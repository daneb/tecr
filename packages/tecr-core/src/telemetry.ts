/**
 * Telemetry (spec §7.3, S-13).
 *
 * Hookable event emitter for per-turn governor metrics. The Governor calls
 * emitTelemetry() after every record(); callers register handlers via
 * onTelemetry() and receive a typed TelemetryEvent.
 *
 * Default sink: writes JSON to stderr unless TECR_NO_TELEMETRY is set.
 * Adopters can pipe events to OpenTelemetry or any custom sink.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** Cumulative token breakdown for a single tool across all turns. */
export interface ToolAttribution {
  toolName: string;
  inputTokens: number;
  outputTokens: number;
}

/** Compaction summary for the current turn (null when no compaction fired). */
export interface CompactionSummary {
  entriesCompacted: number;
  tokensRecovered: number;
}

/** §7.3 — emitted once per governor turn. */
export interface TelemetryEvent {
  /** The tool invoked this turn. */
  toolName: string;
  /** Unix timestamp (ms) when the event was emitted. */
  timestamp: number;

  // §7.3 required fields
  /** Input tokens for this turn (tool args). */
  inputTokens: number;
  /** Output tokens for this turn (response text). */
  outputTokens: number;
  /** Cumulative tool call count across the session. */
  toolCallCount: number;
  /** Per-tool cumulative token breakdown. */
  perToolAttribution: ToolAttribution[];
  /** Compaction that fired during this turn, or null. */
  compactionEvent: CompactionSummary | null;
  /** Effective utilization fraction after this turn (threshold proximity). */
  utilizationFraction: number;

  // Enrichment
  effectiveTokens: number;
  windowSize: number;

  // S-15: tiered model offload (§8.3)
  /** Tokens consumed by a local model this turn (zero-cost for budget). */
  localTokens: number;
  /** Cloud-billed tokens this turn (inputTokens + outputTokens). */
  billableTokens: number;
}

export type TelemetryHandler = (event: TelemetryEvent) => void;

// ── Registry ──────────────────────────────────────────────────────────────────

const handlers: TelemetryHandler[] = [];

/**
 * Register a telemetry handler. Returns an unsubscribe function.
 *
 * @example
 * const off = onTelemetry(e => console.log(JSON.stringify(e)));
 * // later:
 * off();
 */
export function onTelemetry(handler: TelemetryHandler): () => void {
  handlers.push(handler);
  return () => {
    const idx = handlers.indexOf(handler);
    if (idx !== -1) handlers.splice(idx, 1);
  };
}

// ── Emission ──────────────────────────────────────────────────────────────────

/** Called by the Governor after every record(). */
export function emitTelemetry(event: TelemetryEvent): void {
  // Default sink — opt-out via TECR_NO_TELEMETRY=1.
  if (!process.env['TECR_NO_TELEMETRY']) {
    process.stderr.write(`[tecr:telemetry] ${JSON.stringify(event)}\n`);
  }
  for (const h of handlers) {
    h(event);
  }
}
