/**
 * S-17: Measurement harness — acceptance tests.
 *
 * Exit criteria:
 * - runCorpusEntry() returns RunResult with all §9.1 metric fields.
 * - discoveryCost > 0.
 * - utilizationPeak ∈ (0, 1].
 * - truncationRate ∈ [0, 1].
 * - repoMapHitRate ∈ [0, 1].
 * - subAgentRoi ∈ [0, 1].
 * - perTurnInput.p95 >= perTurnInput.mean.
 * - computeMetrics() is a pure function — same input, same output.
 */

import { describe, it, expect } from 'vitest';
import { loadCorpus, runCorpusEntry, computeMetrics } from '../index.js';
import type { SessionMeta } from '../harness/metrics.js';

// Run against bincode only — smallest corpus entry, keeps suite fast.
const corpusEntry = loadCorpus().find((e) => e.id === 'bincode')!;

describe('runCorpusEntry()', () => {
  it('exit criterion: returns RunResult with all §9.1 fields', async () => {
    const result = await runCorpusEntry(corpusEntry);

    expect(result).toHaveProperty('entry');
    expect(result).toHaveProperty('metrics');
    expect(result).toHaveProperty('events');

    const m = result.metrics;
    expect(typeof m.discoveryCost).toBe('number');
    expect(typeof m.utilizationPeak).toBe('number');
    expect(typeof m.truncationRate).toBe('number');
    expect(typeof m.repoMapHitRate).toBe('number');
    expect(typeof m.subAgentRoi).toBe('number');
    expect(typeof m.perTurnInput.mean).toBe('number');
    expect(typeof m.perTurnInput.p95).toBe('number');
  }, 30_000);

  it('exit criterion: discoveryCost > 0', async () => {
    const { metrics } = await runCorpusEntry(corpusEntry);
    expect(metrics.discoveryCost).toBeGreaterThan(0);
  }, 30_000);

  it('utilizationPeak is in (0, 1]', async () => {
    const { metrics } = await runCorpusEntry(corpusEntry);
    expect(metrics.utilizationPeak).toBeGreaterThan(0);
    expect(metrics.utilizationPeak).toBeLessThanOrEqual(1);
  }, 30_000);

  it('truncationRate is in [0, 1]', async () => {
    const { metrics } = await runCorpusEntry(corpusEntry);
    expect(metrics.truncationRate).toBeGreaterThanOrEqual(0);
    expect(metrics.truncationRate).toBeLessThanOrEqual(1);
  }, 30_000);

  it('repoMapHitRate is in [0, 1]', async () => {
    const { metrics } = await runCorpusEntry(corpusEntry);
    expect(metrics.repoMapHitRate).toBeGreaterThanOrEqual(0);
    expect(metrics.repoMapHitRate).toBeLessThanOrEqual(1);
  }, 30_000);

  it('subAgentRoi is in [0, 1]', async () => {
    const { metrics } = await runCorpusEntry(corpusEntry);
    expect(metrics.subAgentRoi).toBeGreaterThanOrEqual(0);
    expect(metrics.subAgentRoi).toBeLessThanOrEqual(1);
  }, 30_000);

  it('p95 >= mean for perTurnInput', async () => {
    const { metrics } = await runCorpusEntry(corpusEntry);
    expect(metrics.perTurnInput.p95).toBeGreaterThanOrEqual(metrics.perTurnInput.mean);
  }, 30_000);

  it('events array is non-empty', async () => {
    const { events } = await runCorpusEntry(corpusEntry);
    expect(events.length).toBeGreaterThan(0);
  }, 30_000);
});

describe('computeMetrics()', () => {
  it('is a pure function — same input produces same output', () => {
    const mockEvents = [
      { inputTokens: 100, outputTokens: 200, utilizationFraction: 0.1, billableTokens: 300 } as any,
      { inputTokens: 50, outputTokens: 100, utilizationFraction: 0.05, billableTokens: 150 } as any,
    ];
    const meta: SessionMeta = {
      discoveryCost: 300,
      truncatedCalls: 1,
      totalCalls: 4,
      repoMapPaths: new Set(['/a/b.ts']),
      readLinesHits: 1,
      readLinesCalls: 2,
      delegateTotalTokens: 500,
      delegateSummaryTokens: 50,
    };

    const r1 = computeMetrics(mockEvents, meta);
    const r2 = computeMetrics(mockEvents, meta);
    expect(r1).toEqual(r2);
  });

  it('truncationRate = truncatedCalls / totalCalls', () => {
    const meta: SessionMeta = {
      discoveryCost: 0,
      truncatedCalls: 2,
      totalCalls: 5,
      repoMapPaths: new Set(),
      readLinesHits: 0,
      readLinesCalls: 0,
      delegateTotalTokens: 0,
      delegateSummaryTokens: 0,
    };
    const { truncationRate } = computeMetrics([], meta);
    expect(truncationRate).toBeCloseTo(0.4);
  });

  it('subAgentRoi = (total - summary) / total', () => {
    const meta: SessionMeta = {
      discoveryCost: 0,
      truncatedCalls: 0,
      totalCalls: 0,
      repoMapPaths: new Set(),
      readLinesHits: 0,
      readLinesCalls: 0,
      delegateTotalTokens: 1000,
      delegateSummaryTokens: 100,
    };
    const { subAgentRoi } = computeMetrics([], meta);
    expect(subAgentRoi).toBeCloseTo(0.9);
  });

  it('subAgentRoi is 0 when no delegate call was made', () => {
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
    expect(computeMetrics([], meta).subAgentRoi).toBe(0);
  });
});
