---
name: fcc-llm-chain
description: "Use when any code path calls an LLM and must survive provider failures (429/timeout/drift) — the SAOS llm-chain discipline: run every consumer through a candidate chain (runLlmChain) with mid-turn failover WITHOUT restart, unique-validated outputs (duplicate candidate outputs are rejected, FCC settings.py:876 law), an honest exhaustion terminal (ok:false, NEVER invent output), the sha256-keyed LRU-128 fast-path cache (withFastPath, TTL-bounded, tokensSaved accounting from last real usage), the LlmChainCall ledger (metadata only — never prompt/model content), and the drillChain validity drill that proves the wiring without real workload."
license: AGPL-3.0-compatible clean-room note (semantics only; zero source vendored — see Provenance)
metadata:
  adapted-from: "Alishahryar1/free-claude-code — the resilient-LLM-consumer patterns (candidate chains with unique validation settings.py:876, cache fast-path). CLEAN-ROOM: the repository was studied for DESIGN only; ZERO source lines vendored; AGPL contagion avoided by construction."
  saos-adoption: "v115.0.0 חוסן (fcc adoption) — docs/FCC-ADOPTION.md (rebuild wave 118-a, restored from the recovery-v110 spec; SAOS_VERSION line untouched by this wave)"
  code-level: "src/lib/saos/llm-chain.ts — runLlmChain (candidate chain, classifyLlmError, ForcedDrillError, trace saos.llm_chain.*) + withFastPath (sha256 LRU-128 TTL) + llmChainKpis (ledger-derived) + drillChain (forced-fail → provider maxTokens:1 → local wiring backstop) + flushFastPath · src/app/api/saos/llm-chain/route.ts (flat GET board; POST drill/flush 64KB+4s+oplog) · wired into src/lib/saos/selfreview.ts (phase-A fastPath diff-hash key, phase-B chain [primary 4000 → compact-retry 2000] with JSON validate gate)"
---

# FCC LLM Chain (SAOS adaptation)

The חוסן plane gives every LLM consumer one resilient entry point instead of a
naked provider call. The two proven failure modes it cures — both measured live
in this estate:

1. **Provider 429 killed a mid-turn runner** (v113 ax wave: the analyst step
   died on `Too many requests` → `RunnerError` fail-closed). Cure: candidates
   fail over **inside the same turn** — a 429 on candidate 1 hands control to
   candidate 2 without restarting the run.
2. **Free-text drift burned the 2-strike JSON discipline** (v114 review wave:
   phase-B returned prose instead of `{findings:[...]}` twice → honest fail).
   Cure: the chain's validate gate makes invalid output a *candidate failure*,
   so the second candidate gets the strike instead of the run.

## The five laws

1. **Candidate chain** — `runLlmChain({candidates, purpose?, validate?, timeoutMs?})`
   runs `{name, call, maxTokens?}` entries in order. A throw, 429, timeout,
   empty output, duplicate output, or validate-rejection moves to the next
   candidate **in the same call**. First valid candidate wins (`selected`).
2. **Unique validation** (FCC settings.py:876 discipline) — an output identical
   (trimmed) to an earlier candidate's output in the same chain is rejected as
   `duplicate`: a repeated answer is not new information.
3. **Honest exhaustion** — when every candidate fails: `ok:false`,
   `output:null`, last `errorClass` (`rate-limit | timeout | empty-output |
   duplicate | invalid | auth | network | provider | unknown`). Output is
   NEVER invented.
4. **Fast path** — `withFastPath(fn, key)`: the key is sha256-hashed (raw key
   never stored), entries live in an LRU capped at 128 with a 10-minute TTL.
   A hit returns the cached output with `tokensSaved` from the last real
   usage; a miss runs `fn`, stores its real usage, and reports
   `tokensSaved:0`.
5. **Metadata-only ledger** — every chain run, drill, and fast-path hit/miss
   writes an `LlmChainCall` row: candidate NAMES, selected name, attempts,
   real usage tokens, `tokensSaved`, ms, and the error CLASS. Prompt content
   and model output are never persisted, never returned by the API.

Trace events (console, metadata only): `saos.llm_chain.started` ·
`saos.llm_chain.candidate_failed` (name + class only) ·
`saos.llm_chain.selected` · `saos.llm_chain.exhausted`.

## The drill

`drillChain()` proves the wiring with no real workload, deterministically:

- candidate 1 `drill-forced-fail` — throws `ForcedDrillError` → proves
  `candidate_failed` + mid-turn failover every time;
- candidate 2 `drill-provider-1t` — a REAL house provider call with
  `max_tokens: 1` → proves the live rail; a real 429 is recorded honestly;
- candidate 3 `drill-local-echo` — a local, network-free wiring backstop →
  guarantees the drill reaches `selected` even under full provider throttle
  (labeled wiring-only in the name and the notes).

Every drill writes a `kind:"drill"` ledger row.

## When to use

- Any new LLM consumer: build 2+ candidates (primary + compact-retry with a
  smaller prompt and max_tokens), pass a strict `validate` for structured
  outputs, and keep the existing downstream discipline intact.
- Deterministic-ish calls over a changing-but-cyclic input (e.g. skill-select
  over the same diff): wrap in `withFastPath` keyed by a content hash of that
  input.
- After any provider incident: run the drill, then read
  `GET /api/saos/llm-chain` — KPIs are derived from the ledger, not from
  in-memory counters (the server recycles; the ledger stays).

## API

- `GET /api/saos/llm-chain` — public flat board: `kpis` (calls, failoverRate,
  exhaustionRate, cacheHitRate, tokensSaved, avgMs), `recent` (last 20 ledger
  rows, metadata only), `chainSpec`. Flat envelope law: payload at the top
  level, never nested.
- `POST /api/saos/llm-chain` — requireAuth; 64KB body cap; 4s rate limit;
  oplog+audit. `{op:"drill"}` runs the drill (returns `drillOk` separate from
  the POST's own `ok`); `{op:"flush"}` empties the fast-path cache and reports
  how many entries were spilled.

## Honest limits

The chain fails over within one turn; it does not queue, retry for minutes, or
cross providers — a candidate IS the retry topology (the compact-retry
candidate is a genuinely different request, not the same one replayed). The
fast path serves the exact keyed input only; a changed diff is a different key
and misses honestly. `tokensSaved` is an accounting of what the cached answer
would have cost per its last real usage — it is not a billing document.

## Provenance & boundaries

Adapted from **Alishahryar1/free-claude-code** (AGPL-3.0) as a **clean-room**:
the upstream design (resilient candidate chains, unique-output validation at
settings.py:876, cache fast-path) was studied and re-implemented from
semantics; **zero source lines, files, or snippets were vendored**, so no AGPL
obligations attach to this house code beyond honest attribution. **Refused**
from upstream (see docs/FCC-ADOPTION.md for the full roast): the
`requires-python == 3.14.7` exact pin, the `curl | sh` installer, the
unverified marketing claims, and the ~67k-LOC local proxy approach. The
`skills/fcc-llm-chain/` sticker is tracked as a house artifact
(`.gitignore` exception).
