# PROVENANCE — the "hot five" batch (r169, 2026-10-03)

Operator relayed a viral post listing 5 repos ("take and start using"). All five measured from source the same day. **Post claims vs measured reality documented per repo.**

| Repo | HEAD | License (verified) | Size | Verdict |
|---|---|---|---|---|
| NanoNets/Graft | `fe30ead` | MIT | 84M (40M assets) | pattern-source |
| msitarzewski/agency-agents | `d3f71c4` | MIT | 7.7M | **ADOPTED (subset)** |
| DeusData/codebase-memory-mcp | `96c3f41` | MIT | **808M** (710M internal C) | pattern-source |
| calesthio/OpenMontage | `08e2151` | **AGPLv3** | 162M | rejected (AGPL+GPU) |
| stablyai/orca | `77ad467e` | MIT | 422M (Electron) | pattern-source |

## 1. Graft (NanoNets) — context layer for coding agents

- **Post says**: "cheap 4×, fast 3×". **Their own table says**: tool-call reduction +46%, token savings +42%, time +60%, correctness 54%→66%. Composite marketing headline; real numbers are good but smaller.
- Mechanism: pre-computed repo context layer so agents explore less. npm `@nanonets/graft`, TypeScript, MIT.
- **Not run**: disk hit 100% during the wave (9.9G rootfs), npm install infeasible; targets Claude Code/Cursor/Codex clients we don't run.
- **Taken**: pattern AT-1 (context-pack-before-task) → activation route below.

## 2. agency-agents (msitarzewski) — ADOPTED subset

- **Post says**: "232 sub-agents in 16 domains". **Measured**: **328 markdown persona files** across 20+ domain dirs.
- Each persona: YAML frontmatter (name/description/color/emoji/vibe) + Identity/Mission/domains body — role-prompt templates, zero runtime, MIT.
- **Sandbox test (real)**: `marketing-aeo-foundations` persona (15.5K) as system prompt through **our llm-bridge :3048** with a Hebrew-SaaS-landing task → on-persona answer in-domain (AI-crawler robots.txt Allow directives · /llms.txt publishing · semantic HTML/Markdown conversion, "prioritize before SEO"). **Persona-steering proven sovereign** — no third-party API.
- **Vendored**: 6 mission-relevant personas (80K) in `sovereign/knowledge/vendor/agency-agents/personas/` with attribution: aeo-foundations · agentic-search-optimizer · ai-citation-strategist · content-creator · social-media-strategist · sales-offer-lead-gen-strategist.
- **Taken**: pattern AT-2 (persona-as-system-prompt per service role).

## 3. codebase-memory-mcp (DeusData)

- **Post says**: "token reduction >99%, answers in milliseconds". **README/paper says**: 10× fewer tokens (=90%), 2.1× fewer tool calls, 83% answer quality (arXiv:2603.27277, 31 repos). **Post exaggerated ~10×.**
- Real thing: pure-C tree-sitter AST → persistent knowledge graph (functions/classes/call-chains/HTTP routes), 17 MCP tools, hybrid LSP for 10 languages, native executable distribution.
- **Not run**: 710M of C sources (clone deleted after measurement — disk pressure), MCP surface (our agent uses bash, not MCP), and our repo is small enough that direct exploration is already cheap.
- **Taken**: pattern AT-3 (structural-index answers > file-by-file reading) — becomes relevant if a fleet repo grows big.

## 4. OpenMontage (calesthio) — rejected

- AGPLv3 (verbatim forbidden), 162M, **requirements-gpu.txt** (GPU pipeline: storyboard→script→assets→edit→render via Remotion + agent prompts).
- **Not runnable here**: no GPU, disk tight, AGPL.
- We already produce video sovereignly via the z-ai video-generation skill — OpenMontage solves running *local* video models we don't have.
- **Taken**: pattern AT-4 (stage-decomposed media pipeline) as a checklist shape only.

## 5. Orca (stablyai)

- **Post says**: "manages multiple agents in parallel". **Reality**: an **Electron desktop GUI app** (422M, pnpm workspace, mobile companion) to run Codex/ClaudeCode/OpenCode/Pi side-by-side, **each in its own git worktree**.
- **Not run**: GUI desktop app, no display in sandbox.
- **Taken**: pattern AT-5 (worktree fan-out — parallel bounded agent tasks, one per worktree, centrally tracked) → maps to the r166 fleet-tasks-route.

## Activation routes

- `persona-route` — LIVE: persona → system prompt → llm-bridge (tested). Next: weblift self-audit with the aeo-foundations persona against OUR properties (do we publish llms.txt? is robots.txt AI-aware?).
- `context-pack-route` — CONDITIONAL: sovereign repo-context pack (tree + key summaries) prepended to mini-swe-agent tasks when agent-task volume rises (Graft pattern, zero deps).
- `worktree-fanout-route` — CONDITIONAL: parallel bounded agent tasks via git worktrees when >1 recurring agent-task must run simultaneously (Orca pattern).
- `code-graph-route` — BLOCKED (scale): our repos are small; revisit if repo grows past direct-exploration comfort.
- `video-studio-route` — REJECTED: AGPL + no GPU + sovereign video skill already exists.

## whyNotRevenue

Direct revenue candidate: agency personas → content-factory/weblift output quality (AEO/GEO work is billable in the market). The other four are efficiency patterns, not income paths.
