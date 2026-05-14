# TECR — Token-Efficient Code Retrieval

A VS Code chat participant (`@tecr`) that lets AI agents navigate your codebase without dumping raw source into the context window. It talks to a local [tecr-mcp](../tecr-mcp) server over the Model Context Protocol, providing AST-aware tools that stay within configurable token budgets.

## Why TECR vs. your IDE's built-in AI?

| | Modern IDE AI (Copilot, Cursor) | TECR |
|---|---|---|
| **Context strategy** | Dumps nearby files into the prompt | Fetches only what the task needs |
| **Token awareness** | None — host model manages cutoff | Tracks utilization per turn; governor blocks before hard stop |
| **Code navigation** | Embedding similarity or whole-file send | AST-ranked repo map, symbol search, paginated reads with cursor |
| **Exploratory tasks** | Pollutes the parent context | Isolated sub-agent; only a ≤200-token summary returns |
| **Protocol** | Proprietary IDE integration | MCP — works in any compliant host |
| **Context window use** | Grows until truncated by the model | Stays within a declared budget; truncation is a metric, not a surprise |

## Prerequisites

- VS Code 1.99 or later (chat participant API)
- Node.js ≥ 20

## Quick start

1. Install the MCP server globally:
   ```bash
   npm install -g @tecr/mcp
   ```
2. Install the extension from the VS Code Marketplace (search **TECR**) or via **Extensions → Install from VSIX…**
3. Reload the window (`⌘⇧P → Developer: Reload Window`)
4. Open the chat panel and type `@tecr map`

No path configuration needed — the extension finds `tecr-mcp` on your PATH automatically.

**Development / local checkout:** Set `tecr.mcpServerPath` to the absolute path of `packages/tecr-mcp/dist/index.js` to override the global binary.

## Commands

| Command | Description |
|---|---|
| `@tecr map [budget]` | Repo-map of the workspace (default 8192 tokens). Budget in tokens. |
| `@tecr outline <file>` | Exported symbols and docstrings for a file |
| `@tecr read <file> [start] [end]` | Paginated file read with optional line range |
| `@tecr search <query>` | AST-aware symbol search across the workspace |
| `@tecr grep <pattern>` | Lexical search with ±2 lines of context (max 100 matches) |
| `@tecr refs <symbol>` | All call sites for a named symbol |
| `@tecr delegate <task>` | Isolated sub-agent discovery — result summary only enters parent context |

## Settings

| Setting | Default | Description |
|---|---|---|
| `tecr.mcpServerPath` | `""` | Absolute path to `tecr-mcp/dist/index.js` |
| `tecr.contextWindow` | `200000` | Token budget for the TECR governor |
| `tecr.localModelUrl` | `""` | OpenAI-compatible endpoint for sub-agent offload (e.g. Ollama) |
| `tecr.telemetryEnabled` | `true` | Emit per-turn token metrics to the server's stderr |

## Troubleshooting

**"TECR server not found"** — The `tecr.mcpServerPath` setting is wrong or the server hasn't been built. Check the path and run `pnpm --filter @tecr/mcp build`.

**Blank response** — The server may have crashed. Open the Output panel (`⌘⇧U`) and select TECR, or check the Extension Host log for errors.

**Slow first call** — The server loads WASM parsers on startup. Subsequent calls are fast.

## Known limitations

- Only the **first workspace folder** is used as `workspaceRoot`. Multi-root workspaces are not yet supported.
- `@tecr delegate` uses heuristic sub-agent routing. Set `tecr.localModelUrl` to route to a local LLM.
