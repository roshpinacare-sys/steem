# NEXT_SESSION_PROMPT_V218.md — Start of V219 (Phase P106)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v218_canonical.zip` (root `ecos_v218_canonical/`).
**Read `CLAUDE.md` first — everything is documented there.**

## What Changed in V218
- **Added:** `ecos-api-server-v218-patch.js` — 5 endpoints (T01–T05 + Tz).
- **Added:** `_scoreHistory218` store (Map, 8,000 ring eviction by oldest timestamp).
- **Added:** `CHANGELOG_V218.md`.
- **Tests:** `tests/v218.test.js` — all passing.

## State at V218
- `ecos-api-server.js` is still V214 base. V217, V218, V219 endpoints in separate patches.
- In-memory stores: see CLAUDE.md table (updated).

## ⚠️ Pre-flight (do FIRST, every session)
```bash
md5sum src/lib/fiatLedger.js src/lib/auditLog.js
# Expected: 563e9b1f… / e5a5c2c2…

node --check ecos-api-server-v217-patch.js
node --check ecos-api-server-v218-patch.js
node --check ecos-api-server-v219-patch.js

NODE_ENV=test node tests/v217.test.js
NODE_ENV=test node tests/v218.test.js
NODE_ENV=test node tests/v219.test.js
```

## Invariants
R1 sacred files immutable · R2 suffix versioned identifiers · R3 zero npm deps ·
R4 NODE_ENV=test block · R5 version bump · R6 no endpoint removal · R7 no duplicate stores.

## Suggested V219 Work (P106)
Per `AI_PROTOCOL_V219.md`:
1. **T01** — `GET /workspaces/:id/health-score` → stateless from `_eventLog181`
2. **T02** — `GET /workspaces/:id/validators/:uid/performance-index` → reads `_scoreHistory218` + `_eventLog181`
3. **T03** — `POST /workspaces/batch-summary` → stateless from `_eventLog181` (max 20)
4. **T04** — `GET /workspaces/:id/validators/:uid/score-percentile` → reads `_scoreHistory218`
5. **T05** — `GET /workspaces/:id/events/replay` → stateless from `_eventLog181` (max 500)
