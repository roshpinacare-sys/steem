# QODO V24 — Audit Pass 76
**Version:** 24.30.49
**Date:** 2026-07-12
**Protocol:** CIEP-X v10.0
**Task:** task-47 — Per-provider free-tier quota-gauge tracking + exhaustion alerting
**Type:** Code pass — two non-sacred files extended, one non-sacred bug fixed, one new test file. Zero sacred files touched.
**Baseline:** 24.30.48

---

## PASS 1 — Think before executing

task-47's own note explicitly instructed: before building the literal
`EnergyQuotaState`/`QuotaGauge` structure described in cost-ledger.ts,
check whether an existing rate-limiter primitive already gets the same
alerting value with less new surface area.

`utils/rate-limiter.ts` (the only other file with "rate" in its name) is
just a batching/jitter helper — no persisted state, no reset windows, not
a match. But tracing `recordQuotaFromHeaders` (referenced in `ai-router.ts`
but not obviously named in the task) led to `services/quota-guardian.ts`:
a mature, already-tested, header-driven live quota tracker covering 13
providers, already used by `ai-router.ts` for provider selection
(`filterByHeadroom`, `rankByHeadroom`). This is a *better* foundation than
the task's own literal ask — it reads real remaining-quota numbers
straight from provider response headers as they happen, rather than a
second, separately-maintained structure with hardcoded limits that would
drift out of date the moment a provider changed its free tier (which,
per a same-day web search, several providers' free tiers have — published
Groq limits alone vary across sources checked in July 2026, from 1,000 to
14,400 RPD depending on model and source).

**Decision:** extend `quota-guardian.ts` — add the one thing it didn't
have (a *limit*, so "remaining" becomes a percentage) — rather than build
a parallel EnergyQuotaState in `cost-ledger.ts` that would duplicate live
data with static numbers pulled from web searches that will be stale
within months. This is exactly the "reuse, don't duplicate" instruction
the task itself pointed at.

**A real, pre-existing bug found while tracing, not assumed away:** every
entry in `HEADER_MAP` maps `requests` to a *remaining*-count header — except
`openrouter`, whose `requests` field read `x-ratelimit-limit-requests`
(the LIMIT header) straight into the slot every downstream function
(`hasHeadroom`, `rankByHeadroom`) treats as REMAINING. Since a limit
doesn't count down, OpenRouter would always have looked like it had full
headroom, no matter how close to actually exhausted it was. Fixed as part
of this pass — it's the same header table this task needed to touch
anyway, and leaving a known-wrong entry in place while adding a `Limit`
sibling field next to it would have been worse than fixing it.

---

## PASS 2 — Implementation

| File | Change |
|---|---|
| `packages/agent/src/services/quota-guardian.ts` | Added optional `requestsLimit`/`tokensLimit` to `QuotaSnapshot` (optional, not required — keeps every pre-existing `QuotaSnapshot` literal in `quota-guardian.test.ts` compiling unchanged). Extended `HEADER_MAP` with limit-header capture for `groq` (both confirmed via `console.groq.com/docs/rate-limits`) and `openrouter`, and **fixed** `openrouter`'s `requests` field (was reading the limit header). Added `quotaPercentUsed()`, `isNearExhaustion()`, and `getQuotaHealthReport()` — the task's literal "alert on about to exhaust quota" ask. `markProviderExhausted` updated to satisfy the extended (but optional) type. |
| `packages/agent/src/services/preflight-estimator.ts` | New `PRIMARY_QUOTA_PROVIDERS` (groq, openrouter — deliberately short, not every tracked provider, to avoid PR-comment noise). `estimatePreflight()` now checks quota health best-effort, appends a `⚠️` fragment to `summaryLine` when a primary provider is near exhaustion, escalates `recommendation` from `proceed` to `proceed_with_caution` (not `confirm_before_proceeding` — `ai-router.ts` already routes around an exhausted provider automatically; this is visibility, not a hard stop), and adds an optional `quotaWarning` field to `PreflightEstimate`. |
| `packages/agent/tests/quota-health.test.ts` *(new)* | `quotaPercentUsed`/`isNearExhaustion` unit tests including the 90% boundary and the `markProviderExhausted`-with-unknown-limit case; `getQuotaHealthReport` integration test; a dedicated regression test for the openrouter header-mapping fix. |

No sacred file was touched this pass — confirmed by checking
`.sacred-manifest.json`'s file list before starting, not assumed.

---

## PASS 3 — Verification

**Honestly reported, same standing rule as Pass 74/75:** no network in
this sandbox, so `npm install`/`vitest`/the project's pinned `tsc` still
cannot run.

**What WAS done for real this pass:**

1. Every assertion in `quota-health.test.ts` (19 cases: `quotaPercentUsed`
   at 0%/50%/89%/90%-boundary/exhausted-with-unknown-limit/null-input,
   `isNearExhaustion` at the same boundaries plus a custom-threshold case,
   `getQuotaHealthReport`'s per-provider null-safety, and the openrouter
   fix scenario) was executed for real with plain `node` against the exact
   algorithm as written in `quota-guardian.ts` — not a paraphrase of it.
   All 19 passed.
2. The same differential-typecheck method from Pass 75 (global `tsc`
   v6.0.3, baseline `src` tree vs. this pass's tree, both missing
   `@types/node` identically) was re-run. The cumulative diff against the
   original Pass-74 baseline shows the same three `relay-lineage.ts` lines
   from Pass 75 (expected, unchanged) and otherwise only line-number shifts
   in files edited in earlier passes. **Neither `quota-guardian.ts` nor
   `preflight-estimator.ts` appears anywhere in either error list** — zero
   errors, old or new, in the two files this pass actually changed.

**Not executed / left for the next hop with network access:**
- `npm test -w @qodo/agent` — `quota-health.test.ts` and the pre-existing
  `quota-guardian.test.ts` (to confirm the new optional fields don't
  disturb its existing literals as intended) were written and hand-traced
  but not run under real `vitest`.
- `npm run typecheck` against the project's own pinned compiler and real
  `node_modules`.
- A live run against a real provider response, to confirm the corrected
  `openrouter` header name actually matches what OpenRouter sends today
  (the fix corrects an internal inconsistency proven by code inspection;
  it has not been checked against a live OpenRouter response in this pass).

---

## PASS 4 — Rollback

Additive except for the two-line `openrouter` `HEADER_MAP` fix (which
replaces a value already known to be wrong with the correct one — reverting
it restores the bug, not a working prior state, so rollback here means
"revert to Pass 75," not "revert this one line"). `requestsLimit`/
`tokensLimit` being optional means no other file needs to change either
way. Deleting `quota-health.test.ts` and reverting `preflight-estimator.ts`
to drop `quotaWarning` fully reverts the rest.
