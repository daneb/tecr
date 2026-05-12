/**
 * §9.3 acceptance gate definitions and checker (S-18).
 *
 * A reference implementation passes TECR-L4 when all three gates hold on the
 * corpus. These are architectural invariants, not tuneable settings.
 */

import type { SessionMetrics } from './metrics.js';

// ── Gate constants (§9.3) ─────────────────────────────────────────────────────

export const DISCOVERY_COST_LIMIT = 15_000;   // tokens
export const UTILIZATION_PEAK_LIMIT = 0.40;   // fraction of 200 k window
export const TRUNCATION_RATE_LIMIT = 0.20;    // fraction of tool calls (strict <)

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GateResult {
  corpusId: string;
  metric: string;
  value: number;
  limit: number;
  /** The comparison used: ≤ for cost/utilization, < for truncation rate. */
  operator: '<=' | '<';
  pass: boolean;
}

// ── Checker ───────────────────────────────────────────────────────────────────

export function checkGates(corpusId: string, metrics: SessionMetrics): GateResult[] {
  return [
    {
      corpusId,
      metric: 'discoveryCost',
      value: metrics.discoveryCost,
      limit: DISCOVERY_COST_LIMIT,
      operator: '<=',
      pass: metrics.discoveryCost <= DISCOVERY_COST_LIMIT,
    },
    {
      corpusId,
      metric: 'utilizationPeak',
      value: metrics.utilizationPeak,
      limit: UTILIZATION_PEAK_LIMIT,
      operator: '<=',
      pass: metrics.utilizationPeak <= UTILIZATION_PEAK_LIMIT,
    },
    {
      corpusId,
      metric: 'truncationRate',
      value: metrics.truncationRate,
      limit: TRUNCATION_RATE_LIMIT,
      operator: '<',
      pass: metrics.truncationRate < TRUNCATION_RATE_LIMIT,
    },
  ];
}
