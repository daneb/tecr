/**
 * WASM-based multi-language symbol extractor (S-03).
 *
 * Uses web-tree-sitter (WASM runtime, no native bindings — Node 25-safe) with
 * prebuilt grammars from tree-sitter-wasms for Rust, Python, Go, and Java.
 *
 * Plugs into the same FileRecord abstraction as ast/typescript.ts (the
 * TypeScript reference implementation). Import resolution is left empty for
 * all WASM languages in S-03; cross-language edges land in a later sprint.
 */

import path from 'path';
import { existsSync } from 'fs';
import type ParserType from 'web-tree-sitter';
import type { FileRecord, SymbolRecord, SymbolKind } from './types.js';

type WasmNode = ParserType.SyntaxNode;

// ── Types ──────────────────────────────────────────────────────────────────────

interface SymbolExtractor {
  nodeType: string;
  kind: SymbolKind;
  getName(node: WasmNode): string | null;
  isExported(node: WasmNode): boolean;
}

interface LangConfig {
  extensions: Set<string>;
  grammarWasm: string;
  extractors: SymbolExtractor[];
}

// ── Per-language export helpers ────────────────────────────────────────────────

function nameField(node: WasmNode): string | null {
  return node.childForFieldName('name')?.text ?? null;
}

/** Rust: exported if a `pub` visibility modifier is present. */
function hasPubVisibility(node: WasmNode): boolean {
  return node.namedChildren.some((c) => c.type === 'visibility_modifier');
}

/** Go: exported if the first character of the name is uppercase (Go convention). */
function isGoExported(node: WasmNode): boolean {
  const name = node.childForFieldName('name')?.text ?? '';
  return name.length > 0 && name[0] >= 'A' && name[0] <= 'Z';
}

/** Python: exported if the name does not start with an underscore. */
function isPythonExported(node: WasmNode): boolean {
  return !(node.childForFieldName('name')?.text ?? '').startsWith('_');
}

/** Java: exported if the `modifiers` child contains the `public` keyword. */
function isJavaPublic(node: WasmNode): boolean {
  const mods = node.namedChildren.find((c) => c.type === 'modifiers');
  return mods ? /\bpublic\b/.test(mods.text) : false;
}

// ── Language configs ───────────────────────────────────────────────────────────

const RUST: LangConfig = {
  extensions: new Set(['.rs']),
  grammarWasm: 'tree-sitter-rust.wasm',
  extractors: [
    { nodeType: 'function_item', kind: 'function',  getName: nameField, isExported: hasPubVisibility },
    { nodeType: 'struct_item',   kind: 'class',     getName: nameField, isExported: hasPubVisibility },
    { nodeType: 'enum_item',     kind: 'enum',      getName: nameField, isExported: hasPubVisibility },
    { nodeType: 'trait_item',    kind: 'interface', getName: nameField, isExported: hasPubVisibility },
    { nodeType: 'type_item',     kind: 'type',      getName: nameField, isExported: hasPubVisibility },
  ],
};

const PYTHON: LangConfig = {
  extensions: new Set(['.py']),
  grammarWasm: 'tree-sitter-python.wasm',
  extractors: [
    { nodeType: 'function_definition', kind: 'function', getName: nameField, isExported: isPythonExported },
    { nodeType: 'class_definition',    kind: 'class',    getName: nameField, isExported: isPythonExported },
  ],
};

const GO: LangConfig = {
  extensions: new Set(['.go']),
  grammarWasm: 'tree-sitter-go.wasm',
  extractors: [
    { nodeType: 'function_declaration', kind: 'function', getName: nameField, isExported: isGoExported },
    { nodeType: 'method_declaration',   kind: 'method',   getName: nameField, isExported: isGoExported },
    // type_spec is the named child of type_declaration; searching descendants
    // of root finds all type specs at any nesting depth.
    { nodeType: 'type_spec',            kind: 'class',    getName: nameField, isExported: isGoExported },
  ],
};

const JAVA: LangConfig = {
  extensions: new Set(['.java']),
  grammarWasm: 'tree-sitter-java.wasm',
  extractors: [
    { nodeType: 'class_declaration',     kind: 'class',     getName: nameField, isExported: isJavaPublic },
    { nodeType: 'interface_declaration', kind: 'interface', getName: nameField, isExported: isJavaPublic },
    { nodeType: 'enum_declaration',      kind: 'enum',      getName: nameField, isExported: isJavaPublic },
    { nodeType: 'method_declaration',    kind: 'method',    getName: nameField, isExported: isJavaPublic },
  ],
};

const LANG_CONFIGS: LangConfig[] = [RUST, PYTHON, GO, JAVA];

const EXCLUDE_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', 'out', 'coverage',
  'target',                              // Rust
  '__pycache__', '.venv', 'venv',        // Python
  'vendor',                              // Go
]);

// ── WASM runtime singleton ─────────────────────────────────────────────────────

/**
 * Resolves an absolute path inside an npm package's installation directory.
 *
 * Two strategies:
 * 1. `require.resolve(pkg)` — works for packages with a valid CJS main entry
 *    (e.g. web-tree-sitter). Returns the entry file path; we take its dirname.
 * 2. `require.resolve.paths(pkg)` probe — for packages whose package.json
 *    `main` field points to a non-existent file (e.g. tree-sitter-wasms with
 *    `main: "bindings/node"`). We iterate Node's module search paths and
 *    check for the package directory directly via existsSync, bypassing the
 *    broken main.
 */
function resolveWasmPath(pkg: string, ...parts: string[]): string {
  // Strategy 1: package has a resolvable CJS entry.
  try {
    return path.join(path.dirname(require.resolve(pkg)), ...parts);
  } catch { /* fall through to strategy 2 */ }

  // Strategy 2: probe Node's module lookup directories.
  const searchPaths: string[] = require.resolve.paths(pkg) ?? [];
  for (const searchDir of searchPaths) {
    const candidate = path.join(searchDir, pkg);
    if (existsSync(candidate)) return path.join(candidate, ...parts);
  }

  throw new Error(`Cannot locate package directory for: ${pkg}`);
}

let _initPromise: Promise<void> | null = null;

async function ensureParserInit(): Promise<void> {
  if (!_initPromise) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const _Parser = ((await import('web-tree-sitter')) as any).default;
    _initPromise = _Parser.init({
      locateFile: (name: string) => resolveWasmPath('web-tree-sitter', name),
    }) as Promise<void>;
  }
  return _initPromise!;
}

// One Parser instance per grammar, reused across files.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _parserCache = new Map<string, any>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getParser(config: LangConfig): Promise<any> {
  const cached = _parserCache.get(config.grammarWasm);
  if (cached) return cached;

  await ensureParserInit();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _Parser = ((await import('web-tree-sitter')) as any).default;

  const wasmFile = resolveWasmPath('tree-sitter-wasms', 'out', config.grammarWasm);
  const language = await _Parser.Language.load(wasmFile);

  const parser = new _Parser();
  parser.setLanguage(language);
  _parserCache.set(config.grammarWasm, parser);
  return parser;
}

// ── File collection ────────────────────────────────────────────────────────────

async function collectFiles(dir: string, extensions: Set<string>): Promise<string[]> {
  const { readdir } = await import('fs/promises');
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  const files: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const entryDir: string = e.parentPath;
    const rel = path.relative(dir, path.join(entryDir, e.name));
    const parts = rel.split(path.sep);
    if (parts.some((p) => EXCLUDE_DIRS.has(p))) continue;
    if (!extensions.has(path.extname(e.name))) continue;
    files.push(path.join(entryDir, e.name));
  }
  return files;
}

// ── Single-file parsing ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function parseFile(filePath: string, parser: any, extractors: SymbolExtractor[]): Promise<FileRecord> {
  const { readFile } = await import('fs/promises');
  const source = await readFile(filePath, 'utf8');
  const tree = parser.parse(source);
  const root = tree.rootNode;

  const symbols: SymbolRecord[] = [];
  const seen = new Set<string>();

  for (const extractor of extractors) {
    for (const node of root.descendantsOfType(extractor.nodeType)) {
      const name = extractor.getName(node);
      if (!name) continue;
      const line = node.startPosition.row + 1; // tree-sitter rows are 0-based
      const key = `${name}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      symbols.push({
        name,
        kind: extractor.kind,
        signature: node.text.split('\n')[0].trim(),
        line,
        exported: extractor.isExported(node),
      });
    }
  }

  symbols.sort((a, b) => a.line - b.line);
  return { path: filePath, symbols, imports: [] };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Parse a single file using the appropriate WASM grammar and return its FileRecord.
 * Throws if the file's extension is not handled by any configured language.
 */
export async function extractWasmFile(filePath: string): Promise<FileRecord> {
  const ext = path.extname(filePath);
  const config = LANG_CONFIGS.find((c) => c.extensions.has(ext));
  if (!config) throw new Error(`outline: no WASM extractor for extension '${ext}'`);
  const parser = await getParser(config);
  return parseFile(filePath, parser, config.extractors);
}

/**
 * Scan workspaceRoot for Rust, Python, Go, and Java files and return one
 * FileRecord per file. Excludes build artifacts and dependency directories.
 */
export async function extractWasmLanguages(workspaceRoot: string): Promise<FileRecord[]> {
  const allRecords: FileRecord[] = [];

  for (const config of LANG_CONFIGS) {
    const files = await collectFiles(workspaceRoot, config.extensions);
    if (files.length === 0) continue;

    const parser = await getParser(config);
    for (const filePath of files) {
      allRecords.push(await parseFile(filePath, parser, config.extractors));
    }
  }

  return allRecords;
}
