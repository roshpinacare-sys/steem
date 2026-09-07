# ECOS AI Protocol — V219
**Version:** 219.0.0 | **Phase:** P106 | **Date:** 2026-05-31 | **Status:** Active

---

## Purpose

This document defines the canonical AI operating protocol for ECOS V219.
It extends AI_PROTOCOL_V218.md with V219-specific contracts, rules, and constraints.

---

## 1. Immutable Rules (All Versions)

| Rule | Description |
|------|-------------|
| R1 | Sacred files (`src/lib/fiatLedger.js`, `src/lib/auditLog.js`) MUST NOT be modified. MD5-verify at session start. |
| R2 | All identifiers introduced in a version MUST be suffixed with the version number (e.g., `req219a`). |
| R3 | Zero new npm dependencies. All logic uses Node.js built-ins or in-memory data structures. |
| R4 | All test exports go into the single `if (process.env.NODE_ENV === 'test')` block. |
| R5 | Version bump: `package.json` `version` field increments on each canonical ZIP. |
| R6 | No existing endpoints may be removed. |
| R7 | Do not create a new store if an existing one already serves the same purpose. |

---

## 2. V219-Specific Protocol

### 2.1 Workspace Health Score Contract

- Source: `_eventLog181` (inherited, read-only). Stateless.
- Filter: events where `event.workspaceId === workspaceId`.
- `activity_score`: count of distinct calendar days (by `Math.floor(ts/86400000)`) with ≥1 event in the last 30 days, divided by 30. Range [0,1].
- `task_score`: `task_completed_count / task_created_count` (0 if `task_created_count === 0`).
- `treasury_score`: 1.0 if `(inflow - outflow) >= 0`, else 0.5. Missing/non-numeric `amount` treated as 0.
- `health_score = 0.4 × activity_score + 0.4 × task_score + 0.2 × treasury_score`, rounded to 4 decimal places.
- If no events for workspace at all: all scores = 0, `health_score = 0`.
- Response: `{ workspaceId, health_score, components: { activity_score, task_score, treasury_score }, computed_at: timestamp }`.

### 2.2 Validator Performance Index Contract

- Sources: `_scoreHistory218` (inherited, read-only) + `_eventLog181` (inherited, read-only). Stateless.
- `score_avg`: mean of all `score` values for `${workspaceId}:${uid}` key in `_scoreHistory218` (0 if no snapshots).
- `score_trend_delta`: `last_score - first_score` when sorted ascending by timestamp (0 if fewer than 2 snapshots).
- `activity_30d`: count of events in `_eventLog181` where `(evt.uid === uid || evt.userId === uid)` AND `evt.timestamp >= Date.now() - 30 * 86400000`.
- `clamp(v, lo, hi) = Math.max(lo, Math.min(hi, v))`.
- `performance_index = 0.5 × score_avg + 0.3 × clamp(score_trend_delta + 0.5, 0, 1) + 0.2 × clamp(activity_30d / 100, 0, 1)`, rounded to 4 decimal places.
- Response: `{ workspaceId, uid, performance_index, components: { score_avg, score_trend_delta, activity_30d }, computed_at: timestamp }`.

### 2.3 Batch Workspace Summary Contract

- Source: `_eventLog181` (inherited, read-only). Stateless.
- Request body: `{ workspace_ids: [string] }`.
- `workspace_ids` field required and must be an array; else HTTP 400.
- Empty array → HTTP 200 `{ count: 0, summaries: [] }`.
- More than `BATCH_SUMMARY_MAX_219 = 20` items → HTTP 400.
- Per workspace: `{ workspaceId, event_count, last_event_ts: number|null, has_treasury_activity: boolean }`.
  - `last_event_ts`: maximum numeric `timestamp` among events for that workspace (null if none).
  - `has_treasury_activity`: true if any event has `type === 'treasury_deposit'` or `type === 'treasury_withdrawal'`.
- Response: `{ count: N, summaries: [...] }`.

### 2.4 Score Percentile Contract

- Source: `_scoreHistory218` (inherited, read-only). Stateless.
- Collect all keys in `_scoreHistory218` that start with `${workspaceId}:`.
- For each such validator key, take the entry with the maximum `timestamp` as the "latest score".
- `validators_in_workspace`: count of validators with at least one snapshot in the workspace.
- If `uid` has no snapshots in workspace: `latest_score: null, percentile: null`.
- If workspace has no validators at all: `validators_in_workspace: 0, percentile: null`.
- `percentile = (count of validators with latest_score ≤ uid_latest_score) / validators_in_workspace × 100`, rounded to 1 decimal place.
- Response: `{ workspaceId, uid, latest_score: number|null, percentile: number|null, validators_in_workspace: number }`.

### 2.5 Event Stream Replay Window Contract

- Source: `_eventLog181` (inherited, read-only). Stateless.
- Query params: `from` (default: `Date.now() - 86400000`), `to` (default: `Date.now()`), `type` (default: all).
- Filter: `evt.workspaceId === workspaceId` AND `evt.timestamp >= from` AND `evt.timestamp <= to` AND (type matches if specified).
- Sort results descending by timestamp; slice to at most `REPLAY_MAX_EVENTS_219 = 500`.
- Response: `{ workspaceId, from, to, type: typeFilter || '*', event_count: N, events: [...] }`.

---

## 3. Endpoint Naming (V219)

All V219 endpoints follow the established pattern:
- Variable names: `req219<letter>`, `res219<letter>`, `err219<letter>`.
- Sequential: `a` = T01, `b` = T02, `c` = T03, `d` = T04, `e` = T05, `z` = admin.

---

## 4. In-Memory Stores (V219)

V219 adds **zero new stores**. All five endpoints are stateless reads of inherited stores.

| Store Read | Variable | Introduced |
|------------|----------|------------|
| Health Score, Batch Summary, Event Replay | `_eventLog181` | V181 |
| Performance Index, Score Percentile | `_scoreHistory218` | V218 |
| Performance Index | `_eventLog181` | V181 |

---

## 5. Inherited Contracts

All V218 contracts remain active:
- Validator Score History (`_scoreHistory218`, max 8,000)
- Score Trend (read-only)
- Treasury Flow Summary (reads `_eventLog181`)
- Governance Proposal Tally (stateless)
- Member Activity Window (reads `_eventLog181`)

All V217 contracts remain active:
- Validator Leaderboard Snapshots (`_leaderboardSnapshots217`, max 5,000)
- Leaderboard History (read-only)
- Task Completion Rate (reads `_eventLog181`)
- Reputation Decay Simulation (stateless)
- Batch Sybil Check (reads `_attestations212` + `_eventLog181`)

All V216 contracts remain active:
- Task Reputation Snapshots (`_repSnapshots216`, max 10,000)
- Snapshot Diff (read-only)
- Task Activity Heatmap (reads `_eventLog181`)
- Escrow Expiry Sweep (mutates `_escrows215`)
- Onboarding Funnel Analytics (reads `_onboardLog215`)

All V215 contracts remain active:
- Agent Micro-Escrow (`_escrows215`, ESCROW_MAX_215 = 20,000)
- Sybil Resistance Score (on-demand)
- Onboarding Funnel Log (`_onboardLog215`, ring 5,000)

All V212 contracts remain active:
- Validator Pool Staking (POOL_MIN_REP_212, POOL_MAX_MEMBERS_212, etc.)
- Proof Attestation (ATTEST_MAX_212 = 10,000)
- Calibration Routing (DEFAULT_AUTO_THRESH_212 = 0.70)
- Reputation Decay Insurance (INSURANCE_RATE_PER_DAY_212 = 0.001)
- Governance Execution (EXEC_QUORUM_PCT_212 = 0.51)
- Multi-Round Consensus (ROUND_MIN_VALIDATORS_212 = 3)
