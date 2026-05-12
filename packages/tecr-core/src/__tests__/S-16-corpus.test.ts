/**
 * S-16: Golden corpus — acceptance tests.
 *
 * Exit criteria:
 * - loadCorpus() returns exactly three entries.
 * - Each entry has id, language, repoPath, sourceRoot, prompt, threshold.
 * - repoPath and sourceRoot exist on disk (corpus is offline-runnable).
 * - threshold is a positive integer.
 * - The three expected languages are present (typescript, rust, python).
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { loadCorpus } from '../harness/corpus.js';

describe('loadCorpus()', () => {
  it('exit criterion: returns exactly three entries', () => {
    const corpus = loadCorpus();
    expect(corpus).toHaveLength(3);
  });

  it('each entry has the required shape', () => {
    const corpus = loadCorpus();
    for (const entry of corpus) {
      expect(typeof entry.id).toBe('string');
      expect(entry.id.length).toBeGreaterThan(0);
      expect(typeof entry.language).toBe('string');
      expect(typeof entry.repoPath).toBe('string');
      expect(typeof entry.sourceRoot).toBe('string');
      expect(typeof entry.prompt).toBe('string');
      expect(entry.prompt.length).toBeGreaterThan(0);
      expect(typeof entry.threshold).toBe('number');
      expect(Number.isInteger(entry.threshold)).toBe(true);
      expect(entry.threshold).toBeGreaterThan(0);
    }
  });

  it('exit criterion: repoPath exists on disk for all entries', () => {
    const corpus = loadCorpus();
    for (const entry of corpus) {
      expect(existsSync(entry.repoPath), `repoPath missing: ${entry.repoPath}`).toBe(true);
    }
  });

  it('exit criterion: sourceRoot exists on disk for all entries', () => {
    const corpus = loadCorpus();
    for (const entry of corpus) {
      expect(existsSync(entry.sourceRoot), `sourceRoot missing: ${entry.sourceRoot}`).toBe(true);
    }
  });

  it('covers typescript, rust, and python', () => {
    const corpus = loadCorpus();
    const languages = corpus.map((e) => e.language);
    expect(languages).toContain('typescript');
    expect(languages).toContain('rust');
    expect(languages).toContain('python');
  });

  it('repoPath is a parent of sourceRoot', () => {
    const corpus = loadCorpus();
    for (const entry of corpus) {
      expect(entry.sourceRoot.startsWith(entry.repoPath)).toBe(true);
    }
  });

  it('ids match the expected corpus entries', () => {
    const corpus = loadCorpus();
    const ids = corpus.map((e) => e.id).sort();
    expect(ids).toEqual(['bincode', 'httpx', 'zod']);
  });
});
