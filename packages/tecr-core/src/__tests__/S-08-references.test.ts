/**
 * S-08: references tool — acceptance tests.
 *
 * Exit criteria:
 * - references(root, 'doWork') returns call sites for the symbol.
 * - Definition line is excluded from results.
 * - node_modules/ is excluded.
 * - Capped at 100 matches; truncated flag set when more exist.
 * - No matches handled gracefully.
 * - Word-boundary matching: 'foo' does not match 'fooBar'.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import { references } from '../tools/references.js';

let fixtureRoot: string;

beforeAll(async () => {
  fixtureRoot = path.join(os.tmpdir(), 'tecr-s08-fixture');
  await rm(fixtureRoot, { recursive: true, force: true });
  await mkdir(path.join(fixtureRoot, 'src'), { recursive: true });
  await mkdir(path.join(fixtureRoot, 'node_modules', 'pkg'), { recursive: true });

  // File with a definition + two call sites.
  await writeFile(
    path.join(fixtureRoot, 'src', 'worker.ts'),
    [
      'export function doWork(n: number): number {',
      '  return n * 2;',
      '}',
      '',
      'export function runAll(): void {',
      '  doWork(1);',
      '  doWork(2);',
      '}',
    ].join('\n'),
  );

  // A caller in a separate file.
  await writeFile(
    path.join(fixtureRoot, 'src', 'main.ts'),
    [
      'import { doWork } from "./worker";',
      '',
      'const result = doWork(42);',
      'console.log(result);',
    ].join('\n'),
  );

  // A file whose name contains "doWork" but as part of "doWorkExtra" — must NOT match.
  await writeFile(
    path.join(fixtureRoot, 'src', 'extra.ts'),
    [
      'export function doWorkExtra(): void {}',
      'doWorkExtra();',
    ].join('\n'),
  );

  // node_modules file with the symbol — must NOT be returned.
  await writeFile(
    path.join(fixtureRoot, 'node_modules', 'pkg', 'index.js'),
    'module.exports = { doWork: () => {} };',
  );

  // Generate 110 lines each containing 'useMarker' to trigger the 100-match cap.
  const manyLines = Array.from({ length: 110 }, (_, i) => `useMarker(${i});`).join('\n');
  await writeFile(path.join(fixtureRoot, 'src', 'markers.ts'), manyLines);

  // Definition of useMarker so those lines are excluded.
  await writeFile(
    path.join(fixtureRoot, 'src', 'marker-def.ts'),
    'export function useMarker(x: number): void { console.log(x); }',
  );
}, 15_000);

describe('S-08 references', () => {
  it('finds call sites in the same file', async () => {
    const result = await references(fixtureRoot, 'doWork');
    const inWorker = result.matches.filter((m) => m.filePath.endsWith('worker.ts'));
    const lines = inWorker.map((m) => m.line);
    expect(lines).toContain(6); // doWork(1)
    expect(lines).toContain(7); // doWork(2)
  });

  it('finds call sites across files', async () => {
    const result = await references(fixtureRoot, 'doWork');
    const inMain = result.matches.some((m) => m.filePath.endsWith('main.ts'));
    expect(inMain).toBe(true);
  });

  it('excludes definition line', async () => {
    const result = await references(fixtureRoot, 'doWork');
    const defLine = result.matches.find(
      (m) => m.filePath.endsWith('worker.ts') && m.line === 1,
    );
    expect(defLine).toBeUndefined();
  });

  it('excludes node_modules', async () => {
    const result = await references(fixtureRoot, 'doWork');
    const inNodeModules = result.matches.some((m) => m.filePath.includes('node_modules'));
    expect(inNodeModules).toBe(false);
  });

  it('word-boundary matching: does not match doWorkExtra', async () => {
    const result = await references(fixtureRoot, 'doWork');
    const wrongMatches = result.matches.filter((m) => m.text.includes('doWorkExtra'));
    expect(wrongMatches).toHaveLength(0);
  });

  it('includes ±2 context lines', async () => {
    const result = await references(fixtureRoot, 'doWork');
    const m = result.matches.find((m) => m.filePath.endsWith('main.ts') && m.line === 3);
    expect(m).toBeDefined();
    expect(m!.before.length).toBeGreaterThan(0);
  });

  it('text output includes file:line header and context indicator', async () => {
    const result = await references(fixtureRoot, 'doWork');
    expect(result.text).toMatch(/worker\.ts:\d+|main\.ts:\d+/);
    expect(result.text).toContain('>');
  });

  it('caps at 100 matches and sets truncated', async () => {
    const result = await references(fixtureRoot, 'useMarker');
    expect(result.matches.length).toBe(100);
    expect(result.truncated).toBe(true);
    expect(result.totalMatches).toBeGreaterThan(100);
  });

  it('returns graceful empty result when no matches', async () => {
    const result = await references(fixtureRoot, 'zzznomatch999');
    expect(result.matches).toHaveLength(0);
    expect(result.truncated).toBe(false);
    expect(result.text).toContain('No references found');
  });
});
