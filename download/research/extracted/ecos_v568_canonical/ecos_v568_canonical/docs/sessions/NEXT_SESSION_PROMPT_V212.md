# ECOS — Next Session Prompt (V212 → V213)

  **From:** V212 (P101) · `ecos_v212_canonical.zip`
  **To plan:** V213 (P102)
  **Date written:** 2026-05-31

  ---

  ## What V212 Delivered

  V212 added 6 lib files and 22 endpoints across:
  1. **Delegated Validator Pools** — pooled reputation stake; proportional slash/reward across members
  2. **Proof Attestation Registry** — immutable off-chain SHA-256 + CID records for verified ZK proofs
  3. **Calibration-Driven Task Routing** — confidence-band routing (auto/hitl/reject) using calibration state
  4. **Reputation Decay Insurance** — day-rate fee to freeze decay; policy lifecycle with one-active-per-workspace rule
  5. **Governance Auto-Execution** — automatic execution of passed proposals (PARAM_CHANGE, FEATURE_FLAG, etc.)
  6. **Multi-Round Consensus** — tiebreaker rounds with top-quartile rep 2× boost; ties flagged for re-round

  ---

  ## Candidate Tasks for V213

  Priority order (based on ECONOMY.md, PRODUCT_DESIGN.md, and V212 gaps):

  ### HIGH PRIORITY

  **V213-T01: Validator Pool Governance Delegation**
  - Pool members can delegate their governance voting weight to the pool
  - Pool casts a single bloc vote proportional to pooled rep
  - Extends `validatorPoolStaking212.js` + `governanceVoting211.js`
  - Endpoints: POST /validator-pools/:id/governance/delegate, GET /validator-pools/:id/governance/vote-weight

  **V213-T02: Attestation Marketplace**
  - Workspace can request attestation from a certified validator for a fee
  - Request → validator accepts/rejects → fee escrow → attestation issued
  - Endpoints: POST /attestation-requests, POST /attestation-requests/:id/accept, POST /attestation-requests/:id/reject, GET /attestation-requests/:id

  **V213-T03: Insurance Pool Collective**
  - Multiple workspaces co-fund a shared decay insurance pool
  - Lower per-workspace cost when pool hits minimum funding threshold
  - Extends `reputationInsurance212.js`
  - Endpoints: POST /insurance-pools, POST /insurance-pools/:id/join, GET /insurance-pools/:id, POST /insurance-pools/:id/claim

  **V213-T04: Consensus Round Replay**
  - Replay a completed round with different validators (audit trail)
  - Immutable replay log; round must be in 'resolved' or 'needs_tiebreaker' status
  - Extends `multiRoundConsensus212.js`
  - Endpoints: POST /workspaces/:id/consensus/rounds/:roundId/replay, GET /workspaces/:id/consensus/replays

  **V213-T05: Governance Proposal Templates**
  - Reusable proposal templates with pre-filled execution payloads
  - Reduces friction for common governance operations
  - Endpoints: POST /governance/templates, GET /governance/templates, POST /governance/templates/:id/instantiate

  **V213-T06: Calibration Drift Alert WebHook**
  - When auto-calibration detects drift > threshold, push a webhook to registered URL
  - Extends `autoCalibration210.js` + routing log from `calibrationRouter212.js`
  - Endpoints: POST /calibration/webhooks, GET /calibration/webhooks, DELETE /calibration/webhooks/:id

  ---

  ## Implementation Rules (Carry Forward to V213)

  1. **R1 — Sacred files**: NEVER modify `lib/fiatLedger.js` or `lib/auditLog.js`
  2. **R2 — Suffix convention**: All new identifiers use `213` suffix
  3. **R3 — Requires block**: Add V213 requires immediately after V212 require block
  4. **R4 — Test exports**: Append to the same `if (process.env.NODE_ENV === 'test')` block
  5. **R5 — Endpoint location**: Append endpoints AFTER V212 `admin/summary/v212` endpoint
  6. **R6 — Zero new npm deps**: No new `package.json` dependencies
  7. **R7 — Test file**: Create `tests/v213.test.js` using vitest
  8. **R8 — MD5 verification**: Verify sacred file MD5s before and after session

  ---

  ## V213 Documentation Checklist

  - [ ] `CHANGELOG_V213.md`
  - [ ] `NEXT_SESSION_PROMPT_V213.md`
  - [ ] `AI_PROTOCOL_V213.md`
  - [ ] Update `CLAUDE.md` version line to V213

  ---

  ## Sacred File MD5s

  ```
  lib/fiatLedger.js  → 563e9b1f9e67091a5b6527c0a92568e5
  lib/auditLog.js    → e5a5c2c27801d2d03991bc8e5a1df8cb
  ```
  