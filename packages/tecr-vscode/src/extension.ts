/**
 * tecr-vscode — thin MCP client launcher (Path B, S-19).
 *
 * The extension spawns tecr-mcp as a child process and calls its tools via
 * the Model Context Protocol. No @tecr/core import — WASM runs in the server
 * process, not the VS Code extension host.
 *
 * Server path resolution (in order):
 *   1. tecr.mcpServerPath setting
 *   2. ../tecr-mcp/dist/index.js relative to the extension root (dev/F5)
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// ── MCP client singleton ──────────────────────────────────────────────────────

let _client: Client | null = null;
let _extensionRoot = '';

async function getClient(): Promise<Client> {
  if (_client) return _client;

  const serverPath = resolveServerPath();

  const transport = new StdioClientTransport({ command: 'node', args: [serverPath] });
  _client = new Client({ name: 'tecr-vscode', version: '0.0.1' }, { capabilities: {} });
  await _client.connect(transport);
  return _client;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const client = await getClient();
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  return content.map((c) => c.text).join('\n');
}

function resolveServerPath(): string {
  const setting = vscode.workspace
    .getConfiguration('tecr')
    .get<string>('mcpServerPath', '')
    .trim();
  if (setting) return setting;
  return path.join(_extensionRoot, '..', 'tecr-mcp', 'dist', 'index.js');
}

// ── Activation ────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  _extensionRoot = context.extensionPath;
  const participant = vscode.chat.createChatParticipant('tecr', handler);
  participant.iconPath = new vscode.ThemeIcon('symbol-namespace');
  context.subscriptions.push(participant);
}

export function deactivate(): void {
  _client = null;
}

// ── Chat handler ──────────────────────────────────────────────────────────────

async function handler(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
): Promise<vscode.ChatResult> {
  const prompt = request.prompt.trim();

  if (!prompt) {
    stream.markdown(
      'TECR tools:\n' +
        '- `@tecr map [budget]` — repo-map of the workspace (default 8192 tokens)\n' +
        '- `@tecr outline <file>` — signatures and docstrings\n' +
        '- `@tecr read <file> [start] [end]` — paginated file read\n' +
        '- `@tecr search <query>` — AST symbol search\n' +
        '- `@tecr grep <pattern>` — lexical search with context\n' +
        '- `@tecr refs <symbol>` — all call sites for a symbol\n' +
        '- `@tecr delegate <task>` — isolated sub-agent discovery\n',
    );
    return {};
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  try {
    const [cmd, ...rest] = prompt.split(/\s+/);
    const arg = rest.join(' ').trim();

    switch (cmd.toLowerCase()) {
      case 'map': {
        const budgetArg = arg ? parseInt(arg, 10) : NaN;
        const budget = Number.isFinite(budgetArg) && budgetArg > 0 ? budgetArg : 8192;
        stream.progress('Building repo-map…');
        const text = await callTool('repo_map', { workspaceRoot, budget });
        stream.markdown('```\n' + text + '\n```');
        break;
      }

      case 'outline': {
        if (!arg) { stream.markdown('Usage: `@tecr outline <file>`'); break; }
        const filePath = absolutePath(arg, workspaceRoot);
        stream.progress('Outlining…');
        const text = await callTool('outline', { filePath });
        stream.markdown('```\n' + text + '\n```');
        break;
      }

      case 'read': {
        const [filePart, startPart, endPart] = rest;
        if (!filePart) { stream.markdown('Usage: `@tecr read <file> [start] [end]`'); break; }
        const filePath = absolutePath(filePart, workspaceRoot);
        const start = startPart ? parseInt(startPart, 10) : undefined;
        const end = endPart ? parseInt(endPart, 10) : undefined;
        const text = await callTool('read_lines', { filePath, start, end });
        stream.markdown('```\n' + text + '\n```');
        break;
      }

      case 'search': {
        if (!arg) { stream.markdown('Usage: `@tecr search <query>`'); break; }
        const text = await callTool('search_symbol', { workspaceRoot, query: arg });
        stream.markdown('```\n' + text + '\n```');
        break;
      }

      case 'grep': {
        if (!arg) { stream.markdown('Usage: `@tecr grep <pattern>`'); break; }
        const text = await callTool('grep', { workspaceRoot, pattern: arg });
        stream.markdown('```\n' + text + '\n```');
        break;
      }

      case 'refs':
      case 'references': {
        if (!arg) { stream.markdown('Usage: `@tecr refs <symbol>`'); break; }
        const text = await callTool('references', { workspaceRoot, symbolName: arg });
        stream.markdown('```\n' + text + '\n```');
        break;
      }

      case 'delegate': {
        if (!arg) { stream.markdown('Usage: `@tecr delegate <task>`'); break; }
        stream.progress('Running sub-agent…');
        const text = await callTool('delegate', { workspaceRoot, task: arg });
        stream.markdown(text);
        break;
      }

      default:
        stream.markdown(`Unknown command \`${cmd}\`. Type \`@tecr\` for the command list.`);
    }
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    if (msg.includes('ENOENT') || msg.includes('Cannot find')) {
      stream.markdown(
        '**TECR server not found.** Set `tecr.mcpServerPath` to the absolute path of ' +
          '`packages/tecr-mcp/dist/index.js` in your VS Code settings, then reload the window.',
      );
      _client = null;
    } else {
      stream.markdown(`**Error:** ${msg}`);
      _client = null;
    }
  }

  return {};
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function absolutePath(filePath: string, workspaceRoot: string | undefined): string {
  if (path.isAbsolute(filePath)) return filePath;
  if (workspaceRoot) return path.join(workspaceRoot, filePath);
  return filePath;
}
