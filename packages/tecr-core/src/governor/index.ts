/**
 * Context Budget Governor (spec §7, S-11/S-12).
 *
 * Combines the utilization tracker (S-10) with the compactor (S-11) into a
 * single coordination point. The Governor:
 *
 *   1. Records every tool call (input args + response text + token counts).
 *   2. Maintains an effective-utilization estimate derived from the live
 *      history buffer — distinct from the raw cumulative tracker, which never
 *      decreases.
 *   3. Fires compaction when effective utilization crosses COMPACTION_THRESHOLD.
 *   4. Enforces the hard ceiling (BUDGET_CEILING) before each tool call via
 *      checkBefore() — throws GovernorHardStop if compaction is exhausted.
 *   5. Logs compaction events to stderr (structured, parseable by telemetry).
 */

import { UtilizationTracker, BUDGET_CEILING } from './tracker.js';
import { compact, type HistoryEntry, type CompactionResult } from './compactor.js';
import { countTokens } from '../tokenizer.js';
import { emitTelemetry, type ToolAttribution } from '../telemetry.js';

export { BUDGET_CEILING } from './tracker.js';
export type { HistoryEntry, CompactionResult };

// ── Hard-stop error ───────────────────────────────────────────────────────────

export class GovernorHardStop extends Error {
  readonly utilization: number;
  readonly effectiveTokens: number;
  readonly windowSize: number;

  constructor(opts: { utilization: number; effectiveTokens: number; windowSize: number }) {
    super(
      'TECR: context budget exhausted. Start a new chat or reduce focus files.',
    );
    this.name = 'GovernorHardStop';
    this.utilization = opts.utilization;
    this.effectiveTokens = opts.effectiveTokens;
    this.windowSize = opts.windowSize;
  }
}

/** Compaction fires when effective utilization reaches this fraction. */
export const COMPACTION_THRESHOLD = 0.35;

export interface GovernorRecord {
  snapshot: {
    utilization: number;
    effectiveTokens: number;
    totalTokens: number;
    windowSize: number;
    turnsRecorded: number;
  };
  compaction: CompactionResult | null;
}

export class Governor {
  private tracker = new UtilizationTracker();
  private history: HistoryEntry[] = [];
  private effectiveTokens = 0;
  /** Cumulative per-tool token totals for telemetry attribution. */
  private attribution = new Map<string, { inputTokens: number; outputTokens: number }>();

  record(
    toolName: string,
    args: Record<string, unknown>,
    responseText: string,
    windowSize: number,
    localTokens = 0,
  ): GovernorRecord {
    const inputTokens = countTokens(JSON.stringify(args));
    const outputTokens = countTokens(responseText);

    const entry: HistoryEntry = { toolName, args, responseText, tokens: outputTokens };
    this.history.push(entry);
    this.effectiveTokens += outputTokens;

    // Accumulate per-tool attribution for telemetry.
    const prior = this.attribution.get(toolName) ?? { inputTokens: 0, outputTokens: 0 };
    this.attribution.set(toolName, {
      inputTokens: prior.inputTokens + inputTokens,
      outputTokens: prior.outputTokens + outputTokens,
    });

    const snap = this.tracker.record({ inputTokens, outputTokens, windowSize });

    let compaction: CompactionResult | null = null;
    const effectiveUtil = this.effectiveTokens / windowSize;

    if (effectiveUtil >= COMPACTION_THRESHOLD) {
      const result = compact(this.history);
      if (result.tokensRecovered > 0) {
        this.history = result.entries;
        this.effectiveTokens -= result.tokensRecovered;
        compaction = result;
      }
    }

    // §7.3 — emit telemetry after every turn.
    emitTelemetry({
      toolName,
      timestamp: Date.now(),
      inputTokens,
      outputTokens,
      toolCallCount: snap.turnsRecorded,
      perToolAttribution: this.buildAttribution(),
      compactionEvent: compaction
        ? { entriesCompacted: compaction.entriesCompacted, tokensRecovered: compaction.tokensRecovered }
        : null,
      utilizationFraction: this.effectiveTokens / windowSize,
      effectiveTokens: this.effectiveTokens,
      windowSize,
      // §8.3 — local tokens are recorded but never counted toward budget.
      localTokens,
      billableTokens: inputTokens + outputTokens,
    });

    return {
      snapshot: {
        utilization: snap.utilization,
        effectiveTokens: this.effectiveTokens,
        totalTokens: snap.totalTokens,
        windowSize,
        turnsRecorded: snap.turnsRecorded,
      },
      compaction,
    };
  }

  private buildAttribution(): ToolAttribution[] {
    return Array.from(this.attribution.entries()).map(([toolName, counts]) => ({
      toolName,
      ...counts,
    }));
  }

  /**
   * Enforce the hard ceiling BEFORE a tool call (spec §7.1 I2).
   *
   * If effective utilization is already at or above BUDGET_CEILING:
   *   1. Attempt compaction.
   *   2. If effective utilization is still at or above BUDGET_CEILING after
   *      compaction, throw GovernorHardStop.
   */
  checkBefore(windowSize: number): void {
    const currentUtil = this.effectiveTokens / windowSize;
    if (currentUtil < BUDGET_CEILING) return;

    // Try compaction first.
    const result = compact(this.history);
    if (result.tokensRecovered > 0) {
      this.history = result.entries;
      this.effectiveTokens -= result.tokensRecovered;
      process.stderr.write(
        `[tecr:governor] pre-call compaction: recovered ${result.tokensRecovered} tokens\n`,
      );
    }

    const afterUtil = this.effectiveTokens / windowSize;
    if (afterUtil >= BUDGET_CEILING) {
      process.stderr.write(
        `[tecr:governor] hard stop: utilization ${(afterUtil * 100).toFixed(1)}% >= ${BUDGET_CEILING * 100}%\n`,
      );
      throw new GovernorHardStop({
        utilization: afterUtil,
        effectiveTokens: this.effectiveTokens,
        windowSize,
      });
    }
  }

  currentHistory(): HistoryEntry[] {
    return [...this.history];
  }

  reset(): void {
    this.tracker.reset();
    this.history = [];
    this.effectiveTokens = 0;
    this.attribution.clear();
  }
}
