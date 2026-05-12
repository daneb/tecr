/**
 * S-11: Governor compaction MCP integration test.
 *
 * Exit criteria:
 * - Every tool response includes an "effective=" field (Governor is wired, not
 *   bare tracker).
 * - After repeated grep calls returning substantial content, the compaction
 *   note "compacted=N recovered=K" appears in the metadata.
 *
 * Compaction requires the response text to be large enough that the one-line
 * summary saves tokens. We use grep on the TECR source tree (returning many
 * lines) with a tiny window (TECR_CONTEXT_WINDOW=300) so the threshold is
 * crossed quickly.
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

// workspaceRoot for the grep calls — the TECR repo itself.
const WORKSPACE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');

const META_RE =
  /\[tecr: utilization=(\S+) effective=(\d+)\/(\d+)(?:\s+compacted=(\d+) recovered=(\d+))?\]/;

let client: Client;

beforeAll(async () => {
  // Each grep("export") returns ~7000–9000 tokens against the full TECR tree.
  // Window=100000: threshold at 35%=35000 tokens. After 5 calls (~35000–45000
  // tokens cumulative) the threshold is crossed and compaction fires, collapsing
  // the 3 oldest entries and recovering tens of thousands of tokens.
  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
    env: { ...process.env, TECR_CONTEXT_WINDOW: '100000' },
  });
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

describe('S-11 governor in MCP responses', () => {
  it('every response includes effective= field (governor wired)', async () => {
    const result = await client.callTool({ name: 'hello', arguments: { message: 'hi' } });
    const text = responseText(result);
    expect(META_RE.test(text)).toBe(true);
    const match = META_RE.exec(text)!;
    // window size should be the custom 100000
    expect(parseInt(match[3])).toBe(100_000);
  });

  it('compaction fires and is reported after threshold crossed', async () => {
    // Each grep returns ~7000–9000 tokens. Window=100000, threshold=35%=35000.
    // After ~5 calls (~35000–45000 tokens) the threshold is crossed and
    // compaction fires, collapsing the 3+ oldest entries. The response for
    // that call carries compacted=N recovered=K in the metadata.
    let compactionSeen = false;

    for (let i = 0; i < 8; i++) {
      const result = await client.callTool({
        name: 'grep',
        arguments: { workspaceRoot: WORKSPACE, pattern: 'export' },
      });
      // If the hard stop fires, the governor is exhausted — stop looping.
      if (result.isError) break;
      const text = responseText(result);
      const match = META_RE.exec(text);
      if (match && match[4] !== undefined) {
        const compacted = parseInt(match[4]);
        const recovered = parseInt(match[5]);
        if (compacted > 0 && recovered > 0) {
          compactionSeen = true;
          break;
        }
      }
    }
    expect(compactionSeen).toBe(true);
  });
});
