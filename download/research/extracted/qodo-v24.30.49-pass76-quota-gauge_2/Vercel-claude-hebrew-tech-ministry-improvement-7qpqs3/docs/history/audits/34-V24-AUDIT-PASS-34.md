# QODO-V24 Audit — Pass 34

**Version:** `24.28.0`
**Previous:** `24.27.0` / `24.25.0` (patched baseline)
**Date:** 2026-07-06
**Theme:** Kill-switch wiring, model-deprecation watchdog, type-safe env across all call sites, full Pass-33 patch application.

---

## Executive Summary

Pass 34 applied all six patches from the Claude Pass-33 session
(`qodo-v24-patched.zip`) to the QODO-V24.27.0 baseline, completed the one
item Claude explicitly deferred (`kill-switch.ts` wiring into `cli.ts`),
added the model-deprecation watchdog recommended in the Brutal Audit §7,
and fixed the Pass-26 typed-env regression that was silently reverted in the
patched tree.

**Zero new dependencies.** All changes are additive or corrective.

---

## Changes Applied

### Pass-33 Patches (from `qodo-v24-patched.zip`)

| # | File | Change |
|---|------|--------|
| P33-1 | `src/services/ai-router.ts` | `GROQ_FAST/GROQ_HEAVY` → `openai/gpt-oss-20b` / `openai/gpt-oss-120b` |
| P33-2 | `src/services/cost-tracker.ts` | Updated pricing table with 2026-07 Groq rates; legacy rows kept for historical cost-ledger lookups |
| P33-3 | `src/validators/path-guard-scoped.ts` | `path.resolve()` against fixed virtual root replaces raw-string `startsWith` — closes path-traversal escape (audit §2.2) |
| P33-4 | `src/validators/secret-guard.ts` | Added Stripe, Slack token+webhook, SendGrid, Twilio, Google API key, PEM block patterns (audit §2.3); documented known bypass limitation |
| P33-5 | `src/services/kill-switch.ts` | **New** — `assertNotHalted()`, `isHalted()`, `PipelineHaltedError` |
| P33-6 | `scripts/check-dead-integrations.mjs` | **New** — CI linter that flags exported symbols with no external caller |
| P33-7 | `tests/kill-switch.test.ts` | **New** — 5 tests for kill-switch unit behaviour |
| P33-8 | `tests/secret-guard.test.ts` | **New** — 9 tests (original 5 patterns + 6 new patterns + documented bypass) |
| P33-9 | `tests/path-guard-scoped.test.ts` | 5 traversal regression tests added |

### Pass-34 Additions (this pass)

| # | File | Change |
|---|------|--------|
| P34-1 | `src/cli.ts` | `kill-switch.ts` wired at **startup** and at **6 phase entry points**: architect, coder, gate, commit, merge, reviewer — `assertNotHalted(env)` before each |
| P34-2 | `src/cli.ts` | `model-deprecation-watchdog.ts` called at startup (`void checkModelDeprecations(env)`) |
| P34-3 | `src/cli.ts` | **Pass-26 typed-env fix restored**: integration startup log now uses `env.SLACK_WEBHOOK_URL`, `env.SENTRY_AUTH_TOKEN`, etc. (not raw `process.env.*`) — this was silently reverted in the patched baseline |
| P34-4 | `src/services/model-deprecation-watchdog.ts` | **New** — async watchdog that queries each provider's `/v1/models` endpoint at startup and emits `model-deprecation-warning` logs for any model absent from the live catalogue; caches per-process; fails open on network errors |
| P34-5 | `tests/model-deprecation-watchdog.test.ts` | **New** — 6 tests covering: all-present, missing model, 403, network error, no-key skip, cache dedup |
| P34-6 | `tests/integrations/pass-34-pipeline-halt.test.ts` | **New** — 8 tests documenting the kill-switch phase-guard contract and PipelineHaltedError identity |
| P34-7 | `package.json` (root + `packages/agent`) | Version `24.20.0` / `24.25.0` → `24.28.0` |
| P34-8 | `packages/agent/docs/34-V24-AUDIT-PASS-34.md` | This audit document |

---

## Kill-Switch Coverage Map

```
runPipeline()
 ├─ startup           → assertNotHalted(env)   [before any I/O]
 ├─ phase: architect  → assertNotHalted(env)   [before LLM spend]
 ├─ phase: coder      → assertNotHalted(env)   [before file writes]
 ├─ phase: gate       → assertNotHalted(env)   [before validators]
 ├─ phase: commit     → assertNotHalted(env)   [before git write]
 ├─ phase: merge      → assertNotHalted(env)   [before irreversible merge]
 └─ phase: reviewer   → assertNotHalted(env)   [before reviewer LLM call]
```

Setting `QODO_HALT=true` (or `QODO_HALT=1`) in the environment stops the
pipeline at the next phase boundary. `QODO_HALT_REASON` is included in the
thrown error for log correlation.

---

## Model-Deprecation Watchdog

The watchdog calls `/v1/models` on each configured provider at startup.
It emits a `model-deprecation-warning` structured log for any model in
`ROUTER_MODELS` that is absent from the live catalogue, then continues.
It never blocks the pipeline.

**Monitored models:**

| Provider | Fast model | Heavy model |
|----------|-----------|-------------|
| Groq | `openai/gpt-oss-20b` | `openai/gpt-oss-120b` |
| Cerebras | `llama3.1-8b` | `llama-3.3-70b` |
| Mistral | `mistral-small-latest` | `mistral-large-latest` |

Wire a log-based alerting rule on `model-deprecation-warning` in your
observability stack (Axiom, Datadog, Sentry) to get advance notice before
the next deprecation causes production failures.

---

## Validation

```bash
# JS/TS syntax (no node_modules needed):
node --check packages/agent/worker/webhook-receiver.js
node packages/agent/scripts/check-dead-integrations.mjs  # expects flagged list — see below

# With node_modules:
cd packages/agent
npx vitest run tests/kill-switch.test.ts
npx vitest run tests/secret-guard.test.ts
npx vitest run tests/path-guard-scoped.test.ts
npx vitest run tests/model-deprecation-watchdog.test.ts
npx vitest run tests/integrations/pass-34-pipeline-halt.test.ts
npx vitest run  # full suite
```

**`check-dead-integrations.mjs` expected output:** The script will flag
~90+ exports. This is the known baseline documented in Pass 33. The number
should not grow between passes without a corresponding CHANGELOG entry
explaining what new exported-but-unwired code was added and why.

---

## System Invariants Preserved

All 10 system invariants from `04-SYSTEM-INVARIANTS.md` are preserved:

- **Fail-safe defaults** — kill-switch fails closed (stops on halt); watchdog fails open (never blocks).
- **No new mandatory dependencies** — all new features degrade gracefully without network or Redis.
- **Redis namespace** — no new Redis keys introduced in this pass.
- **Privacy mode** — watchdog logs only provider name and model ID (public information).

---

## Next Recommended Pass (Pass 35)

1. **End-to-end integration test** — `runPipeline()` with a fully mocked
   `GitHubClient` and `RedisState`, verifying that `QODO_HALT=true` stops
   the pipeline before any `gh.*` call. This test would have caught the
   Pass-26 typed-env regression automatically.
2. **Alerting rule for `model-deprecation-warning`** — wire the watchdog
   log event to a real alerting channel (Slack/PagerDuty) so the team is
   notified before a deprecation hits production.
3. **`check-dead-integrations.mjs` triage** — work through the ~90 flagged
   exports and either wire them into the pipeline, mark them as test-only
   (add to an allowlist), or remove them. Target: 0 unaccounted flags.
4. **Red-team against secret-guard** — run `red-team.ts` explicitly against
   `secret-guard.ts` as recommended in audit §2.3 and document the bypass
   findings as a formal test case.
