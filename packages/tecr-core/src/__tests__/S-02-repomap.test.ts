/**
 * S-02: TypeScript repo-map — acceptance tests.
 *
 * Exit criteria:
 * - buildRepoMap() returns structured text with TypeScript symbols.
 * - tokenCount > 0.
 * - Execution time < 500 ms on a small fixture project.
 * - Truncation markers present when budget is exceeded.
 * - PageRank: highly-imported files appear before leaf files.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { buildRepoMap } from '../index.js';
import path from 'path';
import os from 'os';

// ── Fixture project ───────────────────────────────────────────────────────────
//
// src/
//   utils.ts        — exports two helpers (should rank high: imported by others)
//   auth.ts         — imports from utils.ts
//   index.ts        — imports from utils.ts and auth.ts

let fixtureRoot: string;

beforeAll(async () => {
  fixtureRoot = path.join(os.tmpdir(), 'tecr-s02-fixture');
  await rm(fixtureRoot, { recursive: true, force: true });
  await mkdir(path.join(fixtureRoot, 'src'), { recursive: true });

  await writeFile(
    path.join(fixtureRoot, 'src', 'utils.ts'),
    `export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

export interface Logger {
  log(message: string): void;
  error(message: string): void;
}
`,
  );

  await writeFile(
    path.join(fixtureRoot, 'src', 'auth.ts'),
    `import { Logger } from './utils.js';

export class AuthService {
  constructor(private logger: Logger) {}

  authenticate(token: string): boolean {
    this.logger.log('authenticating');
    return token.length > 0;
  }
}

export type AuthResult = { success: boolean; userId?: string };
`,
  );

  await writeFile(
    path.join(fixtureRoot, 'src', 'index.ts'),
    `import { clamp } from './utils.js';
import { AuthService } from './auth.js';

export function createApp(port: number) {
  const auth = new AuthService({ log: console.log, error: console.error });
  return { auth, port: clamp(port, 1024, 65535) };
}
`,
  );
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('S-02 buildRepoMap', () => {
  it('returns non-empty text with TypeScript symbols', async () => {
    const result = await buildRepoMap(fixtureRoot);
    expect(result.text.trim().length).toBeGreaterThan(0);
    expect(result.tokenCount).toBeGreaterThan(0);
  });

  it('contains known exported symbol names', async () => {
    const result = await buildRepoMap(fixtureRoot);
    expect(result.text).toContain('clamp');
    expect(result.text).toContain('AuthService');
    expect(result.text).toContain('Logger');
  });

  it('completes within 500 ms on the fixture project', async () => {
    const start = Date.now();
    await buildRepoMap(fixtureRoot);
    expect(Date.now() - start).toBeLessThan(500);
  }, 5000);

  it('highly-imported utils.ts appears before leaf files', async () => {
    const result = await buildRepoMap(fixtureRoot);
    const utilsPos = result.text.indexOf('utils.ts');
    const indexPos = result.text.indexOf('index.ts');
    expect(utilsPos).toBeGreaterThanOrEqual(0);
    expect(indexPos).toBeGreaterThanOrEqual(0);
    expect(utilsPos).toBeLessThan(indexPos);
  });

  it('respects token budget and marks truncation', async () => {
    // Budget of 1 token is always exceeded — must truncate.
    const result = await buildRepoMap(fixtureRoot, { budget: 1 });
    expect(result.truncated).toBe(true);
  });

  it('is within budget when budget is generous', async () => {
    const result = await buildRepoMap(fixtureRoot, { budget: 4096 });
    expect(result.truncated).toBe(false);
    expect(result.tokenCount).toBeLessThanOrEqual(4096);
  });

  it('focus files appear first in output', async () => {
    const indexFile = path.join(fixtureRoot, 'src', 'index.ts');
    const result = await buildRepoMap(fixtureRoot, { focusFiles: [indexFile] });
    const indexPos = result.text.indexOf('index.ts');
    const utilsPos = result.text.indexOf('utils.ts');
    // index.ts is focused, so it should appear before utils.ts even though
    // utils.ts has higher PageRank.
    expect(indexPos).toBeLessThan(utilsPos);
  });
});
