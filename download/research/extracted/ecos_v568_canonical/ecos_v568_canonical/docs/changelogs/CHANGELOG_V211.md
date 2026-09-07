# ECOS Changelog — V211

  **Version:** 211.0.0
  **Phase:** P100
  **Date:** 2026-05-31
  **Author:** AI (lead)
  **Build:** Canonical ZIP from V210 source

  ---

  ## Overview

  V211 adds 4 new lib files, 16 API endpoints, and a complete vitest suite.
  Sacred files (fiatLedger.js, auditLog.js) are untouched. Zero new npm dependencies (R6 compliance).

  ---

  ## New Library Files

  | File | Description |
  |------|-------------|
  | `lib/governanceVoting211.js` | Proof-of-Stake weighted governance: proposals, votes, tally, quorum |
  | `lib/crossWorkspaceRoyalty211.js` | Cross-workspace royalty settlement when a patch is reused |
  | `lib/semanticClustering211.js` | Jaccard-similarity node clustering for knowledge graph routing |
  | `lib/disputeAppeal211.js` | 5-arbiter senior appeal panel for disputed decisions |

  ---

  ## New Endpoints (16 total)

  ### T01 — Proof-of-Stake Governance Votes
  - `POST /api/v1/governance/proposals` — create weighted-vote proposal
  - `POST /api/v1/governance/proposals/:id/vote` — cast weighted vote (weight = voterRep)
  - `GET  /api/v1/governance/proposals/:id/tally` — vote tally + quorum + outcome projection
  - `GET  /api/v1/governance/proposals/:id` — get proposal details

  ### T02 — Cross-Workspace Royalty Settlement
  - `POST /api/v1/royalties/settle` — settle royalties when workspace reuses a patch
  - `GET  /api/v1/royalties/:workspaceId/ledger` — royalty ledger for a workspace

  ### T04 — Knowledge Graph Semantic Clustering
  - `POST /api/v1/patches/cluster` — cluster supplied patch nodes by domain
  - `GET  /api/v1/patches/clusters` — list all current clusters
  - `GET  /api/v1/patches/clusters/:clusterId` — get specific cluster

  ### T08 — Dispute Appeal Layer
  - `POST /api/v1/disputes/:id/appeal` — open 5-arbiter senior appeal panel
  - `POST /api/v1/disputes/:id/appeal/vote` — appeal arbiter casts vote
  - `GET  /api/v1/disputes/:id/appeal` — get appeal state

  ### T09 — Workspace Reputation Leaderboard (SSE)
  - `GET  /api/v1/leaderboard/stream` — Server-Sent Events real-time rep ranking

  ### T10 — Referral Fraud Detection
  - `POST /api/v1/admin/referral-fraud-check` — BFS cycle detection on referral graph

  ### Admin
  - `GET  /api/v1/admin/summary/v211` — V211 system summary

  ---

  ## Economic Guardrails

  | Rule | Detail |
  |------|--------|
  | Governance | Min proposer rep 500; quorum = 20% of network rep; 48h voting window |
  | Cross-Royalty | Royalty rate 2%; max 3-level propagation; min amount 0.01 USD |
  | Clustering | Jaccard threshold 0.25; max 50 clusters; max 200 nodes per cluster |
  | Appeal | 5-arbiter panel; min rep 500; costs 3× original dispute fee; 7-day window |
  | Leaderboard SSE | 5-second push interval; top-20 by rep signal |
  | Fraud Detection | BFS depth limit 10; cycle = fraud flag |

  ---

  ## Test Coverage

  `tests/v211.test.js` — 35+ test cases covering governance, royalties, clustering, appeals, SSE, and fraud detection.

  ---

  ## Sacred Files (Unchanged)

  | File | MD5 |
  |------|-----|
  | `lib/fiatLedger.js` | `563e9b1f9e67091a5b6527c0a92568e5` |
  | `lib/auditLog.js` | `e5a5c2c27801d2d03991bc8e5a1df8cb` |
  