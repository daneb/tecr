/**
 * grep(workspaceRoot, pattern) — lexical file search with ±2 context lines (S-07).
 *
 * pattern is treated as a literal string (not a regular expression). Pass
 * caseInsensitive: true for case-insensitive matching. Hard limit: 100 matches.
 * Excludes build artefacts and dependency directories per §6.3.
 */

import path from 'path';
import { readdir, readFile } from 'fs/promises';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface GrepMatch {
  filePath: string;
  /** 1-based line number of the matching line. */
  line: number;
  /** Content of the matching line (no trailing newline). */
  text: string;
  /** Up to 2 lines immediately before the match, in source order. */
  before: string[];
  /** Up to 2 lines immediately after the match, in source order. */
  after: string[];
}

export interface GrepResult {
  matches: GrepMatch[];
  /** Total matches found before the 100-result cap. */
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

export async function grep(
  workspaceRoot: string,
  pattern: string,
  options: { caseInsensitive?: boolean } = {},
): Promise<GrepResult> {
  // Escape pattern so it is treated as a literal string, not a regex.
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const flags = options.caseInsensitive ? 'i' : '';
  const re = new RegExp(escaped, flags);

  const files = await collectFiles(workspaceRoot);
  const matches: GrepMatch[] = [];
  let totalMatches = 0;
  let done = false;

  for (const filePath of files) {
    if (done) break;

    let source: string;
    try {
      source = await readFile(filePath, 'utf8');
    } catch {
      continue; // skip unreadable files
    }

    // Skip binary files (null bytes in first 8 KB).
    if (source.slice(0, 8192).includes('\0')) continue;

    const lines = source.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue;

      totalMatches++;

      if (matches.length < MAX_MATCHES) {
        const lineNum = i + 1;
        const before = lines.slice(Math.max(0, i - CONTEXT), i);
        const after = lines.slice(i + 1, Math.min(lines.length, i + 1 + CONTEXT));
        matches.push({ filePath, line: lineNum, text: lines[i], before, after });
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
    text: format(matches, pattern, totalMatches, workspaceRoot),
  };
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
  matches: GrepMatch[],
  pattern: string,
  total: number,
  workspaceRoot: string,
): string {
  if (matches.length === 0) {
    return `No matches found for '${pattern}'.`;
  }

  const header =
    total > MAX_MATCHES
      ? `${total} matches for '${pattern}' (showing first ${MAX_MATCHES}):`
      : `${total} match${total === 1 ? '' : 'es'} for '${pattern}':`;

  const blocks = matches.map((m) => renderMatch(m, workspaceRoot));
  const parts = [header, '', ...blocks.join('\n\n').split('\n')];

  if (total > MAX_MATCHES) {
    parts.push('', `[truncated: ${total - MAX_MATCHES} more matches; narrow your pattern to see fewer results]`);
  }

  return parts.join('\n');
}

function renderMatch(m: GrepMatch, workspaceRoot: string): string {
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
