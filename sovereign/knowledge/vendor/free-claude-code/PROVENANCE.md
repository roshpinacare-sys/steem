# PROVENANCE — Alishahryar1/free-claude-code (FCC)

- **Repo**: https://github.com/Alishahryar1/free-claude-code
- **HEAD measured**: `03aca36eb3b9f2bf07805b1c39ec4d61f6f740c1` (2026-10-02, "patch: buffer client tool calls until completion (#1973)") — very active (PR #1973).
- **Wave**: r168, evaluated 2026-10-03 (shallow clone at `/home/z/laya-eval/freecode-src`).
- **License**: **AGPL-3.0-only** — verified real file: `LICENSE` header "Free Claude Code / Copyright (c) 2026 Ali Khokhar / SPDX-License-Identifier: AGPL-3.0-only" + pyproject `license = "AGPL-3.0-only"`. Strong copyleft → **verbatim vendoring into our repo FORBIDDEN** (would impose AGPL on our distribution). Pattern distillation only.

## What it is

Local FastAPI proxy connecting coding agents (Claude Code, Codex, Cline, Aider, …11 agents) to OpenAI-compatible providers — aggregates 59 "ToS-friendly" free/paid/local providers (README claim; **39 provider modules measured** in `src/free_claude_code/providers/`: groq, gemini, deepseek, cloudflare, github_copilot, open_router, vertex, lmstudio, kilo, mistral, nvidia_nim, custom, …) with automatic mid-turn model failover, output compaction (RTK, "90% fewer terminal-output tokens"), deterministic interception of routine sub-requests (titles/quota probes/command-prefix — no provider call), history replay for mid-session model switching.

## Hard evidence — why NOT run here

1. **Python pin**: `requires-python = "==3.14.7"` (exact). Sandbox: **3.12.14** → hard runtime block; installing a second Python + grpcio/nvidia-riva-client/telegram/discord deps for zero-provider value fails FLO-6/MAG-1.
2. **Needs provider credentials** for any utility; we hold none by sovereignty law (MAG-2 bridge-not-keys).
3. **Client side irrelevant to us**: we run mini-swe-agent (r166), not Claude Code/Codex/Cline.
4. **Custom-provider loop is symbolic**: FCC could point at our llm-bridge (OpenAI-compatible), but direct bridge access is strictly simpler — a proxy in front of our own proxy adds latency and an AGPL boundary for zero capability.

## What was taken (patterns only — zero verbatim code)

Read with evidence: `providers/admission_policy.py`, `providers/failure_policy.py`, `providers/custom.py`, module map (`request_recovery.py`, `stream_recovery.py`, `history_replay.py`, `reasoning_compatibility.py`).

- **FCC-1 failure taxonomy before retry**: marker-set classification (rate_limit / overload / internal / auth / permission / billing) → only *qualified* failures retry or fail over. Map: future llm-bridge hardening; decision-brain revive.
- **FCC-2 admission limits**: frozen validated `ProviderAdmissionLimits(rate_limit, rate_window, max_concurrency)` "independent of clients and controller lifetime". Map: FLO-2 twin at the LLM layer — wire limits BEFORE any second upstream is admitted.
- **FCC-3 mid-turn failover / recovery layers**: retries exhausted → next model without restarting the turn; request_recovery + stream_recovery as separate layers. Map: agent-loop resilience unit = the turn.
- **FCC-4 history replay**: context replay when switching models mid-session. Map: multi-upstream future.
- **FCC-5 deterministic interception**: answer routine sub-requests (titles, quota probes, command-prefix detection) without any LLM call. Map: token honesty (MAG-4); revisit when bridge traffic justifies.

## Activation routes

- `second-upstream-route` — BLOCKED (sovereignty): failover needs a second LLM upstream; external keys forbidden. Revisit only via local model (laya onnx-route LAY-1) — and even then narrow-capability only.
- `bridge-hardening-route` — CONDITIONAL: implement FCC-1 classification (+1 retry, backoff) in llm-bridge when traffic makes failures observable (currently 15 completions served — below any measurable threshold; premature per MAG-1).

## whyNotRevenue

FCC is a consumer of free tokens, not a producer of revenue. For us it is insurance-pattern literature for the LLM layer. Zero direct income path; indirect value only if the fleet gains a second upstream someday.
