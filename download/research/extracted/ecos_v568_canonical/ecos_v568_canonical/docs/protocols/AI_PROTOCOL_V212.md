# ECOS AI Protocol — V212

  **Version:** 212.0.0
  **Phase:** P101
  **Date:** 2026-05-31
  **Status:** Active

  ---

  ## Purpose

  This document defines the canonical AI operating protocol for ECOS V212.
  It extends AI_PROTOCOL_V211.md with V212-specific contracts, rules, and constraints.

  ---

  ## 1. Immutable Rules (All Versions)

  | Rule | Description |
  |------|-------------|
  | R1 | Sacred files (`lib/fiatLedger.js`, `lib/auditLog.js`) MUST NOT be modified. MD5-verify at session start. |
  | R2 | All identifiers introduced in a version MUST be suffixed with the version number (e.g., `createPool212`). |
  | R3 | Zero new npm dependencies. All logic uses Node.js built-ins or in-memory data structures. |
  | R4 | All test exports go into the single `if (process.env.NODE_ENV === 'test')` block. |
  | R5 | Version bump: `package.json` `version` field increments on each canonical ZIP. |

  ---

  ## 2. V212-Specific Protocol

  ### 2.1 Validator Pool Staking Contract

  - Minimum member reputation: `POOL_MIN_REP_212 = 200`.
  - Maximum members per pool: `POOL_MAX_MEMBERS_212 = 20`.
  - Minimum stake per task: `POOL_MIN_STAKE_PCT_212 = 1%` of pool total rep.
  - Maximum stake per task: `POOL_MAX_STAKE_PCT_212 = 40%` of pool total rep.
  - Wrong prediction: `-POOL_SLASH_PCT_212 × stakeAmount` (15% slash).
  - Correct prediction: `+POOL_REWARD_PCT_212 × stakeAmount` (8% reward).
  - Predicted outcomes: `'pass'` or `'fail'` only.
  - One stake per (poolId, taskId) pair.

  ### 2.2 Proof Attestation Contract

  - Attestations are identified by `proofId` (one attestation per proof).
  - Content hash: SHA-256 of `plaintext`.
  - CID format: `bafybeiv212` + first 32 hex chars of SHA-256(proofId + plaintext + approverId).
  - Attestations are immutable — they can be revoked (flagged) but never deleted.
  - Max attestations in memory: `ATTEST_MAX_212 = 10,000`.

  ### 2.3 Calibration Routing Contract

  - Auto-settle threshold: `DEFAULT_AUTO_THRESH_212 = 0.70`.
  - HITL lower bound: `DEFAULT_HITL_LOW_212 = 0.30` (tasks ≥ 0.30 but < 0.70 go to HITL).
  - Reject threshold: `DEFAULT_REJECT_THRESH_212 = 0.30` (tasks < 0.30 are rejected).
  - Batch maximum: 100 tasks per call.
  - Decision log ring buffer: `ROUTE_LOG_MAX_212 = 2,000` entries.

  ### 2.4 Reputation Decay Insurance Contract

  - Daily rate: `INSURANCE_RATE_PER_DAY_212 = 0.001` (0.1% of workspaceRep per day).
  - Maximum policy duration: `INSURANCE_MAX_DAYS_212 = 30` days.
  - Minimum policy duration: `INSURANCE_MIN_DAYS_212 = 1` day.
  - Minimum qualifying rep: `INSURANCE_MIN_REP_212 = 500`.
  - One active policy per workspace at a time.
  - Cancellation: allowed, but no refund; coverage void from cancellation timestamp.

  ### 2.5 Governance Execution Contract

  - Execution quorum: `EXEC_QUORUM_PCT_212 = 0.51` (>51% of voted weight must be 'for').
  - Execution types: `PARAM_CHANGE`, `TREASURY_TRANSFER`, `FEATURE_FLAG`, `TEXT_RECORD`.
  - Execution log is append-only and immutable.
  - One execution per proposalId (idempotent).
  - `PARAM_CHANGE`: updates `_execParams212` map.
  - `FEATURE_FLAG`: updates `_featureFlags212` map.
  - `TEXT_RECORD`: appends to `_textRecords212` array.

  ### 2.6 Multi-Round Consensus Contract

  - Minimum validators per round: `ROUND_MIN_VALIDATORS_212 = 3`.
  - Maximum validators per round: `ROUND_MAX_VALIDATORS_212 = 11`.
  - Tiebreaker boost: `ROUND_TIEBREAK_MULTIPLIER_212 = 2.0×` for top-quartile rep validators.
  - Top-quartile threshold: `ROUND_TOP_QUARTILE_PCT_212 = 0.75` (75th percentile rep).
  - Tie outcome (for = against after all votes): `outcome = 'tied'`, `status = 'needs_tiebreaker'`.
  - Votes: `'approve'`, `'reject'`, `'abstain'` (abstain counts for quorum, not for/against weight).
  - One vote per validatorId per round (double-vote is rejected).

  ---

  ## 3. Endpoint Naming Conventions (V212)

  All V212 endpoints follow the established pattern:
  - Variable names: `req212<letter>`, `res212<letter>`, `err212<letter>`.
  - Sequential suffix letters: `a` = first endpoint, continuing alphabetically.
  - Admin summary uses letter `z`.

  ---

  ## 4. In-Memory Store Sizes (V212 Limits)

  | Store | Variable | Max Size |
  |-------|----------|----------|
  | Pools | `_pools212` | 500 |
  | Pool Members | `_poolMembers212` | 20 per pool |
  | Pool Stakes | `_poolStakes212` | unlimited per pool |
  | Attestations | `_attestations212` | 10,000 |
  | Route Log | `_routeLog212` | 2,000 (ring) |
  | Insurance Policies | `_policies212` | 5,000 |
  | Execution Log | `_execLog212` | 10,000 |
  | Consensus Rounds | `_rounds212` | 5,000 |
  