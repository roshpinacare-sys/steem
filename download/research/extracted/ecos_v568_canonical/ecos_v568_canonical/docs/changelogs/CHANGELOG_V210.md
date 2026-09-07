# ECOS Changelog — V210

**Version:** 210.0.0  
**Phase:** P99  
**Date:** 2026-05-31  
**Author:** AI (lead)  
**Build:** Canonical ZIP from V209 source

---

## Overview

V210 adds 6 new lib files, 27 API endpoints, and a complete vitest suite covering
all new features. Sacred files (fiatLedger.js, auditLog.js) are untouched. Zero
new npm dependencies added (R6 compliance).

---

## New Library Files

| File | Description |
|------|-------------|
| `lib/reputationStaking210.js` | Validator skin-in-the-game: stake rep on task outcome predictions; slash wrong, reward correct |
| `lib/knowledgeGraph210.js` | Queryable patch relationship graph with BFS pathfinding and neighbor traversal |
| `lib/autoCalibration210.js` | Platt-scale drift correction: tracks validator override rate and suggests threshold updates |
| `lib/referralEngine210.js` | Tree-based referral royalties: 2% of earnings propagate up 3 levels with 50% decay |
| `lib/taskExpiryEngine210.js` | TTL-based task escrow auto-return + ZK commit-reveal proof submission |
| `lib/disputeArbiter210.js` | 3-panel validator arbitration for pay-for-proof disputes; deadlock auto-refunds raiser |

---

## New Endpoints (27 total)

### T01 — Reputation Staking
- `POST /api/v1/workspaces/:id/reputation/stake` — stake rep on task outcome
- `POST /api/v1/workspaces/:id/reputation/resolve` — resolve stake after outcome known
- `GET  /api/v1/workspaces/:id/reputation/stake` — get stake history for validator

### T02 — Knowledge Graph
- `GET  /api/v1/patches/graph` — full graph summary + top nodes
- `GET  /api/v1/patches/:id/neighbors` — direct neighbors of a node
- `POST /api/v1/patches/nodes` — register a new patch node
- `POST /api/v1/patches/edges` — add a directed edge between nodes
- `POST /api/v1/patches/path` — BFS shortest path between two nodes

### T03 — Auto-Calibration
- `POST /api/v1/calibration/recalibrate` — run Platt-scale recalibration
- `POST /api/v1/calibration/record` — record a task outcome event
- `GET  /api/v1/calibration/health` — current calibration health + thresholds

### T04 — Referral Network Royalties
- `POST /api/v1/referral/register` — register user with optional referral code
- `POST /api/v1/referral/:id/activate` — activate referral, pay both-party bonus
- `GET  /api/v1/referral/:id/tree` — ancestry chain + direct referees
- `GET  /api/v1/referral/:id/earnings` — referral bonus + network royalty earnings

### T05 — Workspace Health Score
- `GET  /api/v1/workspaces/:id/health-score` — composite 4-factor health grade (A-D)

### T06 — Task Expiry Engine
- `POST /api/v1/tasks/:id/expiry` — set TTL for escrow auto-return
- `GET  /api/v1/tasks/:id/expiry` — expiry status + remaining milliseconds

### T07 — ZK Commit-Reveal
- `POST /api/v1/proofs/commit` — submit sha256 commitment (blind proof)
- `POST /api/v1/proofs/:id/reveal` — reveal plaintext + salt; hash verified
- `GET  /api/v1/proofs/:id` — get proof commitment state

### T08 — Dispute Arbiter
- `POST /api/v1/disputes` — open a 3-arbiter dispute panel
- `POST /api/v1/disputes/:id/vote` — arbiter casts vote (for_raiser | for_against)
- `GET  /api/v1/disputes/:id` — dispute state + vote tally

### T09 — Inline Features
- `GET  /api/v1/workspaces/:id/semantic-drift` — domain drift circuit breaker
- `POST /api/v1/admin/sla-alerts` — batch SLA breach evaluation
- `GET  /api/v1/admin/summary/v210` — V210 system summary

---

## Economic Guardrails

| Rule | Detail |
|------|--------|
| Staking | Max 50% of reputation staked at once; 20% slash on wrong, 10% reward on correct |
| Referrals | Max 3 levels; 2% royalty; 50% decay per level; 25-credit two-sided signup bonus |
| Task Expiry | 1h min TTL, 90d max TTL; escrow auto-returned on expiry |
| ZK Proof | 48h reveal window; tampered plaintext → hash mismatch = invalid proof |
| Disputes | 3-arbiter panel, min rep 300; majority wins; deadlock = auto-refund raiser; 5% slash on loser |
| Health Score | 4-factor composite: reputation 40%, streak 30%, stake accuracy 20%, network 10% |

---

## Test Coverage

`tests/v210.test.js` — 40+ test cases covering:
- Staking happy path, overstake, insufficient rep, slash, reward, resolution
- Knowledge graph: node creation, edge creation, neighbor traversal, BFS path, unreachable nodes
- Auto-calibration: recording outcomes, recalibration with insufficient samples
- Referral registration, activation, tree traversal, earnings
- Workspace health score structure and grading
- Task expiry: TTL setting, duplicate rejection, short TTL rejection, status
- ZK commit-reveal: valid commit, invalid hash, reveal verification, tamper detection
- Dispute: opening, voting flow, resolution, double-vote prevention
- Inline endpoints: semantic drift, SLA alerts, admin summary V210

---

## Sacred Files (Unchanged)

| File | MD5 |
|------|-----|
| `lib/fiatLedger.js` | `563e9b1f9e67091a5b6527c0a92568e5` |
| `lib/auditLog.js` | `e5a5c2c27801d2d03991bc8e5a1df8cb` |
