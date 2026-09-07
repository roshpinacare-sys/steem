# NEXT_SESSION_PROMPT_V214.md — Start of V215 (Phase P104)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v214_canonical.zip` (root `ecos_v214_canonical/`).

## State at V214
- `ecos-api-server.js` parses clean; version 214.0.0; Phase P103 complete.
- New: `src/research/researchTool214.jsx` — כלי מחקר מובנה שרץ לפני כל גרסה.
- No new server endpoints in V214 — this was a research-tooling release.
- Tests: V213 suite still green (21 tests).

## ⚠️ Pre-flight (do FIRST, every session)
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v213.test.js
for v in 186 187 188 207 208; do NODE_ENV=test node tests/v$v.test.js | grep Results; done
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```

## ⚠️ MANDATORY — הרץ מחקר לפני כל קוד
1. פתח `src/research/researchTool214.jsx` ב-claude.ai Artifacts
2. לחץ "הרץ מחקר מעמיק" — ממתין 30–60 שניות
3. קרא את 7 הטאבים — במיוחד `blind_spots`, `moves_v214_v218`, `red_flags`
4. העתק ממצאים רלוונטיים לכאן לפני כתיבת קוד

## Invariants
- R1 sacred files immutable · R4 no endpoint removal · R5 all prior suites pass
- R6 zero new npm deps · R8 NODE_ENV=test exports + version-suffixed `...215` identifiers
- R9 (NEW) Research tool must be run before architectural decisions

## Chain notes for V215
- Economic Safety Monitor: `_healthSnapshots214` (NEW). Monitor lib: `economicSafetyMonitor213.js`.
- Sacred MD5: `fiatLedger.js` = 563e9b1f... · `auditLog.js` = e5a5c2c2...
- Token burn: `tokenBurnScheduler209.js`. Veto: `governanceVetoEngine209.js`.
- Sybil store: `_sybilVerified214`. Decay cache: `_decayCache214`.
- V214 research tool: `src/research/researchTool214.jsx` — do NOT modify; create `researchTool215.jsx` if upgrade needed.

## Suggested P104 work (V215)
Based on V213→V214 strategic direction:

1. **V215-T01** — Live wire Economic Safety Monitor:
   `GET /admin/health/economy` — feed `assess213` from real ledger/rep/treasury counters.
   Store: `_healthSnapshots214` ring buffer (100). Max staleness 60s.

2. **V215-T02** — Decay enforcement:
   Apply `decayFactor214 = daysSinceLastTask × 0.015` to voting weight + royalty share.
   Function: `computeEffectiveRep215(workspaceId)`. Expose via `GET /workspaces/:id/rep/effective`.

3. **V215-T03** — Stablecoin-only payout guard:
   `assertStablecoinPayout214(currency, payoutType)` — throws `STABLECOIN_GUARD_214` if native token used for executor/connector payout.
   Wire into existing payout flow.

4. **V215-T04** — Sybil gate:
   `POST /workspaces/:id/sybil-verify` + `assertSybilGate214(workspaceId, valueUSD)`.
   Threshold: $1.00. Accepted: Twitter/GitHub OAuth age ≥30d OR World ID nullifier.

5. **V215-Adm** — Admin summary V215.

(Keep additive; no store renaming; no endpoint removal.)
