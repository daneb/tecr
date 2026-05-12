/**
 * S-10: Utilization tracker — acceptance tests.
 *
 * Exit criteria:
 * - tracker.record({ inputTokens: 1000, outputTokens: 200, windowSize: 200000 })
 *   returns utilization: 0.006.
 * - Utilization accumulates across multiple turns.
 * - reset() clears state.
 * - snapshot() returns current state without recording a turn.
 * - BUDGET_CEILING is 0.4.
 */

import { describe, it, expect } from 'vitest';
import { UtilizationTracker, BUDGET_CEILING } from '../governor/tracker.js';

describe('UtilizationTracker', () => {
  it('exit criterion: 1000 input + 200 output on 200k window → utilization 0.006', () => {
    const tracker = new UtilizationTracker();
    const snap = tracker.record({ inputTokens: 1000, outputTokens: 200, windowSize: 200_000 });
    expect(snap.utilization).toBeCloseTo(0.006);
  });

  it('accumulates tokens across turns', () => {
    const tracker = new UtilizationTracker();
    tracker.record({ inputTokens: 1000, outputTokens: 200, windowSize: 200_000 });
    const snap = tracker.record({ inputTokens: 500, outputTokens: 100, windowSize: 200_000 });
    // (1200 + 600) / 200000 = 0.009
    expect(snap.totalTokens).toBe(1800);
    expect(snap.utilization).toBeCloseTo(0.009);
    expect(snap.turnsRecorded).toBe(2);
  });

  it('reset() clears cumulative state', () => {
    const tracker = new UtilizationTracker();
    tracker.record({ inputTokens: 10_000, outputTokens: 5_000, windowSize: 200_000 });
    tracker.reset();
    const snap = tracker.record({ inputTokens: 100, outputTokens: 50, windowSize: 200_000 });
    expect(snap.totalTokens).toBe(150);
    expect(snap.turnsRecorded).toBe(1);
  });

  it('snapshot() does not increment turnsRecorded', () => {
    const tracker = new UtilizationTracker();
    tracker.record({ inputTokens: 1000, outputTokens: 0, windowSize: 200_000 });
    const snap = tracker.snapshot(200_000);
    expect(snap.turnsRecorded).toBe(1);
    expect(snap.totalTokens).toBe(1000);
  });

  it('snapshot() on a fresh tracker returns zero utilization', () => {
    const tracker = new UtilizationTracker();
    const snap = tracker.snapshot(200_000);
    expect(snap.utilization).toBe(0);
    expect(snap.totalTokens).toBe(0);
  });

  it('BUDGET_CEILING is 0.4', () => {
    expect(BUDGET_CEILING).toBe(0.4);
  });

  it('utilization can exceed 1.0 (tracker does not clamp)', () => {
    const tracker = new UtilizationTracker();
    const snap = tracker.record({ inputTokens: 300_000, outputTokens: 0, windowSize: 200_000 });
    expect(snap.utilization).toBeGreaterThan(1);
  });
});
