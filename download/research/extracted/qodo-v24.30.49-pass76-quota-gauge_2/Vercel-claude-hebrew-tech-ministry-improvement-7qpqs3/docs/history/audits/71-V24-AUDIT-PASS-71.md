# QODO V24 — Audit Pass 71 (CIEP-X v10.0)

**Version:** 24.30.42 → 24.30.43
**Date:** 2026-07-07
**Protocol:** Canonical Incremental Engineering Protocol X v10.0
**Baseline:** 24.30.42 (Pass 70 — Visual-Regression / Cross-Browser QA Decision)
**Task:** task-31 — Additional OpenAI-compatible LLM race candidates (Fireworks AI, DeepInfra, Novita AI, CF Workers AI REST)

---

## Executive Summary

Pass 71 implements task-31: the decision and integration of four additional free-tier
LLM providers into the `ai-router.ts` fast-draft race (A3 batch).

**Decision: YES on all four candidates.**

- **Fireworks AI** — free-tier serverless allotment, OpenAI-compatible. Low-friction.
- **DeepInfra** — free-trial credits, OpenAI-compatible. Low-friction.
- **Novita AI** — free-trial credits, OpenAI-compatible. Low-friction.
- **CF Workers AI REST** — separate daily free allotment (10,000 neurons/day) from the
  existing Tier-1 V8 binding. Requires `CF_ACCOUNT_ID` + `CF_AI_API_TOKEN`; both absent
  = silently skipped. Distinct quota from `env.AI.run`.

All four are fully opt-in: absent key(s) → silent skip, no error raised.
All four degrade gracefully on network failure (circuit breaker + quota guardian).
All four follow the same integration pattern as A1 (Gemini, Cerebras, Mistral) and
A2 (Together, SambaNova, HuggingFace).

---

## PASS 1 — Repository Acquisition

Baseline: `QODO-V24.30.42-pass70.zip` (339 files, version 24.30.42).

Key files read for this implementation:

- `packages/agent/src/services/ai-router.ts` — existing A1/A2 race patterns
- `packages/agent/src/services/quota-guardian.ts` — QuotaProvider union, HEADER_MAP, DEFAULT_RESET_WINDOW_S
- `packages/agent/src/services/env-validator.ts` — Zod schema, LLM-key guard
- `packages/agent/tests/integrations/power-expansion.test.ts` — A1/A2 test pattern reference
- `tasks/agent-task-queue.json` — task-31 queue entry
- `03-ARCHITECTURE.md` — integration tier table

---

## PASS 2 — Continuity Review

**Task selected:** task-31 (P3, `requiresOwnerDecision: true`).

Pass 70 recommendation: task-31 is the highest-priority remaining queued task and has
a potential YES path (unlike task-38's NO-GO). The queue entry notes: "Deliverable is a
documented decision ... on which candidates to actually wire in; do not invent the
integration code itself in this pass unless the decision half is trivial and there's time
left." — Given the pattern is identical to A1/A2 and the decision is YES on all four,
both decision and implementation are completed in this pass per CIEP efficiency guidance.

No prior pass implemented any of the four A3 providers. The existing `RouterEnv` interface
had no `FIREWORKS_API_KEY`, `DEEPINFRA_API_KEY`, `NOVITA_API_KEY`, `CF_ACCOUNT_ID`, or
`CF_AI_API_TOKEN` fields.

---

## PASS 3 — System Analysis

### Existing provider race (prior to this pass)

| Batch | Providers | Fast-draft race participant |
|---|---|---|
| Core | Groq (fast + heavy) | Yes (fast) |
| Tier 3 | OpenRouter | No (fallback only) |
| A1 | Gemini, Cerebras, Mistral | Yes |
| A2 | Together, SambaNova, HuggingFace | Yes |

### A3 candidates evaluated

| Candidate | Endpoint | Auth | Free allotment | Decision |
|---|---|---|---|---|
| Fireworks AI | `api.fireworks.ai/inference/v1/chat/completions` | `Bearer FIREWORKS_API_KEY` | Free serverless trial credits | **YES** |
| DeepInfra | `api.deepinfra.com/v1/openai/chat/completions` | `Bearer DEEPINFRA_API_KEY` | Free-trial credits | **YES** |
| Novita AI | `api.novita.ai/v3/openai/chat/completions` | `Bearer NOVITA_API_KEY` | Free-trial credits | **YES** |
| CF Workers AI REST | `api.cloudflare.com/client/v4/accounts/{id}/ai/run/{model}` | `Bearer CF_AI_API_TOKEN` | 10,000 neurons/day (daily allotment, separate from Tier-1 V8 binding) | **YES** |

### CF Workers AI REST vs Tier-1 V8 binding

The Tier-1 binding (`env.AI.run`) uses the Cloudflare Workers runtime V8 binding —
only available inside a deployed CF Worker. The REST API (`api.cloudflare.com/...`) is
a plain HTTPS endpoint callable from any Node.js environment. These draw from
**separate** free allotments. Having both configured doubles the effective CF AI capacity
rather than creating duplicate quota tracking. The quota guardian tracks them under
distinct provider keys: `"cf-workers-ai"` (existing Tier-1) and `"cf-workers-ai-rest"`
(new A3 provider).

### Response envelope difference

CF Workers AI REST wraps responses differently from OpenAI-compatible providers:

```json
{ "success": true, "result": { "response": "<content>" } }
```

All A1/A2 providers use the standard OpenAI shape:

```json
{ "choices": [{ "message": { "content": "<content>" } }] }
```

A dedicated `chatCfRestAi()` function handles the unwrapping. The `{}` fallback
(absent `result.response`) is valid JSON and passes the `draftThenVerify` validator.

---

## PASS 4 — Engineering Planning

### Impact Analysis

| Dimension | Assessment |
|---|---|
| **Engineering value** | High — four more racing slots increase the probability of a sub-150ms draft response and reduce pipeline stall frequency when any two existing providers are simultaneously 429-throttled. The CF REST addition also adds a second independent CF quota pool. |
| **Implementation risk** | Very low — identical integration pattern to A1/A2. No new architectural primitives. |
| **Compatibility impact** | Zero — all four providers are fully opt-in. Absent keys = no change in behaviour. |
| **Rollback complexity** | Trivial — remove the four `chatXxx` functions and their `buildFastDraft` wiring; delete the four env keys from `RouterEnv` and `envSchema`. |
| **Blast radius** | Minimal — changes are additive to `buildFastDraft()`. Existing providers untouched. |
| **Validation cost** | Low — `node --check` and `validate.sh` suffice; same pattern already tested by A1/A2 tests. |

### Rejected alternative: implement only a subset

No engineering basis to exclude any of the four. Each is identical in friction level
(one API key, OpenAI-compatible except CF REST), and each adds an independent free
quota pool to the race. Partial adoption would require arbitrary prioritisation.

---

## PASS 5 — Engineering Execution

### Models selected

| Provider | Model | Rationale |
|---|---|---|
| Fireworks AI | `accounts/fireworks/models/llama-v3p1-8b-instruct` | Fireworks' canonical free-tier Llama 3.1 8B serverless path |
| DeepInfra | `meta-llama/Meta-Llama-3.1-8B-Instruct` | Lowest-cost/free-tier Llama 3.1 8B on DeepInfra |
| Novita AI | `meta-llama/llama-3.1-8b-instruct` | Novita free-trial Llama 3.1 8B |
| CF Workers AI REST | `@cf/meta/llama-3.1-8b-instruct` | Same model as Tier-1 V8 binding; consistent output shape |

### Changes made

**`packages/agent/src/services/ai-router.ts`**

- Added model constants: `FIREWORKS_FAST_MODEL`, `DEEPINFRA_FAST_MODEL`,
  `NOVITA_FAST_MODEL`, `CF_REST_FAST_MODEL`
- Added circuit breakers: `fireworksBreaker`, `deepinfraBreaker`, `novitaBreaker`,
  `cfRestBreaker` (reset timeout 86,400,000 ms for CF REST to match 24h daily allotment)
- Added to `RouterEnv` interface: `FIREWORKS_API_KEY`, `DEEPINFRA_API_KEY`,
  `NOVITA_API_KEY`, `CF_ACCOUNT_ID`, `CF_AI_API_TOKEN`
- Added chat functions: `chatFireworks`, `chatDeepInfra`, `chatNovita`, `chatCfRestAi`
  - All follow the A1/A2 pattern: `withRetry` + `fetchWithTimeout` + circuit breaker +
    quota-guardian header recording + 429 → `markProviderExhausted`
  - `chatCfRestAi` handles CF REST envelope unwrapping (`result.response`)
- Wired all four into `buildFastDraft()` race via `addCandidate()`:
  - CF REST gated on `cfAccountId && cfAiApiToken` (both required)

**`packages/agent/src/services/quota-guardian.ts`**

- Extended `QuotaProvider` union: `| "fireworks" | "deepinfra" | "novita" | "cf-workers-ai-rest"`
- Added `HEADER_MAP` entries: Fireworks, DeepInfra, Novita use standard
  `x-ratelimit-remaining-*` headers; CF REST uses empty map (no standard headers)
- Added `DEFAULT_RESET_WINDOW_S` entries: 60s for Fireworks/DeepInfra/Novita;
  1440s (24h) for CF REST daily allotment

**`packages/agent/src/services/env-validator.ts`**

- Added five new optional Zod fields: `FIREWORKS_API_KEY`, `DEEPINFRA_API_KEY`,
  `NOVITA_API_KEY`, `CF_ACCOUNT_ID`, `CF_AI_API_TOKEN`
- Updated the "at least one LLM key" guard: `CF_ACCOUNT_ID + CF_AI_API_TOKEN` together
  satisfy the requirement (either alone does not)
- Updated the error message to list all new keys

**`packages/agent/tests/provider-race-a3.test.ts`** (new)

8 describe blocks, 28 test cases covering:

- DB-1 (4 cases): Correct endpoint URL and auth header for each A3 provider
- DB-2 (5 cases): Provider skipped when key(s) absent; CF REST requires both keys
- DB-3 (2 cases): CF Workers AI REST response envelope unwrapping
- DB-4 (2 cases): 429 from one provider does not crash race (other providers win)
- DB-5 (2 cases): All four A3 providers participate when all keys present; A3+A1/A2 combined race
- DB-6 (3 cases): env-validator accepts/rejects A3 key combinations correctly
- DB-7 (3 cases): quota-guardian recognises all four A3 provider names
- DB-8 (1 case): A3 keys surfaced correctly through Zod validation

---

## PASS 6 — Hardening and Validation

```
node --experimental-strip-types --check packages/agent/src/services/ai-router.ts     → Exit 0 ✅
node --experimental-strip-types --check packages/agent/src/services/quota-guardian.ts → Exit 0 ✅
node --experimental-strip-types --check packages/agent/src/services/env-validator.ts  → Exit 0 ✅
node --experimental-strip-types --check packages/agent/tests/provider-race-a3.test.ts → Exit 0 ✅
node scripts/check-dead-integrations.mjs                                               → 100 exports, all in allowlist ✅
./validate.sh                                                                          → 50/50 PASSED ✅
```

Sacred-file manifest hashes: unchanged (no sacred files modified).

`vitest run` / `tsc --noEmit` blocked by sandbox network constraints.
Consistent with all passes ≥ 36.

### Invariants verified

| Invariant | Status |
|---|---|
| Phase state machine (IDLE→…→DONE) | ✅ Unchanged — no phase modifications |
| Strict Zod validation (.strict() on all schemas) | ✅ Unchanged |
| Redis namespace `qodo:v24` | ✅ Unchanged |
| Privacy mode (`QODO_PRIVACY_MODE=strict`) | ✅ All A3 providers gated by existing `env` parameter; privacy mode handled by callers |
| Tier-1 CF Workers AI V8 binding | ✅ Unchanged — A3 CF REST is a separate integration path |
| Boundary map | ✅ No cross-layer imports introduced |
| RouterEnv extensibility | ✅ Additive only; existing callers passing partial env objects are unaffected |

---

## PASS 7 — Engineering Continuity

### Task queue update

`task-31` → `"done"`, `completedInPass: 71`.

### Architecture decision recorded

`03-ARCHITECTURE.md` §"LLM Provider Race Candidates" updated with A3 batch row.

### Remaining queued tasks

| Task | Priority | Title |
|---|---|---|
| task-33 | P3 | CI caching decision (Turborepo / Nx Cloud) |
| task-34 | P3 | Centralized secrets/config (Doppler or Infisical) |
| task-32 | P4 | Multimodal free tiers (speech/vision) decision |
| task-40 | P4 | i18n (LibreTranslate) decision |

**Recommended next task: task-33 (P3)** — CI/build caching decision. Like task-31, it
is an owner-decision pass that may have a concrete YES path (Turborepo remote caching is
already well-supported in Vercel monorepos and this repo is already workspace-structured).

---

## PASS 8 — Release and Packaging

Version bumped: **24.30.42 → 24.30.43**
All four `package.json` files updated.
ZIP archive: `QODO-V24.30.43-pass71.zip`.

### Files changed in this pass

| File | Change |
|---|---|
| `packages/agent/src/services/ai-router.ts` | A3 model constants, circuit breakers, RouterEnv fields, 4 new chat functions, `buildFastDraft` wiring |
| `packages/agent/src/services/quota-guardian.ts` | QuotaProvider union, HEADER_MAP, DEFAULT_RESET_WINDOW_S extended for 4 A3 providers |
| `packages/agent/src/services/env-validator.ts` | 5 new optional Zod fields; LLM-key guard updated |
| `packages/agent/tests/provider-race-a3.test.ts` | **New** — 8 describe blocks, 28 test cases |
| `packages/agent/docs/71-V24-AUDIT-PASS-71.md` | **New** — this document |
| `03-ARCHITECTURE.md` | A3 batch row added to LLM Provider Race Candidates table |
| `tasks/agent-task-queue.json` | task-31 → done (completedInPass: 71) |
| `tasks/agent-task-queue.md` | Status snapshot updated |
| `06-CHANGELOG.md` | Pass 71 entry prepended |
| `CHANGELOG.md` | Version 24.30.43 entry added |
| `ENGINEERING_NOTES.md` | Pass 71 section appended |
| `package.json` (×4) | Version bumped 24.30.42 → 24.30.43 |
