/**
 * S-04: outline tool — acceptance tests.
 *
 * Exit criteria:
 * - outline() returns ≤200 lines, no function bodies.
 * - JSDoc/line comments immediately preceding a symbol appear in output.
 * - Non-exported symbols are included.
 * - Truncation hint present when the file exceeds the 200-line limit.
 * - Unsupported extensions reject with a clear error.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import { outline } from '../tools/outline.js';

let fixtureRoot: string;
let simpleFile: string;
let bigFile: string;

beforeAll(async () => {
  fixtureRoot = path.join(os.tmpdir(), 'tecr-s04-fixture');
  await rm(fixtureRoot, { recursive: true, force: true });
  await mkdir(fixtureRoot, { recursive: true });

  simpleFile = path.join(fixtureRoot, 'example.ts');
  await writeFile(
    simpleFile,
    `
/**
 * Adds two numbers together.
 */
export function add(a: number, b: number): number {
  return a + b;
}

// Internal configuration type.
interface Config {
  timeout: number;
}

export class Service {
  /** Handles an incoming request. */
  handle(req: string): void {
    console.log(req);
  }
}
`,
  );

  // 110 multi-line functions → ≥220 output lines → must trigger truncation.
  bigFile = path.join(fixtureRoot, 'big.ts');
  const fns = Array.from(
    { length: 110 },
    (_, i) => `export function fn${i}(x: number): number {\n  return x + ${i};\n}`,
  ).join('\n\n');
  await writeFile(bigFile, fns);
}, 30_000);

// ── Core behaviour ────────────────────────────────────────────────────────────

describe('S-04 outline', () => {
  it('includes function signature', async () => {
    const result = await outline(simpleFile);
    expect(result.text).toContain('add(a: number, b: number): number');
  });

  it('does not include function bodies', async () => {
    const result = await outline(simpleFile);
    expect(result.text).not.toContain('return a + b');
    expect(result.text).not.toContain('console.log');
  });

  it('includes JSDoc comment preceding the symbol', async () => {
    const result = await outline(simpleFile);
    expect(result.text).toContain('Adds two numbers together.');
  });

  it('includes inline line comment', async () => {
    const result = await outline(simpleFile);
    expect(result.text).toContain('Internal configuration type.');
  });

  it('includes non-exported symbols', async () => {
    const result = await outline(simpleFile);
    expect(result.text).toContain('Config');
  });

  it('lineCount is always ≤200', async () => {
    const result = await outline(bigFile);
    expect(result.lineCount).toBeLessThanOrEqual(200);
  });

  it('sets truncated flag and includes hint for large files', async () => {
    const result = await outline(bigFile);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain('[truncated:');
    expect(result.text).toContain('read_lines');
  });

  it('truncated flag is false for small files', async () => {
    const result = await outline(simpleFile);
    expect(result.truncated).toBe(false);
  });

  it('rejects unsupported file extensions', async () => {
    const badFile = path.join(fixtureRoot, 'foo.xyz');
    await writeFile(badFile, 'content');
    await expect(outline(badFile)).rejects.toThrow('unsupported');
  });
});
