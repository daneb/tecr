/**
 * Measurement harness runner (spec §9.1–9.2, S-17).
 *
 * Runs a single corpus entry through the TECR-L3 tool surface:
 *   1. buildRepoMap   — discovery phase
 *   2. searchSymbol   — first tool call
 *   3. grep           — second tool call
 *   4. delegate       — sub-agent isolation + ROI
 *   5. readLines      — repo-map hit check on top artifact ref
 *
 * Collects telemetry events via onTelemetry() and computes all §9.1 metrics.
 */

import path from 'path';
import { onTelemetry } from '../telemetry.js';
import { Governor } from '../governor/index.js';
import { searchSymbol } from '../tools/searchSymbol.js';
import { grep } from '../tools/grep.js';
import { readLines } from '../tools/readLines.js';
import { delegate } from '../subagent/index.js';
import { rankFiles } from '../graph.js';
import { emitRepoMap } from '../repomap.js';
import { computeMetrics, type SessionMetrics, type SessionMeta } from './metrics.js';
import type { TelemetryEvent } from '../telemetry.js';
import type { CorpusEntry } from './corpus.js';

const WINDOW_SIZE = 200_000;

// ── Public types ──────────────────────────────────────────────────────────────

export interface RunResult {
  entry: CorpusEntry;
  metrics: SessionMetrics;
  events: TelemetryEvent[];
}

// ── Runner ────────────────────────────────────────────────────────────────────

export async function runCorpusEntry(entry: CorpusEntry): Promise<RunResult> {
  const events: TelemetryEvent[] = [];
  const off = onTelemetry((e) => events.push(e));
  const governor = new Governor();
  const meta: SessionMeta = {
    discoveryCost: 0,
    truncatedCalls: 0,
    totalCalls: 0,
    repoMapPaths: new Set(),
    readLinesHits: 0,
    readLinesCalls: 0,
    delegateTotalTokens: 0,
    delegateSummaryTokens: 0,
  };

  try {
    // 1. Discovery: build repo-map (mirrors buildRepoMap() without circular import).
    const { extractWorkspace } = await import('../ast/typescript.js');
    const { extractWasmLanguages } = await import('../ast/wasm.js');
    const [tsRecords, wasmRecords] = await Promise.all([
      extractWorkspace(entry.sourceRoot),
      extractWasmLanguages(entry.sourceRoot),
    ]);
    const ranked = rankFiles([...tsRecords, ...wasmRecords]);
    const mapResult = emitRepoMap(ranked, { budget: 4096, workspaceRoot: entry.sourceRoot });
    meta.repoMapPaths = extractPaths(mapResult.text, entry.sourceRoot);
    governor.record('repo_map', { workspaceRoot: entry.sourceRoot }, mapResult.text, WINDOW_SIZE);
    meta.totalCalls++;
    if (mapResult.truncated) meta.truncatedCalls++;
    // discoveryCost = billableTokens of the repo_map event (first emitted).
    meta.discoveryCost = events[0]?.billableTokens ?? 0;

    // 2. Symbol search.
    const term = primaryTerm(entry.prompt);
    const symResult = await searchSymbol(entry.sourceRoot, term);
    governor.record('search_symbol', { workspaceRoot: entry.sourceRoot, query: term }, symResult.text, WINDOW_SIZE);
    meta.totalCalls++;
    if (symResult.truncated) meta.truncatedCalls++;

    // 3. Grep.
    const grepResult = await grep(entry.sourceRoot, term);
    governor.record('grep', { workspaceRoot: entry.sourceRoot, pattern: term }, grepResult.text, WINDOW_SIZE);
    meta.totalCalls++;
    if (grepResult.truncated) meta.truncatedCalls++;

    // 4. Delegate (sub-agent isolation).
    const delegateResult = await delegate({ task: entry.prompt, workspaceRoot: entry.sourceRoot });
    governor.record('delegate', { task: entry.prompt }, delegateResult.summary, WINDOW_SIZE);
    meta.totalCalls++;
    meta.delegateTotalTokens = delegateResult.tokenUsage.totalTokens;
    meta.delegateSummaryTokens = delegateResult.tokenUsage.outputTokens;

    // 5. readLines on top artifact ref, if any.
    const topRef = delegateResult.artifactRefs[0];
    if (topRef?.path && topRef.line != null) {
      const start = Math.max(1, topRef.line - 2);
      const rlResult = await readLines(topRef.path, start, start + 49);
      governor.record('read_lines', { filePath: topRef.path, start, end: start + 49 }, rlResult.text, WINDOW_SIZE);
      meta.totalCalls++;
      meta.readLinesCalls++;
      if (meta.repoMapPaths.has(path.resolve(topRef.path))) meta.readLinesHits++;
      if (rlResult.truncated) meta.truncatedCalls++;
    }
  } finally {
    off();
  }

  const metrics = computeMetrics(events, meta);
  return { entry, metrics, events };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract the primary search term from a natural-language prompt.
 * Preference order: first PascalCase word → method name → first long noun.
 */
function primaryTerm(prompt: string): string {
  const pascal = prompt.match(/\b([A-Z][a-zA-Z]{2,})\b/);
  if (pascal) return pascal[1];

  const method = prompt.match(/\.([a-z][a-zA-Z]+)\(/);
  if (method) return method[1];

  const skip = new Set(['find', 'all', 'that', 'with', 'from', 'their', 'handle', 'which', 'these']);
  const word = prompt
    .toLowerCase()
    .split(/\W+/)
    .find((w) => w.length >= 5 && !skip.has(w));
  return word ?? 'export';
}

/** Parse absolute file paths from repo-map text. */
function extractPaths(text: string, sourceRoot: string): Set<string> {
  const paths = new Set<string>();
  for (const line of text.split('\n')) {
    const m = line.match(/^(\S.*\.(ts|tsx|rs|py|go|java|js|cs))(\s|$)/);
    if (m) paths.add(path.resolve(sourceRoot, m[1]));
  }
  return paths;
}
