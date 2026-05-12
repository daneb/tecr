/**
 * S-12: Hard-stop MCP integration test.
 *
 * Uses TECR_CONTEXT_WINDOW=10 so a single grep call (returning hundreds of
 * tokens) saturates the budget. The very next call must return isError: true
 * with the hard-stop message.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import path from 'path';

const serverPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../dist/index.js',
);

const WORKSPACE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');

let client: Client;

beforeAll(async () => {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
    env: { ...process.env, TECR_CONTEXT_WINDOW: '10' },
  });
  client = new Client({ name: 'test', version: '0.0.1' }, { capabilities: {} });
  await client.connect(transport);
}, 15_000);

afterAll(async () => {
  await client?.close();
});

function responseText(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as Array<{ type: string; text: string }>).map((c) => c.text).join('');
}

describe('S-12 hard stop in MCP responses', () => {
  it('first call succeeds normally', async () => {
    const result = await client.callTool({
      name: 'grep',
      arguments: { workspaceRoot: WORKSPACE, pattern: 'export' },
    });
    // First call should not be an error — governor hasn't saturated yet.
    expect(result.isError).toBeFalsy();
  });

  it('subsequent call after saturation returns isError with hard-stop message', async () => {
    // After the first grep above filled the 10-token window, this call
    // should trip the hard stop.
    const result = await client.callTool({ name: 'hello', arguments: { message: 'ping' } });
    expect(result.isError).toBe(true);
    expect(responseText(result)).toContain('context budget exhausted');
  });
});
