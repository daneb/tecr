/**
 * Compactor (spec §7.2 actions 1–2, S-11).
 *
 * Pure function — no I/O, no side effects. Takes a history of tool results
 * and returns a compacted version where old entries are collapsed to one-line
 * summaries. The most recent KEEP_RECENT entries are always preserved at full
 * fidelity so the model can still see what it just did.
 *
 * Summary format matches spec §7.2 action 1:
 *   [compacted] toolName(primaryArg) → N lines
 */

import { countTokens } from '../tokenizer.js';

export interface HistoryEntry {
  toolName: string;
  args: Record<string, unknown>;
  /** Full response text as sent to the model. */
  responseText: string;
  /** cl100k token count of responseText (pre-computed by the Governor). */
  tokens: number;
}

export interface CompactionResult {
  entries: HistoryEntry[];
  tokensRecovered: number;
  entriesCompacted: number;
}

/** Number of most-recent entries kept at full fidelity after compaction. */
export const KEEP_RECENT = 2;

export function compact(history: HistoryEntry[], keepRecent = KEEP_RECENT): CompactionResult {
  if (history.length <= keepRecent) {
    return { entries: history, tokensRecovered: 0, entriesCompacted: 0 };
  }

  const candidates = history.slice(0, -keepRecent);
  const recent = history.slice(-keepRecent);

  let tokensRecovered = 0;
  let entriesCompacted = 0;

  const compactedCandidates = candidates.map((entry) => {
    const summary = summarize(entry);
    const summaryTokens = countTokens(summary);
    const recovered = entry.tokens - summaryTokens;
    tokensRecovered += Math.max(0, recovered);
    entriesCompacted++;
    return { ...entry, responseText: summary, tokens: summaryTokens };
  });

  return {
    entries: [...compactedCandidates, ...recent],
    tokensRecovered,
    entriesCompacted,
  };
}

// ── Internal ──────────────────────────────────────────────────────────────────

function summarize(entry: HistoryEntry): string {
  const arg = primaryArg(entry.args);
  // Strip the utilization metadata footer before counting lines.
  const lines = entry.responseText
    .split('\n')
    .filter((l) => !l.startsWith('[tecr:'));
  const lineCount = lines.filter((l) => l.trim().length > 0).length;
  return `[compacted] ${entry.toolName}(${arg}) → ${lineCount} lines`;
}

/** Pick the most meaningful single argument value for the summary label. */
function primaryArg(args: Record<string, unknown>): string {
  const priority = ['pattern', 'query', 'symbolName', 'filePath', 'message', 'workspaceRoot'];
  for (const key of priority) {
    if (args[key] !== undefined) {
      const val = String(args[key]);
      return val.length > 40 ? `${val.slice(0, 37)}…` : val;
    }
  }
  const s = JSON.stringify(args);
  return s.length > 40 ? `${s.slice(0, 37)}…` : s;
}
