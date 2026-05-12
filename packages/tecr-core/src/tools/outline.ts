/**
 * outline(filePath) — signatures + docstrings, no bodies, ≤200 lines (S-04).
 *
 * Language support:
 *   TypeScript/JavaScript — ts-morph symbol extraction, raw-line comment scan.
 *   Rust / Go / Java      — WASM symbol extraction, raw-line comment scan.
 *   Python                — WASM symbol extraction, preceding # comments only.
 *                           Triple-quoted docstrings (inside function bodies)
 *                           are intentionally skipped in S-04.
 */

import path from 'path';
import { readFile } from 'fs/promises';
import { extractSingleFile } from '../ast/typescript.js';
import { extractWasmFile } from '../ast/wasm.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface OutlineResult {
  /** Formatted outline text, ≤200 lines. */
  text: string;
  /** Number of lines in text. Always ≤200. */
  lineCount: number;
  /** True when symbols were dropped to stay within the 200-line limit. */
  truncated: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_LINES = 200;

const TS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);
const WASM_EXTS = new Set(['.rs', '.py', '.go', '.java']);

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Return signatures and any immediately-preceding docstrings for every symbol
 * in filePath, capped at 200 output lines. No function bodies are included.
 *
 * filePath must be an absolute path. Callers are responsible for resolving
 * workspace-relative paths before calling.
 */
export async function outline(filePath: string): Promise<OutlineResult> {
  const ext = path.extname(filePath);

  let record;
  if (TS_EXTS.has(ext)) {
    record = await extractSingleFile(filePath);
  } else if (WASM_EXTS.has(ext)) {
    record = await extractWasmFile(filePath);
  } else {
    throw new Error(`outline: unsupported file type '${ext}'`);
  }

  const source = await readFile(filePath, 'utf8');
  const srcLines = source.split('\n');

  // Build per-symbol blocks: [docstring lines…, signature line]
  const blocks: string[][] = record.symbols.map((sym) => [
    ...extractPrecedingComment(srcLines, sym.line - 1), // sym.line is 1-based
    sym.signature,
  ]);

  // Assemble output, stopping before we exceed MAX_LINES.
  const out: string[] = [`// ${filePath}`, ''];
  let truncated = false;
  let omitted = 0;

  for (let i = 0; i < blocks.length; i++) {
    const withSep = [...blocks[i], ''];

    if (out.length + withSep.length > MAX_LINES) {
      truncated = true;
      omitted = blocks.length - i;
      break;
    }

    out.push(...withSep);
  }

  // Remove the trailing blank separator from the last emitted block.
  while (out.length > 0 && out[out.length - 1] === '') out.pop();

  if (truncated) {
    // The hint replaces the trailing blank, so lineCount stays ≤ MAX_LINES.
    out.push(`[truncated: ${omitted} symbols omitted; use read_lines to see the rest]`);
  }

  return { text: out.join('\n'), lineCount: out.length, truncated };
}

// ── Comment extraction ─────────────────────────────────────────────────────────

/**
 * Scan backwards from line0 (0-based) in srcLines to collect the comment block
 * that immediately precedes a declaration. Returns [] when none is found.
 *
 * Handles:
 *   /** … *\/  block comments (TypeScript JSDoc, Java JavaDoc, Rust)
 *   /* … *\/   block comments
 *   ///        Rust doc-comment lines
 *   //         Line comments (TypeScript, Go, Java, Rust)
 *   #          Python / shell line comments
 */
function extractPrecedingComment(srcLines: string[], line0: number): string[] {
  let i = line0 - 1;

  // Skip blank lines between the comment and the declaration.
  while (i >= 0 && srcLines[i].trim() === '') i--;
  if (i < 0) return [];

  const trimmed = srcLines[i].trim();

  if (trimmed.endsWith('*/')) {
    // Block comment ending — scan back to the opening `/*`.
    const end = i;
    while (i >= 0 && !srcLines[i].trimStart().startsWith('/*')) i--;
    return i >= 0 ? srcLines.slice(i, end + 1) : [];
  }

  if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
    // Consecutive line comments — scan back while lines keep matching.
    const end = i;
    while (i > 0) {
      const prev = srcLines[i - 1].trim();
      if (prev.startsWith('//') || prev.startsWith('#')) i--;
      else break;
    }
    return srcLines.slice(i, end + 1);
  }

  return [];
}
