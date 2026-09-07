# QODO-V24 Audit — Pass 22

**Version:** `24.23.0`  
**Previous:** `24.22.0`  
**Date:** 2026-07-06  
**Theme:** Pre-flight cost gate, quota headroom ranking, webhook completeness.

## Summary

Pass 22 synthesised 3 new design files against the existing v24.22.0 codebase,
identified exactly what was missing, and applied the smallest correct set of
changes to close those gaps.

### Design files analysed

| File | Status on arrival | Gap found |
|------|-------------------|-----------|
| `preflight-estimator.ts` | **Not present** in codebase | Entire new service |
| `quota-guardian.ts` | Present (functional API, Pass 20) | `rankByHeadroom()` + `hasComfortableHeadroom()` missing |
| `webhook-receiver.js` | Present (Pass 20, B1) | `issue_comment` + `check_suite` handlers missing; single-path dispatch only |

---

## Files Changed

### New Files

| File | Purpose |
|------|---------|
| `src/services/preflight-estimator.ts` | Pre-flight cost + risk estimate, posted as PR comment before architect runs |
| `tests/integrations/pass-22-preflight-quota-webhook.test.ts` | 30+ regression tests covering all 3 new surfaces |

### Modified Files

| File | Change |
|------|--------|
| `src/services/quota-guardian.ts` | Added `rankByHeadroom()` and `hasComfortableHeadroom()`; fixed pre-existing `set→setWithTTL` and `null→undefined` type errors |
| `worker/webhook-receiver.js` | Added `handleIssueComment()` (routes `/qodo proceed`, `/qodo cancel`, `@qodo` mentions) and `handleCheckSuite()` (re-triggers on CI failure); unified `dispatchTask()` to try Options A/B/C in order |
| `src/cli.ts` | Wired `postPreflightComment` before architect; added `preflight_hold` phase resume path; calls `recordPreflightOutcome` on success and failure |
| `src/types/run-state.ts` | Added `"preflight_hold"` to `Phase` union |
| `package.json` | Version `24.22.0` → `24.23.0` |

---

## Architecture Notes

### preflight-estimator.ts

- **Zero new infra:** uses `RedisState` (`setWithTTL` for TTL-bearing history) and `GitHubClient.comment()`.
- **Best-effort:** every external call wrapped in `.catch()`; failures never block the pipeline.
- **Privacy guard:** PR comment skipped when `QODO_PRIVACY_MODE=strict`.
- **Rolling stats:** keyed by `RiskTier`; swap `getHistoricalStats()` internals for embedding nearest-neighbour once enough run history exists.
- **Pause protocol:** `confirm_before_proceeding` sets `phase = preflight_hold` in Redis; a `/qodo proceed` webhook event (now handled by `webhook-receiver.js`) resets to `idle` and continues.

### quota-guardian.ts additions

- `rankByHeadroom(providers, state)` — scores each provider by `requestsRemaining` (unknown=500 optimistic); sort descending. Used by `ai-router.ts` racing logic to dispatch to the provider with most room first.
- `hasComfortableHeadroom(provider, assumedLimit, state, threshold=0.1)` — batch planning check; returns `false` when remaining fraction < threshold. Prevents fanning 30 architect calls onto a provider at 3% remaining.

### webhook-receiver.js additions

- `handleIssueComment` — routes `/qodo proceed` → `pipeline_resume`, `/qodo cancel` → `pipeline_cancel`, `@qodo <text>` → `pipeline_trigger` with `objectiveOverride`.
- `handleCheckSuite` — triggers `pipeline_trigger` on `check_suite.completed` with `conclusion=failure`.
- `dispatchTask` — now tries Option A (Qodo dispatch endpoint) → Option B (Upstash Redis LPUSH) → Option C (GitHub Actions `workflow_dispatch`) in sequence, logging but not throwing on individual option failures.

---

## Validation

- `npx tsc --noEmit` passes with **zero new errors** introduced by Pass 22.
- Pre-existing baseline errors (`d1-history.ts`, `blame-sentry-bridge.ts`, `github-actions-flaky.ts`, `rationale-bank.ts`) are unchanged from v24.22.0.

---

## Next Recommended Pass (Pass 23)

1. **Fix pre-existing baseline TS errors** (`d1-history`, `blame-sentry-bridge`, `github-actions-flaky`, `rationale-bank`) — one-time housekeeping pass.
2. **Q2 — Availability-aware notification routing** — check reviewer calendar before @-pinging; prevents trust erosion from noisy pings.
3. **W1 — Slack/calendar identity** — make the agent an @-mentionable Slack user with availability state.
4. **M1 — Sandboxed real execution as Gate 0** + PII scanner.
5. **U1/U2 — Forecast engine + Janitor pre-emptive refactors**.
