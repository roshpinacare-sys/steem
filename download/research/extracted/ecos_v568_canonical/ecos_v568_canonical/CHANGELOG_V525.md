# CHANGELOG V525 — agent-require ESM bridge restore

**Phase:** P386
**Date:** 2026-06-05
**Author:** AI engineering-partner
**Type:** fix > feature (regression closure)

## What changed
Closes the next NAMED realFail surfaced by V524's `TEST_AUDIT.json`:

```
tests/agent.test.js
  ✗ findSimilarPatches returns results with score field: require is not defined
  ✗ findSimilarPatches returns empty array when no patches:  require is not defined
```

### Root cause
`tests/agent.test.js` is an ES module (`import { describe } from 'vitest';`).
Two `it()` blocks call `require('../lib/semanticSearch')` directly. In ESM
the CommonJS `require` global is absent → "require is not defined" before
any assertion runs.

### Fix
Injected the standard ESM↔CJS bridge at the top of `tests/agent.test.js`:

```js
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
```

After the fix the two specs still fail in this sandbox — but with
`Cannot find module 'pg'` (an environment dep). That string is matched by
`scripts/audit-tests.js`'s `CANNOT_RUN_RX` and the whole suite reclassifies
from `realFail` → `cannotRun`. **realFail count: 9 → 8.**

## Files added
- `lib/agentRequireFix525.js` — read-only introspection connector +
  `selfTest525()` + `registerEndpoints525(app)`.
- `src/lib/agentRequireFix525.js` — byte-identical mirror.
- `tests/v525.test.js` — 12 assertions, plain Node, exit-code truth.
- `CHANGELOG_V525.md`, `NEXT_SESSION_PROMPT_V525.md`.

## Files changed
- `tests/agent.test.js` — added 2 import lines at the top (createRequire bridge).
- `ecos-api-server.js` — appended one IIFE `_wireAgentRequireFix525()`.
- `package.json` — version bump 524.0.0 → 525.0.0 + description.

## Endpoints added
- `GET /api/v1/admin/agent-require-fix/v525`
- `GET /api/v1/admin/summary/v525`

## Sacred & money
- `lib/fiatLedger.js` md5 = `563e9b1f9e67091a5b6527c0a92568e5` — unchanged.
- `lib/auditLog.js`   md5 = `e5a5c2c27801d2d03991bc8e5a1df8cb` — unchanged.
- No money paths touched, no autonomy paths touched, no new npm deps.

## Verification (exit code, no claims)
```
tests/v525.test.js          → 12 passed, 0 failed, exit 0

scripts/audit-tests.js (before V525 changes):
  total=142  pass=109  cannotRun=24  realFail=9
scripts/audit-tests.js (after  V525 changes):
  total=143  pass=110  cannotRun=25  realFail=8
delta: +1 pass (v525.test.js), +1 cannotRun (agent.test.js reclassified),
       -1 realFail (agent.test.js removed). 0 regressions.
```

## What is NOT verified
- The 8 remaining realFail were present in V524 and are NOT fixed here
  (chainProof, cli, embeddingProvider, missionDashboard, monitor, paymentRail,
  stripe, v510-sentinel). v510's sentinel still fails because non-self realFail > 0.
- 25 `cannotRun` suites still require vitest/ESM or missing deps (`pg`,
  `../monitor/index.js`, `../lib/rails/manualRail`) — not in scope for V525.
- The connector's HTTP endpoints were not exercised against a live server in
  this environment; they're verified via `selfTest525()` (T05) and parse (T02)
  only.
