# QODO-V24 Audit — Pass 23

**Version:** `24.24.0`
**Previous:** `24.23.0`
**Date:** 2026-07-06
**Theme:** Eliminate all pre-existing TypeScript compilation errors — clean compile baseline.

---

## Summary

Pass 23 completed a focused correctness pass, resolving all 6 pre-existing TypeScript
compilation errors that had accumulated across Passes 1–22. The repository now compiles
with **zero errors** (`npx tsc --noEmit` exits 0).

No new features were introduced. No architecture was changed. Blast radius was minimal:
4 files, 6 call sites.

---

## Root Cause

All 6 errors shared the same underlying cause: callers were passing `(key, value, ttlSec)`
to `RedisState.set()`, but that method only accepts 2 arguments `(key, value)`. The TTL
variant is `RedisState.setWithTTL(key, value, ttlSec)`. The same fix was already applied
to `quota-guardian.ts` and `preflight-estimator.ts` in Pass 22; Pass 23 completes that
cleanup for the remaining 4 files.

A sixth error — `Cannot find name 'GitBlameRiskEntry'` — was a stale type alias referencing
a name that never existed in `git-blame-risk.ts`. The correct type (`FileRiskBonus`) was
already imported in the same file; the variable declaration simply needed to be updated.

---

## Files Changed

| File | Line(s) | Change |
|------|---------|--------|
| `src/services/d1-history.ts` | 103, 112 | `state.set(k, v, ttl)` → `state.setWithTTL(k, v, ttl)` |
| `src/services/integrations/blame-sentry-bridge.ts` | 97 | `GitBlameRiskEntry` → `FileRiskBonus` (already imported) |
| `src/services/integrations/github-actions-flaky.ts` | 142 | `state.set(k, v, ttl)` → `state.setWithTTL(k, v, ttl)` |
| `src/services/rationale-bank.ts` | 84, 89 | `state.set(k, v, ttl)` → `state.setWithTTL(k, v, ttl)` |
| `package.json` | — | Version `24.23.0` → `24.24.0` |

---

## Validation

```
npx tsc --noEmit
# exit 0 — no errors
```

**Before Pass 23:** 6 errors across 4 files.
**After Pass 23:** 0 errors.

---

## Architectural Notes

- `RedisState.set(key, value)` — 2-argument form, no TTL (key persists until explicit delete).
- `RedisState.setWithTTL(key, value, ttlSec)` — 3-argument form, used for all ephemeral data.
- `RedisState.setJSON(key, value, ttlSec?)` — JSON-serialising wrapper; `ttlSec` optional (3 args accepted).
- All TTL-bearing Redis writes in the codebase now uniformly use `setWithTTL` or `setJSON`.

---

## Next Recommended Pass (Pass 24)

1. **Q2 — Availability-aware reviewer notification** — check reviewer calendar/timezone before @-pinging to avoid trust erosion from noisy off-hours pings.
2. **W1 — Slack/calendar identity bridge** — make the agent an @-mentionable Slack user with live availability state.
3. **M1 — Sandboxed real execution as Gate 0** + PII scanner before LLM spend.
4. **U1/U2 — Forecast engine + Janitor pre-emptive refactors** — proactive tech-debt harvesting.
