/**
 * S-10: Utilization tracker MCP integration test.
 *
 * Spawns the compiled MCP server and verifies that every tool response
 * includes a [tecr: utilization=... effective=.../...] metadata line, and that
 * utilization accumulates across successive calls.
 * (S-11 changed the metadata key from "tokens=" to "effective=".)
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

const META_RE = /\[tecr: utilization=(\d+\.\d+) effective=(\d+)\/(\d+)/;

let client: Client;

beforeAll(async () => {
  const transport = new StdioClientTransport({ command: 'node', args: [serverPath] });
  client = new Client({ name: 'test', version: '0.0.1' }, { capabilities: {} });
  await client.connect(transport);
}, 15_000);

afterAll(async () => {
  await client?.close();
});

function responseText(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content.map((c) => c.text).join('');
}

describe('S-10 utilization metadata in MCP responses', () => {
  it('hello response contains utilization metadata', async () => {
    const result = await client.callTool({ name: 'hello', arguments: { message: 'ping' } });
    const text = responseText(result);
    expect(META_RE.test(text)).toBe(true);
  });

  it('utilization is a positive number', async () => {
    const result = await client.callTool({ name: 'hello', arguments: { message: 'test' } });
    const text = responseText(result);
    const match = META_RE.exec(text);
    expect(match).not.toBeNull();
    const utilization = parseFloat(match![1]);
    expect(utilization).toBeGreaterThan(0);
  });

  it('utilization increases across successive calls', async () => {
    const r1 = await client.callTool({ name: 'hello', arguments: { message: 'first' } });
    const r2 = await client.callTool({ name: 'hello', arguments: { message: 'second' } });

    const u1 = parseFloat(META_RE.exec(responseText(r1))![1]);
    const u2 = parseFloat(META_RE.exec(responseText(r2))![1]);

    expect(u2).toBeGreaterThan(u1);
  });

  it('token total in metadata matches expected window size', async () => {
    const result = await client.callTool({ name: 'hello', arguments: { message: 'window' } });
    const text = responseText(result);
    const match = META_RE.exec(text);
    expect(match).not.toBeNull();
    // Default window is 200000
    expect(parseInt(match![3])).toBe(200_000);
  });
});
