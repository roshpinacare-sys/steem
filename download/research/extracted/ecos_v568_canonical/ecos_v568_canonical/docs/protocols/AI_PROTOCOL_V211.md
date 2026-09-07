# ECOS AI Protocol — V211

  **Version:** 211.0.0
  **Phase:** P100
  **Date:** 2026-05-31
  **Status:** Active

  ---

  ## Purpose

  This document defines the canonical AI operating protocol for ECOS V211.
  It extends AI_PROTOCOL_V210.md with V211-specific contracts, rules, and constraints.

  ---

  ## 1. Immutable Rules (All Versions)

  | Rule | Description |
  |------|-------------|
  | R1 | Sacred files (`lib/fiatLedger.js`, `lib/auditLog.js`) MUST NOT be modified. MD5-verify at session start. |
  | R2 | All identifiers introduced in a version MUST be suffixed with the version number (e.g., `createProposal211`). |
  | R3 | Zero new npm dependencies. All logic uses Node.js built-ins or in-memory data structures. |
  | R4 | All test exports go into the single `if (process.env.NODE_ENV === 'test')` block. |
  | R5 | Version bump: `package.json` `version` field increments on each canonical ZIP. |

  ---

  ## 2. V211-Specific Protocol

  ### 2.1 Governance Voting Contract

  - Minimum proposer rep: `GOVERNANCE_MIN_REP_211 = 500`.
  - Quorum threshold: `GOVERNANCE_QUORUM_PCT_211 = 0.20` (20% of total network rep must participate).
  - Voting window: `GOVERNANCE_WINDOW_MS_211 = 48 hours`.
  - Votes are weighted by `voterRep`; abstain counts toward quorum but not for/against.
  - Proposals are immutable once created.

  ### 2.2 Cross-Workspace Royalty Contract

  - Royalty rate: `XR_ROYALTY_PCT_211 = 0.02` (2% of earnings).
  - Maximum propagation depth: `XR_MAX_DEPTH_211 = 3`.
  - Minimum royalty payment: `XR_MIN_AMOUNT_USD_211 = 0.01`.
  - Settlement is idempotent per (patchId, reusingWorkspaceId) pair.

  ### 2.3 Semantic Clustering Contract

  - Jaccard similarity threshold: `CLUSTER_JACCARD_THRESH_211 = 0.25`.
  - Maximum clusters in memory: `CLUSTER_MAX_211 = 50`.
  - Maximum nodes per cluster: `CLUSTER_MAX_NODES_211 = 200`.
  - Clusters are recomputed on demand; labels are derived from dominant domain.

  ### 2.4 Dispute Appeal Contract

  - Appeal panel size: `APPEAL_PANEL_SIZE_211 = 5` (must be odd).
  - Minimum appeal arbiter rep: `APPEAL_MIN_REP_211 = 500`.
  - Appeal fee multiplier: `APPEAL_FEE_MULT_211 = 3` (costs 3× original dispute fee).
  - Voting window: `APPEAL_WINDOW_MS_211 = 7 days`.
  - Outcome: uphold (original decision stands) or dismiss (original reversed).
  - Deadlock (equal uphold/dismiss): appeal dismissed, original decision stands.

  ---

  ## 3. Endpoint Naming Conventions (V211)

  All V211 endpoints follow the established pattern:
  - Variable names: `req211<letter>`, `res211<letter>`, `err211<letter>`.
  - Sequential suffix letters: `a` = first endpoint, continuing alphabetically.

  ---

  ## 4. In-Memory Store Sizes (V211 Limits)

  | Store | Variable | Max Size |
  |-------|----------|----------|
  | Proposals | `_proposals211` | 1000 |
  | Votes | per proposal map | unlimited (bounded by validators) |
  | Royalty Ledger | `_xRoyaltyLedger211` | 50,000 entries |
  | Clusters | `_clusters211` | 50 |
  | Appeals | `_appeals211` | 500 |
  