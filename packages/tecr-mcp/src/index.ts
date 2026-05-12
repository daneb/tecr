#!/usr/bin/env node
/**
 * tecr-mcp: TECR MCP server.
 *
 * Exposes tecr-core capabilities over the Model Context Protocol via stdio
 * transport, making them available to any compliant host (Claude Code, Cursor,
 * Copilot, VS Code via tecr-vscode).
 *
 * Phase 0: single `hello` tool wired to tecr-core#hello().
 * Phase 1+ will add repo_map, outline, read_lines, search_symbol, grep, references.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  hello,
  buildRepoMap,
  outline,
  readLines,
  searchSymbol,
  grep,
  references,
  delegate,
  Governor,
  GovernorHardStop,
} from '@tecr/core';

const WINDOW_SIZE = parseInt(process.env.TECR_CONTEXT_WINDOW ?? '200000', 10);
const governor = new Governor();

const server = new Server(
  { name: 'tecr-mcp', version: '0.0.1' },
  { capabilities: { tools: {} } },
);

// ── Tool registry ─────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'hello',
      description: 'Smoke-test the TECR pipeline end-to-end (Phase 0).',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Message to echo.' },
        },
        required: ['message'],
      },
    },
    {
      name: 'grep',
      description:
        'Lexical search across all files in the workspace with ±2 lines of context. ' +
        'Pattern is a literal string (not a regex). Hard limit: 100 matches. ' +
        'Excludes node_modules, dist, .git, and other build/dependency directories.',
      inputSchema: {
        type: 'object',
        properties: {
          workspaceRoot: {
            type: 'string',
            description: 'Absolute path to the workspace root.',
          },
          pattern: {
            type: 'string',
            description: 'Literal string to search for.',
          },
          caseInsensitive: {
            type: 'boolean',
            description: 'Case-insensitive matching (default: false).',
          },
        },
        required: ['workspaceRoot', 'pattern'],
      },
    },
    {
      name: 'search_symbol',
      description:
        'AST-based symbol search across all supported languages in a workspace. ' +
        'Matches symbols whose names contain the query (case-insensitive). ' +
        'Hard limit: 50 results.',
      inputSchema: {
        type: 'object',
        properties: {
          workspaceRoot: {
            type: 'string',
            description: 'Absolute path to the workspace root.',
          },
          query: {
            type: 'string',
            description: 'Symbol name to search for (substring, case-insensitive).',
          },
        },
        required: ['workspaceRoot', 'query'],
      },
    },
    {
      name: 'read_lines',
      description:
        'Read lines from a file with explicit start/end bounds. ' +
        'Hard limit: 200 lines per call. ' +
        'When truncated, pass the returned cursor as start for the next page.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Absolute path to the file.',
          },
          start: {
            type: 'number',
            description: '1-based start line (default: 1).',
          },
          end: {
            type: 'number',
            description: '1-based end line, inclusive (default: start + 199).',
          },
          cursor: {
            type: 'number',
            description: 'Resume cursor from a prior truncated response (overrides start).',
          },
        },
        required: ['filePath'],
      },
    },
    {
      name: 'outline',
      description:
        'Return signatures and docstrings for a single file, no function bodies. ' +
        'Hard limit: 200 output lines. Truncation hint included when the file exceeds the limit.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Absolute path to the file to outline.',
          },
        },
        required: ['filePath'],
      },
    },
    {
      name: 'references',
      description:
        'Find all call sites for a named symbol across the workspace. ' +
        'Definition lines are excluded. Hard limit: 100 results. ' +
        'Excludes node_modules, dist, .git, and other build/dependency directories.',
      inputSchema: {
        type: 'object',
        properties: {
          workspaceRoot: {
            type: 'string',
            description: 'Absolute path to the workspace root.',
          },
          symbolName: {
            type: 'string',
            description: 'Exact symbol name to find references for.',
          },
        },
        required: ['workspaceRoot', 'symbolName'],
      },
    },
    {
      name: 'repo_map',
      description:
        'Return a token-budgeted, AST-ranked map of the repository. ' +
        'Phase 1 stub — returns placeholder until Tree-sitter integration is complete.',
      inputSchema: {
        type: 'object',
        properties: {
          workspaceRoot: {
            type: 'string',
            description: 'Absolute path to the workspace root.',
          },
          budget: {
            type: 'number',
            description: 'Hard token budget for the emitted map. Default: 1024.',
          },
        },
        required: ['workspaceRoot'],
      },
    },
    {
      name: 'delegate',
      description:
        'Delegate a discovery task to an isolated sub-agent (spec §8). ' +
        'The sub-agent runs grep/searchSymbol internally; only a structured ' +
        'summary ≤200 tokens is returned to the parent. ' +
        'Use for broad exploratory tasks to avoid polluting the parent context.',
      inputSchema: {
        type: 'object',
        properties: {
          workspaceRoot: {
            type: 'string',
            description: 'Absolute path to the workspace root.',
          },
          task: {
            type: 'string',
            description: 'Natural-language description of the discovery task.',
          },
          parentContext: {
            type: 'string',
            description: 'Optional context excerpt from the parent (not returned).',
          },
        },
        required: ['workspaceRoot', 'task'],
      },
    },
  ],
}));

// ── Utilization metadata ──────────────────────────────────────────────────────

function withUtilization(
  toolName: string,
  args: Record<string, unknown>,
  responseText: string,
  localTokens = 0,
): { content: Array<{ type: 'text'; text: string }> } {
  const { snapshot, compaction } = governor.record(toolName, args, responseText, WINDOW_SIZE, localTokens);
  const compactedNote = compaction
    ? ` compacted=${compaction.entriesCompacted} recovered=${compaction.tokensRecovered}`
    : '';
  const localNote = localTokens > 0 ? ` local=${localTokens}` : '';
  const meta = `[tecr: utilization=${snapshot.utilization.toFixed(4)} effective=${snapshot.effectiveTokens}/${WINDOW_SIZE}${compactedNote}${localNote}]`;
  return { content: [{ type: 'text', text: `${responseText}\n${meta}` }] };
}

// ── Tool dispatch ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const a = (args ?? {}) as Record<string, unknown>;

  // Enforce budget ceiling before running the tool (spec §7.1 I2).
  try {
    governor.checkBefore(WINDOW_SIZE);
  } catch (err) {
    if (err instanceof GovernorHardStop) {
      return { content: [{ type: 'text', text: err.message }], isError: true };
    }
    throw err;
  }

  switch (name) {
    case 'hello': {
      const { message } = a as { message: string };
      return withUtilization('hello', a, hello(message));
    }

    case 'grep': {
      const { workspaceRoot, pattern, caseInsensitive } = a as {
        workspaceRoot: string;
        pattern: string;
        caseInsensitive?: boolean;
      };
      const result = await grep(workspaceRoot, pattern, { caseInsensitive });
      return withUtilization('grep', a, result.text);
    }

    case 'search_symbol': {
      const { workspaceRoot, query } = a as { workspaceRoot: string; query: string };
      const result = await searchSymbol(workspaceRoot, query);
      return withUtilization('search_symbol', a, result.text);
    }

    case 'read_lines': {
      const { filePath, start, end, cursor } = a as {
        filePath: string;
        start?: number;
        end?: number;
        cursor?: number;
      };
      const result = await readLines(filePath, cursor ?? start, end);
      return withUtilization('read_lines', a, result.text);
    }

    case 'outline': {
      const { filePath } = a as { filePath: string };
      const result = await outline(filePath);
      return withUtilization('outline', a, result.text);
    }

    case 'repo_map': {
      const { workspaceRoot, budget } = a as {
        workspaceRoot: string;
        budget?: number;
      };
      const result = await buildRepoMap(workspaceRoot, { budget });
      const truncationHint = result.truncated
        ? `\n[truncated: map exceeded budget; increase budget to see more]`
        : '';
      const text = `${result.text}${truncationHint}\n\n[tokens: ${result.tokenCount}]`;
      return withUtilization('repo_map', a, text);
    }

    case 'references': {
      const { workspaceRoot, symbolName } = a as {
        workspaceRoot: string;
        symbolName: string;
      };
      const result = await references(workspaceRoot, symbolName);
      return withUtilization('references', a, result.text);
    }

    case 'delegate': {
      const { workspaceRoot, task, parentContext } = a as {
        workspaceRoot: string;
        task: string;
        parentContext?: string;
      };
      const result = await delegate({ workspaceRoot, task, parentContext });
      // Only the summary enters the parent governor — sub-agent transcript is isolated.
      const refs =
        result.artifactRefs.length > 0
          ? `\nRefs: ${result.artifactRefs.map((r) => `${r.path}${r.line ? `:${r.line}` : ''}`).join(', ')}`
          : '';
      const usage = `\nSub-agent tokens: input=${result.tokenUsage.inputTokens} output=${result.tokenUsage.outputTokens}`;
      return withUtilization('delegate', a, result.summary + refs + usage, result.tokenUsage.localTokens);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
