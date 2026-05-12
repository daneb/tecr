/**
 * S-07: grep tool — acceptance tests.
 *
 * Exit criteria:
 * - grep(root, 'needle') returns matches with file, line number, ±2 context lines.
 * - node_modules/ and dist/ are excluded.
 * - Capped at 100 matches; truncated flag and hint when more exist.
 * - Case-insensitive option works.
 * - No matches handled gracefully.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import { grep } from '../tools/grep.js';

let fixtureRoot: string;

beforeAll(async () => {
  fixtureRoot = path.join(os.tmpdir(), 'tecr-s07-fixture');
  await rm(fixtureRoot, { recursive: true, force: true });
  await mkdir(path.join(fixtureRoot, 'src'), { recursive: true });
  await mkdir(path.join(fixtureRoot, 'node_modules', 'pkg'), { recursive: true });

  // Main source file with known content.
  await writeFile(
    path.join(fixtureRoot, 'src', 'server.ts'),
    [
      'import { createServer } from "http";',
      '',
      '// Start the server on the given port.',
      'export function startServer(port: number): void {',
      '  const server = createServer();',
      '  server.listen(port);',
      '}',
    ].join('\n'),
  );

  // A file in node_modules — must NOT be searched.
  await writeFile(
    path.join(fixtureRoot, 'node_modules', 'pkg', 'index.js'),
    'module.exports = { startServer: () => {} };',
  );

  // Generate 110 lines each containing 'mark' to trigger the 100-match cap.
  const manyLines = Array.from({ length: 110 }, (_, i) => `const mark${i} = ${i};`).join('\n');
  await writeFile(path.join(fixtureRoot, 'src', 'marks.ts'), manyLines);
}, 10_000);

describe('S-07 grep', () => {
  it('finds a match with correct file and line', async () => {
    const result = await grep(fixtureRoot, 'startServer');
    const m = result.matches.find((x) => x.filePath.endsWith('server.ts'));
    expect(m).toBeDefined();
    expect(m!.line).toBe(4);
    expect(m!.text).toContain('startServer');
  });

  it('includes ±2 context lines', async () => {
    const result = await grep(fixtureRoot, 'startServer');
    const m = result.matches.find((x) => x.line === 4);
    expect(m!.before.length).toBe(2);        // lines 2 and 3
    expect(m!.after.length).toBe(2);         // lines 5 and 6
    expect(m!.before[0]).toBe('');           // line 2: blank
    expect(m!.before[1]).toContain('Start'); // line 3: comment
    expect(m!.after[0]).toContain('createServer'); // line 5
  });

  it('excludes node_modules', async () => {
    const result = await grep(fixtureRoot, 'startServer');
    const inNodeModules = result.matches.some((m) =>
      m.filePath.includes('node_modules'),
    );
    expect(inNodeModules).toBe(false);
  });

  it('text output includes file:line header and context indicator', async () => {
    const result = await grep(fixtureRoot, 'startServer');
    expect(result.text).toMatch(/server\.ts:\d+/);
    expect(result.text).toContain('>');
  });

  it('caps at 100 matches and sets truncated', async () => {
    const result = await grep(fixtureRoot, 'mark');
    expect(result.matches.length).toBe(100);
    expect(result.truncated).toBe(true);
    expect(result.totalMatches).toBeGreaterThan(100);
  });

  it('truncation hint appears in text', async () => {
    const result = await grep(fixtureRoot, 'mark');
    expect(result.text).toContain('[truncated:');
    expect(result.text).toContain('narrow your pattern');
  });

  it('case-insensitive option finds case variants', async () => {
    const sensitive = await grep(fixtureRoot, 'STARTSERVER');
    const insensitive = await grep(fixtureRoot, 'STARTSERVER', { caseInsensitive: true });
    expect(sensitive.matches.length).toBe(0);
    expect(insensitive.matches.length).toBeGreaterThan(0);
  });

  it('returns graceful empty result when no matches', async () => {
    const result = await grep(fixtureRoot, 'zzznomatch999');
    expect(result.matches).toHaveLength(0);
    expect(result.truncated).toBe(false);
    expect(result.text).toContain('No matches found');
  });
});
