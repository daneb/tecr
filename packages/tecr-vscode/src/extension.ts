/**
 * tecr-vscode: VS Code chat participant for TECR.
 *
 * S-01: @tecr participant calls tecr-core#hello() directly (bundled).
 * S-02: adds `map` command — calls buildRepoMap() for the open workspace.
 * S-05 (Phase 2): replaces direct core calls with MCP client requests.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import {
  hello,
  buildRepoMap,
  outline,
  readLines,
  searchSymbol,
  grep,
  references,
  Governor,
  GovernorHardStop,
} from '@tecr/core';

const governor = new Governor();
const WINDOW_SIZE = 200_000;

const PARTICIPANT_ID = 'tecr';

export function activate(context: vscode.ExtensionContext): void {
  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
  participant.iconPath = new vscode.ThemeIcon('symbol-namespace');
  registerMcpServer(context);
  context.subscriptions.push(participant);
}

// ── Chat handler ──────────────────────────────────────────────────────────────

async function handler(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  _token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
  const prompt = request.prompt.trim();

  if (!prompt) {
    stream.markdown(
      'TECR is running. Commands:\n' +
        '- `@tecr hello <message>` — smoke-test the pipeline\n' +
        '- `@tecr map` — show the repo-map for the open workspace\n' +
        '- `@tecr outline <file>` — show signatures and docstrings for a file\n' +
        '- `@tecr read <file> [start] [end]` — read lines from a file (200-line pages)\n' +
        '- `@tecr search <query>` — find symbols by name across the workspace\n' +
        '- `@tecr grep <pattern>` — lexical search with ±2 lines context\n' +
        '- `@tecr refs <symbol>` — find all call sites for a symbol\n',
    );
    return {};
  }

  try {
    governor.checkBefore(WINDOW_SIZE);
  } catch (err) {
    if (err instanceof GovernorHardStop) {
      stream.markdown('TECR: context budget exhausted. Start a new chat or reduce focus files.');
      return {};
    }
    throw err;
  }

  const [cmd, ...rest] = prompt.split(/\s+/);

  switch (cmd.toLowerCase()) {
    case 'map':
      return handleMap(stream);

    case 'grep': {
      const pattern = rest.join(' ').trim();
      if (!pattern) {
        stream.markdown('Usage: `@tecr grep <pattern>`');
        return {};
      }
      return handleGrep(stream, pattern);
    }

    case 'refs':
    case 'references': {
      const symbol = rest.join(' ').trim();
      if (!symbol) {
        stream.markdown('Usage: `@tecr refs <symbol>`');
        return {};
      }
      return handleReferences(stream, symbol);
    }

    case 'search': {
      const query = rest.join(' ').trim();
      if (!query) {
        stream.markdown('Usage: `@tecr search <query>`');
        return {};
      }
      return handleSearch(stream, query);
    }

    case 'read': {
      const [filePart, startPart, endPart] = rest;
      if (!filePart) {
        stream.markdown('Usage: `@tecr read <file> [start] [end]`');
        return {};
      }
      return handleRead(stream, filePart, startPart ? parseInt(startPart, 10) : undefined, endPart ? parseInt(endPart, 10) : undefined);
    }

    case 'outline': {
      const filePath = rest.join(' ').trim();
      if (!filePath) {
        stream.markdown('Usage: `@tecr outline <file>`');
        return {};
      }
      return handleOutline(stream, filePath);
    }

    default:
      // Fall back to hello for anything unrecognised.
      stream.markdown(hello(prompt));
      return {};
  }
}

async function handleMap(stream: vscode.ChatResponseStream): Promise<vscode.ChatResult> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    stream.markdown('No workspace folder is open.');
    return {};
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  stream.markdown('Building repo-map…\n\n');

  const result = await buildRepoMap(workspaceRoot, { budget: 1024 });

  if (!result.text.trim()) {
    stream.markdown('No TypeScript/JavaScript files found in the workspace.');
    return {};
  }

  stream.markdown('```\n' + result.text + '\n```\n\n');
  stream.markdown(
    `_${result.tokenCount} tokens · ${result.truncated ? 'truncated (budget 1024 tokens)' : 'within budget'}_`,
  );

  return {};
}

async function handleGrep(
  stream: vscode.ChatResponseStream,
  pattern: string,
): Promise<vscode.ChatResult> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    stream.markdown('No workspace folder is open.');
    return {};
  }
  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  try {
    const result = await grep(workspaceRoot, pattern);
    stream.markdown('```\n' + result.text + '\n```\n\n');
    if (result.truncated) {
      stream.markdown(`_${result.totalMatches} total matches · showing first 100_`);
    }
  } catch (err) {
    stream.markdown(`Error: ${(err as Error).message}`);
  }
  return {};
}

async function handleSearch(
  stream: vscode.ChatResponseStream,
  query: string,
): Promise<vscode.ChatResult> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    stream.markdown('No workspace folder is open.');
    return {};
  }
  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  try {
    const result = await searchSymbol(workspaceRoot, query);
    stream.markdown('```\n' + result.text + '\n```\n\n');
    if (result.truncated) {
      stream.markdown(`_${result.totalMatches} total matches · showing first 50_`);
    }
  } catch (err) {
    stream.markdown(`Error: ${(err as Error).message}`);
  }
  return {};
}

async function handleRead(
  stream: vscode.ChatResponseStream,
  filePath: string,
  start?: number,
  end?: number,
): Promise<vscode.ChatResult> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    stream.markdown('No workspace folder is open.');
    return {};
  }
  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);

  try {
    const result = await readLines(absPath, start, end);
    stream.markdown('```\n' + result.text + '\n```\n\n');
    stream.markdown(
      `_${result.lineCount} lines (${result.startLine}–${result.endLine} of ${result.totalLines})${result.truncated ? ' · truncated' : ''}_`,
    );
  } catch (err) {
    stream.markdown(`Error: ${(err as Error).message}`);
  }
  return {};
}

async function handleOutline(
  stream: vscode.ChatResponseStream,
  filePath: string,
): Promise<vscode.ChatResult> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    stream.markdown('No workspace folder is open.');
    return {};
  }
  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);

  try {
    const result = await outline(absPath);
    stream.markdown('```\n' + result.text + '\n```\n\n');
    stream.markdown(
      `_${result.lineCount} lines${result.truncated ? ' · truncated' : ''}_`,
    );
  } catch (err) {
    stream.markdown(`Error: ${(err as Error).message}`);
  }
  return {};
}

async function handleReferences(
  stream: vscode.ChatResponseStream,
  symbolName: string,
): Promise<vscode.ChatResult> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    stream.markdown('No workspace folder is open.');
    return {};
  }
  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  try {
    const result = await references(workspaceRoot, symbolName);
    stream.markdown('```\n' + result.text + '\n```\n\n');
    if (result.truncated) {
      stream.markdown(`_${result.totalMatches} total references · showing first 100_`);
    }
  } catch (err) {
    stream.markdown(`Error: ${(err as Error).message}`);
  }
  return {};
}

// ── MCP server registration ───────────────────────────────────────────────────

function registerMcpServer(context: vscode.ExtensionContext): void {
  const devServerPath = context.asAbsolutePath(
    path.join('..', '..', 'packages', 'tecr-mcp', 'dist', 'index.js'),
  );

  const lm = vscode.lm as typeof vscode.lm & {
    registerMcpServerDefinitionProvider?: (id: string, provider: unknown) => vscode.Disposable;
  };

  if (typeof lm.registerMcpServerDefinitionProvider !== 'function') return;

  const disposable = lm.registerMcpServerDefinitionProvider('tecr', {
    provideMcpServerDefinitions() {
      return [{ label: 'TECR', kind: 0 /* stdio */, command: 'node', args: [devServerPath] }];
    },
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {}
