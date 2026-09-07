# ECOS AI Protocol — V216
**Version:** 216.0.0 | **Phase:** P103 | **Date:** 2026-05-31 | **Status:** Active

---

## Purpose

This document defines the canonical AI operating protocol for ECOS V216.
It extends AI_PROTOCOL_V215.md with V216-specific contracts, rules, and constraints.

---

## 1. Immutable Rules (All Versions)

| Rule | Description |
|------|-------------|
| R1 | Sacred files (`src/lib/fiatLedger.js`, `src/lib/auditLog.js`) MUST NOT be modified. MD5-verify at session start. |
| R2 | All identifiers introduced in a version MUST be suffixed with the version number (e.g., `_repSnapshots216`). |
| R3 | Zero new npm dependencies. All logic uses Node.js built-ins or in-memory data structures. |
| R4 | All test exports go into the single `if (process.env.NODE_ENV === 'test')` block. |
| R5 | Version bump: `package.json` `version` field increments on each canonical ZIP. |
| R6 | No existing endpoints may be removed. |
| R7 | Do not create a new store if an existing one already serves the same purpose. |

---

## 2. V216-Specific Protocol

### 2.1 Task Reputation Snapshot Contract

- Store: `_repSnapshots216` (Map, max `REP_SNAPSHOT_MAX_216 = 10,000`, ring eviction).
- Map key: `${workspaceId}:${taskId}` → array of snapshot objects.
- `snapshotId`: UUID (v4 format).
- Fields per snapshot: `{ taskId, snapshotId, timestamp, validators: [{ uid, reputation, score }] }`.
- Validators array must be non-empty; each entry requires `uid` (string), `reputation` (number), `score` (number).
- Ring eviction: when the Map reaches max size, the oldest key is deleted before inserting a new one.

### 2.2 Snapshot Diff Contract

- Operates on `_repSnapshots216` (read-only for diff).
- Compares the two most recent snapshots for a given taskId.
- Returns `{ taskId, snapshots: [s1, s2], diff: [{ uid, repBefore, repAfter, delta }] }`.
- `delta = repAfter - repBefore` (null if uid absent in one snapshot).
- Guard: fewer than 2 snapshots → HTTP 400 `{ error: "insufficient_snapshots" }`.

### 2.3 Task Activity Heatmap Contract

- Source: `_eventLog181` (inherited, read-only).
- Filter: events where `event.taskId === taskId` (or `event.payload.taskId === taskId`) and `event.workspaceId === workspaceId` (or absent).
- Bucket: UTC hour of `event.timestamp` (0–23).
- Response: `{ taskId, heatmap: [{ hour: 0, count: N }, ..., { hour: 23, count: N }] }` — always 24 entries.

### 2.4 Escrow Expiry Sweep Contract

- Operates on `_escrows215` (inherited store, V215 ownership).
- Auto-refund condition: `status === 'pending' && expiry < Date.now()`.
- Mutates `status` → `'refunded'` in place.
- Sweep is idempotent: already-refunded or released escrows are never touched.
- Response: `{ swept: N, escrowIds: [...] }`.

### 2.5 Onboarding Analytics Contract

- Source: `_onboardLog215` (inherited, read-only for analytics).
- `fast_completion` threshold: `ONBOARD_TARGET_MS_215 = 60,000 ms` (inherited constant).
- `completion_rate` = completed / total (0 if total = 0).
- `avg_duration_ms` = mean `durationMs` of completed sessions (0 if none).
- Drop-off counted for incomplete sessions by last step reached.

---

## 3. Endpoint Naming (V216)

All V216 endpoints follow the established pattern:
- Variable names: `req216<letter>`, `res216<letter>`, `err216<letter>`.
- Sequential: `a` = T01, `b` = T02, `c` = T03, `d` = T04, `e` = T05, `z` = admin.

---

## 4. In-Memory Stores (V216)

| Store | Variable | Max Size |
|-------|----------|----------|
| Rep Snapshots | `_repSnapshots216` | 10,000 (ring eviction) |

---

## 5. Inherited Contracts

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
