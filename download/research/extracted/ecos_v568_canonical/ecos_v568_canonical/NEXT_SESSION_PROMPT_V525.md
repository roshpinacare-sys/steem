# NEXT SESSION PROMPT — after V525

You inherit `ecos_v525_canonical.zip` (V525.0.0). Goal: produce V526.

## What is SAFE (verified, exit-code truth)
- SACRED md5 unchanged: `lib/fiatLedger.js` `563e9b1f...`, `lib/auditLog.js` `e5a5c2c2...`.
- `ecos-api-server.js` parses (`node --check`).
- `tests/v525.test.js` → 12/12 pass, exit 0.
- `scripts/audit-tests.js` → **total=143 pass=110 cannotRun=25 realFail=8** (was 142/109/24/9 in V524).
- `agent.test.js` no longer in realFail (reclassified to cannotRun on `Cannot find module 'pg'`).
- New connector `lib/agentRequireFix525.js` mirrored byte-identical at `src/lib/`.
- IIFE `_wireAgentRequireFix525()` added at end of `ecos-api-server.js`.

## What is FRAGILE / NOT verified
- 8 realFail remain (all pre-existed V525). Listed in `TEST_AUDIT.json`:
  `chainProof.test.js`, `cli.test.js`, `embeddingProvider.test.js`,
  `missionDashboard.test.js`, `monitor.test.js`, `paymentRail.test.js`,
  `stripe.test.js`, `v510.test.js` (sentinel — passes iff others pass).
- `v510.test.js` will keep failing until non-self realFail = 0.
- HTTP endpoints registered by V525 IIFE were not hit against a live server
  here; verified only via parse + `selfTest525()`.

## Recommended target for V526 (cheapest realFail to close)
The lowest-effort, highest-honesty win:

1. **`monitor.test.js` + `cli.test.js`** — both fail on
   `Cannot find module '../monitor/index.js'`. The path `engine/monitor/index.js`
   exists in repo. Either (a) add a thin re-export at `monitor/index.js` that
   does `module.exports = require('../engine/monitor');` (verify the engine
   module's surface first), or (b) patch both tests to import from the real
   path. **Before either**: `grep -rn "require.*monitor/index" tests/ lib/ engine/`
   to ensure no other module already paves this path. Inheritance > duplication.
2. **`paymentRail.test.js`** — fails on `Cannot find module '../lib/rails/manualRail'`.
   `lib/rails/` does not exist. Search for `manualRail` / `stripeRail` /
   `bankTransferRail` / `railRegistry` in repo: if they live under another
   path (likely consolidated in V502 cleanup), add a single thin re-export
   directory `lib/rails/` OR patch the test imports. Do NOT recreate the
   implementations — that's duplication.
3. **`embeddingProvider.test.js`** — `expected mock to be called 1 times, got 0`.
   Almost certainly a vitest-shim gap around `vi.fn()` call tracking + an
   async path. V524 added basic `toHaveBeenCalled*` matchers; check whether
   the test uses `vi.spyOn` or `vi.mock` and extend the shim minimally.
4. **`chainProof.test.js` / `missionDashboard.test.js`** — both fail on
   `Failed to parse URL from undefined/api/v1/...`. Tests build URLs from an
   env var that isn't set under plain `node`. Either set a default base URL
   in the connector module OR patch the tests to fall back to
   `http://127.0.0.1:0`. Read both tests first; they likely share a helper.

Pick **one**. Don't fan out.

## Hard rules (do not violate)
- Don't touch SACRED. Re-check md5 in your V526 test.
- Don't add npm deps. Node builtins + relative requires + vendored source only.
- Don't delete or rename a file without `grep`ing every `tests/` reference first
  (this rule prevented a V502-style regression and is restated here for V526).
- New artifacts named `<name>526.js`, mirrored at `lib/` and `src/lib/`.
- New IIFE at end of `ecos-api-server.js`, endpoints `V526-T01…` and
  `GET /api/v1/admin/summary/v526`.
- `tests/v526.test.js` MUST verify SACRED md5, server parse, mirror identity,
  fail-closed behavior, and the specific NAMED realFail it claims to close
  (run it under plain `node` via `execSync` and grep the output).
- Re-run `scripts/audit-tests.js` **twice** (v510 reads `TEST_AUDIT.json`
  written by the previous run); report before→after numbers.
- Repack via `zip -rqX ecos_v526_canonical.zip ecos_v526_canonical`, then
  re-extract to `/tmp` and re-verify on the extracted copy before handing off.

## Cheat-sheet
```
md5sum lib/fiatLedger.js lib/auditLog.js
node --check ecos-api-server.js
NODE_ENV=test node tests/v525.test.js     # baseline must stay green
node scripts/audit-tests.js               # twice, then read TEST_AUDIT.json
```
