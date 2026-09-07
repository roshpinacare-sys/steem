# NEXT_SESSION_PROMPT_V217.md — Start of V218 (Phase P105)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v217_canonical.zip` (root `ecos_v217_canonical/`).
**Read `CLAUDE.md` first — everything is documented there.**

## What Changed in V217
- **Added:** `ecos-api-server-v217-patch.js` — 5 endpoints (T01–T05 + Tz).
- **Added:** `_leaderboardSnapshots217` store (Map, 5,000 ring).
- **Added:** `CHANGELOG_V217.md`.
- **Tests:** `tests/v217.test.js` — 88/88 passing.

## State at V217
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

## Suggested V218 Work (P105)
Per `AI_PROTOCOL_V218.md`:
1. **T01** — `POST /validators/:uid/score-history` → `_scoreHistory218` store (8,000 ring)
2. **T02** — `GET /validators/:uid/score-trend` → stateless read of store
3. **T03** — `GET /treasury/flow-summary` → reads `_eventLog181`
4. **T04** — `GET /governance/proposals/tally` → stateless
5. **T05** — `GET /members/:uid/activity-window` → reads `_eventLog181`
