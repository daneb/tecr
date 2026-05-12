# TECR Implementation Plan

Each **slice** is a thin vertical cut through the full stack (core → mcp → vscode) that produces a demonstrable, independently shippable increment. No slice is "infrastructure only" — every slice ends with something the user can invoke and test.

Slices map to git branches named `slice/S-NN-short-description`.

---

## Slice Map

| # | Title | Layers touched | Status |
|---|---|---|---|
| S-00 | Monorepo skeleton | all | ✅ done |
| S-01 | MCP pipe hello (Phase 0 exit) | core · mcp · vscode | ✅ done |
| S-02 | TypeScript repo-map | core · mcp · vscode | ✅ done |
| S-03 | Multi-language repo-map | core | ✅ done |
| S-04 | `outline` tool | core · mcp · vscode | ✅ done |
| S-05 | `read_lines` tool | core · mcp · vscode | ✅ done |
| S-06 | `search_symbol` tool | core · mcp · vscode | ✅ done |
| S-07 | `grep` tool | core · mcp · vscode | ✅ done |
| S-08 | `references` tool | core · mcp · vscode | ✅ done |
| S-09 | Token counter | core | ✅ done |
| S-10 | Utilization tracker | core · mcp | ✅ done |
| S-11 | Governor: compaction | core · mcp | ✅ done |
| S-12 | Governor: hard stop | core · mcp · vscode | ✅ done |
| S-13 | Telemetry per turn | core · mcp | ✅ done |
| S-14 | Sub-agent isolation | core · mcp | ✅ done |
| S-15 | Tiered model offload | core · mcp | ✅ done |
| S-16 | Golden corpus (small tier) | test fixtures | ✅ done |
| S-17 | Measurement harness | core · mcp | ✅ done |
| S-18 | TECR-L4 conformance gate | all | ✅ done |

---

## Slice Details

### S-00 — Monorepo Skeleton ✅

**What:** pnpm workspace, three packages, shared tsconfig, `pnpm build` chain.
**Exit:** `pnpm build` exits 0 across all packages.
**Spec coverage:** none (prerequisite).

---

### S-01 — MCP Pipe Hello ✅

**What:** `tecr-core#hello()` → `tecr-mcp` `hello` tool → `@tecr` VS Code participant.
**Exit:**
- `node packages/tecr-mcp/dist/index.js` accepts a `tools/call hello` request and returns `TECR 0.0.1: hello`.
- `@tecr hello` in VS Code chat shows the same string.
- Unit test in `tecr-core` passes.

**Spec coverage:** none (smoke test only).

---

### S-02 — TypeScript Repo-Map ✅

**What:** Real `buildRepoMap()` for TypeScript/JavaScript. Single language, full PageRank + budget emission.

**Note:** Switched from native tree-sitter (no Node 25 prebuilds) to ts-morph (TypeScript compiler API). S-03 will use web-tree-sitter (WASM) for the remaining languages, preserving the planned abstraction boundary.

**Verified:** 10/10 tests pass. `buildRepoMap()` on the fixture project completes in <500 ms, PageRank ranks `utils.ts` above leaf files, focus-file boost works, truncation markers present at tight budgets.

**Original description:**

**Files changed:**
- `tecr-core/src/ast/` — Tree-sitter integration, tags.scm for TS/JS.
- `tecr-core/src/graph.ts` — file dependency graph + PageRank.
- `tecr-core/src/repomap.ts` — budgeted emitter.
- `tecr-core/src/index.ts` — replace `buildRepoMap()` stub.
- `tecr-mcp/src/index.ts` — `repo_map` tool now returns real data.
- `tecr-vscode/src/extension.ts` — `@tecr map` command triggers `repo_map` tool.

**Exit:**
- `buildRepoMap('/path/to/ts/project', { budget: 1024 })` returns structured text with TypeScript symbols, correct truncation markers, `tokenCount > 0`.
- Execution time < 500 ms on a 10 kloc TypeScript project.
- `@tecr map` in VS Code shows the repo-map.
- Unit test in `tecr-core` passes.

**Spec coverage:** §5.1–5.4 (TS/JS only), §5.5 partial.

---

### S-03 — Multi-Language Repo-Map ✅

**What:** Add Rust, Python, Go, Java grammars to the existing repo-map via web-tree-sitter (WASM). No changes to MCP or VS Code — the `repo_map` tool already exists.

**Note:** Used web-tree-sitter@0.22.6 + tree-sitter-wasms@0.1.13 (WASM, Node 25-safe). Downgrade from 0.26.8 was required due to a `dylink` vs `dylink.0` format incompatibility in the prebuilt grammar WASMs. pnpm isolation required a custom `resolveWasmPath()` using `require.resolve.paths()` + `existsSync`.

**Files changed:**
- `tecr-core/src/ast/wasm.ts` — generic WASM extractor with per-language configs for Rust, Python, Go, Java.
- `tecr-core/src/index.ts` — `buildRepoMap()` now merges TS + WASM records.

**Exit:**
- `buildRepoMap()` produces correct output for all five languages (TS + Rust + Python + Go + Java). 20/20 tests passing.

**Spec coverage:** §5.5 complete.

---

### S-04 — `outline` Tool ✅

**What:** `outline(filePath)` returns signatures + docstrings for a single file, no bodies, hard limit 200 lines. Wired through MCP and exposed in the `@tecr` participant.

**Note:** Docstrings extracted by scanning raw source lines backwards from each symbol's line number — handles `/** */`, `///`, `//`, `#` comment styles. Python triple-quoted docstrings (inside function bodies) are intentionally skipped. Also added `extractSingleFile()` to `typescript.ts` and `extractWasmFile()` to `wasm.ts` to support single-file extraction without a full workspace scan.

**Files changed:**
- `tecr-core/src/tools/outline.ts`
- `tecr-core/src/ast/typescript.ts` — added `extractSingleFile()`.
- `tecr-core/src/ast/wasm.ts` — added `extractWasmFile()`.
- `tecr-core/src/index.ts` — export `outline`, `OutlineResult`.
- `tecr-mcp/src/index.ts` — `outline` tool.
- `tecr-vscode/src/extension.ts` — `@tecr outline <file>`.

**Exit:**
- `outline()` returns ≤200 lines, no function bodies, docstrings included. 9/9 tests passing.

**Spec coverage:** §6.1 (`outline`), §6.2 (truncation protocol), §6.3 partial.

---

### S-05 — `read_lines` Tool ✅

**What:** Paginated file read with explicit `start`/`end`, 200-line hard limit per call.

**Note:** When `end` is omitted, `requestedEnd` defaults to `totalLines` (not `start + 199`) so the 200-cap comparison fires correctly for files longer than 200 lines. `cursor` in the MCP tool is an alias for `start`. MCP integration test (S-05-mcp-readlines) exercises actual server pagination end-to-end.

**Files changed:**
- `tecr-core/src/tools/readLines.ts`
- `tecr-core/src/index.ts` — export `readLines`, `ReadLinesResult`.
- `tecr-mcp/src/index.ts` — `read_lines` tool with `cursor` support.
- `tecr-vscode/src/extension.ts` — `@tecr read <file> [start] [end]`.

**Exit:**
- `readLines(file, 1, 50)` returns exactly 50 lines. Omitting end returns 200-line page with truncation for files >200 lines. `nextCursor` correctly resumes next page. 9/9 core + 3/3 MCP integration tests passing.

**Spec coverage:** §6.1 (`read_lines`), §6.2, §6.3.

---

### S-06 — `search_symbol` Tool ✅

**What:** AST-based symbol lookup by name. No grep fallback. 50-result hard limit.

**Note:** Case-insensitive substring matching with relevance tiers: exact → prefix → substring. Scans both TS (ts-morph) and WASM extractors over the workspace root. Also fixed a latent bug in `typescript.ts`: `getInitializerOrThrow?.()` was being called on uninitialised `let` declarations (e.g. `let x: string`) and throwing — replaced with `getInitializer()`. MCP integration test searches real `tecr-core/src` source.

**Files changed:**
- `tecr-core/src/tools/searchSymbol.ts`
- `tecr-core/src/ast/typescript.ts` — bug fix: `getInitializer()` instead of `getInitializerOrThrow`.
- `tecr-core/src/index.ts` — export `searchSymbol`, `SearchSymbolResult`, `SymbolMatch`.
- `tecr-mcp/src/index.ts` — `search_symbol` tool.
- `tecr-vscode/src/extension.ts` — `@tecr search <query>`.

**Exit:**
- `searchSymbol(root, 'buildRepoMap')` returns correct file, line, kind. Cross-language (Rust) search works. 9/9 core + 3/3 MCP integration tests passing.

**Spec coverage:** §6.1 (`search_symbol`), §6.2, §6.3.

---

### S-07 — `grep` Tool ✅

**What:** Lexical search with ±2 lines context, 100-match hard limit. Respects §6.3 exclusion list.

**Note:** Pattern treated as a literal string (regex-escaped internally). Binary files skipped via null-byte detection. `.d.ts` files excluded. `caseInsensitive` option exposed in MCP schema. Output uses `> N: line` format for match line, `  N: line` for context.

**Files changed:**
- `tecr-core/src/tools/grep.ts`
- `tecr-core/src/index.ts` — export `grep`, `GrepResult`, `GrepMatch`.
- `tecr-mcp/src/index.ts` — `grep` tool.
- `tecr-vscode/src/extension.ts` — `@tecr grep <pattern>`.

**Exit:**
- Returns matches with file path, line number, ±2 context lines. `node_modules/`, `dist/`, `.git/` excluded. Capped at 100 with truncation hint. 8/8 core + 3/3 MCP integration tests passing.

**Spec coverage:** §6.1 (`grep`), §6.2, §6.3.

---

### S-08 — `references` Tool ✅

**What:** AST-assisted reference lookup for a named symbol. Word-boundary regex search
across all workspace files; definition lines identified via `searchSymbol` (exact match)
and excluded. 100-result hard limit, ±2 context lines, §6.3 exclusion dirs.

**Files changed:**
- `tecr-core/src/tools/references.ts` (new — 145 lines)
- `tecr-core/src/index.ts` — `references()` wrapper + type exports
- `tecr-mcp/src/index.ts` — `references` tool (ListTools + dispatch)
- `tecr-vscode/src/extension.ts` — `@tecr refs <symbol>` / `@tecr references <symbol>`

**Tests:** 9 core (`S-08-references.test.ts`) + 3 MCP (`S-08-mcp-references.test.ts`) — 12 new, 76 total.

**Non-obvious decisions:**
- Definition exclusion uses `searchSymbol` (AST) for exact name matches, keyed on
  `filePath:line`; avoids false-positive exclusions from unrelated symbols.
- Word-boundary regex `\bsymbolName\b` prevents `doWork` from matching `doWorkExtra`.
- Binary detection and `.d.ts` skip carry over from `grep` for consistency.

**Exit:** `references(root, 'doWork')` returns call sites, excluding the `export function`
definition line. Respects §6.3 exclusion list. 76/76 tests pass.

**Spec coverage:** §6.1 (`references`), §6.2, §6.3. **TECR-L1 complete.**

---

### S-09 — Token Counter

**What:** tiktoken-compatible token counter in `tecr-core`. Used by the governor (S-10+) and the repo-map emitter (improves S-02 precision).

**Files changed:**
- `tecr-core/src/tokenizer.ts`
- `tecr-core/src/index.ts`

**Exit:**
- `countTokens('hello world')` returns the expected cl100k count.
- `buildRepoMap()` uses real token counts instead of character estimates.

**Spec coverage:** prerequisite for §7.

---

### S-10 — Utilization Tracker

**What:** Per-turn tracker that accumulates input + output tokens and computes utilization fraction. No governor actions yet — observe only.

**Files changed:**
- `tecr-core/src/governor/tracker.ts`
- `tecr-core/src/index.ts`
- `tecr-mcp/src/index.ts` — emit utilization in every tool response.

**Exit:**
- `tracker.record({ inputTokens: 1000, outputTokens: 200, windowSize: 200000 })` returns `utilization: 0.006`.
- MCP tool responses include `x-tecr-utilization` metadata.

**Spec coverage:** §7.1 (I2 partial), §7.3 partial.

---

### S-11 — Governor: Compaction

**What:** When utilization approaches 40%, the governor compacts old tool results to one-line summaries and evicts superseded artifacts. No hard stop yet.

**Files changed:**
- `tecr-core/src/governor/compactor.ts`
- `tecr-core/src/governor/index.ts`
- `tecr-core/src/index.ts`
- `tecr-mcp/src/index.ts` — governor runs before each tool dispatch.

**Exit:**
- Given a message history at 35% utilization, `compact(history)` reduces it below 25%.
- Compaction events logged with bytes recovered.

**Spec coverage:** §7.1 (I1, I2), §7.2 (actions 1–2), §7.3 partial.

---

### S-12 — Governor: Hard Stop

**What:** When compaction is exhausted and the next call would breach 40%, the governor halts and surfaces a structured error to the host. VS Code participant shows a user-facing message.

**Files changed:**
- `tecr-core/src/governor/index.ts`
- `tecr-mcp/src/index.ts`
- `tecr-vscode/src/extension.ts`

**Exit:**
- Synthetic test: tool history that can't be compacted below 40%. Governor throws `GovernorHardStop` error with structured payload.
- Extension shows: "TECR: context budget exhausted. Start a new chat or reduce focus files."

**Spec coverage:** §7.1 (I1–I3), §7.2 (all actions). **TECR-L2 complete after this slice.**

---

### S-13 — Telemetry Per Turn

**What:** After every tool call, emit a structured telemetry event covering all §7.3 fields. Hookable interface so callers can pipe to OpenTelemetry or a custom sink.

**Files changed:**
- `tecr-core/src/telemetry.ts`
- `tecr-core/src/index.ts`
- `tecr-mcp/src/index.ts`

**Exit:**
- `onTelemetry(event => ...)` receives an event with all §7.3 fields after each call.
- Default sink writes structured JSON to stderr (opt-out via env var).

**Spec coverage:** §7.3 complete.

---

### S-14 — Sub-Agent Isolation

**What:** Discovery tasks are delegated to an isolated sub-agent whose context does not propagate to the parent. Return contract: summary ≤200 tokens + artifact refs + token report.

**Files changed:**
- `tecr-core/src/subagent/index.ts`
- `tecr-core/src/index.ts`
- `tecr-mcp/src/index.ts` — `delegate` tool.

**Exit:**
- `delegate({ task: '…', parentContext: … })` returns `{ summary, artifactRefs, tokenUsage }`.
- `summary.length` (token-counted) ≤ 200.
- Parent context is unchanged beyond the summary.

**Spec coverage:** §8.1–8.2. **TECR-L3 complete after this slice.**

---

### S-15 — Tiered Model Offload ✅

**What:** Sub-agent work is optionally offloaded to a local model (Ollama). Governor accounts local tokens at zero cost but records them in telemetry.

**Files changed:**
- `tecr-core/src/subagent/offload.ts` — OpenAI-compatible fetch to `TECR_LOCAL_MODEL_URL`; falls back silently on error.
- `tecr-core/src/subagent/index.ts` — `delegate()` routes to offload when env var is set; `TokenUsage` gains `localTokens`.
- `tecr-core/src/telemetry.ts` — `TelemetryEvent` gains `localTokens` and `billableTokens`.
- `tecr-core/src/governor/index.ts` — `record()` accepts optional `localTokens`; passes to telemetry but never adds to `effectiveTokens`.
- `tecr-mcp/src/index.ts` — `withUtilization()` threads `localTokens` through; `delegate` handler passes `result.tokenUsage.localTokens`.

**Exit:**
- When `TECR_LOCAL_MODEL_URL` is set, `delegate()` routes to the local model. ✅
- Telemetry shows `localTokens > 0`, `billableTokens` unchanged. ✅
- Local tokens are NOT counted toward `effectiveTokens` (zero-cost for budget). ✅
- Unreachable or non-2xx local model silently falls back to grep path. ✅

**Tests:** 8 new (`S-15-offload.test.ts`). 143/143 total.

**Spec coverage:** §8.3. **TECR-L3 complete.**

---

### S-16 — Golden Corpus (Small Tier) ✅

**What:** Assemble three real-world repositories across required languages with fixed task prompts and expected useful-action thresholds. Committed as stripped fixtures.

**Repos:**
- `test/corpus/bincode` — Rust (dtolnay/bincode via sr.ht). `sourceRoot: src`
- `test/corpus/zod` — TypeScript (colinhacks/zod). `sourceRoot: packages/zod/src/v4/core`
- `test/corpus/httpx` — Python (encode/httpx). `sourceRoot: httpx`

**Note:** All three exceed the spec's ≤5 kloc guideline at ~8–10k source lines each. The `sourceRoot` field constrains what the harness points tools at. `.git` and build artifacts stripped; source trees committed verbatim.

**Files changed:**
- `test/corpus/thresholds.json` — corpus manifest (id, language, sourceRoot, prompt, threshold).
- `test/corpus/bincode/`, `test/corpus/zod/`, `test/corpus/httpx/` — stripped fixture repos.
- `tecr-core/src/harness/corpus.ts` — `loadCorpus()` loader; resolves paths relative to `__dirname`.
- `tecr-core/src/index.ts` — exports `loadCorpus`, `CorpusEntry`.

**Exit:**
- `loadCorpus()` returns three entries each with `id`, `language`, `repoPath`, `sourceRoot`, `prompt`, `threshold`. ✅
- `repoPath` and `sourceRoot` exist on disk; corpus runs fully offline. ✅

**Tests:** 7 new (`S-16-corpus.test.ts`). 150/150 total.

**Spec coverage:** §9.2 (small tier).

---

### S-17 — Measurement Harness ✅

**What:** Run the golden corpus against the TECR-L3 tool surface and collect all §9.1 metrics. Output: structured JSON results artifact.

**Files changed:**
- `tecr-core/src/harness/metrics.ts` — `SessionMetrics` type + `computeMetrics()` pure function.
- `tecr-core/src/harness/runner.ts` — `runCorpusEntry()`: 5-step simulated session (repo_map → search_symbol → grep → delegate → read_lines), collects telemetry, tracks meta for all 6 metrics.
- `scripts/measure.ts` — CLI; `pnpm measure` runs all 3 corpus entries and writes `results.json` + summary table.
- Root `package.json` — `"measure": "pnpm build && tsx scripts/measure.ts"`.
- `tecr-core/src/index.ts` — exports `runCorpusEntry`, `computeMetrics`, `SessionMetrics`, `RunResult`.

**Non-obvious decisions:**
- `runner.ts` replicates `buildRepoMap()`'s internals directly to avoid a circular import through `index.ts`.
- `tsx` added as workspace-root devDependency for running `scripts/measure.ts` without a separate compile step.
- S-15 cleanup bug fixed (`afterEach` now async with `Promise.allSettled`).

**Exit:**
- `pnpm measure` produces `results.json` with all §9.1 fields for each corpus entry. ✅

**Tests:** 12 new (`S-17-harness.test.ts`). 162/162 total.

**Spec coverage:** §9.1–9.2.

---

### S-18 — TECR-L4 Conformance Gate ✅

**What:** CI step that asserts the §9.3 acceptance gates against the golden corpus. Fails the build if any gate is breached.

**Files changed:**
- `tecr-core/src/harness/gates.ts` — `DISCOVERY_COST_LIMIT`, `UTILIZATION_PEAK_LIMIT`, `TRUNCATION_RATE_LIMIT` constants + `checkGates()` function returning typed `GateResult[]`.
- `scripts/conformance-gate.ts` — CLI: runs all corpus entries, reports pass/fail per gate, exits 1 on any failure.
- `.github/workflows/conformance.yml` — two-job CI pipeline: unit-tests → conformance. Uploads `results.json` as artifact.
- `package.json` — `"gate": "pnpm build && TECR_NO_TELEMETRY=1 tsx scripts/conformance-gate.ts"`.
- `tecr-core/src/index.ts` — exports `checkGates`, `GateResult`, and the three limit constants.
- `README.md` — full rewrite: setup, Claude Code / Cursor / VS Code integration, all tools, configuration reference, measurement guide, corpus management, architecture diagram, conformance level table.

**Non-obvious decisions:**
- `truncationRate` gate uses strict `<` (not `≤`) per §9.3 wording.
- Medium-tier corpus not added — the gate runs against whatever entries are in `test/corpus/`. Adding more repos is documented in README.
- Badge URL uses `YOUR_ORG/YOUR_REPO` placeholder — update once the remote is set.

**Exit:**
- Discovery cost ≤ 15k tokens. ✅ (current: ~4k on bincode)
- Utilization peak ≤ 40% on 200k window. ✅ (current: ~2.4%)
- Truncation rate < 20%. ✅ (current: 0%)
- CI workflow committed. Badge in README. ✅

**Tests:** 13 new (`S-18-conformance.test.ts`). 175/175 total.

**Spec coverage:** §9.3, §10 (L4). **TECR-L4 complete.**

---

## Branch & PR Convention

```
slice/S-02-ts-repomap
slice/S-03-multilang-repomap
slice/S-04-outline-tool
...
```

One PR per slice. The PR description links to the slice entry above and includes:
- What changed in each package.
- The exit criterion result (copy the test output).
- Spec section(s) covered.

## Test Convention

Every slice adds at least one test to the relevant package(s):

```
packages/tecr-core/src/__tests__/S-02-repomap.test.ts
packages/tecr-core/src/__tests__/S-04-outline.test.ts
...
```

Tests are named `S-NN-*` so it is immediately clear which slice they belong to.
