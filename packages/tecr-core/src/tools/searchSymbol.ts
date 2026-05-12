/**
 * searchSymbol(workspaceRoot, query) — AST-based symbol lookup (S-06).
 *
 * Scans all TypeScript/JavaScript/Rust/Python/Go/Java files under
 * workspaceRoot and returns symbols whose names contain the query string
 * (case-insensitive). Exact matches are returned before prefix matches
 * before substring matches. Hard limit: 50 results.
 */

import path from 'path';
import type { SymbolKind } from '../ast/types.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SymbolMatch {
  filePath: string;
  line: number;
  kind: SymbolKind;
  name: string;
  signature: string;
  exported: boolean;
}

export interface SearchSymbolResult {
  matches: SymbolMatch[];
  /** Total number of matches found before the 50-result cap. */
  totalMatches: number;
  truncated: boolean;
  /** Human-readable formatted output. */
  text: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_RESULTS = 50;

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Search all symbols in workspaceRoot whose names contain query.
 * Returns ≤50 matches ordered by relevance (exact → prefix → substring),
 * then by file path and line number within each tier.
 *
 * workspaceRoot must be an absolute path.
 */
export async function searchSymbol(
  workspaceRoot: string,
  query: string,
): Promise<SearchSymbolResult> {
  const { extractWorkspace } = await import('../ast/typescript.js');
  const { extractWasmLanguages } = await import('../ast/wasm.js');

  const [tsRecords, wasmRecords] = await Promise.all([
    extractWorkspace(workspaceRoot),
    extractWasmLanguages(workspaceRoot),
  ]);

  const q = query.toLowerCase();
  const all: SymbolMatch[] = [];

  for (const record of [...tsRecords, ...wasmRecords]) {
    for (const sym of record.symbols) {
      if (sym.name.toLowerCase().includes(q)) {
        all.push({
          filePath: record.path,
          line: sym.line,
          kind: sym.kind,
          name: sym.name,
          signature: sym.signature,
          exported: sym.exported,
        });
      }
    }
  }

  // Sort: exact match → prefix match → substring match; within each tier by
  // relative file path then line number.
  all.sort((a, b) => {
    const ta = tier(a.name, q);
    const tb = tier(b.name, q);
    if (ta !== tb) return ta - tb;
    const relA = path.relative(workspaceRoot, a.filePath);
    const relB = path.relative(workspaceRoot, b.filePath);
    if (relA !== relB) return relA.localeCompare(relB);
    return a.line - b.line;
  });

  const totalMatches = all.length;
  const truncated = totalMatches > MAX_RESULTS;
  const matches = truncated ? all.slice(0, MAX_RESULTS) : all;

  return { matches, totalMatches, truncated, text: format(matches, query, totalMatches, workspaceRoot) };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Relevance tier: 0 = exact, 1 = prefix, 2 = substring. */
function tier(name: string, q: string): number {
  const n = name.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  return 2;
}

function format(
  matches: SymbolMatch[],
  query: string,
  total: number,
  workspaceRoot: string,
): string {
  if (matches.length === 0) {
    return `No symbols found matching '${query}'.`;
  }

  const header =
    total > MAX_RESULTS
      ? `${total} matches for '${query}' (showing first ${MAX_RESULTS}):`
      : `${total} match${total === 1 ? '' : 'es'} for '${query}':`;

  const lines = matches.map((m) => {
    const rel = path.relative(workspaceRoot, m.filePath);
    return `  ${rel}:${m.line}  [${m.kind}]  ${m.signature}`;
  });

  const parts = [header, '', ...lines];

  if (total > MAX_RESULTS) {
    parts.push('', `[truncated: ${total - MAX_RESULTS} more matches; refine your query to see fewer results]`);
  }

  return parts.join('\n');
}
