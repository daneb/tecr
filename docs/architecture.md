# TECR Architecture

High-level overview of the three-package monorepo and the data flows between them.

## Package Diagram

```mermaid
graph TD
    subgraph vscode["tecr-vscode (VS Code Extension)"]
        participant["@tecr chat participant\nhandler()"]
        mcp_reg["MCP server registration\nregisterMcpServer()"]
    end

    subgraph mcp["tecr-mcp (MCP Server, stdio)"]
        mcp_server["MCP Server\n(ListTools / CallTool)"]
        tools_dispatch["Tool dispatch\nhello · repo_map · outline\nread_lines · search_symbol\ngrep · references"]
    end

    subgraph core["tecr-core (Library)"]
        public_api["Public API\nindex.ts"]

        subgraph ast["AST Layer"]
            ts_extractor["typescript.ts\n(ts-morph)\nTS · JS · JSX · TSX"]
            wasm_extractor["wasm.ts\n(web-tree-sitter)\nRust · Python · Go · Java"]
        end

        subgraph tools_layer["Tools Layer"]
            outline_tool["outline.ts\nsignatures + docstrings\n≤200 lines"]
            readlines_tool["readLines.ts\npaginated file read\n≤200 lines / page"]
            search_tool["searchSymbol.ts\nAST symbol search\n≤50 results"]
            grep_tool["grep.ts\nlexical search\n±2 ctx · ≤100 results"]
            refs_tool["references.ts\ncall-site lookup\n±2 ctx · ≤100 results"]
        end

        graph_ts["graph.ts\nPageRank file ranking\n(damping=0.85)"]
        repomap_ts["repomap.ts\ntoken-budgeted map emitter"]
    end

    %% VS Code direct path (Phase 1)
    participant -->|"direct import\n@tecr/core"| public_api
    mcp_reg -->|"spawns node dist/index.js\n(stdio MCP)"| mcp_server

    %% MCP path
    mcp_server --> tools_dispatch
    tools_dispatch -->|"@tecr/core"| public_api

    %% Core internal wiring
    public_api --> outline_tool
    public_api --> readlines_tool
    public_api --> search_tool
    public_api --> grep_tool
    public_api --> refs_tool
    public_api --> repomap_ts

    outline_tool --> ts_extractor
    outline_tool --> wasm_extractor
    search_tool --> ts_extractor
    search_tool --> wasm_extractor
    refs_tool --> search_tool

    repomap_ts --> graph_ts
    graph_ts --> ts_extractor
    graph_ts --> wasm_extractor
```

## Data Flow: Tool Call

```mermaid
sequenceDiagram
    participant Host as VS Code / Claude Code
    participant Ext as tecr-vscode
    participant MCP as tecr-mcp (stdio)
    participant Core as tecr-core

    Host->>Ext: @tecr grep "buildRepoMap"
    Ext->>Core: grep(workspaceRoot, pattern)
    Core-->>Ext: GrepResult { matches, text }
    Ext-->>Host: markdown response

    Host->>MCP: tools/call grep {...}
    MCP->>Core: grep(workspaceRoot, pattern)
    Core-->>MCP: GrepResult
    MCP-->>Host: { content: [{ type: "text", text }] }
```

## Layer Responsibilities

| Layer | Package | Responsibility |
|---|---|---|
| VS Code Extension | `tecr-vscode` | Chat participant UI, `@tecr` commands, MCP server registration for compliant hosts |
| MCP Server | `tecr-mcp` | stdio JSON-RPC server, tool schema declarations, thin dispatch to core |
| Public API | `tecr-core/index.ts` | Stable contract; lazy-import wrappers so tree-shaking works |
| AST Layer | `tecr-core/ast/` | Language-specific symbol + import extraction (ts-morph for TS/JS, web-tree-sitter WASM for Rust/Python/Go/Java) |
| Tools Layer | `tecr-core/tools/` | Stateless functions over the filesystem and AST results |
| Graph | `tecr-core/graph.ts` | PageRank-based file importance ranking from import graph |
| Repo-map | `tecr-core/repomap.ts` | Token-budgeted, ranked symbol emitter |

## Exclusion Rules (§6.3)

All file-walking tools skip: `node_modules`, `dist`, `build`, `.git`, `out`, `coverage`, `target`, `__pycache__`, `.venv`, `venv`, `vendor`. Binary files (null bytes in first 8 KB) and `.d.ts` declaration files are also skipped.
