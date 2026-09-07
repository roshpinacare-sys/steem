# Changelog — V500 — Learning Governance Tick 💎⏱️ (the missing beat)

**Release:** ECOS V500 · 2026-06-05 · AI lead (Opus 4.8) — milestone

## Why (connection > addition; rule #2 honored)
Triage found the system ALREADY has heartbeats (`diamondHeartbeat454`, `diamondHeartbeat465`,
both wired). Building a third would be the exact parallel-duplication we fight. But neither
heartbeat ran the unified governance cycle (V499) or fed the learning engine (V462) — so the
operator's "heartbeat" never exercised the full economy+code loop and never improved over time.
V500 supplies the missing piece: not a scheduler, but the ACTION a beat performs.

## Feature — `governanceTick500` (src/lib + lib mirror)
`governanceTick500(signals, ctx)`:
1. runs one unified governance cycle (V499) — economy + code, **always propose-only on a beat**.
2. ingests the cycle's cognition into the V462 engine (rolling memory across beats).
3. computes trends/foresight across accumulated beats.
4. records a compact `diamond.governance_tick` audit event.
No timer, no competing heartbeat class — any scheduler (the existing heartbeats included) drives it.

## Boundedness (verified)
A beat NEVER auto-executes — even if `ctx.authorized` is passed, the tick forces propose-only.
A solvency emergency surfaces as `protect` posture but still only proposes. Fail-closed without
an orchestrator.

## Verification
- `node --check` clean; `tests/v500.test.js` all pass — ingest+memory growth, propose-only-always,
  emergency-still-proposes, audit event, recordHistory toggle, fail-closed, no-timer guard, wiring.
- Sacred unchanged (R1). Zero new npm deps (R3/R6).

## Endpoints
- `POST /api/v1/diamond/governance-tick` [T01] — run one learning beat
- `GET  /api/v1/diamond/heartbeat-trends` [T02] — trends accumulated across beats
- `GET  /api/v1/admin/summary/v500` [T03]

## Impact (V500 milestone)
The sovereign operator now has a TRUE heartbeat: each beat sees economy + code, proposes safely,
and learns — autonomy that improves over time, bounded by the unbreakable base. The Diamond arc
(V453→V500) is a complete, self-managing, self-learning, self-bounded operator.

## Breaking changes
None. Additive; reuses V499 + V462; no third heartbeat introduced.
