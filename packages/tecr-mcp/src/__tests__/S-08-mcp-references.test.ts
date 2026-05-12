/**
 * S-08: references MCP integration test.
 *
 * Spawns the compiled MCP server and calls the references tool against a
 * controlled fixture so results are deterministic.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';

const serverPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../dist/index.js',
);

let client: Client;
let fixtureRoot: string;

beforeAll(async () => {
  fixtureRoot = path.join(os.tmpdir(), 'tecr-s08-mcp-fixture');
  await rm(fixtureRoot, { recursive: true, force: true });
  await mkdir(path.join(fixtureRoot, 'src'), { recursive: true });

  await writeFile(
    path.join(fixtureRoot, 'src', 'scheduler.ts'),
    [
      'export function scheduleTask(id: string): void {',
      '  console.log("scheduled", id);',
      '}',
      '',
      'export function bootstrap(): void {',
      '  scheduleTask("init");',
      '  scheduleTask("cleanup");',
      '}',
    ].join('\n'),
  );

  const transport = new StdioClientTransport({ command: 'node', args: [serverPath] });
  client = new Client({ name: 'test', version: '0.0.1' }, { capabilities: {} });
  await client.connect(transport);
}, 15_000);

afterAll(async () => {
  await client?.close();
});

describe('S-08 references MCP tool', () => {
  it('finds call sites for a defined symbol', async () => {
    const result = await client.callTool({
      name: 'references',
      arguments: { workspaceRoot: fixtureRoot, symbolName: 'scheduleTask' },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('scheduler.ts');
    expect(text).toContain('scheduleTask');
    expect(text).toContain('>');
  });

  it('returns no-match message for unknown symbol', async () => {
    const result = await client.callTool({
      name: 'references',
      arguments: { workspaceRoot: fixtureRoot, symbolName: 'xYzAbsolutelyNotHere' },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('No references found');
  });

  it('does not include the definition line', async () => {
    const result = await client.callTool({
      name: 'references',
      arguments: { workspaceRoot: fixtureRoot, symbolName: 'scheduleTask' },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    // The definition line reads: export function scheduleTask(id: string): void {
    // It should NOT appear with a > marker at line 1.
    expect(text).not.toMatch(/>\s+1:.*export function scheduleTask/);
  });
});
