# NEXT SESSION PROMPT — ECOS V208 → V209

## Current state

ECOS V208 (Phase P97) is complete. The ZIP `ecos_v208_canonical.zip` is the source of truth.

**Version:** 208.0.0  
**All 6 new lib files:** ✅ implemented  
**All 13 new endpoints:** ✅ implemented  
**All V207 functionality:** ✅ preserved  
**Sacred files (fiatLedger.js, auditLog.js):** ✅ UNTOUCHED  

## What V208 added

### From PDF #1 (failure autopsy — FTX/Terra/Celsius/3AC/Colony/Build Finance):
- **reputationDecayEngine208.js** — Exponential decay R(t)=R₀×e^(−λt), Gini, RII, governance power=sqrt(rep)
- **economicHealthMonitor208.js** — 4 red-flag metrics with exact thresholds from research
- **workStreakEngine208.js** — Duolingo-style streak, loss-aversion freeze mechanic, anti-hollow gate
- **systemCapabilities208.js** — 17 capability domains, guided actions catalog, onboarding score, Sybil gate

### From PDF #2 (BIM specification — Browser-native Inference Mesh):
- **agentConsensusEngine208.js** — Tolerance-aware consensus: NED (code), cosine (vectors), Jaccard (prose)
- **diversityRouter208.js** — Weighted Rendezvous Hashing + diversity constraints + collusion detection

## What V209 should add (priority order)

### HIGH PRIORITY (from research)

1. **Token Burn Mechanism (V209-T01)**  
   Research: "10% of platform's 40% should buy and burn protocol token from market"  
   Implement: `POST /api/v1/treasury/burn-schedule` — calculate and schedule periodic burn  
   Lib: `lib/tokenBurnScheduler209.js`

2. **Lazy Consensus / Veto Gate (V209-T02)**  
   Research: "High-reputation members can fast-veto suspicious treasury proposals"  
   Implement: `POST /api/v1/governance/proposals/:id/veto` with quorum check  
   Lib: `lib/governanceVetoEngine209.js`

3. **Pay-for-Proof Escrow (V209-T03)**  
   Research: "Tasks managed via pay-for-proof — no unilateral payment release"  
   Implement: `POST /api/v1/tasks/:id/proof` + `POST /api/v1/tasks/:id/release`  
   Lib: `lib/payForProofEscrow209.js`

4. **Single-Player Mode (V209-T04)**  
   Research: Notion lesson — "users can manage personal tasks privately via AI without network dependency"  
   Implement: `POST /api/v1/workspaces/:id/tasks/private` — private task mode  

5. **Active Context Routing (V209-T05)**  
   Research: ECOS unique differentiator — AI reads chat and proactively surfaces tasks  
   Implement: `POST /api/v1/context/analyze` — parse chat context, emit task suggestions  
   Lib: `lib/activeContextRouter209.js`

6. **Embedded Wallet Abstraction (V209-T06)**  
   Research: "Account Abstraction — create wallet in first chat message, gas subsidized by 40%"  
   Implement: `POST /api/v1/workspaces/:id/wallet/provision`  
   Gas subsidy: deducted from platform's 40% share

7. **Dynamic Reputation Galaxy (V209-T07)**  
   Research: `/profile` command → generate dynamic image showing workspace as "planet" in galaxy  
   Each skill = satellite orbit. Governance = "red sun" at center.  
   Implement: `GET /api/v1/workspaces/:id/profile/galaxy` → SVG/JSON galaxy spec

### MEDIUM PRIORITY

8. **Proof of Reserves (V209-T08)**  
   Research: Celsius "no on-chain proof of reserves" failure  
   Implement: `GET /api/v1/treasury/reserves/proof` — Merkle-tree-based reserve attestation

9. **Competitive Intelligence Monitor (V209-T09)**  
   Track: Braintrust, Gitcoin, Dework, Coordinape, Colony, Autonolas, Superfluid, Bittensor  
   Implement: `GET /api/v1/admin/competitive-map` — gaps/opportunities dashboard

10. **Competitive Leagues (V209-T10)**  
    Research: Duolingo leagues table — "competitive leagues drive retention by ranking contributors"  
    Implement: `GET /api/v1/leagues/current` — weekly XP leaderboard by cohort

## Rules for V209 (SAME AS ALL VERSIONS)

- **R1 SACRED:** Never modify `src/lib/fiatLedger.js` (MD5: 563e9b1f9e67091a5b6527c0a92568e5) or `src/lib/auditLog.js` (MD5: e5a5c2c27801d2d03991bc8e5a1df8cb)
- **R6:** Zero new npm dependencies — all Node.js built-ins only
- **BUG-L:** All new identifiers suffixed with `209`
- **Require blocks:** Add at TOP of ecos-api-server.js, BEFORE V186 marker, specifically AFTER the last V208 require block
- **Test exports:** Add to the SINGLE EXISTING `if (process.env.NODE_ENV === 'test')` block (use lastIndexOf pattern if needed)
- **Endpoints:** Add AFTER the V208 block (after `/api/v1/admin/summary/v208`)
- **Version:** package.json 208.0.0 → 209.0.0
- **Output ZIP:** `ecos_v209_canonical.zip`

## File structure to preserve

```
ecos_v209_canonical/
├── ecos-api-server.js     ← main server (19,800+ lines after V208)
├── package.json           ← version: 209.0.0
├── lib/
│   ├── ...all V207 libs...
│   ├── systemCapabilities207.js
│   ├── reputationDecayEngine208.js   ← V208 ✅
│   ├── economicHealthMonitor208.js   ← V208 ✅
│   ├── workStreakEngine208.js        ← V208 ✅
│   ├── systemCapabilities208.js     ← V208 ✅
│   ├── agentConsensusEngine208.js   ← V208 ✅
│   ├── diversityRouter208.js        ← V208 ✅
│   └── [new V209 libs here]
├── tests/
│   ├── v207.test.js
│   ├── v208.test.js                 ← V208 ✅
│   └── v209.test.js                 ← to create
└── CHANGELOG_V208.md
```

## Research to apply in V209

Search for new research PDFs attached to the conversation. If new PDFs attached:
1. Read ALL lines before writing any code
2. Synthesize findings into `RESEARCH_SYNTHESIS_V209.md`
3. Map each finding to a concrete guardrail/endpoint
4. Only then implement

## Key economic invariants (NEVER violate)

- 40% executor + 40% platform + 20% connector = 100% (always USDC/ETH)
- Protocol token = governance + staking ONLY (never wage)
- Reputation decay: active = growing, inactive = shrinking
- Governance quorum ≥ 65% dynamic
- AI agent payment autonomy ≤ $20 USD
- BIM consensus required before payment release
- Diversity routing enforced for all peer reviews
