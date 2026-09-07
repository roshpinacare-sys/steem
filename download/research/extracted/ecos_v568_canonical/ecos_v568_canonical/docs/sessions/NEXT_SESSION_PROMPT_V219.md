# NEXT_SESSION_PROMPT_V219.md — Start of V220 (Phase P107)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v219_canonical.zip` (root `ecos_v219_canonical/`).
**Read `CLAUDE.md` first — everything is documented there.**

## What Changed in V219
- **Added:** `ecos-api-server-v219-patch.js` — 5 stateless endpoints (T01–T05 + Tz).
- **Zero new stores** — all endpoints read from `_eventLog181` and/or `_scoreHistory218`.
- **Added:** `CHANGELOG_V219.md`.
- **Tests:** `tests/v219.test.js` — 85/85 passing.

## State at V219
- `ecos-api-server.js` is still V214 base. V217–V219 endpoints in separate patches (P107-A blocker).
- In-memory stores: see CLAUDE.md table.

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

## Suggested V220 Work (P107)
Per `AI_PROTOCOL_V220.md`:
1. **P107-A** (HIGH/BLOCKER) — Merge `v218-patch.js` + `v219-patch.js` into `ecos-api-server.js`
2. **P107-B** (MEDIUM) — Move 30 engines from `lib/` into `src/lib/`
3. **P107-C** (MEDIUM) — Fix `vitest.config.js` to include V216–V219 test files
4. **P107-D** (LOW) — Workspace Federation: `_federation220` store + 3 endpoints
