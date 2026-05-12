/**
 * S-06: search_symbol MCP integration test.
 *
 * Spawns the compiled MCP server and calls search_symbol against the
 * tecr-core/src directory — real source code with known symbols.
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

// Search inside the tecr-core source tree — it has known symbols.
// __tests__ → src → tecr-mcp → packages → repo-root → packages/tecr-core/src
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/tecr-core/src',
);

let client: Client;

beforeAll(async () => {
  const transport = new StdioClientTransport({ command: 'node', args: [serverPath] });
  client = new Client({ name: 'test', version: '0.0.1' }, { capabilities: {} });
  await client.connect(transport);
}, 15_000);

afterAll(async () => {
  await client?.close();
});

describe('S-06 search_symbol MCP tool', () => {
  it('finds buildRepoMap with correct file and kind', async () => {
    const result = await client.callTool({
      name: 'search_symbol',
      arguments: { workspaceRoot, query: 'buildRepoMap' },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('buildRepoMap');
    expect(text).toContain('[function]');
    expect(text).toContain('index.ts');
  });

  it('returns a no-match message for a nonsense query', async () => {
    const result = await client.callTool({
      name: 'search_symbol',
      arguments: { workspaceRoot, query: 'zzznomatch999' },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('No symbols found');
  });

  it('performs case-insensitive substring search', async () => {
    const result = await client.callTool({
      name: 'search_symbol',
      arguments: { workspaceRoot, query: 'REPOMAP' },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('buildRepoMap');
  });
});
