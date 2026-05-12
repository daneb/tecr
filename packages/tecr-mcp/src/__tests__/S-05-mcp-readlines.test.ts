/**
 * S-05: read_lines MCP integration test.
 *
 * Spawns the compiled MCP server via stdio and calls the read_lines tool
 * through the full MCP pipe. Verifies:
 * - Content matches expected lines.
 * - Pagination: cursor from page 1 retrieves page 2.
 * - Truncation hint is present in the text when clamped.
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
let fixturePath: string;
const TOTAL_LINES = 250;

beforeAll(async () => {
  // Create a fixture file the server process can access.
  const fixtureRoot = path.join(os.tmpdir(), 'tecr-s05-mcp-fixture');
  await rm(fixtureRoot, { recursive: true, force: true });
  await mkdir(fixtureRoot, { recursive: true });

  fixturePath = path.join(fixtureRoot, 'data.txt');
  const content = Array.from({ length: TOTAL_LINES }, (_, i) => `line ${i + 1}`).join('\n');
  await writeFile(fixturePath, content);

  const transport = new StdioClientTransport({ command: 'node', args: [serverPath] });
  client = new Client({ name: 'test', version: '0.0.1' }, { capabilities: {} });
  await client.connect(transport);
}, 15_000);

afterAll(async () => {
  await client?.close();
});

describe('S-05 read_lines MCP tool', () => {
  it('returns the first 200 lines and includes a truncation hint', async () => {
    const result = await client.callTool({
      name: 'read_lines',
      arguments: { filePath: fixturePath },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('line 1');
    expect(text).toContain('line 200');
    expect(text).not.toContain('line 201');
    expect(text).toContain('[truncated:');
    expect(text).toContain('cursor=201');
  });

  it('uses cursor to retrieve page 2', async () => {
    const page2 = await client.callTool({
      name: 'read_lines',
      arguments: { filePath: fixturePath, cursor: 201 },
    });
    const text = (page2.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('line 201');
    expect(text).toContain(`line ${TOTAL_LINES}`);
    expect(text).not.toContain('[truncated:');
  });

  it('respects explicit start and end', async () => {
    const result = await client.callTool({
      name: 'read_lines',
      arguments: { filePath: fixturePath, start: 10, end: 20 },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('line 10');
    expect(text).toContain('line 20');
    expect(text).not.toContain('line 9\t');
    expect(text).not.toContain('line 21');
    expect(text).not.toContain('[truncated:');
  });
});
