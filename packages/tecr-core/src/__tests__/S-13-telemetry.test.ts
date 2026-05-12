/**
 * S-13: Telemetry per turn — acceptance tests.
 *
 * Exit criteria:
 * - onTelemetry(handler) receives a TelemetryEvent with all §7.3 fields
 *   after each Governor.record() call.
 * - Fields: inputTokens, outputTokens, toolCallCount, perToolAttribution,
 *   compactionEvent, utilizationFraction.
 * - Handler is called exactly once per record() call.
 * - onTelemetry() returns an unsubscribe function that stops delivery.
 * - Default sink is opt-out via TECR_NO_TELEMETRY (not tested here — it
 *   writes to stderr which is not captured in unit tests).
 * - compactionEvent is non-null when compaction fires this turn.
 * - perToolAttribution accumulates across turns.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { onTelemetry } from '../telemetry.js';
import { Governor } from '../governor/index.js';
import type { TelemetryEvent } from '../telemetry.js';

// Collect handlers registered in each test so we can clean up.
const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function capture(): { events: TelemetryEvent[]; unsub: () => void } {
  const events: TelemetryEvent[] = [];
  const unsub = onTelemetry((e) => events.push(e));
  cleanups.push(unsub);
  return { events, unsub };
}

describe('onTelemetry / TelemetryEvent', () => {
  it('exit criterion: handler receives event with all §7.3 fields', () => {
    const { events } = capture();
    const gov = new Governor();
    gov.record('grep', { pattern: 'foo' }, 'some output text', 200_000);

    expect(events).toHaveLength(1);
    const e = events[0];

    // §7.3 required fields
    expect(typeof e.inputTokens).toBe('number');
    expect(e.inputTokens).toBeGreaterThan(0);
    expect(typeof e.outputTokens).toBe('number');
    expect(e.outputTokens).toBeGreaterThan(0);
    expect(e.toolCallCount).toBe(1);
    expect(Array.isArray(e.perToolAttribution)).toBe(true);
    expect(e.perToolAttribution.length).toBeGreaterThan(0);
    expect(e.compactionEvent).toBeNull();
    expect(typeof e.utilizationFraction).toBe('number');
    expect(e.utilizationFraction).toBeGreaterThan(0);
  });

  it('event shape: toolName, timestamp, effectiveTokens, windowSize', () => {
    const { events } = capture();
    const gov = new Governor();
    const before = Date.now();
    gov.record('outline', { filePath: 'src/x.ts' }, 'response', 200_000);
    const after = Date.now();

    const e = events[0];
    expect(e.toolName).toBe('outline');
    expect(e.timestamp).toBeGreaterThanOrEqual(before);
    expect(e.timestamp).toBeLessThanOrEqual(after);
    expect(e.windowSize).toBe(200_000);
    expect(e.effectiveTokens).toBeGreaterThan(0);
  });

  it('handler called exactly once per record() call', () => {
    const { events } = capture();
    const gov = new Governor();
    gov.record('hello', { message: 'a' }, 'r1', 200_000);
    gov.record('hello', { message: 'b' }, 'r2', 200_000);
    gov.record('grep', { pattern: 'x' }, 'r3', 200_000);
    expect(events).toHaveLength(3);
  });

  it('unsubscribe stops delivery', () => {
    const { events, unsub } = capture();
    const gov = new Governor();
    gov.record('hello', { message: 'a' }, 'r1', 200_000);
    expect(events).toHaveLength(1);

    unsub();
    gov.record('hello', { message: 'b' }, 'r2', 200_000);
    expect(events).toHaveLength(1); // no new events after unsub
  });

  it('perToolAttribution accumulates across turns', () => {
    const { events } = capture();
    const gov = new Governor();
    gov.record('grep', { pattern: 'a' }, 'result1', 200_000);
    gov.record('grep', { pattern: 'b' }, 'result2', 200_000);
    gov.record('outline', { filePath: 'f.ts' }, 'outline', 200_000);

    const last = events[2];
    expect(last.toolCallCount).toBe(3);

    const grepAttr = last.perToolAttribution.find((a) => a.toolName === 'grep');
    const outlineAttr = last.perToolAttribution.find((a) => a.toolName === 'outline');
    expect(grepAttr).toBeDefined();
    expect(outlineAttr).toBeDefined();
    // Grep appeared twice — its cumulative output should be > single call.
    expect(grepAttr!.outputTokens).toBeGreaterThan(outlineAttr!.outputTokens);
  });

  it('compactionEvent is non-null when compaction fires', () => {
    const { events } = capture();
    const gov = new Governor();
    const TINY = 1_000;
    const bigText = 'word '.repeat(90); // ~90 tokens

    // Push past 35% threshold on a 1k window.
    for (let i = 0; i < 6; i++) {
      gov.record('grep', { pattern: `t${i}` }, bigText, TINY);
    }

    const compactionEvents = events.filter((e) => e.compactionEvent !== null);
    expect(compactionEvents.length).toBeGreaterThan(0);

    const ce = compactionEvents[0].compactionEvent!;
    expect(ce.entriesCompacted).toBeGreaterThan(0);
    expect(ce.tokensRecovered).toBeGreaterThan(0);
  });

  it('utilizationFraction reflects post-compaction level', () => {
    const { events } = capture();
    const gov = new Governor();
    const TINY = 1_000;
    const bigText = 'word '.repeat(90);

    for (let i = 0; i < 6; i++) {
      gov.record('grep', { pattern: `t${i}` }, bigText, TINY);
    }

    const compactionTurn = events.find((e) => e.compactionEvent !== null)!;
    // After compaction, utilization should be below the 35% threshold.
    expect(compactionTurn.utilizationFraction).toBeLessThan(0.35);
  });

  it('multiple independent handlers all receive events', () => {
    const received1: TelemetryEvent[] = [];
    const received2: TelemetryEvent[] = [];
    const off1 = onTelemetry((e) => received1.push(e));
    const off2 = onTelemetry((e) => received2.push(e));
    cleanups.push(off1, off2);

    const gov = new Governor();
    gov.record('hello', { message: 'x' }, 'resp', 200_000);

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
  });
});
