/**
 * S-05: read_lines tool — acceptance tests.
 *
 * Exit criteria:
 * - readLines(file, 1, 50) returns exactly 50 lines.
 * - readLines with end − start + 1 > 200 clamps to 200 and includes hint.
 * - nextCursor from a truncated result gives the correct next page.
 * - end > file length clamps to file end without triggering truncation.
 * - start > file length returns gracefully.
 * - Output includes correct line numbers.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import { readLines } from '../tools/readLines.js';

let fixtureRoot: string;
let fixturePath: string;
const TOTAL_LINES = 300;

beforeAll(async () => {
  fixtureRoot = path.join(os.tmpdir(), 'tecr-s05-fixture');
  await rm(fixtureRoot, { recursive: true, force: true });
  await mkdir(fixtureRoot, { recursive: true });

  fixturePath = path.join(fixtureRoot, 'lines.txt');
  const content = Array.from({ length: TOTAL_LINES }, (_, i) => `line ${i + 1}`).join('\n');
  await writeFile(fixturePath, content);
}, 10_000);

describe('S-05 readLines', () => {
  it('returns exactly the requested number of lines when within cap', async () => {
    const result = await readLines(fixturePath, 1, 50);
    expect(result.lineCount).toBe(50);
    expect(result.truncated).toBe(false);
    expect(result.nextCursor).toBeUndefined();
  });

  it('clamps to 200 when range exceeds the cap', async () => {
    const result = await readLines(fixturePath, 1, 250);
    expect(result.lineCount).toBe(200);
    expect(result.truncated).toBe(true);
  });

  it('includes truncation hint with cursor when clamped', async () => {
    const result = await readLines(fixturePath, 1, 250);
    expect(result.text).toContain('[truncated:');
    expect(result.text).toContain('cursor=201');
    expect(result.nextCursor).toBe(201);
  });

  it('nextCursor returns the correct next page', async () => {
    const page1 = await readLines(fixturePath, 1, 250);
    const page2 = await readLines(fixturePath, page1.nextCursor!);
    expect(page2.startLine).toBe(201);
    expect(page2.text).toContain('line 201');
    expect(page2.text).not.toContain('line 1\t');
  });

  it('defaults to 200-line page from line 1 when no bounds given', async () => {
    const result = await readLines(fixturePath);
    expect(result.startLine).toBe(1);
    expect(result.lineCount).toBe(200);
    expect(result.truncated).toBe(true);
  });

  it('clamps end to file length without triggering truncation', async () => {
    const result = await readLines(fixturePath, 280, 350);
    expect(result.endLine).toBe(TOTAL_LINES);
    expect(result.lineCount).toBe(TOTAL_LINES - 280 + 1);
    expect(result.truncated).toBe(false);
  });

  it('handles start beyond file length gracefully', async () => {
    const result = await readLines(fixturePath, 999);
    expect(result.lineCount).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.text).toContain('exceeds');
  });

  it('reports correct totalLines', async () => {
    const result = await readLines(fixturePath, 1, 10);
    expect(result.totalLines).toBe(TOTAL_LINES);
  });

  it('output text contains correct line numbers', async () => {
    const result = await readLines(fixturePath, 5, 7);
    expect(result.text).toContain('5\tline 5');
    expect(result.text).toContain('6\tline 6');
    expect(result.text).toContain('7\tline 7');
  });
});
