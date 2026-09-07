# AI Protocol — V209 (Phase P98)

  ## Version: 209.0.0 | Phase: P98

  **Sacred files (MUST NOT MODIFY):**
  - `lib/fiatLedger.js` MD5:`563e9b1f9e67091a5b6527c0a92568e5`
  - `lib/auditLog.js` MD5:`e5a5c2c27801d2d03991bc8e5a1df8cb`

  **New lib modules in V209 (6):**
  - `lib/tokenBurnScheduler209.js` — computeBurnAmount209, scheduleBurn209, executeBurn209, getBurnStats209
  - `lib/governanceVetoEngine209.js` — createProposal209, castVeto209, getProposal209
  - `lib/payForProofEscrow209.js` — createEscrow209, submitProof209, approveProof209, rejectProof209, getEscrow209
  - `lib/activeContextRouter209.js` — analyzeContext209
  - `lib/economicAnomalyDetector209.js` — detectCircularFlow209, detectHighVelocity209, detectBulkClaims209, runFullAnomalyCheck209
  - `lib/multiSigTreasury209.js` — createWithdrawalRequest209, signWithdrawal209, getWithdrawalRequest209

  **Endpoints added:** V209-T01 through V209-T14c + V209-Adm (22 total)

  **Tests:** `tests/v209.test.js` — covers all 6 libs + all 22 endpoints

  **Key constants (NODE_ENV=test exports):**
  - `BURN_ALLOCATION_PCT_209 = 0.10`
  - `MIN_BURN_AMOUNT_USD_209 = 1.0`
  - `VETO_QUORUM_PCT_209 = 0.65`
  - `FAST_VETO_THRESHOLD_209 = 3`
  - `FAST_VETO_REP_MIN_209 = 2000`
  - `PROOF_DISPUTE_WINDOW_MS_209 = 172800000 (48h)`
  - `MAX_CONTEXT_MESSAGES_209 = 20`
  - `WASH_TRADE_CYCLE_LIMIT_209 = 3`
  - `VELOCITY_RED_THRESHOLD_209 = 50`
  - `MULTISIG_QUORUM_209 = 3`
  - `MULTISIG_HIGH_VALUE_209 = 10000`
  