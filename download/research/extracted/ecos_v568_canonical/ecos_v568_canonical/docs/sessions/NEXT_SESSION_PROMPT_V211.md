# ECOS — Next Session Prompt (V211 → V212)

  **From:** V211 (P100) · `ecos_v211_canonical.zip`
  **To plan:** V212 (P101)
  **Date written:** 2026-05-31

  ---

  ## What V211 Delivered

  V211 added 4 lib files and 16 endpoints across:
  1. **Proof-of-Stake Governance** — weighted proposals and voting using staked reputation
  2. **Cross-Workspace Royalty Settlement** — automatic royalty flows when patches are reused
  3. **Knowledge Graph Semantic Clustering** — Jaccard-similarity node clustering for validator routing
  4. **Dispute Appeal Layer** — 5-arbiter senior panel for appealing disputed decisions
  5. **SSE Leaderboard** — real-time Server-Sent Events reputation ranking stream
  6. **Referral Fraud Detection** — BFS cycle detection on referral graph

  ---

  ## Candidate Tasks for V212

  Priority order (based on ECONOMY.md, PRODUCT_DESIGN.md, and V211 gaps):

  ### HIGH PRIORITY

  **V212-T01: Delegated Validator Pools**
  - Groups of validators pool their reputation; pool earns/loses as a unit
  - Extends `reputationStaking210.js` with pool-level stake management
  - Endpoints: POST /validator-pools, POST /validator-pools/:id/join, POST /validator-pools/:id/stake, POST /validator-pools/:id/resolve, GET /validator-pools/:id

  **V212-T02: Proof Attestation Registry (Off-Chain)**
  - When a ZK proof is verified, mint an immutable off-chain attestation record
  - SHA-256 content hash, synthetic IPFS-style CID, approver, timestamp
  - Endpoints: POST /proofs/:id/attest, GET /proofs/:id/attestation, GET /attestations, DELETE /proofs/:id/attestation

  **V212-T03: Calibration-Driven Task Routing**
  - Use calibration state (V210) to route borderline tasks to HITL vs auto-settle
  - Batch routing endpoint for high-volume scenarios
  - Endpoints: POST /tasks/route-calibrated, POST /tasks/route-calibrated/batch, GET /calibration/routing-decision

  **V212-T04: Reputation Decay Insurance Market**
  - High-rep validators can freeze decay by purchasing a day-rate insurance policy
  - Extends reputationDecayEngine208
  - Endpoints: POST /workspaces/:id/decay/insure, GET /workspaces/:id/decay/insurance, DELETE /workspaces/:id/decay/insurance

  **V212-T05: Governance Auto-Execution Engine**
  - When a governance proposal passes quorum, auto-execute its payload
  - Execution types: PARAM_CHANGE, TREASURY_TRANSFER, FEATURE_FLAG, TEXT_RECORD
  - Endpoints: POST /governance/proposals/:id/execute, GET /governance/executions, GET /governance/params

  **V212-T06: Multi-Round Consensus Scoring**
  - Tasks with validator vote ties trigger a tiebreaker round with boosted rep weights
  - Top-quartile validators get 2× weight in tiebreaker rounds
  - Endpoints: POST /workspaces/:id/consensus/rounds, POST /workspaces/:id/consensus/rounds/:roundId/vote, GET /workspaces/:id/consensus/rounds/:roundId

  ---

  ## Implementation Rules (Carry Forward to V212)

  1. **R1 — Sacred files**: NEVER modify `lib/fiatLedger.js` or `lib/auditLog.js`
  2. **R2 — Suffix convention**: All new identifiers use `212` suffix
  3. **R3 — Requires block**: Add V212 requires immediately after V211 require block
  4. **R4 — Test exports**: Append to the same `if (process.env.NODE_ENV === 'test')` block
  5. **R5 — Endpoint location**: Append endpoints AFTER V211 `admin/summary/v211` endpoint
  6. **R6 — Zero new npm deps**: No new `package.json` dependencies
  7. **R7 — Test file**: Create `tests/v212.test.js` using vitest
  8. **R8 — MD5 verification**: Verify sacred file MD5s before and after session

  ---

  ## V212 Documentation Checklist

  - [ ] `CHANGELOG_V212.md`
  - [ ] `NEXT_SESSION_PROMPT_V212.md`
  - [ ] `AI_PROTOCOL_V212.md`
  - [ ] Update `CLAUDE.md` version line to V212

  ---

  ## Sacred File MD5s

  ```
  lib/fiatLedger.js  → 563e9b1f9e67091a5b6527c0a92568e5
  lib/auditLog.js    → e5a5c2c27801d2d03991bc8e5a1df8cb
  ```
  