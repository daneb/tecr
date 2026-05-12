/**
 * S-07: grep MCP integration test.
 *
 * Spawns the compiled MCP server and calls the grep tool against a
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
  fixtureRoot = path.join(os.tmpdir(), 'tecr-s07-mcp-fixture');
  await rm(fixtureRoot, { recursive: true, force: true });
  await mkdir(path.join(fixtureRoot, 'src'), { recursive: true });

  await writeFile(
    path.join(fixtureRoot, 'src', 'engine.ts'),
    [
      'import { readFile } from "fs/promises";',
      '',
      '// computePagerank calculates importance scores.',
      'export async function computePagerank(nodes: string[]): Promise<Map<string, number>> {',
      '  const ranks = new Map<string, number>();',
      '  for (const n of nodes) ranks.set(n, 1 / nodes.length);',
      '  return ranks;',
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

describe('S-07 grep MCP tool', () => {
  it('finds pattern with file path and context lines', async () => {
    const result = await client.callTool({
      name: 'grep',
      arguments: { workspaceRoot: fixtureRoot, pattern: 'computePagerank' },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('engine.ts');
    expect(text).toContain('computePagerank');
    expect(text).toContain('>'); // context indicator on the matching line
  });

  it('returns no-match message for unknown pattern', async () => {
    const result = await client.callTool({
      name: 'grep',
      arguments: { workspaceRoot: fixtureRoot, pattern: 'xYzAbsolutelyNotHere' },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('No matches found');
  });

  it('case-insensitive flag finds uppercase variant', async () => {
    const result = await client.callTool({
      name: 'grep',
      arguments: { workspaceRoot: fixtureRoot, pattern: 'COMPUTEPAGERANK', caseInsensitive: true },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('engine.ts');
    expect(text).toContain('computePagerank');
  });
});
