# ECOS AI Protocol — V217
**Version:** 217.0.0 | **Phase:** P104 | **Date:** 2026-05-31 | **Status:** Active

---

## Purpose

This document defines the canonical AI operating protocol for ECOS V217.
It extends AI_PROTOCOL_V216.md with V217-specific contracts, rules, and constraints.

---

## 1. Immutable Rules (All Versions)

| Rule | Description |
|------|-------------|
| R1 | Sacred files (`src/lib/fiatLedger.js`, `src/lib/auditLog.js`) MUST NOT be modified. MD5-verify at session start. |
| R2 | All identifiers introduced in a version MUST be suffixed with the version number (e.g., `_leaderboardSnapshots217`). |
| R3 | Zero new npm dependencies. All logic uses Node.js built-ins or in-memory data structures. |
| R4 | All test exports go into the single `if (process.env.NODE_ENV === 'test')` block. |
| R5 | Version bump: `package.json` `version` field increments on each canonical ZIP. |
| R6 | No existing endpoints may be removed. |
| R7 | Do not create a new store if an existing one already serves the same purpose. |

---

## 2. V217-Specific Protocol

### 2.1 Validator Leaderboard Snapshot Contract

- Store: `_leaderboardSnapshots217` (Map, key=workspaceId, value=array of snapshots).
- Ring eviction: when total entries across all workspaces reaches `LEADERBOARD_SNAPSHOT_MAX_217 = 5,000`, the oldest entry (by timestamp, across all workspaces) is evicted.
- `snapshotId`: UUID (v4 format).
- Fields per snapshot: `{ snapshotId, workspaceId, timestamp, topN, entries: [{ uid, reputation, rank }] }`.
- `topN`: default 10, max 50. Values outside range are clamped.
- `rank`: 1-based position in descending-reputation sort (rank 1 = highest reputation).
- Validators provided in request body; sorted descending by `reputation` field before slicing to topN.

### 2.2 Leaderboard History Contract

- Source: `_leaderboardSnapshots217` (read-only for history queries).
- Response: `{ workspaceId, count: N, snapshots: [...] }` sorted by timestamp descending.
- `limit` query param: default 10, max 100.
- If no snapshots exist for workspace: `{ workspaceId, count: 0, snapshots: [] }`.

### 2.3 Task Completion Rate Contract

- Source: `_eventLog181` (inherited, read-only).
- Filter: events where `event.workspaceId === workspaceId` (or workspaceId absent).
- `task_created` event type: `'task_created'`.
- `task_completed` event type: `'task_completed'`.
- `completion_rate` = tasks_completed / tasks_created, rounded to 4 decimal places.
- If `tasks_created === 0` → `completion_rate = 0`.
- No new store created (stateless read of `_eventLog181`).

### 2.4 Reputation Decay Simulation Contract

- Stateless (no store).
- Decay rate: `DECAY_RATE_PER_DAY_217 = 0.005` (0.5% compound daily).
- Formula: `rep_day_N = initial_rep × (1 − 0.005)^N`.
- Projection: days 0–30 inclusive (31 data points).
- `initial_rep`: required query param, must be a number > 0; else HTTP 400.
- Values rounded to 2 decimal places.
- Response: `{ uid, initial_rep, decay_rate: 0.005, projection: [{ day, rep }, ...] }`.

### 2.5 Batch Sybil Check Contract

- Stateless (no store). Reads `_attestations212` and `_eventLog181`.
- Max batch size: `SYBIL_BATCH_MAX_217 = 50` uids.
- Empty array or > 50 uids → HTTP 400.
- Score formula (inherited from V215): `0.4 × attestation_score + 0.35 × activity_pattern_score + 0.25 × reputation_age_score`.
  - `attestation_score`: verified attestation count for uid, capped at `SYBIL_MAX_ATTEST_215 = 10`, normalized to [0,1].
  - `activity_pattern_score`: Shannon entropy of UTC hour distribution across uid's events, normalized by log2(24); default 0.5 if <2 events.
  - `reputation_age_score`: days since first event, capped at 90 days, normalized to [0,1].
- `hitl_flag = true` if `sybil_score < SYBIL_HITL_THRESH_215 (0.35)`.
- `reject_flag = true` if `sybil_score < SYBIL_REJECT_THRESH_215 (0.15)`.
- Response: `{ checked: N, results: [{ uid, sybil_score, hitl_flag, reject_flag }] }`.

---

## 3. Endpoint Naming (V217)

All V217 endpoints follow the established pattern:
- Variable names: `req217<letter>`, `res217<letter>`, `err217<letter>`.
- Sequential: `a` = T01, `b` = T02, `c` = T03, `d` = T04, `e` = T05, `z` = admin.

---

## 4. In-Memory Stores (V217)

| Store | Variable | Max Size |
|-------|----------|----------|
| Leaderboard Snapshots | `_leaderboardSnapshots217` | 5,000 total entries (ring eviction) |

---

## 5. Inherited Contracts

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
