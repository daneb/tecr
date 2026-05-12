/**
 * Golden corpus loader (spec §9.2, S-16).
 *
 * Reads test/corpus/thresholds.json and resolves each entry into an absolute
 * CorpusEntry with a repoPath (cloned repo root) and a sourceRoot (the
 * subtree the measurement harness points its tools at).
 *
 * Path anchor: four levels up from src/harness/ (or dist/harness/) reaches
 * the workspace root, where test/corpus/ lives.
 */

import path from 'path';
import { readFileSync } from 'fs';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CorpusEntry {
  id: string;
  language: string;
  /** Absolute path to the cloned repo root (test/corpus/<id>). */
  repoPath: string;
  /** Absolute path to the source subtree to analyse. */
  sourceRoot: string;
  /** Natural-language task prompt for the measurement harness. */
  prompt: string;
  /** Minimum useful-action count expected from a compliant implementation. */
  threshold: number;
}

interface ThresholdRecord {
  id: string;
  language: string;
  sourceRoot: string;
  prompt: string;
  threshold: number;
}

// ── Loader ────────────────────────────────────────────────────────────────────

const CORPUS_DIR = path.resolve(__dirname, '../../../../test/corpus');

export function loadCorpus(): CorpusEntry[] {
  const manifest = path.join(CORPUS_DIR, 'thresholds.json');
  const records = JSON.parse(readFileSync(manifest, 'utf8')) as ThresholdRecord[];

  return records.map((r) => ({
    id: r.id,
    language: r.language,
    repoPath: path.join(CORPUS_DIR, r.id),
    sourceRoot: path.join(CORPUS_DIR, r.id, r.sourceRoot),
    prompt: r.prompt,
    threshold: r.threshold,
  }));
}
