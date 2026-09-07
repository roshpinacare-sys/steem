# CHANGELOG — ECOS V209 (Phase P98)

  **Date:** 2026-05-31
  **Version:** 209.0.0 (→ from 208.0.0)
  **Phase:** P98

  ---

  ## What changed

  ### New library files (6)

  | File | Purpose |
  |------|---------|
  | `lib/tokenBurnScheduler209.js` | Deflationary burn: 10% of platform 40% → token buy-and-burn |
  | `lib/governanceVetoEngine209.js` | Lazy consensus + fast 3-veto gate (≥2000 rep) |
  | `lib/payForProofEscrow209.js` | Bilateral pay-for-proof escrow, 48h dispute window |
  | `lib/activeContextRouter209.js` | Chat→intent→action surfacing (9 intent types) |
  | `lib/economicAnomalyDetector209.js` | Circular flow, high-velocity, bulk-claim detection |
  | `lib/multiSigTreasury209.js` | M-of-N treasury withdrawal (default 3-of-N) |

  ### New endpoints (22)

  ```
  POST /api/v1/treasury/burn-schedule         — V209-T01
  GET  /api/v1/treasury/burn-stats            — V209-T01b
  POST /api/v1/governance/proposals           — V209-T02
  POST /api/v1/governance/proposals/:id/veto  — V209-T02b
  GET  /api/v1/governance/proposals/:id       — V209-T02c
  POST /api/v1/tasks/:id/proof/escrow         — V209-T03
  POST /api/v1/tasks/:id/proof                — V209-T03b
  POST /api/v1/tasks/:id/proof/approve        — V209-T03c
  POST /api/v1/workspaces/:id/tasks/private   — V209-T04
  POST /api/v1/context/analyze                — V209-T05
  POST /api/v1/workspaces/:id/wallet/provision — V209-T06
  GET  /api/v1/workspaces/:id/profile/galaxy  — V209-T07
  GET  /api/v1/treasury/reserves/proof        — V209-T08
  GET  /api/v1/admin/competitive-map          — V209-T09
  GET  /api/v1/leagues/current                — V209-T10
  POST /api/v1/workspaces/:id/federation/delegate — V209-T11
  POST /api/v1/tasks/route-validator          — V209-T12
  POST /api/v1/admin/anomaly-check            — V209-T13
  POST /api/v1/treasury/withdrawal/request    — V209-T14
  POST /api/v1/treasury/withdrawal/:id/sign   — V209-T14b
  GET  /api/v1/treasury/withdrawal/:id        — V209-T14c
  GET  /api/v1/admin/summary/v209             — V209-Adm
  ```

  ### Files modified

  - `ecos-api-server.js` — 6 new require() blocks + 22 endpoints + 44 test exports (20,840 lines)
  - `package.json` — version 208.0.0 → 209.0.0

  ### Files NOT modified (R1 sacred rule)

  - `lib/fiatLedger.js` ✅ MD5 unchanged: 563e9b1f9e67091a5b6527c0a92568e5
  - `lib/auditLog.js` ✅ MD5 unchanged: e5a5c2c27801d2d03991bc8e5a1df8cb

  ---

  ## 14 V209 Tasks — Economic Guardrails Plan

  | Task | Priority | Lib | Endpoints |
  |------|----------|-----|-----------|
  | T01: Token Burn Scheduler | 🔴 Critical | tokenBurnScheduler209.js | 2 |
  | T02: Governance Veto Gate | 🔴 Critical | governanceVetoEngine209.js | 3 |
  | T03: Pay-for-Proof Escrow | 🔴 Critical | payForProofEscrow209.js | 3 |
  | T04: Single-Player Mode | 🟠 High | (inline) | 1 |
  | T05: Active Context Router | 🟠 High | activeContextRouter209.js | 1 |
  | T06: Embedded Wallet Abstraction | 🟠 High | (inline) | 1 |
  | T07: Dynamic Reputation Galaxy | 🟠 High | (inline) | 1 |
  | T08: Proof of Reserves | 🟡 Medium | (inline, crypto built-in) | 1 |
  | T09: Competitive Intelligence Map | 🟡 Medium | (inline) | 1 |
  | T10: Competitive Leagues | 🟡 Medium | (inline) | 1 |
  | T11: Cross-Workspace Federation *(new)* | 🟠 High | (inline) | 1 |
  | T12: Validator Threshold Router *(new)* | 🟠 High | (inline) | 1 |
  | T13: Economic Anomaly Detector *(new)* | 🔴 Critical | economicAnomalyDetector209.js | 1 |
  | T14: Multi-Sig Treasury *(new)* | 🔴 Critical | multiSigTreasury209.js | 3 |

  ## Economic guardrails implemented

  1. **Deflationary token burns** — 10% of platform 40% → buy-and-burn (FTX/Terra lesson)
  2. **Fast veto gate** — 3+ members with ≥2000 reputation instantly reject suspicious proposals
  3. **Pay-for-proof** — zero unilateral payment release; bilateral approval + 48h dispute window
  4. **Single-player mode** — users can manage tasks privately without network dependency (Notion lesson)
  5. **Context-aware AI** — proactive task surfacing from chat context (ECOS differentiator)
  6. **Account abstraction** — wallet created on first message, gas subsidized 40% from platform share
  7. **Proof of reserves** — Merkle-tree attestation (Celsius lesson: no more hidden insolvency)
  8. **Multi-sig treasury** — M-of-N ≥3 for withdrawals ≥$10,000 (Build Finance lesson)
  9. **Wash-trade detection** — circular-flow cycles, high-velocity flagging, bulk-claim clustering
  10. **Cross-workspace audit trail** — SHA-256 federated delegation receipts
  