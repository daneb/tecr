/**
 * readLines(filePath, start, end) — paginated file read, ≤200 lines per call (S-05).
 *
 * start and end are 1-based inclusive line numbers. When the requested range
 * exceeds the 200-line hard cap, the response is clamped and a nextCursor is
 * returned for the next page.
 */

import { readFile } from 'fs/promises';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ReadLinesResult {
  /** Line-numbered content, with a header and optional truncation hint. */
  text: string;
  /** Number of content lines returned. */
  lineCount: number;
  /** Total lines in the file. */
  totalLines: number;
  /** Actual start line (1-based). */
  startLine: number;
  /** Actual end line (1-based). */
  endLine: number;
  /** True when the 200-line cap was applied and more lines remain in the file. */
  truncated: boolean;
  /** Pass as start (or cursor) on the next call to read the next page. */
  nextCursor?: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_LINES = 200;

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Read lines [start, end] from filePath.
 *
 * - start defaults to 1; end defaults to start + 199.
 * - If end − start + 1 > 200, the range is capped at 200 lines.
 * - If the file is shorter than the requested range, it ends at the last line
 *   without triggering truncation.
 * - filePath must be absolute.
 */
export async function readLines(
  filePath: string,
  start = 1,
  end?: number,
): Promise<ReadLinesResult> {
  const source = await readFile(filePath, 'utf8');
  const allLines = source.split('\n');
  const totalLines = allLines.length;

  const s = Math.max(1, Math.floor(start));

  // Apply 200-line hard cap.
  const cap = s + MAX_LINES - 1;
  // When end is omitted the caller implicitly wants everything → use totalLines
  // so the cap comparison fires correctly for files longer than 200 lines.
  const requestedEnd = end !== undefined ? Math.floor(end) : totalLines;
  const hitCap = requestedEnd > cap;
  const targetEnd = hitCap ? cap : requestedEnd;

  // Clamp to actual file length.
  const e = Math.min(targetEnd, totalLines);

  // Truncated only when the cap fired AND more lines exist beyond e.
  const truncated = hitCap && e < totalLines;
  const nextCursor = truncated ? e + 1 : undefined;

  // Handle start beyond file end.
  if (s > totalLines) {
    const msg =
      `// ${filePath}\n` +
      `[start (${s}) exceeds file length (${totalLines})]`;
    return { text: msg, lineCount: 0, totalLines, startLine: s, endLine: s, truncated: false };
  }

  const lines = allLines.slice(s - 1, e);
  const lineCount = lines.length;

  // Render with right-justified line numbers.
  const width = e.toString().length;
  const numbered = lines.map((line, i) => {
    const n = (s + i).toString().padStart(width);
    return `${n}\t${line}`;
  });

  const header = `// ${filePath} (lines ${s}–${e} of ${totalLines})`;
  const parts = [header, ...numbered];

  if (truncated) {
    parts.push(`[truncated: ${totalLines - e} more lines; pass cursor=${nextCursor} for the next page]`);
  }

  return {
    text: parts.join('\n'),
    lineCount,
    totalLines,
    startLine: s,
    endLine: e,
    truncated,
    nextCursor,
  };
}
