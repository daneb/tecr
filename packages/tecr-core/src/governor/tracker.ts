/**
 * Utilization tracker (spec §7.1 — observe-only phase, S-10).
 *
 * Accumulates input + output tokens across turns and reports the fraction of
 * the model context window consumed so far. No governor actions fire yet;
 * S-11 adds compaction and S-12 adds the hard stop.
 *
 * The 40% threshold (spec §7) is the architectural invariant the governor
 * enforces in later slices — it is exposed here as a named constant so callers
 * can read it without hard-coding the magic number.
 */

export const BUDGET_CEILING = 0.4;

export interface TurnRecord {
  inputTokens: number;
  outputTokens: number;
  /** Total context window size in tokens (e.g. 200_000 for claude-sonnet). */
  windowSize: number;
}

export interface UtilizationSnapshot {
  /** Cumulative (input + output) / windowSize. */
  utilization: number;
  /** Raw cumulative token count across all recorded turns. */
  totalTokens: number;
  windowSize: number;
  turnsRecorded: number;
}

export class UtilizationTracker {
  private total = 0;
  private turns = 0;

  record(turn: TurnRecord): UtilizationSnapshot {
    this.total += turn.inputTokens + turn.outputTokens;
    this.turns++;
    return {
      utilization: this.total / turn.windowSize,
      totalTokens: this.total,
      windowSize: turn.windowSize,
      turnsRecorded: this.turns,
    };
  }

  /** Current snapshot without recording a new turn. */
  snapshot(windowSize: number): UtilizationSnapshot {
    return {
      utilization: windowSize > 0 ? this.total / windowSize : 0,
      totalTokens: this.total,
      windowSize,
      turnsRecorded: this.turns,
    };
  }

  reset(): void {
    this.total = 0;
    this.turns = 0;
  }
}
