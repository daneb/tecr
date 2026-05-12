# SPEC: Token-Efficient Code Retrieval (TECR) v0.1

> This document is the canonical spec. The README contains the same text as an overview; this file is the authoritative version referenced by ADRs.

**A Portable Pattern for Agentic IDEs**

| | |
|---|---|
| Status | Draft v0.1 |
| Author | Dane Balia |
| Date | 2026-05-10 |
| Implementing ADRs | TBD (proposed: ADR-0002 Repo-Map Backbone, ADR-0003 Context Budget Governor, ADR-0004 TECR Tool Contracts) |
| Reference Implementation | TECR (TypeScript, MCP, VS Code) |

---

## 1. Motivation

A measured baseline in Forgiven shows ~140k tokens consumed by an agent merely to *understand* a medium codebase before producing useful work. This is not a Forgiven-specific problem: published research across seven major coding agents shows token consumption for the same retrieval task ranging from 8.5k (Aider) to 117k (Claude Code) — a 13.7× spread driven almost entirely by retrieval architecture, not model choice.

Two findings reframe the problem:

1. **Context degradation begins at ~40% utilization.** Beyond this threshold, agent reasoning quality drops measurably even within nominally large context windows. The 140k figure is therefore not just expensive — it is actively impairing the agent.
2. **Input tokens dominate consumption (~54% on average) and are concentrated in refinement/verification loops, not initial generation.** Output throttling alone cannot solve this.

The techniques commonly cited online (tool truncation, AST outlines, RAG, system-prompt guardrails) are necessary but insufficient. They address symptoms; they do not specify a retrieval *backbone*. This spec proposes one.

## 2. Goals & Non-Goals

### Goals

- G1. Define a **portable** retrieval pattern that any agentic IDE or CLI can adopt, language- and model-agnostic.
- G2. Specify a **graph-AST repo-map** as the primary retrieval primitive, with deterministic ranking (no embeddings, no vector store).
- G3. Define a **context budget governor** that enforces utilization invariants as a first-class architectural concern.
- G4. Define **tool contracts** (MCP-compatible) that other agents and IDEs can implement without coupling to this implementation.
- G5. Define a **measurement harness** so adopters can verify they are on the efficiency curve, not just *claiming* to be.

### Non-Goals

- Replacing semantic embeddings entirely. The spec deliberately starts deterministic; a future companion spec may layer optional semantic retrieval.
- Defining the agent loop, tool-calling protocol, or model selection. These are concerns of the host IDE.
- Specifying UI. The spec governs what enters and leaves the model's context window.
- Cross-session memory. Out of scope.

## 3. Definitions

| Term | Definition |
|---|---|
| **Repo-map** | A token-budgeted, AST-derived summary of a codebase containing the most structurally important symbols and their signatures. |
| **Importance rank** | A deterministic score per symbol derived from the call/import graph, used to fit the repo-map within a token budget. |
| **Context budget** | A hard ceiling on tokens consumed by retrieval before agent reasoning begins. |
| **Utilization** | Fraction of model context window occupied by input + output. The 40% threshold is the architectural invariant. |
| **Semantic density** | Ratio of meaningful information to total tokens. The optimization target — not raw token count. |
| **Tool contract** | A typed, bounded interface specification for a retrieval tool, including hard output limits. |

## 4. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                         Agent Loop                            │
│                                                               │
│   ┌────────────────────────────────────────────────────────┐  │
│   │             Context Budget Governor (§7)                │  │
│   │  - tracks input/output tokens per turn                  │  │
│   │  - enforces 40% hard ceiling                            │  │
│   │  - triggers summarization at threshold                  │  │
│   └────────────────────────────────────────────────────────┘  │
│         │                      │                      │       │
│         ▼                      ▼                      ▼       │
│   ┌──────────┐         ┌──────────────┐       ┌───────────┐   │
│   │ Repo-Map │         │ Targeted     │       │ Sub-Agent │   │
│   │ Backbone │         │ Tools (§6)   │       │ Isolation │   │
│   │  (§5)    │         │              │       │  (§8)     │   │
│   └──────────┘         └──────────────┘       └───────────┘   │
│         │                      │                      │       │
└─────────┼──────────────────────┼──────────────────────┼───────┘
          ▼                      ▼                      ▼
   ┌──────────────────────────────────────────────────────┐
   │              Tree-sitter AST Layer                    │
   │  130+ languages, deterministic, no model in the loop  │
   └──────────────────────────────────────────────────────┘
                            │
                            ▼
                   ┌────────────────┐
                   │   Telemetry    │
                   │  (§9, hookable)│
                   └────────────────┘
```

### Five Layers

1. **AST extraction** (Tree-sitter): deterministic, language-agnostic, no model.
2. **Repo-map backbone** (§5): graph-ranked, token-budgeted symbol map.
3. **Targeted tool surface** (§6): bounded, paginated, never unbounded.
4. **Budget governor** (§7): hard ceiling, summary trigger, termination authority.
5. **Sub-agent isolation** (§8): contamination boundary; only summaries return.

## 5. Repo-Map Backbone (Primary Primitive)

### 5.1 Construction

On project open or watched-file change:

1. Parse all source files via Tree-sitter (`tags.scm` query per language).
2. Extract per-symbol records: `{file, name, kind, signature, line, references[], referenced_by[]}`.
3. Build a directed dependency graph where nodes are *files* and edges are imports/references.
4. Compute PageRank (or equivalent ranking algorithm) over the file graph.
5. Within each file, rank symbols by inbound reference count.

### 5.2 Budgeted Emission

The repo-map is emitted as a **single text artifact** with a hard token budget (default 1024 tokens, configurable). To fit:

- Walk files in PageRank order; within each file, emit symbols in inbound-reference order.
- Use binary search to find the cutoff that maximizes coverage within budget.
- Truncated symbols are replaced with `…` markers, never silently dropped.
- Output is grouped by file path with relative indentation; bodies are never included.

### 5.3 Output Format (Required)

```
src/auth/jwt.ts:
  export function verify(token: string, secret: Uint8Array): Result<Claims, AuthError> …
  export interface Claims { sub: string; exp: number; … }
  function decodeSegment(s: string): Result<Uint8Array, …> …

src/auth/index.ts:
  export interface Authenticator { authenticate(…): … }
  …
```

Adopters MAY add lightweight annotations (e.g. `[hot]` for high-PageRank files) but MUST NOT include function bodies, comments, or non-signature text in the default emission.

### 5.4 Dynamic Adjustment

The repo-map MUST adjust to the agent's current focus:

- When files are explicitly added to the chat/context, those files' symbols receive an importance boost.
- When the agent has read a full file, its summary in the repo-map may be elided to free budget.
- The repo-map is regenerated *per turn*, not cached statically across an agent session.

### 5.5 Language Support

The pattern requires Tree-sitter grammars and `tags.scm` query files. A reference implementation MUST support at minimum: Rust, Python, TypeScript/JavaScript, Go, Java. Extension to additional languages is a configuration concern, not a code change.

## 6. Tool Contracts

All retrieval tools exposed to the agent MUST conform to these contracts. This spec defines the minimum surface; adopters MAY extend.

### 6.1 Required Tools

| Tool | Purpose | Hard Output Limit |
|---|---|---|
| `repo_map` | Return the current ranked repo-map | configurable, default 1024 tokens |
| `outline` | Return signatures + docstrings for a single file (no bodies) | 200 lines |
| `read_lines` | Paginated file read with explicit `start`/`end` | 200 lines per call |
| `search_symbol` | AST-based symbol lookup by name (no full-text grep fallback) | 50 results |
| `grep` | Lexical search; returns matches with ±2 lines context | 100 matches |
| `references` | Find all references to a symbol via AST graph | 100 results |

### 6.2 Truncation Protocol

When a tool result is truncated, the response MUST include:

1. The truncated content.
2. A machine-readable continuation hint: `[truncated: 47 more results; call X with cursor=Y to continue]`.
3. Total available count where computable.

### 6.3 Forbidden Patterns

- Tools MUST NOT return whole files by default. `read_file` (unbounded) is explicitly excluded from the required surface; agents needing it must paginate via `read_lines`.
- Tools MUST NOT return binary content as text.
- Tools MUST NOT include build artifacts, `node_modules`, `target/`, `.git/`, lock files, or generated code by default.

### 6.4 MCP Compatibility

Tool contracts SHOULD be expressible as MCP server endpoints so agents in any host (Claude Code, Cursor, Copilot, future-Forgiven) can consume them. A reference MCP server MUST be provided alongside the core library.

## 7. Context Budget Governor

### 7.1 Invariants

- **I1.** Total context utilization MUST NOT exceed 40% of the model's stated window without triggering a governor action.
- **I2.** The governor MUST be enforced before each model call, not after.
- **I3.** The governor's threshold is an architectural invariant, not a tuneable setting. Adopters MAY raise it but MUST NOT remove it.

### 7.2 Governor Actions

When utilization approaches threshold, the governor selects the highest-priority action available:

1. **Compact tool results.** Collapse old tool outputs to one-line summaries (`tool: read_lines(src/x.ts, 1-200) → 47 lines, see prior turn`).
2. **Evict superseded artifacts.** Older repo-maps, outlines, and search results superseded by newer ones are removed.
3. **Summarize sub-agent transcripts.** Sub-agent contexts (§8) collapse to their final summary on return.
4. **Hard stop.** If no compaction is available and the next call would breach the ceiling, the governor halts the loop and surfaces a structured error to the host.

### 7.3 Telemetry Requirements

The governor MUST emit, per turn:

- Input tokens (system, user, tool results, repo-map).
- Output tokens.
- Tool call count and per-tool token attribution.
- Compaction events and bytes recovered.
- Threshold proximity (utilization fraction).

Telemetry SHOULD be hookable into existing observability layers (e.g. OpenTelemetry).

## 8. Sub-Agent Isolation

### 8.1 Contamination Boundary

Discovery and exploratory tasks (e.g. "find all callers of X across 12 files") are delegated to sub-agents whose context is **isolated** from the parent.

### 8.2 Return Contract

A sub-agent MUST return only:

- A structured summary (≤200 tokens by default).
- A list of artifact references the parent may request explicitly.
- Token usage report.

The sub-agent's full transcript MUST NOT propagate to the parent context.

### 8.3 Tiered Model Offload (Optional)

Adopters with local model capacity (Ollama, MLX, llama.cpp) SHOULD offload sub-agent work to smaller, cheaper models. The governor treats local-model tokens as zero-cost for budget accounting but MUST still record them for telemetry.

## 9. Measurement Harness

A spec without a benchmark is folklore. Adopters MUST implement, and MAY publish results from, the following harness.

### 9.1 Required Metrics

| Metric | Definition |
|---|---|
| **Discovery cost** | Tokens consumed from project open to first useful agent action |
| **Per-turn input** | Mean + p95 input tokens per agent turn |
| **Utilization peak** | Max context utilization observed in a session |
| **Truncation rate** | % of tool calls that returned truncated results |
| **Repo-map hit rate** | % of agent file reads already represented in the repo-map at adequate detail |
| **Sub-agent ROI** | Tokens saved in parent context / tokens spent in sub-agent |

### 9.2 Golden Corpus

A reference test corpus of repositories spanning small (≤5 kloc), medium (5–50 kloc), and large (50–500 kloc) projects across the five required languages. Each corpus entry pairs a repo with a fixed task prompt and an expected useful-action threshold.

### 9.3 Acceptance Gate

A reference implementation passes the spec when, on the medium-tier corpus:

- Discovery cost ≤ 15k tokens (≈10% of baseline).
- Utilization peak ≤ 40% on a 200k window.
- Truncation rate < 20%.

## 10. Conformance Levels

| Level | Required |
|---|---|
| **L1: Backbone** | §5 repo-map + §6.1 required tools + §6.2 truncation protocol |
| **L2: Governed** | L1 + §7 governor with §7.1 invariants |
| **L3: Isolated** | L2 + §8 sub-agent isolation |
| **L4: Measured** | L3 + §9 harness with published results |

A library or IDE may claim TECR-L*N* conformance only when meeting all required clauses for that level and below.

## 11. Comparison to Adjacent Approaches

| Approach | Primary Mechanism | Measured Utilization | Trade-off |
|---|---|---|---|
| Aider (graph-AST) | Tree-sitter + PageRank repo-map | 4–6% | No semantic awareness; structural only |
| Cursor (hybrid) | Background semantic + lexical | 14–17% | Indexing infrastructure required |
| Cline (three-tier) | ripgrep + fzf + AST | 17–18% | Plan-and-act loop adds turns |
| Claude Code (lexical agentic) | grep/glob + whole-file reads | 54–59% | Transparent but expensive |
| **TECR L2 (this spec)** | Aider-style + governor + isolation | target ≤10% | Deterministic; semantic layer optional |

## 12. Open Questions

- **Q1.** Should the repo-map default budget scale with model context window or stay fixed at 1024 tokens?
- **Q2.** How should incremental updates (file save → AST diff → repo-map delta) interact with prompt caching?
- **Q3.** Does the governor need a "soft" mode for interactive exploration where 40% is too aggressive?
- **Q4.** Should the spec mandate or merely recommend MCP exposure?

## 13. References

- *An Exploratory Study of Code Retrieval Techniques in Coding Agents* (preprints.org, 2025–2026).
- *Tokenomics: Quantifying Where Tokens Are Used in Agentic Software Engineering* (MSR 2026).
- Aider repository-map design (`aider.chat/docs/repomap.html`).
- Model Context Protocol specification: `modelcontextprotocol.io`.

## 14. Changelog

| Version | Date | Notes |
|---|---|---|
| v0.1 | 2026-05-10 | Initial draft. Backbone = graph-AST. Governor invariants set. Open questions noted. |
