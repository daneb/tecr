/**
 * S-14: Sub-agent isolation MCP integration test.
 *
 * Verifies that the `delegate` tool:
 * - Returns a non-empty summary.
 * - The summary fits within 200 tokens (isolation contract).
 * - The parent governor only accounts for the summary tokens, not the
 *   sub-agent's full exploration (effective= shows a small increment).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import path from 'path';
import { countTokens } from '@tecr/core';

const serverPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../dist/index.js',
);

const WORKSPACE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');

const META_RE = /\[tecr: utilization=(\S+) effective=(\d+)\/(\d+)/;

let client: Client;

beforeAll(async () => {
  const transport = new StdioClientTransport({ command: 'node', args: [serverPath] });
  client = new Client({ name: 'test', version: '0.0.1' }, { capabilities: {} });
  await client.connect(transport);
}, 15_000);

afterAll(async () => {
  await client?.close();
});

function text(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as Array<{ type: string; text: string }>).map((c) => c.text).join('');
}

describe('S-14 delegate MCP tool', () => {
  it('returns a non-empty summary', async () => {
    const result = await client.callTool({
      name: 'delegate',
      arguments: { workspaceRoot: WORKSPACE, task: 'find buildRepoMap' },
    });
    expect(result.isError).toBeFalsy();
    expect(text(result).length).toBeGreaterThan(0);
  });

  it('summary portion is ≤ 200 tokens (isolation contract)', async () => {
    const result = await client.callTool({
      name: 'delegate',
      arguments: {
        workspaceRoot: WORKSPACE,
        task: 'find all export statements',
      },
    });
    // The response is: summary + "\nRefs: ..." + "\nSub-agent tokens: ..." + "\n[tecr: ...]"
    // Only the summary (before the first "\nRefs:" or "\nSub-agent") is bounded to ≤200.
    const full = text(result);
    const summaryEnd = full.search(/\n(?:Refs:|Sub-agent tokens:|$\[tecr:)/);
    const summaryPortion = summaryEnd === -1 ? full : full.slice(0, summaryEnd);
    expect(countTokens(summaryPortion)).toBeLessThanOrEqual(200);
  });

  it('parent governor effective tokens grow by summary size only', async () => {
    // Snapshot effective tokens before delegate call.
    const before = await client.callTool({ name: 'hello', arguments: { message: 'snap' } });
    const mBefore = META_RE.exec(text(before));
    const effectiveBefore = parseInt(mBefore![2]);

    // delegate call — internally runs grep/searchSymbol (many tokens).
    const delegateResult = await client.callTool({
      name: 'delegate',
      arguments: { workspaceRoot: WORKSPACE, task: 'find countTokens' },
    });

    const mAfter = META_RE.exec(text(delegateResult));
    const effectiveAfter = parseInt(mAfter![2]);

    // The increment should be well under 500 tokens (summary ≤200 + refs + usage).
    // If the full grep transcript leaked, it would be thousands of tokens.
    const increment = effectiveAfter - effectiveBefore;
    expect(increment).toBeLessThan(500);
    expect(increment).toBeGreaterThan(0);
  });
});
