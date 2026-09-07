# ECOS AI Protocol — V210

**Version:** 210.0.0  
**Phase:** P99  
**Date:** 2026-05-31  
**Status:** Active

---

## Purpose

This document defines the canonical AI operating protocol for ECOS V210.
It extends AI_PROTOCOL_V209.md with V210-specific contracts, rules, and constraints.

---

## 1. Immutable Rules (All Versions)

| Rule | Description |
|------|-------------|
| R1 | Sacred files (`lib/fiatLedger.js`, `lib/auditLog.js`) MUST NOT be modified. MD5-verify at session start. |
| R2 | All identifiers introduced in a version MUST be suffixed with the version number (e.g., `createStake210`). |
| R3 | Zero new npm dependencies. All logic uses Node.js built-ins or in-memory data structures. |
| R4 | All test exports go into the single `if (process.env.NODE_ENV === 'test')` block. |
| R5 | Version bump: `package.json` `version` field increments on each canonical ZIP. |

---

## 2. V210-Specific Protocol

### 2.1 Reputation Staking Contract

- A validator may stake at most `STAKE_MAX_PCT_210 × currentRep` points per task.
- Wrong prediction: `-SLASH_PCT_210 × stakeAmount` (20% slash).
- Correct prediction: `+REWARD_PCT_210 × stakeAmount` (10% reward).
- Minimum reputation to stake: `STAKE_MIN_REP_210 = 100`.
- Stakes have a 7-day expiry window (`STAKE_WINDOW_MS_210`).

### 2.2 Knowledge Graph Contract

- Nodes are immutable once created (no update/delete in V210).
- Edges are directed and additive (multiple traversals increment `weight`).
- BFS path search has a maximum depth of `MAX_PATH_DEPTH_210 = 6`.
- Maximum neighbors returned per query: `MAX_NEIGHBORS_210 = 50`.

### 2.3 Auto-Calibration Contract

- Minimum `MIN_SAMPLES_210 = 50` events required before recalibration runs.
- Recalibration has a 30-minute cooldown (`RECAL_COOLDOWN_MS_210`).
- Calibration uses a sliding window of `CALIBRATION_WINDOW_210 = 500` events.
- Drift alert fires when override rate changes by > `DRIFT_ALERT_THRESHOLD_210 = 0.08` (8%).

### 2.4 Referral Royalty Contract

- Maximum referral chain depth: `REFERRAL_CHAIN_DEPTH_210 = 3`.
- Royalty rate: `REFERRAL_ROYALTY_PCT_210 = 0.02` (2% of earner's income).
- Each level up receives `REFERRAL_CHAIN_DECAY_210 = 0.50` of the previous level's royalty.
- Both-party signup bonus: `REFERRAL_REWARD_CREDITS_210 = 25` credits each.
- Royalty propagation stops when the per-level amount drops below 1 cent.

### 2.5 Task Expiry Contract

- Default TTL: `DEFAULT_TTL_MS_210 = 7 days`.
- Minimum TTL: `MIN_TTL_MS_210 = 1 hour`.
- Maximum TTL: `MAX_TTL_MS_210 = 90 days`.
- ZK Reveal window: `REVEAL_WINDOW_MS_210 = 48 hours`.
- Commitment hash MUST be a 64-character lowercase hex sha256.
- Tampered plaintext → `valid: false` (not an error; proof simply fails).

### 2.6 Dispute Arbiter Contract

- Exactly 3 arbiters required (`ARBITER_PANEL_SIZE_210 = 3`).
- Minimum arbiter reputation: `ARBITER_MIN_REP_210 = 300`.
- Parties cannot be arbiters in their own dispute.
- Majority wins (2-of-3). Deadlock (1-1-1) → auto-refund to raiser.
- Losing party forfeits `LOSING_PARTY_SLASH_PCT_210 = 5%` of escrow.
- Voting window: `DISPUTE_WINDOW_MS_210 = 72 hours`.

---

## 3. Endpoint Naming Conventions (V210)

All V210 endpoints follow the pattern established in V209:
- Variable names: `req210<letter>`, `res210<letter>`, `err210<letter>` — suffixed to prevent shadowing.
- Sequential suffix letters: `a` = first endpoint, `b` = second, etc.
- Inline-only features use prose suffixes: `v`, `w`, `z` for terminal endpoints.

---

## 4. In-Memory Store Sizes (V210 Limits)

| Store | Variable | Max Size |
|-------|----------|----------|
| Stakes | `_stakes210` | 10,000 |
| Graph Nodes | `_graphNodes210` | 50,000 |
| Graph Edges | `_graphEdges210` | 200,000 |
| Calibration Events | `_calibrationEvents210` | 10,000 (sliding window) |
| Referral Users | `_referralMap210` | 100,000 |
| Task Expiry | `_taskExpiry210` | 50,000 |
| Proof Commits | `_proofCommits210` | 100,000 |
| Disputes | `_disputes210` | 10,000 |

---

## 5. Sacred File Verification

Verify at the start of every session:

```bash
md5sum lib/fiatLedger.js lib/auditLog.js
```

Expected output:
```
563e9b1f9e67091a5b6527c0a92568e5  lib/fiatLedger.js
e5a5c2c27801d2d03991bc8e5a1df8cb  lib/auditLog.js
```

Any deviation MUST halt the session immediately.

---

## 6. Version Lineage

```
V208 → V209 (Economic Guardrails + Governance + Multi-Sig)
     → V210 (Reputation Staking + Knowledge Graph + Auto-Calibration + Referral + ZK + Disputes)
     → V211 (planned: Proof-of-Stake Governance + Cross-Workspace Royalties + Validator Pools)
```

---

*AI_PROTOCOL_V210.md is the authoritative protocol document for ECOS V210.*  
*Supersedes: AI_PROTOCOL_V209.md for all V210 session operations.*
