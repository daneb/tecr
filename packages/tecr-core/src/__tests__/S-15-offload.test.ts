/**
 * S-15: Tiered model offload — acceptance tests.
 *
 * Exit criteria:
 * - When TECR_LOCAL_MODEL_URL is set, delegate() routes to the local model.
 * - Telemetry shows localTokens > 0, billableTokens unchanged.
 * - Local tokens are NOT added to effectiveTokens (zero-cost for budget).
 * - When the local model is unreachable, delegate() falls back to the grep path.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import { delegate } from '../subagent/index.js';
import { Governor } from '../governor/index.js';
import { onTelemetry } from '../telemetry.js';
import type { TelemetryEvent } from '../telemetry.js';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  const fns = cleanups.splice(0);
  await Promise.allSettled(fns.map((fn) => fn()));
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function setupFixture(): Promise<string> {
  const root = path.join(os.tmpdir(), 'tecr-s15-fixture');
  await rm(root, { recursive: true, force: true });
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(
    path.join(root, 'src', 'auth.ts'),
    'export function verifyToken(token: string): boolean { return token.length > 0; }\n',
  );
  return root;
}

function stubLocalModel(responseContent: string, usage?: { prompt_tokens: number; completion_tokens: number }) {
  vi.stubEnv('TECR_LOCAL_MODEL_URL', 'http://localhost:11434');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: responseContent } }],
        ...(usage ? { usage } : {}),
      }),
    }),
  );
}

function captureEvents(): { events: TelemetryEvent[] } {
  const events: TelemetryEvent[] = [];
  const off = onTelemetry((e) => events.push(e));
  cleanups.push(off);
  return { events };
}

describe('S-15: tiered model offload', () => {
  it('exit criterion: localTokens > 0 when local model is used', async () => {
    const root = await setupFixture();
    cleanups.push(() => rm(root, { recursive: true, force: true }));

    stubLocalModel('Found verifyToken in src/auth.ts at line 1.', {
      prompt_tokens: 45,
      completion_tokens: 12,
    });

    const result = await delegate({ task: 'find verifyToken', workspaceRoot: root });
    expect(result.tokenUsage.localTokens).toBe(57); // 45 + 12
  });

  it('exit criterion: billableTokens = inputTokens + outputTokens (unchanged by localTokens)', async () => {
    const root = await setupFixture();
    cleanups.push(() => rm(root, { recursive: true, force: true }));

    stubLocalModel('Summary of findings.', { prompt_tokens: 30, completion_tokens: 8 });

    const { events } = captureEvents();
    const gov = new Governor();

    // Simulate what the MCP layer does: record with localTokens from result.
    const result = await delegate({ task: 'find verifyToken', workspaceRoot: root });
    gov.record('delegate', { task: 'find verifyToken' }, result.summary, 200_000, result.tokenUsage.localTokens);

    const e = events[0];
    expect(e.billableTokens).toBe(e.inputTokens + e.outputTokens);
    expect(e.localTokens).toBe(38); // 30 + 8
  });

  it('exit criterion: localTokens are NOT added to effectiveTokens (zero-cost for budget)', async () => {
    const root = await setupFixture();
    cleanups.push(() => rm(root, { recursive: true, force: true }));

    stubLocalModel('Summary.', { prompt_tokens: 10_000, completion_tokens: 5_000 });

    const { events } = captureEvents();
    const gov = new Governor();

    const result = await delegate({ task: 'find verifyToken', workspaceRoot: root });
    gov.record('delegate', { task: 'x' }, result.summary, 200_000, result.tokenUsage.localTokens);

    const e = events[0];
    // effectiveTokens must NOT include the 15k local tokens.
    expect(e.localTokens).toBe(15_000);
    expect(e.effectiveTokens).toBeLessThan(1_000); // only the small summary counts
    expect(e.effectiveTokens).toBe(e.outputTokens);
  });

  it('localTokens is 0 on the grep/searchSymbol path (no env var)', async () => {
    const root = await setupFixture();
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    // No TECR_LOCAL_MODEL_URL set.

    const result = await delegate({ task: 'find verifyToken', workspaceRoot: root });
    expect(result.tokenUsage.localTokens).toBe(0);
  });

  it('falls back to grep path when local model is unreachable', async () => {
    const root = await setupFixture();
    cleanups.push(() => rm(root, { recursive: true, force: true }));

    vi.stubEnv('TECR_LOCAL_MODEL_URL', 'http://localhost:11434');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const result = await delegate({ task: 'find verifyToken', workspaceRoot: root });
    // Fell back — no local tokens, and summary is still valid.
    expect(result.tokenUsage.localTokens).toBe(0);
    expect(typeof result.summary).toBe('string');
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it('falls back to grep path when local model returns non-2xx', async () => {
    const root = await setupFixture();
    cleanups.push(() => rm(root, { recursive: true, force: true }));

    vi.stubEnv('TECR_LOCAL_MODEL_URL', 'http://localhost:11434');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    const result = await delegate({ task: 'find verifyToken', workspaceRoot: root });
    expect(result.tokenUsage.localTokens).toBe(0);
    expect(typeof result.summary).toBe('string');
  });

  it('summary is still ≤ 200 tokens when local model returns long content', async () => {
    const root = await setupFixture();
    cleanups.push(() => rm(root, { recursive: true, force: true }));

    const longContent = 'token '.repeat(500); // ~500 tokens, well over limit
    stubLocalModel(longContent, { prompt_tokens: 20, completion_tokens: 500 });

    const { countTokens } = await import('../tokenizer.js');
    const { SUMMARY_TOKEN_LIMIT } = await import('../subagent/index.js');

    const result = await delegate({ task: 'find everything', workspaceRoot: root });
    expect(countTokens(result.summary)).toBeLessThanOrEqual(SUMMARY_TOKEN_LIMIT);
  });

  it('telemetry event has both localTokens and billableTokens fields', async () => {
    const root = await setupFixture();
    cleanups.push(() => rm(root, { recursive: true, force: true }));

    const { events } = captureEvents();
    const gov = new Governor();
    gov.record('grep', { pattern: 'foo' }, 'output', 200_000); // no local tokens

    const e = events[0];
    expect(typeof e.localTokens).toBe('number');
    expect(typeof e.billableTokens).toBe('number');
    expect(e.localTokens).toBe(0);
    expect(e.billableTokens).toBe(e.inputTokens + e.outputTokens);
  });
});
