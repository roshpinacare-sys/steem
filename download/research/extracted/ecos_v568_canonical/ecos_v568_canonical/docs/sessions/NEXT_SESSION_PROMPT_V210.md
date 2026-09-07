# ECOS — Next Session Prompt (V210 → V211)

**From:** V210 (P99) · `ecos_v210_canonical.zip`  
**To plan:** V211 (P100)  
**Date written:** 2026-05-31

---

## What V210 Delivered

V210 added 6 lib files and 27 endpoints across:
1. **Reputation Staking** — validators stake rep on task outcome predictions (slash/reward)
2. **Knowledge Graph API** — queryable directed graph of patch relationships (BFS, neighbors, path)
3. **Auto-Calibration Loop** — Platt-scale drift correction, override-rate tracking
4. **Referral Network Royalties** — tree-based 2% royalty propagation, 3 levels, 50% decay
5. **Workspace Health Score** — composite 4-factor metric (A/B/C/D grade)
6. **Task Expiry Engine** — TTL auto-return + ZK sha256 commit-reveal proof submission
7. **Dispute Arbiter** — 3-validator panel arbitration, majority vote, deadlock auto-refund
8. **Inline:** semantic drift circuit breaker, SLA breach alerts

---

## Candidate Tasks for V211

Priority order (based on ECONOMY.md, PRODUCT_DESIGN.md, and V210 gaps):

### HIGH PRIORITY

**V211-T01: Proof-of-Stake Governance Votes**  
- Weighted voting using staked reputation (not flat 1-person-1-vote)
- Extends `governanceVetoEngine209.js` + `reputationStaking210.js`
- Endpoints: POST /governance/proposals (weight-staked), GET /governance/votes/tally

**V211-T02: Cross-Workspace Royalty Settlement**  
- When a workspace reuses a patch from another workspace, royalty flows automatically
- Extends `knowledgeGraph210.js` edges + `referralEngine210.js` propagation
- Endpoints: POST /royalties/settle, GET /royalties/:workspaceId/ledger

**V211-T03: Reputation Decay Override Market**  
- High-rep validators can "freeze" decay for a fee; unlocks a decay-insurance market
- Extends `computeDecay208` + `purchaseFreeze208` + staking
- Endpoints: POST /workspaces/:id/decay/insure, GET /workspaces/:id/decay/insurance

**V211-T04: Knowledge Graph Semantic Clustering**  
- Auto-cluster graph nodes by domain using a Jaccard similarity heuristic
- Returns cluster map; used to route tasks to the most relevant validators
- Endpoints: GET /patches/clusters, GET /patches/clusters/:clusterId

**V211-T05: Delegated Validator Pools**  
- Groups of validators pool their reputation; pool earns/loses as a unit
- Research: Liquid staking pools (Lido/Rocket Pool)
- Endpoints: POST /validator-pools, POST /validator-pools/:id/join, GET /validator-pools/:id

### MEDIUM PRIORITY

**V211-T06: Proof Attestation NFT (off-chain hash)**  
- When a proof is approved, mint an ERC-721-compatible off-chain record (no blockchain)
- Stores: SHA3 hash, IPFS-style CID, timestamp, approver
- Endpoints: POST /proofs/:id/attest, GET /proofs/:id/attestation

**V211-T07: Calibration-Driven Task Routing**  
- Use auto-calibration params to route borderline tasks to HITL vs auto-settle
- Inline with auto-calibration state
- Endpoints: POST /tasks/route-calibrated, GET /calibration/routing-decision

**V211-T08: Dispute Appeal Layer**  
- Losing party can appeal a dispute to a larger 5-arbiter panel (costs 3x fee)
- Extends `disputeArbiter210.js`
- Endpoints: POST /disputes/:id/appeal, GET /disputes/:id/appeal

**V211-T09: Workspace Reputation Leaderboard (Streamed)**  
- Server-Sent Events (SSE) stream of real-time rep ranking changes (no new deps — Node http)
- Endpoint: GET /leaderboard/stream (SSE)

**V211-T10: Referral Fraud Detection**  
- Detect self-referral rings (A→B→A circular referral abuse)
- Inline heuristic: BFS cycle detection on referral graph
- Endpoint: POST /admin/referral-fraud-check

---

## Implementation Rules (Carry Forward to V211)

1. **R1 — Sacred files**: NEVER modify `lib/fiatLedger.js` or `lib/auditLog.js`
2. **R2 — Suffix convention**: All new identifiers use `211` suffix
3. **R3 — Requires block**: Add V211 requires immediately after V210 require block
4. **R4 — Test exports**: Append to the **same** `if (process.env.NODE_ENV === 'test')` block
5. **R5 — Endpoint location**: Append endpoints AFTER V210 `admin/summary/v210` endpoint
6. **R6 — Zero new npm deps**: No new `package.json` dependencies
7. **R7 — Test file**: Create `tests/v211.test.js` using vitest, import from `'../ecos-api-server.js'`
8. **R8 — MD5 verification**: Verify sacred file MD5s before and after session

---

## V211 Documentation Checklist

- [ ] `CHANGELOG_V211.md`
- [ ] `NEXT_SESSION_PROMPT_V211.md`
- [ ] `AI_PROTOCOL_V211.md`
- [ ] Update `CLAUDE.md` version line to V211

---

## Sacred File MD5s

```
lib/fiatLedger.js  → 563e9b1f9e67091a5b6527c0a92568e5
lib/auditLog.js    → e5a5c2c27801d2d03991bc8e5a1df8cb
```

**Verify at session start with:**
```bash
md5sum lib/fiatLedger.js lib/auditLog.js
```
