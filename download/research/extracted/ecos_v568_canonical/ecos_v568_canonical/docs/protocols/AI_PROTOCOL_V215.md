# ECOS AI Protocol — V215

  **Version:** 215.0.0
  **Phase:** P102
  **Date:** 2026-05-31
  **Status:** Active

  ---

  ## Purpose

  This document defines the canonical AI operating protocol for ECOS V215.
  It extends AI_PROTOCOL_V212.md with V215-specific contracts, rules, and constraints.

  ---

  ## 1. Immutable Rules (All Versions)

  | Rule | Description |
  |------|-------------|
  | R1 | Sacred files (`src/lib/fiatLedger.js`, `src/lib/auditLog.js`) MUST NOT be modified. MD5-verify at session start. |
  | R2 | All identifiers introduced in a version MUST be suffixed with the version number (e.g., `createEscrow215`). |
  | R3 | Zero new npm dependencies. All logic uses Node.js built-ins or in-memory data structures. |
  | R4 | All test exports go into the single `if (process.env.NODE_ENV === 'test')` block. |
  | R5 | Version bump: `package.json` `version` field increments on each canonical ZIP. |

  ---

  ## 2. V215-Specific Protocol

  ### 2.1 Agent Micro-Escrow Contract

  - Escrow is identified by `escrowId` (UUID).
  - States: `pending` → `released` | `refunded`.
  - Hold amount: minimum `ESCROW_MIN_AMOUNT_215 = 0.01` USD.
  - Maximum escrow duration: `ESCROW_MAX_DURATION_MS_215 = 72 hours`.
  - Release requires agent signature (`agentId` + `taskId` match).
  - Refund auto-triggers on expiry.
  - One escrow per (agentId, taskId) pair.
  - Max escrows in memory: `ESCROW_MAX_215 = 20,000`.

  ### 2.2 Sybil Resistance Score Contract

  - Score range: 0.0–1.0 (higher = more trustworthy).
  - Components:
    - `attestation_score`: count of verified EAS attestations (capped at `SYBIL_MAX_ATTEST_215 = 10`).
    - `activity_pattern_score`: entropy of action timestamps (low entropy = bot-like).
    - `reputation_age_score`: days since first reputation event (capped at 90 days).
  - Formula: `0.4 × attestation_score + 0.35 × activity_pattern_score + 0.25 × reputation_age_score`.
  - Threshold for HITL flag: `SYBIL_HITL_THRESH_215 = 0.35`.
  - Threshold for auto-reject: `SYBIL_REJECT_THRESH_215 = 0.15`.
  - Score is recalculated on-demand (not cached).

  ### 2.3 Onboarding Flow Contract

  - Onboarding session identified by `sessionId`.
  - Steps: `wallet_connect` → `first_task` → `first_earn` → `complete`.
  - Target completion: `ONBOARD_TARGET_MS_215 = 60,000` ms (60 seconds).
  - Funnel events logged to `_onboardLog215` (ring buffer, max 5,000).
  - Drop-off detected if step gap > `ONBOARD_DROPOFF_MS_215 = 300,000` ms (5 min).

  ---

  ## 3. Endpoint Naming Conventions (V215)

  All V215 endpoints follow the established pattern:
  - Variable names: `req215<letter>`, `res215<letter>`, `err215<letter>`.
  - Sequential suffix letters: `a` = first endpoint, continuing alphabetically.
  - Admin summary uses letter `z`.

  ---

  ## 4. In-Memory Store Sizes (V215 Limits)

  | Store | Variable | Max Size |
  |-------|----------|----------|
  | Escrows | `_escrows215` | 20,000 |
  | Sybil Scores | computed on-demand | — |
  | Onboard Log | `_onboardLog215` | 5,000 (ring) |

  ---

  ## 5. Inherited Contracts (from V212)

  All V212 contracts remain active:
  - Validator Pool Staking (POOL_MIN_REP_212, POOL_MAX_MEMBERS_212, etc.)
  - Proof Attestation (ATTEST_MAX_212 = 10,000)
  - Calibration Routing (DEFAULT_AUTO_THRESH_212 = 0.70)
  - Reputation Decay Insurance (INSURANCE_RATE_PER_DAY_212 = 0.001)
  - Governance Execution (EXEC_QUORUM_PCT_212 = 0.51)
  - Multi-Round Consensus (ROUND_MIN_VALIDATORS_212 = 3)
