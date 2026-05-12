/**
 * references(workspaceRoot, symbolName) — AST-assisted reference lookup (S-08).
 *
 * Finds all call sites for a named symbol across the workspace. Definition
 * lines (identified via AST) are excluded from results. Hard limit: 100
 * matches. Respects §6.3 exclusion dirs.
 */

import path from 'path';
import { readdir, readFile } from 'fs/promises';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ReferenceMatch {
  filePath: string;
  /** 1-based line number. */
  line: number;
  text: string;
  /** Up to 2 lines before, in source order. */
  before: string[];
  /** Up to 2 lines after, in source order. */
  after: string[];
}

export interface ReferencesResult {
  matches: ReferenceMatch[];
  totalMatches: number;
  truncated: boolean;
  /** Human-readable formatted output. */
  text: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_MATCHES = 100;
const CONTEXT = 2;

const EXCLUDE_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', 'out', 'coverage',
  'target',
  '__pycache__', '.venv', 'venv',
  'vendor',
]);

// ── Public API ─────────────────────────────────────────────────────────────────

export async function references(
  workspaceRoot: string,
  symbolName: string,
): Promise<ReferencesResult> {
  const defKeys = await findDefinitionKeys(workspaceRoot, symbolName);

  const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\b`);

  const files = await collectFiles(workspaceRoot);
  const matches: ReferenceMatch[] = [];
  let totalMatches = 0;
  let done = false;

  for (const filePath of files) {
    if (done) break;

    let source: string;
    try {
      source = await readFile(filePath, 'utf8');
    } catch {
      continue;
    }

    if (source.slice(0, 8192).includes('\0')) continue;

    const lines = source.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue;

      const lineNum = i + 1;
      if (defKeys.has(`${filePath}:${lineNum}`)) continue;

      totalMatches++;

      if (matches.length < MAX_MATCHES) {
        matches.push({
          filePath,
          line: lineNum,
          text: lines[i],
          before: lines.slice(Math.max(0, i - CONTEXT), i),
          after: lines.slice(i + 1, Math.min(lines.length, i + 1 + CONTEXT)),
        });
      } else {
        done = true;
        break;
      }
    }
  }

  const truncated = totalMatches > MAX_MATCHES;

  return {
    matches,
    totalMatches,
    truncated,
    text: format(matches, symbolName, totalMatches, workspaceRoot, truncated),
  };
}

// ── Definition exclusion ───────────────────────────────────────────────────────

async function findDefinitionKeys(
  workspaceRoot: string,
  symbolName: string,
): Promise<Set<string>> {
  const { searchSymbol } = await import('./searchSymbol.js');
  const result = await searchSymbol(workspaceRoot, symbolName);
  const keys = new Set<string>();
  for (const m of result.matches) {
    if (m.name === symbolName) {
      keys.add(`${m.filePath}:${m.line}`);
    }
  }
  return keys;
}

// ── File collection ────────────────────────────────────────────────────────────

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  const files: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const entryDir: string = e.parentPath;
    const rel = path.relative(dir, path.join(entryDir, e.name));
    const parts = rel.split(path.sep);
    if (parts.some((p) => EXCLUDE_DIRS.has(p))) continue;
    if (e.name.endsWith('.d.ts')) continue;
    files.push(path.join(entryDir, e.name));
  }
  return files.sort();
}

// ── Output formatting ──────────────────────────────────────────────────────────

function format(
  matches: ReferenceMatch[],
  symbolName: string,
  total: number,
  workspaceRoot: string,
  truncated: boolean,
): string {
  if (matches.length === 0) {
    return `No references found for '${symbolName}'.`;
  }

  const header =
    total > MAX_MATCHES
      ? `${total} references to '${symbolName}' (showing first ${MAX_MATCHES}):`
      : `${total} reference${total === 1 ? '' : 's'} to '${symbolName}':`;

  const blocks = matches.map((m) => renderMatch(m, workspaceRoot));
  const parts = [header, '', ...blocks.join('\n\n').split('\n')];

  if (truncated) {
    parts.push('', `[truncated: ${total - MAX_MATCHES} more references; narrow your search to see fewer results]`);
  }

  return parts.join('\n');
}

function renderMatch(m: ReferenceMatch, workspaceRoot: string): string {
  const rel = path.relative(workspaceRoot, m.filePath);
  const width = (m.line + CONTEXT).toString().length;
  const lines: string[] = [`${rel}:${m.line}`];

  for (let i = 0; i < m.before.length; i++) {
    const n = (m.line - m.before.length + i).toString().padStart(width);
    lines.push(`  ${n}: ${m.before[i]}`);
  }

  lines.push(`> ${m.line.toString().padStart(width)}: ${m.text}`);

  for (let i = 0; i < m.after.length; i++) {
    const n = (m.line + 1 + i).toString().padStart(width);
    lines.push(`  ${n}: ${m.after[i]}`);
  }

  return lines.join('\n');
}
