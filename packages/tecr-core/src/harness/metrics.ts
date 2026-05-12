/**
 * §9.1 metrics types and computation (S-17).
 */

import type { TelemetryEvent } from '../telemetry.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PerTurnInput {
  mean: number;
  p95: number;
}

/** All six §9.1 required metrics for a single corpus session. */
export interface SessionMetrics {
  /** Tokens consumed by the initial repo-map (discovery phase). */
  discoveryCost: number;
  /** Mean and p95 input tokens across all tool calls in the session. */
  perTurnInput: PerTurnInput;
  /** Maximum context utilization fraction observed during the session. */
  utilizationPeak: number;
  /** Fraction of tool calls that returned truncated results [0, 1]. */
  truncationRate: number;
  /** Fraction of read_lines paths already represented in the repo-map [0, 1]. */
  repoMapHitRate: number;
  /**
   * (delegateTotalTokens - delegateSummaryTokens) / delegateTotalTokens.
   * Proportion of sub-agent work that was kept out of the parent context.
   * 0 when no delegate call was made.
   */
  subAgentRoi: number;
}

export interface SessionMeta {
  /** billableTokens of the first event (repo_map discovery phase). */
  discoveryCost: number;
  truncatedCalls: number;
  totalCalls: number;
  repoMapPaths: Set<string>;
  readLinesHits: number;
  readLinesCalls: number;
  /** tokenUsage.totalTokens from the delegate result. */
  delegateTotalTokens: number;
  /** tokenUsage.outputTokens from the delegate result (what entered parent). */
  delegateSummaryTokens: number;
}

// ── Computation ───────────────────────────────────────────────────────────────

export function computeMetrics(events: TelemetryEvent[], meta: SessionMeta): SessionMetrics {
  const inputValues = events.map((e) => e.inputTokens);

  return {
    discoveryCost: meta.discoveryCost,
    perTurnInput: {
      mean: mean(inputValues),
      p95: p95(inputValues),
    },
    utilizationPeak: Math.max(...events.map((e) => e.utilizationFraction), 0),
    truncationRate: meta.totalCalls > 0 ? meta.truncatedCalls / meta.totalCalls : 0,
    repoMapHitRate: meta.readLinesCalls > 0 ? meta.readLinesHits / meta.readLinesCalls : 0,
    subAgentRoi:
      meta.delegateTotalTokens > 0
        ? (meta.delegateTotalTokens - meta.delegateSummaryTokens) / meta.delegateTotalTokens
        : 0,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}
