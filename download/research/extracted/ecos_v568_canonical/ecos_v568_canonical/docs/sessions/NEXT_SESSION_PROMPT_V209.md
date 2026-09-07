# NEXT SESSION PROMPT — ECOS V209 → V210

  ## Current state

  ECOS V209 (Phase P98) is complete. The ZIP `ecos_v209_canonical.zip` is the source of truth.

  **Version:** 209.0.0
  **All 6 new lib files:** ✅
  **All 22 new endpoints:** ✅
  **All V208 functionality:** ✅ preserved
  **Sacred files (fiatLedger.js, auditLog.js):** ✅ UNTOUCHED

  ## What V209 added

  - **tokenBurnScheduler209.js** — Deflationary 10%/40% burn scheduler
  - **governanceVetoEngine209.js** — Lazy consensus + fast-veto gate (3+ high-rep = instant rejection)
  - **payForProofEscrow209.js** — Bilateral pay-for-proof escrow with dispute window
  - **activeContextRouter209.js** — Chat→intent analysis, 9 intent types, up to 5 suggestions
  - **economicAnomalyDetector209.js** — Circular flow, velocity, bulk-claim detection
  - **multiSigTreasury209.js** — M-of-N treasury withdrawal (default 3-of-N, threshold $10k)
  - 8 additional inline endpoints: single-player tasks, wallet provisioning, galaxy profile, proof-of-reserves, competitive-map, leagues, federation, validator routing

  ## What V210 should add (priority order)

  ### HIGH PRIORITY

  1. **Reputation Staking (V210-T01)** — Members stake reputation on task outcomes; slashed on wrong validation
     Lib: `lib/reputationStaking210.js`; Endpoint: `POST /api/v1/workspaces/:id/reputation/stake`

  2. **Knowledge Graph API (V210-T02)** — Queryable graph of how semantic patches connect to each other
     Lib: `lib/knowledgeGraph210.js`; Endpoints: `GET /api/v1/patches/graph`, `GET /api/v1/patches/:id/neighbors`

  3. **Auto-Calibration Feedback Loop (V210-T03)** — Platt-scale recalibration based on validator override patterns
     Lib: `lib/autoCalibration210.js`; Endpoint: `POST /api/v1/calibration/recalibrate`

  4. **Workspace Health Composite Score (V210-T04)** — Single 0-100 health score combining streak + reputation + economic health
     Endpoint: `GET /api/v1/workspaces/:id/health-score`

  5. **Referral Network Royalties (V210-T05)** — Track referral trees; propagate micro-royalties up the chain
     Lib: `lib/referralEngine210.js`

  6. **Encrypted Proof Submission (V210-T06)** — Zero-knowledge proof hash submission (sha256 blind reveal)

  7. **Task Expiry & Auto-Return (V210-T07)** — Escrows auto-return after TTL if no proof submitted

  ## Rules for V210 (SAME AS ALL VERSIONS)

  - **R1 SACRED:** Never modify `lib/fiatLedger.js` or `lib/auditLog.js`
  - **R6:** Zero new npm dependencies
  - **BUG-L:** All new identifiers suffixed with `210`
  - **Require blocks:** Add AFTER last V209 require block
  - **Test exports:** Add to SINGLE EXISTING NODE_ENV==='test' block
  - **Endpoints:** Add AFTER V209 admin summary endpoint
  - **Version:** package.json 209.0.0 → 210.0.0
  - **Output ZIP:** `ecos_v210_canonical.zip`
  