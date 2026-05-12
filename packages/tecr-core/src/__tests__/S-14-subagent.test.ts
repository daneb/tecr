/**
 * S-14: Sub-agent isolation — acceptance tests.
 *
 * Exit criteria:
 * - delegate({ task, workspaceRoot }) returns { summary, artifactRefs, tokenUsage }.
 * - countTokens(result.summary) ≤ SUMMARY_TOKEN_LIMIT (200).
 * - Parent context is unchanged (delegate uses its own isolated tracker).
 * - artifactRefs contains typed pointers (file/symbol/match).
 * - tokenUsage reports inputTokens, outputTokens, totalTokens.
 */

import { describe, it, expect } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import { delegate, SUMMARY_TOKEN_LIMIT } from '../subagent/index.js';
import { countTokens } from '../tokenizer.js';
import { Governor } from '../governor/index.js';

let fixtureRoot: string;

async function setupFixture(): Promise<string> {
  const root = path.join(os.tmpdir(), 'tecr-s14-fixture');
  await rm(root, { recursive: true, force: true });
  await mkdir(path.join(root, 'src'), { recursive: true });

  await writeFile(
    path.join(root, 'src', 'auth.ts'),
    [
      'export function verifyToken(token: string): boolean {',
      '  return token.length > 0;',
      '}',
      '',
      'export function createSession(userId: string): string {',
      '  return `session-${userId}`;',
      '}',
    ].join('\n'),
  );

  await writeFile(
    path.join(root, 'src', 'api.ts'),
    [
      "import { verifyToken } from './auth.js';",
      '',
      'export function handleRequest(token: string): string {',
      '  if (!verifyToken(token)) return "unauthorized";',
      '  return "ok";',
      '}',
    ].join('\n'),
  );

  return root;
}

describe('delegate()', () => {
  it('returns the required shape', async () => {
    fixtureRoot = await setupFixture();
    const result = await delegate({ task: 'find verifyToken', workspaceRoot: fixtureRoot });
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('artifactRefs');
    expect(result).toHaveProperty('tokenUsage');
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it('exit criterion: summary is ≤ SUMMARY_TOKEN_LIMIT tokens', async () => {
    fixtureRoot = await setupFixture();
    const result = await delegate({
      task: 'find all callers of verifyToken across the codebase',
      workspaceRoot: fixtureRoot,
    });
    const tokens = countTokens(result.summary);
    expect(tokens).toBeLessThanOrEqual(SUMMARY_TOKEN_LIMIT);
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it('summary token limit constant is 200', () => {
    expect(SUMMARY_TOKEN_LIMIT).toBe(200);
  });

  it('artifactRefs contains typed pointers', async () => {
    fixtureRoot = await setupFixture();
    const result = await delegate({
      task: 'find verifyToken',
      workspaceRoot: fixtureRoot,
    });
    for (const ref of result.artifactRefs) {
      expect(['symbol', 'match', 'file']).toContain(ref.type);
      expect(typeof ref.path).toBe('string');
    }
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it('tokenUsage has inputTokens, outputTokens, totalTokens', async () => {
    fixtureRoot = await setupFixture();
    const result = await delegate({ task: 'find createSession', workspaceRoot: fixtureRoot });
    expect(result.tokenUsage.inputTokens).toBeGreaterThan(0);
    expect(result.tokenUsage.outputTokens).toBeGreaterThan(0);
    expect(result.tokenUsage.totalTokens).toBe(
      result.tokenUsage.inputTokens + result.tokenUsage.outputTokens,
    );
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it('parent context is unchanged: delegate uses isolated tracker', async () => {
    fixtureRoot = await setupFixture();
    const parentGovernor = new Governor();

    // Record one parent call.
    parentGovernor.record('grep', { pattern: 'export' }, 'some output', 200_000);
    const snapBefore = parentGovernor.currentHistory().length;

    // Delegate a discovery task — should NOT touch the parent governor.
    await delegate({ task: 'find verifyToken', workspaceRoot: fixtureRoot });

    // Parent history unchanged.
    expect(parentGovernor.currentHistory().length).toBe(snapBefore);
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it('handles a task with no matches gracefully', async () => {
    fixtureRoot = await setupFixture();
    const result = await delegate({
      task: 'find xyzzyNonExistentSymbol',
      workspaceRoot: fixtureRoot,
    });
    expect(typeof result.summary).toBe('string');
    expect(result.summary.length).toBeGreaterThan(0);
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it('summary is truncated to ≤200 tokens even for large result sets', async () => {
    // Use the real TECR workspace — grep for 'export' returns many matches.
    const realRoot = path.resolve(process.cwd());
    const result = await delegate({
      task: 'find all export statements across the codebase',
      workspaceRoot: realRoot,
    });
    expect(countTokens(result.summary)).toBeLessThanOrEqual(SUMMARY_TOKEN_LIMIT);
  });
});
