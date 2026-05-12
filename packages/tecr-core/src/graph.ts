/**
 * File dependency graph and PageRank scorer.
 *
 * Nodes are file paths (absolute). Edges are import relationships:
 * an edge A → B means "file A imports from file B".
 * PageRank is computed on this directed graph so that highly-imported
 * files (shared utilities, core modules) score highest and are emitted
 * first in the repo-map.
 */

import type { FileRecord } from './ast/types.js';

export interface RankedFile {
  record: FileRecord;
  /** PageRank score (sum ≈ 1 across all files). */
  score: number;
  /** Total inbound import count (raw, pre-normalization). */
  inboundCount: number;
}

const DAMPING = 0.85;
const CONVERGENCE = 1e-6;
const MAX_ITER = 100;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Given the full set of FileRecords for a workspace, compute PageRank
 * and return files sorted by score descending.
 */
export function rankFiles(records: FileRecord[]): RankedFile[] {
  if (records.length === 0) return [];

  const paths = records.map((r) => r.path);
  const pathIndex = new Map(paths.map((p, i) => [p, i]));
  const N = paths.length;

  // Build adjacency: outEdges[i] = set of file indices that file[i] imports
  const outEdges: Set<number>[] = Array.from({ length: N }, () => new Set());
  const inCounts: number[] = new Array(N).fill(0);

  for (let i = 0; i < N; i++) {
    for (const importPath of records[i].imports) {
      const j = pathIndex.get(importPath);
      if (j !== undefined && j !== i) {
        outEdges[i].add(j);
      }
    }
  }

  // Count inbound edges
  for (let i = 0; i < N; i++) {
    for (const j of outEdges[i]) {
      inCounts[j]++;
    }
  }

  // Iterative PageRank
  let scores: number[] = new Array(N).fill(1 / N);

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const next: number[] = new Array(N).fill((1 - DAMPING) / N);

    for (let i = 0; i < N; i++) {
      const out = outEdges[i];
      if (out.size === 0) {
        // Dangling node: distribute evenly
        const share = (DAMPING * scores[i]) / N;
        for (let j = 0; j < N; j++) next[j] += share;
      } else {
        const share = (DAMPING * scores[i]) / out.size;
        for (const j of out) next[j] += share;
      }
    }

    // Check convergence
    let delta = 0;
    for (let i = 0; i < N; i++) delta += Math.abs(next[i] - scores[i]);
    scores = next;
    if (delta < CONVERGENCE) break;
  }

  return records
    .map((record, i) => ({ record, score: scores[i], inboundCount: inCounts[i] }))
    .sort((a, b) => b.score - a.score);
}
