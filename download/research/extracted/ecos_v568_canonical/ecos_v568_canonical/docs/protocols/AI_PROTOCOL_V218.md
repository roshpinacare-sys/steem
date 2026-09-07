# ECOS AI Protocol — V218
**Version:** 218.0.0 | **Phase:** P105 | **Date:** 2026-05-31 | **Status:** Active

---

## Purpose

This document defines the canonical AI operating protocol for ECOS V218.
It extends AI_PROTOCOL_V217.md with V218-specific contracts, rules, and constraints.

---

## 1. Immutable Rules (All Versions)

| Rule | Description |
|------|-------------|
| R1 | Sacred files (`src/lib/fiatLedger.js`, `src/lib/auditLog.js`) MUST NOT be modified. MD5-verify at session start. |
| R2 | All identifiers introduced in a version MUST be suffixed with the version number (e.g., `_scoreHistory218`). |
| R3 | Zero new npm dependencies. All logic uses Node.js built-ins or in-memory data structures. |
| R4 | All test exports go into the single `if (process.env.NODE_ENV === 'test')` block. |
| R5 | Version bump: `package.json` `version` field increments on each canonical ZIP. |
| R6 | No existing endpoints may be removed. |
| R7 | Do not create a new store if an existing one already serves the same purpose. |

---

## 2. V218-Specific Protocol

### 2.1 Validator Score History Contract

- Store: `_scoreHistory218` (Map, key=`${workspaceId}:${uid}`, value=array of entries, max 8,000 total entries across all keys, ring eviction by oldest timestamp).
- `snapshotId`: UUID (v4 format).
- Fields per entry: `{ snapshotId, workspaceId, uid, score, metadata, timestamp }`.
- `score` must be a number in [0, 1] inclusive; else HTTP 400.
- `metadata`: optional object; defaults to `{}` if omitted.
- Ring eviction: when total entries across all keys reaches `SCORE_HISTORY_MAX_218 = 8,000`, the entry with the oldest timestamp (across all keys) is evicted.

### 2.2 Score Trend Contract

- Source: `_scoreHistory218` (read-only for trend queries).
- Response: `{ workspaceId, uid, count: N, trend: [{ snapshotId, score, timestamp }] }` sorted by timestamp ascending.
- `limit` query param: default 20, max 200.
- If no snapshots exist for the uid/workspace: `{ workspaceId, uid, count: 0, trend: [] }`.

### 2.3 Treasury Flow Summary Contract

- Source: `_eventLog181` (inherited, read-only). No new store.
- Filter: events where `event.workspaceId === workspaceId`.
- `inflow`: sum of `amount` for events with `type === 'treasury_deposit'`.
- `outflow`: sum of `amount` for events with `type === 'treasury_withdrawal'`.
- `net = inflow - outflow`.
- Missing or non-numeric `amount` values are treated as 0.
- If no matching events: all fields return 0.
- Response: `{ workspaceId, inflow, outflow, net, event_count }`.

### 2.4 Governance Tally Contract

- Stateless (no store).
- Request body: `{ votes: [{ uid, vote, weight? }] }`.
- `vote` values: `'yes'`, `'no'`, `'abstain'`; any other value → HTTP 400.
- `weight` default = 1; if provided must be a number > 0, else HTTP 400.
- `votes` field required and must be an array; else HTTP 400.
- Empty votes array → HTTP 200 with all numeric fields = 0 and `passed = false`.
- Calculation:
  - `yes_weight`: sum of weights for `'yes'` votes.
  - `no_weight`: sum of weights for `'no'` votes.
  - `abstain_weight`: sum of weights for `'abstain'` votes.
  - `total_weight`: sum of all weights.
  - `yes_pct = yes_weight / total_weight` (0 if total_weight = 0), rounded to 4 decimal places.
  - `passed = yes_pct >= GOVERNANCE_QUORUM_218` where `GOVERNANCE_QUORUM_218 = 0.51`.
- Response: `{ yes_weight, no_weight, abstain_weight, total_weight, yes_pct, passed, quorum: GOVERNANCE_QUORUM_218 }`.

### 2.5 Member Activity Window Contract

- Source: `_eventLog181` (inherited, read-only). No new store.
- Filter by uid: `event.uid === uid || event.userId === uid`.
- `days` query param: default 7, max 90.
- Window: `event.timestamp >= Date.now() - days * 86400000`.
- `first_event_ts`: minimum timestamp among matching events in window (null if none).
- `last_event_ts`: maximum timestamp among matching events in window (null if none).
- Response: `{ workspaceId, uid, days, event_count: N, first_event_ts: N|null, last_event_ts: N|null }`.

---

## 3. Endpoint Naming (V218)

All V218 endpoints follow the established pattern:
- Variable names: `req218<letter>`, `res218<letter>`, `err218<letter>`.
- Sequential: `a` = T01, `b` = T02, `c` = T03, `d` = T04, `e` = T05, `z` = admin.

---

## 4. In-Memory Stores (V218)

| Store | Variable | Max Size |
|-------|----------|----------|
| Score History | `_scoreHistory218` | 8,000 total entries (ring eviction) |

---

## 5. Inherited Contracts

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
