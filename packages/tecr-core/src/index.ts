/**
 * tecr-core public API.
 *
 * Stable contract across all slices — only the implementations behind these
 * exports change as phases progress.
 */

export const VERSION = '0.0.1';

// ── S-13: telemetry ───────────────────────────────────────────────────────────

export { onTelemetry, emitTelemetry } from './telemetry.js';
export type { TelemetryEvent, TelemetryHandler, ToolAttribution, CompactionSummary } from './telemetry.js';

// ── S-09: token counter ───────────────────────────────────────────────────────

export { countTokens } from './tokenizer.js';

// ── S-10: utilization tracker ─────────────────────────────────────────────────

export { UtilizationTracker, BUDGET_CEILING } from './governor/tracker.js';
export type { TurnRecord, UtilizationSnapshot } from './governor/tracker.js';

// ── S-14: sub-agent isolation ─────────────────────────────────────────────────

export { delegate, SUMMARY_TOKEN_LIMIT } from './subagent/index.js';
export type { DelegateInput, DelegateResult, ArtifactRef, TokenUsage } from './subagent/index.js';

// ── S-11: governor + compactor ────────────────────────────────────────────────

export { Governor, GovernorHardStop, COMPACTION_THRESHOLD } from './governor/index.js';
export { compact, KEEP_RECENT } from './governor/compactor.js';
export type { HistoryEntry, CompactionResult, GovernorRecord } from './governor/index.js';

// ── S-16/S-17/S-18: corpus loader + harness + conformance gate ───────────────

export { loadCorpus } from './harness/corpus.js';
export type { CorpusEntry } from './harness/corpus.js';
export { runCorpusEntry } from './harness/runner.js';
export { computeMetrics } from './harness/metrics.js';
export type { SessionMetrics, SessionMeta, PerTurnInput } from './harness/metrics.js';
export type { RunResult } from './harness/runner.js';
export { checkGates, DISCOVERY_COST_LIMIT, UTILIZATION_PEAK_LIMIT, TRUNCATION_RATE_LIMIT } from './harness/gates.js';
export type { GateResult } from './harness/gates.js';

// ── Re-exports ────────────────────────────────────────────────────────────────

export type { SymbolKind, SymbolRecord, FileRecord } from './ast/types.js';
export type { RankedFile } from './graph.js';
export type { EmitOptions, EmitResult } from './repomap.js';
export type { OutlineResult } from './tools/outline.js';
export type { ReadLinesResult } from './tools/readLines.js';
export type { SearchSymbolResult, SymbolMatch } from './tools/searchSymbol.js';
export type { GrepResult, GrepMatch } from './tools/grep.js';
export type { ReferencesResult, ReferenceMatch } from './tools/references.js';

// ── S-01: echo stub ───────────────────────────────────────────────────────────

export function hello(message: string): string {
  return `TECR ${VERSION}: ${message}`;
}

// ── S-02: repo-map ────────────────────────────────────────────────────────────

export interface RepoMapOptions {
  /** Hard token budget for the emitted map. Default: 1024. */
  budget?: number;
  /** Files the agent currently has open — receive an importance boost. */
  focusFiles?: string[];
}

export interface RepoMapResult {
  text: string;
  tokenCount: number;
  truncated: boolean;
}

// ── S-08: references ──────────────────────────────────────────────────────────

export async function references(
  workspaceRoot: string,
  symbolName: string,
): Promise<import('./tools/references.js').ReferencesResult> {
  const { references: _refs } = await import('./tools/references.js');
  return _refs(workspaceRoot, symbolName);
}

// ── S-07: grep ────────────────────────────────────────────────────────────────

export async function grep(
  workspaceRoot: string,
  pattern: string,
  options?: { caseInsensitive?: boolean },
): Promise<import('./tools/grep.js').GrepResult> {
  const { grep: _grep } = await import('./tools/grep.js');
  return _grep(workspaceRoot, pattern, options);
}

// ── S-06: search_symbol ───────────────────────────────────────────────────────

export async function searchSymbol(
  workspaceRoot: string,
  query: string,
): Promise<import('./tools/searchSymbol.js').SearchSymbolResult> {
  const { searchSymbol: _search } = await import('./tools/searchSymbol.js');
  return _search(workspaceRoot, query);
}

// ── S-05: read_lines ──────────────────────────────────────────────────────────

export async function readLines(
  filePath: string,
  start?: number,
  end?: number,
): Promise<import('./tools/readLines.js').ReadLinesResult> {
  const { readLines: _readLines } = await import('./tools/readLines.js');
  return _readLines(filePath, start, end);
}

// ── S-04: outline ─────────────────────────────────────────────────────────────

export async function outline(
  filePath: string,
): Promise<import('./tools/outline.js').OutlineResult> {
  const { outline: _outline } = await import('./tools/outline.js');
  return _outline(filePath);
}

/**
 * Build a token-budgeted, AST-ranked repo-map for a workspace root.
 *
 * S-02: TypeScript/JavaScript via ts-morph.
 * S-03: Rust, Python, Go, Java via web-tree-sitter (WASM).
 */
export async function buildRepoMap(
  workspaceRoot: string,
  options?: RepoMapOptions,
): Promise<RepoMapResult> {
  const { extractWorkspace } = await import('./ast/typescript.js');
  const { extractWasmLanguages } = await import('./ast/wasm.js');
  const { rankFiles } = await import('./graph.js');
  const { emitRepoMap } = await import('./repomap.js');

  const [tsRecords, wasmRecords] = await Promise.all([
    extractWorkspace(workspaceRoot),
    extractWasmLanguages(workspaceRoot),
  ]);

  const ranked = rankFiles([...tsRecords, ...wasmRecords]);
  return emitRepoMap(ranked, {
    budget: options?.budget ?? 1024,
    workspaceRoot,
    focusFiles: options?.focusFiles,
  });
}
