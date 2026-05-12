/**
 * Sub-agent isolation (spec §8, S-14).
 *
 * `delegate()` runs a discovery task in a fully isolated context:
 *   - Its own UtilizationTracker (never shared with parent).
 *   - Uses the standard TECR tool surface (grep, searchSymbol) internally.
 *   - Returns only a structured summary ≤200 cl100k tokens, artifact refs,
 *     and a token usage report.
 *
 * The full sub-agent transcript MUST NOT propagate to the parent (§8.2).
 * The MCP `delegate` tool achieves this by passing only `result.summary` to
 * `withUtilization`, so the parent governor accounts ≤200 tokens per call.
 */

import path from 'path';
import { countTokens } from '../tokenizer.js';
import { UtilizationTracker } from '../governor/tracker.js';
import { offload } from './offload.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface DelegateInput {
  /** Natural-language description of the discovery task. */
  task: string;
  /** Workspace to search. */
  workspaceRoot: string;
  /**
   * Optional context snapshot from the parent (e.g. current repo-map excerpt).
   * Used to guide the sub-agent but never returned to the caller.
   */
  parentContext?: string;
}

export interface ArtifactRef {
  type: 'symbol' | 'match' | 'file';
  path: string;
  line?: number;
  name?: string;
}

export interface TokenUsage {
  /** Tokens consumed reading the task + parentContext. */
  inputTokens: number;
  /** Tokens in the returned summary. */
  outputTokens: number;
  totalTokens: number;
  /** Tokens consumed by the local model (§8.3). Zero when using the grep path. */
  localTokens: number;
}

export interface DelegateResult {
  /** Structured summary of findings — guaranteed ≤ SUMMARY_TOKEN_LIMIT tokens. */
  summary: string;
  /** Pointers the parent may request explicitly via targeted tools. */
  artifactRefs: ArtifactRef[];
  tokenUsage: TokenUsage;
}

/** Hard limit on summary size (spec §8.2). */
export const SUMMARY_TOKEN_LIMIT = 200;

// ── Implementation ────────────────────────────────────────────────────────────

export async function delegate(input: DelegateInput): Promise<DelegateResult> {
  // Isolated tracker — never touches the parent governor.
  const tracker = new UtilizationTracker();
  const inputTokens = countTokens(
    JSON.stringify({ task: input.task, parentContext: input.parentContext ?? '' }),
  );

  // §8.3 — route to local model when configured; fall back to grep path on error.
  if (process.env['TECR_LOCAL_MODEL_URL']) {
    try {
      const offloadResult = await offload(input.task, input.workspaceRoot, input.parentContext);
      const summary = truncateToLimit(offloadResult.summary, SUMMARY_TOKEN_LIMIT);
      const outputTokens = countTokens(summary);
      tracker.record({ inputTokens, outputTokens, windowSize: 200_000 });
      return {
        summary,
        artifactRefs: [],
        tokenUsage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          localTokens: offloadResult.localTokens,
        },
      };
    } catch {
      // Local model unreachable — fall through to grep/searchSymbol path.
    }
  }

  const { grep } = await import('../tools/grep.js');
  const { searchSymbol } = await import('../tools/searchSymbol.js');

  const artifactRefs: ArtifactRef[] = [];
  const lines: string[] = [`Task: ${input.task}`];

  // Extract search terms from the task description.
  const terms = extractTerms(input.task);

  for (const term of terms.slice(0, 3)) {
    if (term.isSymbol) {
      const result = await searchSymbol(input.workspaceRoot, term.value);
      const top = result.matches.slice(0, 5);
      for (const m of top) {
        artifactRefs.push({ type: 'symbol', path: m.filePath, line: m.line, name: m.name });
      }
      lines.push(
        `symbol "${term.value}": ${result.matches.length} match${result.matches.length !== 1 ? 'es' : ''}` +
          (top.length ? ` — ${top.map((m) => `${shortPath(m.filePath, input.workspaceRoot)}:${m.line}`).join(', ')}` : ''),
      );
    } else {
      const result = await grep(input.workspaceRoot, term.value);
      const top = result.matches.slice(0, 5);
      for (const m of top) {
        artifactRefs.push({ type: 'match', path: m.filePath, line: m.line });
      }
      lines.push(
        `grep "${term.value}": ${result.totalMatches} match${result.totalMatches !== 1 ? 'es' : ''}` +
          (top.length ? ` — ${top.map((m) => `${shortPath(m.filePath, input.workspaceRoot)}:${m.line}`).join(', ')}` : ''),
      );
    }
  }

  lines.push(`Artifacts: ${artifactRefs.length} refs`);

  const summary = truncateToLimit(lines.join('\n'), SUMMARY_TOKEN_LIMIT);
  const outputTokens = countTokens(summary);

  tracker.record({ inputTokens, outputTokens, windowSize: 200_000 });

  return {
    summary,
    artifactRefs,
    tokenUsage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, localTokens: 0 },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface Term {
  value: string;
  isSymbol: boolean;
}

/**
 * Extract search terms from a natural-language task description.
 * - Back-tick quoted words → literal grep
 * - CamelCase / PascalCase words (≥3 chars) → symbol search
 * - Remaining words ≥4 chars → literal grep (lower-cased)
 */
function extractTerms(task: string): Term[] {
  const terms: Term[] = [];
  const seen = new Set<string>();

  // Back-tick literals: `foo`
  for (const m of task.matchAll(/`([^`]+)`/g)) {
    const v = m[1].trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      terms.push({ value: v, isSymbol: false });
    }
  }

  // CamelCase / PascalCase → symbol search
  for (const word of task.split(/\s+/)) {
    const clean = word.replace(/[^a-zA-Z0-9_]/g, '');
    if (clean.length >= 3 && /[A-Z]/.test(clean[0]) && !seen.has(clean)) {
      seen.add(clean);
      terms.push({ value: clean, isSymbol: true });
    }
  }

  // Remaining substantive words → grep
  for (const word of task.split(/\s+/)) {
    const clean = word.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
    if (clean.length >= 4 && !seen.has(clean)) {
      seen.add(clean);
      terms.push({ value: clean, isSymbol: false });
    }
  }

  return terms;
}

/** Truncate text so its cl100k token count is ≤ limit. */
function truncateToLimit(text: string, limit: number): string {
  if (countTokens(text) <= limit) return text;
  // Binary-search on character count.
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (countTokens(text.slice(0, mid)) <= limit - 1) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return text.slice(0, lo) + '…';
}

/** Return a path relative to workspaceRoot, truncated if too long. */
function shortPath(filePath: string, workspaceRoot: string): string {
  const rel = path.relative(workspaceRoot, filePath);
  return rel.length < 40 ? rel : path.basename(filePath);
}
