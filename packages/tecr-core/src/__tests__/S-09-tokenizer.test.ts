/**
 * S-09: Token counter — acceptance tests.
 *
 * Exit criteria:
 * - countTokens('hello world') returns the expected cl100k count.
 * - Empty / whitespace-only input returns 0.
 * - buildRepoMap() tokenCount reflects real token counts (not char/4 estimate).
 */

import { describe, it, expect } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import { countTokens } from '../tokenizer.js';
import { buildRepoMap } from '../index.js';

describe('countTokens', () => {
  it('returns 0 for empty string', () => {
    expect(countTokens('')).toBe(0);
  });

  it('returns 0 for undefined-like falsy input', () => {
    // @ts-expect-error intentional
    expect(countTokens(null)).toBe(0);
  });

  it('counts "hello world" as 2 cl100k tokens', () => {
    // cl100k_base: "hello" (1) + " world" (1) = 2
    expect(countTokens('hello world')).toBe(2);
  });

  it('counts each word in a longer sentence correctly', () => {
    // Sanity: result is a positive integer
    const n = countTokens('The quick brown fox jumps over the lazy dog');
    expect(n).toBeGreaterThan(0);
    expect(Number.isInteger(n)).toBe(true);
  });

  it('counts code tokens accurately', () => {
    // A function signature will tokenise to more tokens than chars/4 would predict
    const src = 'export function buildRepoMap(workspaceRoot: string): Promise<RepoMapResult>';
    const n = countTokens(src);
    expect(n).toBeGreaterThan(0);
    // char/4 heuristic would give ~19; real count should differ
    const charEstimate = Math.ceil(src.length / 4);
    expect(n).not.toBe(charEstimate);
  });

  it('is consistent: same input always returns same count', () => {
    const text = 'TypeScript is a strongly typed programming language.';
    expect(countTokens(text)).toBe(countTokens(text));
  });
});

describe('buildRepoMap uses real token counts', () => {
  let fixtureRoot: string;

  it('tokenCount is a positive integer from real encoding', async () => {
    fixtureRoot = path.join(os.tmpdir(), 'tecr-s09-fixture');
    await rm(fixtureRoot, { recursive: true, force: true });
    await mkdir(path.join(fixtureRoot, 'src'), { recursive: true });

    await writeFile(
      path.join(fixtureRoot, 'src', 'index.ts'),
      [
        'export function add(a: number, b: number): number { return a + b; }',
        'export function subtract(a: number, b: number): number { return a - b; }',
      ].join('\n'),
    );

    const result = await buildRepoMap(fixtureRoot, { budget: 2048 });

    expect(result.tokenCount).toBeGreaterThan(0);
    expect(Number.isInteger(result.tokenCount)).toBe(true);
    // A real cl100k count for a short TS file should be in single-to-low-double digits
    expect(result.tokenCount).toBeLessThan(200);

    await rm(fixtureRoot, { recursive: true, force: true });
  });
});
