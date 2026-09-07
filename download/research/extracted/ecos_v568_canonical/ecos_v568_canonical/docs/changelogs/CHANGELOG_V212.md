# ECOS Changelog — V212

  **Version:** 212.0.0
  **Phase:** P101
  **Date:** 2026-05-31
  **Author:** AI (lead)
  **Build:** Canonical ZIP from V211 source

  ---

  ## Overview

  V212 adds 6 new lib files, 22 API endpoints, and a complete vitest suite covering
  all new features. Sacred files (fiatLedger.js, auditLog.js) are untouched.
  Zero new npm dependencies added (R6 compliance).

  ---

  ## New Library Files

  | File | Description |
  |------|-------------|
  | `lib/validatorPoolStaking212.js` | Delegated validator pools: pooled reputation stake, proportional slash/reward |
  | `lib/proofAttestation212.js` | Off-chain proof attestation registry: SHA-256 hash, synthetic IPFS CID, revocable |
  | `lib/calibrationRouter212.js` | Calibration-driven task routing: auto/hitl/reject based on confidence bands |
  | `lib/reputationInsurance212.js` | Reputation decay insurance market: day-rate freeze fee, policy lifecycle |
  | `lib/governanceExecution212.js` | Governance auto-execution engine: PARAM_CHANGE, FEATURE_FLAG, TEXT_RECORD |
  | `lib/multiRoundConsensus212.js` | Multi-round consensus: tiebreaker rounds with 2× boosted top-quartile weights |

  ---

  ## New Endpoints (22 total)

  ### T01 — Delegated Validator Pools
  - `POST /api/v1/validator-pools` — create a new validator pool
  - `POST /api/v1/validator-pools/:id/join` — join a pool (min rep 200)
  - `POST /api/v1/validator-pools/:id/stake` — pool stakes on task outcome
  - `POST /api/v1/validator-pools/:id/resolve` — settle pool stake after outcome known
  - `GET  /api/v1/validator-pools/:id` — pool details + member list

  ### T02 — Proof Attestation Registry
  - `POST /api/v1/proofs/:id/attest` — create off-chain attestation for verified proof
  - `GET  /api/v1/proofs/:id/attestation` — get attestation by proof ID
  - `GET  /api/v1/attestations` — paginated list of all attestations
  - `DELETE /api/v1/proofs/:id/attestation` — revoke attestation (immutable, not deleted)

  ### T03 — Calibration-Driven Task Routing
  - `POST /api/v1/tasks/route-calibrated` — route single task by confidence
  - `POST /api/v1/tasks/route-calibrated/batch` — batch route up to 100 tasks
  - `GET  /api/v1/calibration/routing-decision` — current thresholds + last 20 decisions

  ### T04 — Reputation Decay Insurance
  - `POST /api/v1/workspaces/:id/decay/insure` — purchase decay freeze policy
  - `GET  /api/v1/workspaces/:id/decay/insurance` — get active policy
  - `DELETE /api/v1/workspaces/:id/decay/insurance` — cancel policy (no refund)

  ### T05 — Governance Auto-Execution
  - `POST /api/v1/governance/proposals/:id/execute` — auto-execute passed proposal
  - `GET  /api/v1/governance/executions` — paginated execution log
  - `GET  /api/v1/governance/params` — current param values + feature flags

  ### T06 — Multi-Round Consensus Scoring
  - `POST /api/v1/workspaces/:id/consensus/rounds` — open a consensus round
  - `POST /api/v1/workspaces/:id/consensus/rounds/:roundId/vote` — cast vote
  - `GET  /api/v1/workspaces/:id/consensus/rounds/:roundId` — round state + tally

  ### Admin
  - `GET  /api/v1/admin/summary/v212` — V212 system summary

  ---

  ## Economic Guardrails

  | Rule | Detail |
  |------|--------|
  | Validator Pools | Max 40% stake per task; 15% slash on wrong, 8% reward on correct; max 20 members; min rep 200 to join |
  | Proof Attestation | SHA-256 content hash + synthetic CID; revocable (not deletable); max 10,000 in memory |
  | Calibration Routing | auto ≥ 0.70; hitl [0.30, 0.70); reject < 0.30; batch max 100 tasks |
  | Decay Insurance | 0.1% of rep/day; max 30 days; min rep 500 to qualify; one active policy per workspace |
  | Governance Execution | >51% weighted approval required; execution log is immutable; 4 payload types |
  | Multi-Round Consensus | 3–11 validators per round; tiebreaker: top-25%-rep gets 2× weight; tie → needs_tiebreaker |

  ---

  ## Test Coverage

  `tests/v212.test.js` — 42+ test cases covering:
  - Pool creation, joining, staking, resolution (correct/incorrect), duplicate guards
  - Attestation create, get, list, revoke, duplicate guards
  - Calibration routing: auto/hitl/reject bands, custom thresholds, batch routing
  - Insurance purchase, get, cancel, isInsured utility, duplicate/rep guards
  - Governance execution: PARAM_CHANGE, FEATURE_FLAG, TEXT_RECORD, quorum failure, duplicates
  - Consensus rounds: open, vote, approve/reject/tie resolution, tiebreaker boost, double-vote guard

  ---

  ## Sacred Files (Unchanged)

  | File | MD5 |
  |------|-----|
  | `lib/fiatLedger.js` | `563e9b1f9e67091a5b6527c0a92568e5` |
  | `lib/auditLog.js` | `e5a5c2c27801d2d03991bc8e5a1df8cb` |
  