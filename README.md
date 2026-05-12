# TECR — Token-Efficient Code Retrieval

[![TECR-L4 Conformance](https://github.com/daneb/tecr/actions/workflows/conformance.yml/badge.svg)](https://github.com/daneb/tecr/actions/workflows/conformance.yml)

A portable retrieval layer for agentic coding tools. Keeps agent context budgets under control by exposing a graph-ranked repo-map, bounded tool contracts, a context budget governor, and sub-agent isolation — all through a single MCP server.

| Package | Description |
|---|---|
| [`packages/tecr-core`](packages/tecr-core) | Pure TypeScript library. The portable retrieval engine. |
| [`packages/tecr-mcp`](packages/tecr-mcp) | MCP server over stdio. Connects `tecr-core` to any compliant host. |
| [`packages/tecr-vscode`](packages/tecr-vscode) | VS Code extension. Registers `@tecr` chat participant. |

---

## Contents

- [Prerequisites](#prerequisites)
- [Install & Build](#install--build)
- [Connect to an MCP Host](#connect-to-an-mcp-host)
  - [Claude Code](#claude-code)
  - [Cursor](#cursor)
  - [VS Code Extension](#vs-code-extension)
- [Available Tools](#available-tools)
- [Configuration](#configuration)
- [Measurement & Conformance](#measurement--conformance)
  - [pnpm measure](#pnpm-measure)
  - [pnpm gate](#pnpm-gate)
  - [Golden Corpus](#golden-corpus)
- [Architecture](#architecture)
- [Spec & Design Docs](#spec--design-docs)

---

## Prerequisites

- **Node.js** v22 or later
- **pnpm** v9 or later (`npm install -g pnpm`)

---

## Install & Build

```sh
git clone <this repo>
cd tecr
pnpm install
pnpm build
```

The build compiles all three packages in dependency order. Compiled output lands in each package's `dist/` directory.

---

## Connect to an MCP Host

Build first, then configure your client to launch the MCP server:

```sh
pnpm build
# server entry point: packages/tecr-mcp/dist/index.js
```

### Claude Code (CLI or VS Code extension)

Add to `.claude/settings.json` in your project (or `~/.claude/settings.json` for all projects):

```json
{
  "mcpServers": {
    "tecr": {
      "command": "node",
      "args": ["/absolute/path/to/tecr/packages/tecr-mcp/dist/index.js"]
    }
  }
}
```

Restart Claude Code. TECR tools appear automatically in the tool list and Claude will use them during code navigation tasks.

### VS Code (native MCP — no extension required)

VS Code 1.99+ has built-in MCP support. Add to your workspace `.vscode/mcp.json`:

```json
{
  "servers": {
    "tecr": {
      "command": "node",
      "args": ["/absolute/path/to/tecr/packages/tecr-mcp/dist/index.js"]
    }
  }
}
```

TECR tools are then available to any MCP-compatible AI in VS Code (GitHub Copilot, etc.).

### VS Code Extension (Copilot Chat participant)

The `tecr-vscode` package provides an `@tecr` chat participant for GitHub Copilot Chat. To install it:

```sh
cd packages/tecr-vscode
pnpm package          # produces tecr-vscode-0.0.1.vsix
```

Then in VS Code: **Extensions → … → Install from VSIX** and select the file. Once installed, `@tecr` is available in the Copilot Chat panel:

```
@tecr map                               # repo-map of the workspace
@tecr outline src/auth.ts               # symbol outline for a file
@tecr search verifyToken                # AST symbol search
@tecr grep "export function"            # lexical search with context
@tecr refs buildRepoMap                 # all call sites for a symbol
@tecr read src/auth.ts 1 50             # paginated file read
@tecr delegate "find all token parsers" # isolated sub-agent discovery
```

Set the server path in VS Code settings: `tecr.mcpServerPath` → absolute path to `packages/tecr-mcp/dist/index.js`.

### Cursor

**Settings → Cursor Settings → MCP → Add new server:**

| Field | Value |
|---|---|
| Name | `tecr` |
| Type | `command` |
| Command | `node /absolute/path/to/tecr/packages/tecr-mcp/dist/index.js` |

---

## Available Tools

| Tool | Description | Hard limit | Spec |
|---|---|---|---|
| `repo_map` | PageRank-ranked symbol map, token-budgeted | configurable budget | §5 |
| `outline` | Signatures + docstrings, no bodies | 200 lines | §6.1 |
| `read_lines` | Paginated file read | 200 lines/call | §6.1 |
| `search_symbol` | AST-based symbol search | 50 results | §6.1 |
| `grep` | Lexical search with ±2 lines context | 100 matches | §6.1 |
| `references` | All call sites for a symbol | 100 results | §6.1 |
| `delegate` | Discovery task in isolated sub-agent context | 200-token summary | §8 |

All tools enforce the §6.2 truncation protocol and §6.3 exclusion list (`node_modules`, `dist`, `.git`, etc.).

---

## Configuration

All configuration is via environment variables on the MCP server process.

| Variable | Default | Description |
|---|---|---|
| `TECR_CONTEXT_WINDOW` | `200000` | Context window size in tokens for governor budget calculations |
| `TECR_NO_TELEMETRY` | unset | Set to `1` to suppress per-turn JSON telemetry on stderr |
| `TECR_LOCAL_MODEL_URL` | unset | Base URL of a local OpenAI-compatible endpoint for sub-agent offload (§8.3) |

### Local Model Offload

When `TECR_LOCAL_MODEL_URL` is set, `delegate` routes discovery tasks to a local Ollama/MLX/llama.cpp instance instead of the built-in grep heuristic. Local tokens are recorded in telemetry but treated as zero-cost for budget accounting.

```sh
TECR_LOCAL_MODEL_URL=http://localhost:11434 node packages/tecr-mcp/dist/index.js
```

### Telemetry Hook

Register a custom handler in any application that embeds `tecr-core`:

```ts
import { onTelemetry } from '@tecr/core';

const off = onTelemetry((event) => {
  // All §7.3 fields available:
  // inputTokens, outputTokens, utilizationFraction,
  // localTokens, billableTokens, perToolAttribution, …
  myOtelSpan.setAttributes(event);
});
// off() to unsubscribe
```

---

## Measurement & Conformance

### pnpm measure

Runs the golden corpus through the full L3 tool surface and writes `results.json` with all six §9.1 metrics per entry:

```sh
pnpm measure
```

Output `results.json` shape:

```json
{
  "timestamp": "2026-05-12T…",
  "windowSize": 200000,
  "entries": [
    {
      "id": "bincode",
      "language": "rust",
      "prompt": "Find all types that implement the Encode or Decode trait",
      "metrics": {
        "discoveryCost": 4119,
        "perTurnInput": { "mean": 24.0, "p95": 33.0 },
        "utilizationPeak": 0.024,
        "truncationRate": 0.0,
        "repoMapHitRate": 0.0,
        "subAgentRoi": 0.83
      }
    }
  ]
}
```

### pnpm gate

Runs the §9.3 acceptance gate and exits 0 (all pass) or 1 (any fail):

```sh
TECR_NO_TELEMETRY=1 pnpm gate

# TECR-L4 Conformance Gate
# ════════════════════════════════════════════════════════════════
# Thresholds: discoveryCost ≤ 15000 | utilizationPeak ≤ 0.4 | truncationRate < 0.2
# ════════════════════════════════════════════════════════════════
#
# Running [bincode] (rust)… done
#   ✓  [bincode] discoveryCost      4119.00000   <= 15000
#   ✓  [bincode] utilizationPeak    0.02354      <= 0.4
#   ✓  [bincode] truncationRate     0.00000      < 0.2
# …
# All gates passed. TECR-L4 ✓
```

The CI workflow at [`.github/workflows/conformance.yml`](.github/workflows/conformance.yml) runs this automatically on every push to `main` and every PR.

### Golden Corpus

The small-tier corpus lives in `test/corpus/` with a manifest at `test/corpus/thresholds.json`. Each entry:

```json
{
  "id": "bincode",
  "language": "rust",
  "sourceRoot": ".",
  "prompt": "Find all types that implement the Encode or Decode trait",
  "threshold": 2
}
```

The three fixture repos (bincode, zod, httpx) are committed at their trimmed source-only size (~1.2 MB total). `sourceRoot: "."` means the corpus dir root is the analysis root.

**Adding a corpus entry:**

1. Clone, strip to source only, and commit:
   ```sh
   git clone --depth 1 git@github.com:org/repo.git test/corpus/myrepo
   rm -rf test/corpus/myrepo/.git
   # Keep only the relevant source subtree, delete everything else
   ```
2. Add an entry to `test/corpus/thresholds.json` with `"sourceRoot": "."`.
3. Run `pnpm gate` to confirm the new entry passes §9.3 thresholds.

The `sourceRoot` field constrains which subtree the harness points its tools at — useful for monorepos where only one package is relevant.

---

## Architecture

```
┌────────────────────────────────────┐
│         tecr-vscode                │
│  @tecr chat participant            │
└──────────────┬─────────────────────┘
               │ spawns
┌──────────────▼─────────────────────┐
│         tecr-mcp                   │
│  MCP server (stdio transport)      │
│  Governor: compaction + hard stop  │
│  Telemetry: per-turn JSON events   │
└──────────────┬─────────────────────┘
               │ calls
┌──────────────▼─────────────────────┐
│         tecr-core                  │
│  AST: ts-morph (TS/JS)             │
│       web-tree-sitter WASM         │
│       (Rust, Python, Go, Java)     │
│  PageRank repo-map + token budget  │
│  Governor (§7 — 35%/40% thresholds)│
│  Sub-agent isolation (§8)          │
│  Measurement harness (§9)          │
└────────────────────────────────────┘
```

**Governor invariants (§7.1):**
- Compaction fires at **35%** effective utilization — summarises old tool results in-place
- Hard stop at **40%** if compaction is exhausted — `GovernorHardStop` surfaces to the host with a user-facing message

---

## Spec & Design Docs

| Document | Description |
|---|---|
| [`docs/SPEC.md`](docs/SPEC.md) | TECR specification v0.1 — authoritative reference |
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | Slice-by-slice implementation history |
| [`docs/ADR0001.md`](docs/ADR0001.md) | Project charter and architectural decisions |

### Conformance Levels

| Level | Required | Status |
|---|---|---|
| **L1: Backbone** | §5 repo-map + §6.1 tools + §6.2 truncation | ✅ |
| **L2: Governed** | L1 + §7 governor | ✅ |
| **L3: Isolated** | L2 + §8 sub-agent isolation | ✅ |
| **L4: Measured** | L3 + §9 harness + published results | ✅ |
