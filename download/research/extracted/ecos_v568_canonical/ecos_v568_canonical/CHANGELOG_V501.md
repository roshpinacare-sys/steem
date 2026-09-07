# Changelog — V501 — Governance-Backed Heartbeat State 💎🫀

**Release:** ECOS V501 · 2026-06-05 · AI lead (Opus 4.8)

## What was identified (a real, silent bug)
The V465 heartbeat is wired into the server, but its state provider tried to call methods that
DON'T EXIST — `creditReserve268.health()` and `proofOfSolvency403.surplus()` — caught the errors,
and fell back to a CONSTANT `healthScore = 70` on every beat. So the heartbeat's learning engine
was fed a flat line: it "ran" but learned nothing real. The scheduler existed; its blood was fake.

## What was connected (rule #2: connection > addition)
`heartbeatGovernanceState501.governanceSystemState501(ctx)` — an async getSystemState() (the exact
contract diamondHeartbeat465 expects) backed by the unified governance cycle (V499). Each beat now
returns REAL { healthScore, posture, proposals } reflecting actual economy + code health. Wired a
governance-backed heartbeat using the EXISTING heartbeat465 class — no new scheduler, no new timer.

## Measured
Old provider: healthScore = 70 (constant). New provider: healthScore = 92 nominal / drops under
stress, posture nominal→protect, real proposal counts. The existing heartbeat465 class, driven by
this provider, fires beats and the V462 engine accumulates a TRUE signal history.

## Boundedness
Propose-only every beat (never executes). The heartbeat interval is unref'd (won't hold the
process). Existing V465 endpoints untouched (addition only).

## Endpoints
- `GET  /api/v1/diamond/heartbeat/governance-state` [T01] — one real state read
- `POST /api/v1/diamond/heartbeat/governance-start|stop` [T02]
- `GET  /api/v1/diamond/heartbeat/governance-status` [T03]
- `GET  /api/v1/admin/summary/v501` [T04]

## Verification
- `node --check` clean; `tests/v501.test.js` all pass — real (non-70) healthScore, emergency posture,
  signals-as-function, fail-closed without orchestrator, drives heartbeat465 + engine learns, no-new-scheduler guard, wiring.
- Sacred unchanged (R1). Zero new npm deps (R3/R6).

## Impact
The sovereign operator's heartbeat now beats on real cognition: each beat sees true economy+code
health and learns from it. The autonomy loop is genuine, not a placeholder.

## Breaking changes
None. Reuses heartbeat465 + V499; existing wiring untouched.
