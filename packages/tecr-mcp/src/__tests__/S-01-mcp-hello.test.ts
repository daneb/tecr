/**
 * S-01: MCP pipe hello — acceptance test for the tecr-mcp layer.
 *
 * Exit criterion: the MCP server responds to a tools/call hello request
 * with the expected TECR-prefixed text.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import path from 'path';

// __dirname = packages/tecr-mcp/src/__tests__
// ../../dist = packages/tecr-mcp/dist
const serverPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../dist/index.js',
);

let client: Client;

describe('S-01 MCP hello tool', () => {
  it('echoes the message through the full MCP pipe', { timeout: 10_000 }, async () => {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath],
    });

    client = new Client(
      { name: 'test', version: '0.0.1' },
      { capabilities: {} },
    );

    await client.connect(transport);

    const result = await client.callTool({
      name: 'hello',
      arguments: { message: 'hello' },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    // S-10 appends a utilization metadata line — match only the first line.
    expect(content[0].text).toMatch(/^TECR \d+\.\d+\.\d+: hello/);
  });

  afterAll(async () => {
    await client?.close();
  });
});
