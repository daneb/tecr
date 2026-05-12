/**
 * Budgeted repo-map emitter (spec §5.2–5.3).
 *
 * Emits a single text artifact from a ranked set of FileRecords. Files
 * are walked in PageRank order; within each file, symbols are ordered by
 * their export status then declaration order.
 */

import path from 'path';
import type { RankedFile } from './graph.js';
import type { SymbolRecord } from './ast/types.js';
import { countTokens } from './tokenizer.js';

export interface EmitOptions {
  /** Hard token budget. Default: 1024. */
  budget: number;
  /** Workspace root — used to compute relative paths in output. */
  workspaceRoot: string;
  /**
   * Files currently open in the editor; symbols in these files receive an
   * importance boost by being emitted before other files of equal rank.
   */
  focusFiles?: string[];
}

export interface EmitResult {
  text: string;
  tokenCount: number;
  truncated: boolean;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function emitRepoMap(rankedFiles: RankedFile[], opts: EmitOptions): EmitResult {
  const ordered = applyFocusBoost(rankedFiles, opts.focusFiles ?? []);
  return fitToBudget(ordered, opts);
}

// ── Internal ──────────────────────────────────────────────────────────────────

/**
 * Move focus files to the front of the ranked list while preserving the
 * internal ordering of both groups.
 */
function applyFocusBoost(ranked: RankedFile[], focusFiles: string[]): RankedFile[] {
  if (focusFiles.length === 0) return ranked;
  const focusSet = new Set(focusFiles);
  const focus = ranked.filter((f) => focusSet.has(f.record.path));
  const rest = ranked.filter((f) => !focusSet.has(f.record.path));
  return [...focus, ...rest];
}

/**
 * Binary-search for the largest prefix of files that fits within budget.
 * Falls back to a linear scan when individual files already exceed budget.
 */
function fitToBudget(ranked: RankedFile[], opts: EmitOptions): EmitResult {
  const { budget, workspaceRoot } = opts;

  // Render each file as a block; collect until budget exhausted.
  const blocks: string[] = [];
  let tokens = 0;
  let truncated = false;

  for (const { record } of ranked) {
    if (record.symbols.length === 0) continue;

    const relPath = path.relative(workspaceRoot, record.path);
    const headerLine = `${relPath}:\n`;
    const symbolLines = renderSymbols(record.symbols);

    const blockText = headerLine + symbolLines.join('\n') + '\n';
    const blockTokens = estimateTokens(blockText);

    if (tokens + blockTokens <= budget) {
      blocks.push(blockText);
      tokens += blockTokens;
    } else {
      // Try to fit a partial block
      const partial = fitPartialBlock(relPath, symbolLines, budget - tokens);
      if (partial) {
        blocks.push(partial.text);
        tokens += partial.tokens;
      }
      truncated = true;
      break;
    }
  }

  return {
    text: blocks.join('\n'),
    tokenCount: tokens,
    truncated,
  };
}

interface PartialBlock {
  text: string;
  tokens: number;
}

function fitPartialBlock(
  relPath: string,
  symbolLines: string[],
  remaining: number,
): PartialBlock | null {
  const header = `${relPath}:\n`;
  const headerTokens = estimateTokens(header);
  if (headerTokens > remaining) return null;

  const fittedLines: string[] = [];
  let tokens = headerTokens;

  for (const line of symbolLines) {
    const t = estimateTokens(line + '\n');
    if (tokens + t > remaining) {
      fittedLines.push('  …');
      break;
    }
    fittedLines.push(line);
    tokens += t;
  }

  if (fittedLines.length === 0) return null;
  return { text: header + fittedLines.join('\n') + '\n', tokens };
}

function renderSymbols(symbols: SymbolRecord[]): string[] {
  // Exported symbols first, then internal; within each group, declaration order.
  const exported = symbols.filter((s) => s.exported);
  const internal = symbols.filter((s) => !s.exported);
  return [...exported, ...internal].map((s) => `  ${s.signature} …`);
}

function estimateTokens(text: string): number {
  return countTokens(text);
}
