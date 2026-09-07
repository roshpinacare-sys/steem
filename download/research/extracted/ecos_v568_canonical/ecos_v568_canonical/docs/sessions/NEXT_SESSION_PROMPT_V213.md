# NEXT_SESSION_PROMPT_V213.md — Start of V214 (Phase P103)

## State at V213
- `ecos-api-server.js` parses clean; version 213.0.0; Phase P102 complete.
- New: `lib/economicSafetyMonitor213.js` + `GET /admin/economic-safety[/:indexId]` (V213-T01/T02), summary (T03).
- Tests: `tests/v213.test.js` (21). Stabilized v186/187/188/207 (R6 narrowed to npm-only).

## ⚠️ Pre-flight (do FIRST)
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v213.test.js
for v in 186 187 188 207 208; do NODE_ENV=test node tests/v$v.test.js | grep Results; done
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```
- **Convention clarified:** new libs may be `require()`d inside an appended IIFE block (relative
  `./lib/*` paths are fine). The R6 guards now flag only NEW npm/bare-package requires.
- Do NOT add a new top-level `if (NODE_ENV==='test')` block — v187/v188 use `lastIndexOf` to find
  the final export block. Either merge into it, or (preferred for pure libs) test the lib directly.
- vitest suites (v209+) need `npm install`; they don't run in the offline sandbox — that's expected.
- `Identifier '...' already declared` → suffix new identifiers `...214` (BUG-L). `__manus_ec` → BUG-K.
- A prior suite failing only on `pkg.version === '21x.0.0'` → relax to `major >= 21x`.

## Strategic direction (owner)
Translate the research into enforced guardrails, not just monitors. Highest-leverage V214 work:
1. **Wire the Economic Safety Monitor into live data** — feed real ledger/reputation/treasury
   counters into `assess213` and expose a single `/admin/health/economy` with cached snapshots.
2. **Decay enforcement** — make reputation/royalty decay (research §3 "Value Claim Decay") actually
   reduce voting weight + royalty share, not just report. Extends reputation + governance modules.
3. **Stablecoin-only payout guard** — enforce that executor/connector payouts are external-stable
   only; native token staking-only (research move #2). Add a guard + test.
4. **Sybil gate** — require an aged verified social link before financial-value tasks (research move, blind-spot #3).

## Packaging
`ecos_v213_canonical.zip`, root `ecos_v213_canonical/`.
