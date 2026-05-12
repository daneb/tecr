/**
 * S-06: search_symbol tool — acceptance tests.
 *
 * Exit criteria:
 * - searchSymbol(root, 'add') returns the correct file, line, and kind.
 * - Case-insensitive substring matching works.
 * - Exact matches ranked before prefix matches before substring matches.
 * - Returns ≤50 results; truncated flag and hint when more are available.
 * - Empty query results handled gracefully.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import { searchSymbol } from '../tools/searchSymbol.js';

let fixtureRoot: string;

beforeAll(async () => {
  fixtureRoot = path.join(os.tmpdir(), 'tecr-s06-fixture');
  await rm(fixtureRoot, { recursive: true, force: true });
  await mkdir(fixtureRoot, { recursive: true });

  // TypeScript: known symbols at known lines.
  await writeFile(
    path.join(fixtureRoot, 'math.ts'),
    [
      'export function add(a: number, b: number): number { return a + b; }',
      'export function subtract(a: number, b: number): number { return a - b; }',
      'export function multiply(a: number, b: number): number { return a * b; }',
      'function addInternal(x: number): number { return x; }',
    ].join('\n'),
  );

  // Rust: pub fn for cross-language test.
  await writeFile(
    path.join(fixtureRoot, 'utils.rs'),
    [
      'pub fn add_numbers(a: i32, b: i32) -> i32 { a + b }',
      'fn helper() {}',
    ].join('\n'),
  );

  // Generate 60 unique TS functions to test the 50-result cap.
  const manyFns = Array.from(
    { length: 60 },
    (_, i) => `export function widget${i}(): void {}`,
  ).join('\n');
  await writeFile(path.join(fixtureRoot, 'widgets.ts'), manyFns);
}, 30_000);

describe('S-06 searchSymbol', () => {
  it('finds a known TypeScript function by exact name', async () => {
    const result = await searchSymbol(fixtureRoot, 'add');
    const match = result.matches.find((m) => m.name === 'add');
    expect(match).toBeDefined();
    expect(match!.kind).toBe('function');
    expect(match!.filePath).toContain('math.ts');
    expect(match!.line).toBe(1);
  });

  it('returns correct exported flag', async () => {
    const result = await searchSymbol(fixtureRoot, 'addInternal');
    const match = result.matches.find((m) => m.name === 'addInternal');
    expect(match?.exported).toBe(false);
  });

  it('performs case-insensitive matching', async () => {
    const lower = await searchSymbol(fixtureRoot, 'add');
    const upper = await searchSymbol(fixtureRoot, 'ADD');
    const names = (r: typeof lower) => r.matches.map((m) => m.name).sort();
    expect(names(lower)).toEqual(names(upper));
  });

  it('performs substring matching', async () => {
    const result = await searchSymbol(fixtureRoot, 'tract');
    const names = result.matches.map((m) => m.name);
    expect(names).toContain('subtract');
  });

  it('ranks exact matches before prefix before substring', async () => {
    // 'add' exactly matches 'add', is a prefix of 'addInternal',
    // and is a substring of 'add_numbers'.
    const result = await searchSymbol(fixtureRoot, 'add');
    const names = result.matches.map((m) => m.name);
    const idxExact = names.indexOf('add');
    const idxPrefix = names.indexOf('addInternal');
    const idxSubstring = names.indexOf('add_numbers');
    expect(idxExact).toBeLessThan(idxPrefix);
    expect(idxPrefix).toBeLessThan(idxSubstring);
  });

  it('finds Rust symbols cross-language', async () => {
    const result = await searchSymbol(fixtureRoot, 'add_numbers');
    const match = result.matches.find((m) => m.name === 'add_numbers');
    expect(match).toBeDefined();
    expect(match!.filePath).toContain('utils.rs');
    expect(match!.kind).toBe('function');
  });

  it('caps results at 50 and sets truncated', async () => {
    const result = await searchSymbol(fixtureRoot, 'widget');
    expect(result.matches.length).toBe(50);
    expect(result.truncated).toBe(true);
    expect(result.totalMatches).toBeGreaterThan(50);
  });

  it('includes truncation hint in text when capped', async () => {
    const result = await searchSymbol(fixtureRoot, 'widget');
    expect(result.text).toContain('[truncated:');
    expect(result.text).toContain('refine your query');
  });

  it('returns empty result gracefully for no matches', async () => {
    const result = await searchSymbol(fixtureRoot, 'zzznomatch');
    expect(result.matches).toHaveLength(0);
    expect(result.truncated).toBe(false);
    expect(result.text).toContain("No symbols found");
  });
});
