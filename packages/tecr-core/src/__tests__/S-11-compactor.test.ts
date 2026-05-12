/**
 * S-11: Compactor + Governor — acceptance tests.
 *
 * Exit criteria:
 * - Given a message history at 35% utilization, compact(history) reduces it
 *   below 25% (tokensRecovered is large enough).
 * - The most recent KEEP_RECENT entries are preserved at full fidelity.
 * - Entries fewer than keepRecent are not compacted.
 * - Each compacted entry becomes a one-liner matching [compacted] format.
 * - Governor fires compaction when effectiveTokens / windowSize >= 0.35.
 * - Governor preserves full-fidelity for the most recent entries after firing.
 */

import { describe, it, expect } from 'vitest';
import { compact, KEEP_RECENT } from '../governor/compactor.js';
import { Governor, COMPACTION_THRESHOLD } from '../governor/index.js';
import type { HistoryEntry } from '../governor/compactor.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build an entry whose stored token count matches the given value. */
function entry(
  toolName: string,
  args: Record<string, unknown>,
  tokens: number,
  responseText = 'x'.repeat(tokens * 4), // approximate reverse of chars/4
): HistoryEntry {
  return { toolName, args, responseText, tokens };
}

// ── compact() ────────────────────────────────────────────────────────────────

describe('compact()', () => {
  it('does nothing when history length ≤ keepRecent', () => {
    const h = [entry('grep', { pattern: 'foo' }, 100)];
    const { tokensRecovered, entriesCompacted } = compact(h);
    expect(tokensRecovered).toBe(0);
    expect(entriesCompacted).toBe(0);
  });

  it('exit criterion: 35% → below 25% on 200k window', () => {
    const WINDOW = 200_000;
    // Build a history totalling ~70k tokens (35% of 200k).
    // Five entries of 12k tokens each = 60k, plus two recent entries of 5k each = 70k.
    const history: HistoryEntry[] = [
      entry('grep', { pattern: 'auth' }, 12_000),
      entry('read_lines', { filePath: 'src/a.ts' }, 12_000),
      entry('outline', { filePath: 'src/b.ts' }, 12_000),
      entry('search_symbol', { query: 'doWork' }, 12_000),
      entry('grep', { pattern: 'token' }, 12_000),
      // most-recent two (preserved)
      entry('read_lines', { filePath: 'src/c.ts' }, 5_000),
      entry('outline', { filePath: 'src/d.ts' }, 5_000),
    ];
    const totalBefore = history.reduce((s, e) => s + e.tokens, 0);
    expect(totalBefore / WINDOW).toBeGreaterThanOrEqual(0.35);

    const { entries, tokensRecovered } = compact(history);
    const totalAfter = entries.reduce((s, e) => s + e.tokens, 0);

    expect(totalAfter / WINDOW).toBeLessThan(0.25);
    expect(tokensRecovered).toBeGreaterThan(0);
  });

  it('preserves the most recent KEEP_RECENT entries verbatim', () => {
    const history: HistoryEntry[] = [
      entry('grep', { pattern: 'old' }, 5_000),
      entry('grep', { pattern: 'older' }, 5_000),
      entry('grep', { pattern: 'recent-1', }, 500, 'RECENT ONE FULL TEXT'),
      entry('grep', { pattern: 'recent-2' }, 500, 'RECENT TWO FULL TEXT'),
    ];
    const { entries } = compact(history);
    // Last KEEP_RECENT entries untouched
    expect(entries[entries.length - 1].responseText).toBe('RECENT TWO FULL TEXT');
    expect(entries[entries.length - 2].responseText).toBe('RECENT ONE FULL TEXT');
    // Older entries are compacted
    expect(entries[0].responseText).toMatch(/^\[compacted\]/);
    expect(entries[1].responseText).toMatch(/^\[compacted\]/);
  });

  it('summary includes tool name and primary arg', () => {
    const history: HistoryEntry[] = [
      entry('grep', { pattern: 'useState', workspaceRoot: '/repo' }, 3_000),
      entry('grep', { pattern: 'noop' }, 100, 'recent'),
      entry('grep', { pattern: 'noop' }, 100, 'recent2'),
    ];
    const { entries } = compact(history);
    expect(entries[0].responseText).toMatch(/\[compacted\] grep\(useState\)/);
  });

  it('compacted token count is lower than original', () => {
    const history: HistoryEntry[] = [
      entry('outline', { filePath: 'src/huge.ts' }, 10_000),
      entry('outline', { filePath: 'noop' }, 50, 'r1'),
      entry('outline', { filePath: 'noop' }, 50, 'r2'),
    ];
    const { entries, tokensRecovered } = compact(history);
    expect(entries[0].tokens).toBeLessThan(10_000);
    expect(tokensRecovered).toBeGreaterThan(0);
  });
});

// ── Governor ─────────────────────────────────────────────────────────────────

describe('Governor', () => {
  it('COMPACTION_THRESHOLD is 0.35', () => {
    expect(COMPACTION_THRESHOLD).toBe(0.35);
  });

  it('does not compact when under threshold', () => {
    const gov = new Governor();
    // Small responses — well under 35% of 200k
    const r = gov.record('hello', { message: 'hi' }, 'TECR: hi', 200_000);
    expect(r.compaction).toBeNull();
  });

  it('fires compaction when effectiveTokens / windowSize >= 0.35', () => {
    const gov = new Governor();
    const WINDOW = 200_000;
    // Push enough history to cross 35% (70k tokens)
    // Use a tiny window so we can test without generating massive strings.
    const TINY_WINDOW = 1_000;
    const bigText = 'word '.repeat(90); // ~90 tokens via cl100k

    // Fill past 35% of 1k window (350 tokens) with several calls.
    for (let i = 0; i < 5; i++) {
      gov.record('grep', { pattern: `term${i}` }, bigText, TINY_WINDOW);
    }
    // The 6th call should push effective util over threshold and trigger compaction.
    const last = gov.record('grep', { pattern: 'final' }, bigText, TINY_WINDOW);
    expect(last.compaction).not.toBeNull();
    expect(last.compaction!.entriesCompacted).toBeGreaterThan(0);
    expect(last.compaction!.tokensRecovered).toBeGreaterThan(0);
    void WINDOW; // suppress unused var lint
  });

  it('effectiveTokens decreases after compaction', () => {
    const gov = new Governor();
    const TINY_WINDOW = 1_000;
    const bigText = 'word '.repeat(90);

    let lastSnap = gov.record('grep', { pattern: 'a' }, bigText, TINY_WINDOW).snapshot;
    for (let i = 1; i < 6; i++) {
      lastSnap = gov.record('grep', { pattern: `t${i}` }, bigText, TINY_WINDOW).snapshot;
    }
    // After compaction fires, effectiveTokens should be lower than totalTokens.
    expect(lastSnap.effectiveTokens).toBeLessThan(lastSnap.totalTokens);
  });

  it('reset() clears history and effective tokens', () => {
    const gov = new Governor();
    gov.record('hello', { message: 'x' }, 'response', 200_000);
    gov.reset();
    const snap = gov.record('hello', { message: 'y' }, 'hi', 200_000).snapshot;
    expect(snap.turnsRecorded).toBe(1);
  });
});
