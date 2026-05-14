/**
 * TypeScript/JavaScript symbol and import extractor.
 *
 * Uses ts-morph (TypeScript compiler API) for accurate, semantic-aware
 * extraction. Switched from native tree-sitter bindings because Node.js 25
 * lacks prebuilt packages for tree-sitter@0.25.0.
 *
 * S-03 will introduce web-tree-sitter (WASM) for the remaining languages.
 */

import { Project, Node, SyntaxKind, SourceFile } from 'ts-morph';
import path from 'path';
import type { FileRecord, SymbolRecord, SymbolKind } from './types.js';

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);

const EXCLUDE_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'out', 'coverage']);

/** Lazy-created project; reused across calls within a process. */
let project: Project | null = null;

function getProject(): Project {
  if (!project) {
    project = new Project({
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        allowJs: true,
        noEmit: true,
        skipLibCheck: true,
      },
    });
  }
  return project;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse a single TypeScript/JavaScript file and return its FileRecord.
 * The source file is removed from the project after extraction to prevent
 * unbounded accumulation in long-running processes.
 */
export async function extractSingleFile(filePath: string): Promise<FileRecord> {
  const { readFile } = await import('fs/promises');
  const content = await readFile(filePath, 'utf8');
  const proj = getProject();
  const sf = proj.createSourceFile(filePath, content, { overwrite: true });
  const record = extractFile(sf, path.dirname(filePath));
  proj.removeSourceFile(sf);
  return record;
}

/**
 * Scan all TypeScript/JavaScript files in workspaceRoot and return one
 * FileRecord per file. Excludes declaration files, build output, and
 * dependency directories.
 */
export async function extractWorkspace(workspaceRoot: string): Promise<FileRecord[]> {
  const { readdir, readFile } = await import('fs/promises');
  const files = await collectFiles(workspaceRoot, readdir);
  const proj = getProject();

  // Reset: remove any stale source files from a previous call.
  for (const sf of proj.getSourceFiles()) {
    proj.removeSourceFile(sf);
  }

  const records: FileRecord[] = [];
  for (const filePath of files) {
    try {
      const content = await readFile(filePath, 'utf8');
      const sf = proj.createSourceFile(filePath, content, { overwrite: true });
      records.push(extractFile(sf, workspaceRoot));
    } catch {
      // skip unparseable files rather than crashing the server
    }
  }

  return records;
}

// ── Private helpers ───────────────────────────────────────────────────────────

async function collectFiles(
  dir: string,
  readdir: typeof import('fs/promises').readdir,
): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  const files: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const entryDir: string = e.parentPath;
    const rel = path.relative(dir, path.join(entryDir, e.name));
    const parts = rel.split(path.sep);
    if (parts.some((p) => EXCLUDE_DIRS.has(p))) continue;
    if (e.name.endsWith('.d.ts')) continue;
    if (!EXTENSIONS.has(path.extname(e.name))) continue;
    files.push(path.join(entryDir, e.name));
  }
  return files;
}

function extractFile(sf: SourceFile, workspaceRoot: string): FileRecord {
  const symbols: SymbolRecord[] = [];
  const imports: string[] = [];

  // ── Imports (dependency graph edges) ─────────────────────────────────────

  for (const importDecl of sf.getImportDeclarations()) {
    const moduleSpecifier = importDecl.getModuleSpecifierValue();
    if (!moduleSpecifier.startsWith('.')) continue; // skip external packages

    const resolved = importDecl.getModuleSpecifierSourceFile();
    if (resolved) {
      imports.push(resolved.getFilePath());
    } else {
      // Best-effort: resolve manually
      const candidate = resolveRelative(sf.getFilePath(), moduleSpecifier);
      if (candidate) imports.push(candidate);
    }
  }

  // ── Top-level statements ─────────────────────────────────────────────────

  for (const stmt of sf.getStatements()) {
    extractStatement(stmt, symbols, false);
  }

  return { path: sf.getFilePath(), symbols, imports };
}

function extractStatement(
  node: Node,
  symbols: SymbolRecord[],
  parentExported: boolean,
): void {
  // export { ... } / export default
  if (Node.isExportDeclaration(node)) return;

  const isExported = parentExported || hasExportModifier(node);

  if (Node.isFunctionDeclaration(node)) {
    const name = node.getName();
    if (name) symbols.push(record(name, 'function', signatureOf(node), node.getStartLineNumber(), isExported));
    return;
  }

  if (Node.isClassDeclaration(node)) {
    const name = node.getName();
    if (name) symbols.push(record(name, 'class', signatureOf(node), node.getStartLineNumber(), isExported));
    for (const m of node.getMethods()) {
      symbols.push(record(
        `${name}.${m.getName()}`,
        'method',
        signatureOf(m),
        m.getStartLineNumber(),
        m.hasModifier(SyntaxKind.PublicKeyword) || !m.hasModifier(SyntaxKind.PrivateKeyword),
      ));
    }
    return;
  }

  if (Node.isInterfaceDeclaration(node)) {
    const name = node.getName();
    symbols.push(record(name, 'interface', signatureOf(node), node.getStartLineNumber(), isExported));
    return;
  }

  if (Node.isTypeAliasDeclaration(node)) {
    const name = node.getName();
    symbols.push(record(name, 'type', signatureOf(node), node.getStartLineNumber(), isExported));
    return;
  }

  if (Node.isEnumDeclaration(node)) {
    const name = node.getName();
    symbols.push(record(name, 'enum', signatureOf(node), node.getStartLineNumber(), isExported));
    return;
  }

  if (Node.isVariableStatement(node)) {
    for (const decl of node.getDeclarations()) {
      const name = decl.getName();
      // Only scalars and arrow functions — skip destructured bindings
      if (name && !name.startsWith('{') && !name.startsWith('[')) {
        const init = decl.getInitializer();
        const kind: SymbolKind =
          init !== undefined && Node.isArrowFunction(init) ? 'function' : 'variable';
        symbols.push(record(name, kind, signatureOf(decl), decl.getStartLineNumber(), isExported));
      }
    }
    return;
  }

  // Unwrap export statement
  if (Node.isExportAssignment(node)) return;
  if (node.getKind() === SyntaxKind.ExportKeyword) return;

  // export function foo() / export class Bar {}
  const children = node.getChildren();
  for (const child of children) {
    if (
      Node.isFunctionDeclaration(child) ||
      Node.isClassDeclaration(child) ||
      Node.isInterfaceDeclaration(child) ||
      Node.isTypeAliasDeclaration(child) ||
      Node.isEnumDeclaration(child)
    ) {
      extractStatement(child, symbols, isExported);
    }
  }
}

function record(
  name: string,
  kind: SymbolKind,
  signature: string,
  line: number,
  exported: boolean,
): SymbolRecord {
  return { name, kind, signature, line, exported };
}

function hasExportModifier(node: Node): boolean {
  if (!Node.isModifierable(node)) return false;
  return (node as Node & { hasModifier(k: SyntaxKind): boolean }).hasModifier(
    SyntaxKind.ExportKeyword,
  );
}

/** Return only the first line of a node's text (the signature, without the body). */
function signatureOf(node: Node): string {
  const text = node.getText();
  const brace = text.indexOf('{');
  const firstLine = text.split('\n')[0].trim();
  if (brace === -1 || firstLine.length < text.length) return firstLine;
  return firstLine;
}

function resolveRelative(fromFile: string, specifier: string): string | null {
  const dir = path.dirname(fromFile);
  const candidates = [
    specifier,
    `${specifier}.ts`,
    `${specifier}.tsx`,
    `${specifier}.js`,
    `${specifier}/index.ts`,
    `${specifier}/index.js`,
  ];
  for (const c of candidates) {
    const abs = path.resolve(dir, c);
    if (EXTENSIONS.has(path.extname(abs))) return abs;
  }
  return null;
}
