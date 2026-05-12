/**
 * S-18: TECR-L4 conformance gate — acceptance tests.
 *
 * Exit criteria:
 * - checkGates() returns exactly 3 GateResults per corpus entry.
 * - All gates pass when metrics are within thresholds.
 * - Each gate fails correctly when its threshold is exceeded.
 * - Gate constants match §9.3 values.
 */

import { describe, it, expect } from 'vitest';
import {
  checkGates,
  DISCOVERY_COST_LIMIT,
  UTILIZATION_PEAK_LIMIT,
  TRUNCATION_RATE_LIMIT,
} from '../harness/gates.js';
import type { SessionMetrics } from '../harness/metrics.js';

function makeMetrics(overrides: Partial<SessionMetrics> = {}): SessionMetrics {
  return {
    discoveryCost: 1_000,
    perTurnInput: { mean: 20, p95: 30 },
    utilizationPeak: 0.05,
    truncationRate: 0.0,
    repoMapHitRate: 1.0,
    subAgentRoi: 0.9,
    ...overrides,
  };
}

describe('§9.3 gate constants', () => {
  it('discoveryCost limit is 15 000 tokens', () => {
    expect(DISCOVERY_COST_LIMIT).toBe(15_000);
  });

  it('utilizationPeak limit is 0.40', () => {
    expect(UTILIZATION_PEAK_LIMIT).toBe(0.40);
  });

  it('truncationRate limit is 0.20 (strict <)', () => {
    expect(TRUNCATION_RATE_LIMIT).toBe(0.20);
  });
});

describe('checkGates()', () => {
  it('exit criterion: returns exactly 3 results', () => {
    const results = checkGates('test', makeMetrics());
    expect(results).toHaveLength(3);
  });

  it('all gates pass for well-behaved metrics', () => {
    const results = checkGates('test', makeMetrics());
    for (const r of results) {
      expect(r.pass).toBe(true);
    }
  });

  it('discoveryCost gate passes at exactly 15 000', () => {
    const results = checkGates('test', makeMetrics({ discoveryCost: 15_000 }));
    const gate = results.find((r) => r.metric === 'discoveryCost')!;
    expect(gate.pass).toBe(true);
    expect(gate.operator).toBe('<=');
  });

  it('discoveryCost gate fails at 15 001', () => {
    const results = checkGates('test', makeMetrics({ discoveryCost: 15_001 }));
    const gate = results.find((r) => r.metric === 'discoveryCost')!;
    expect(gate.pass).toBe(false);
  });

  it('utilizationPeak gate passes at exactly 0.40', () => {
    const results = checkGates('test', makeMetrics({ utilizationPeak: 0.40 }));
    const gate = results.find((r) => r.metric === 'utilizationPeak')!;
    expect(gate.pass).toBe(true);
  });

  it('utilizationPeak gate fails at 0.401', () => {
    const results = checkGates('test', makeMetrics({ utilizationPeak: 0.401 }));
    const gate = results.find((r) => r.metric === 'utilizationPeak')!;
    expect(gate.pass).toBe(false);
  });

  it('truncationRate gate passes at 0.199 (strict <)', () => {
    const results = checkGates('test', makeMetrics({ truncationRate: 0.199 }));
    const gate = results.find((r) => r.metric === 'truncationRate')!;
    expect(gate.pass).toBe(true);
    expect(gate.operator).toBe('<');
  });

  it('truncationRate gate fails at exactly 0.20 (strict <, not ≤)', () => {
    const results = checkGates('test', makeMetrics({ truncationRate: 0.20 }));
    const gate = results.find((r) => r.metric === 'truncationRate')!;
    expect(gate.pass).toBe(false);
  });

  it('result carries corpusId, value, and limit', () => {
    const metrics = makeMetrics({ discoveryCost: 5_000 });
    const results = checkGates('bincode', metrics);
    const gate = results.find((r) => r.metric === 'discoveryCost')!;
    expect(gate.corpusId).toBe('bincode');
    expect(gate.value).toBe(5_000);
    expect(gate.limit).toBe(DISCOVERY_COST_LIMIT);
  });

  it('independent gates can mix pass and fail', () => {
    const results = checkGates('test', makeMetrics({
      discoveryCost: 20_000,   // fail
      utilizationPeak: 0.10,  // pass
      truncationRate: 0.30,   // fail
    }));
    const passing = results.filter((r) => r.pass);
    const failing = results.filter((r) => !r.pass);
    expect(passing).toHaveLength(1);
    expect(failing).toHaveLength(2);
  });
});
