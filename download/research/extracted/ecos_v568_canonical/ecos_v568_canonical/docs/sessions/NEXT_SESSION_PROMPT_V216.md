# NEXT_SESSION_PROMPT_V216.md — Start of V220 (Phase P107)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v216_canonical.zip` (root `ecos_v216_canonical/`).
**Read `CLAUDE.md` first — everything is documented there.**

## What Changed in V216-canonical (this ZIP)
- **Pruned:** 43 old AI_PROTOCOLs → 6 (V212, V215–V219). 56 old NSPs → 2. 65 old CHANGELOGs → 8.
- **Added:** `artifacts/researchTool216.jsx` — research tool with Prompt V2 embedded.
- **Added:** `artifacts/ecosNavigator216.jsx` — dashboard / ZIP context extractor (updated to V216).
- **Added:** `docs/RESEARCH_PROMPT_V2.md` — full research prompt for reference.
- **Added:** `AI_PROTOCOL_V220.md` — draft protocol for next session.
- **Fixed:** `lib/` contains only 30 engines unique to that layer (not duplicates of src/lib/).
- **Fixed:** CLAUDE.md is clean, AI-first, complete.
- **Total files:** ~548 (was 973 — 43% reduction).

## State at V219 (code unchanged from v215_merged)
- `ecos-api-server.js` is V214 base. V218 + V219 endpoints in separate patches.
- Tests: V216-V219 test files present but not connected to vitest.
- In-memory stores: see CLAUDE.md table.

## ⚠️ Pre-flight (do FIRST, every session)
```bash
md5sum src/lib/fiatLedger.js src/lib/auditLog.js
# Expected: 563e9b1f… / e5a5c2c2…

node --check ecos-api-server-v218-patch.js
node --check ecos-api-server-v219-patch.js

NODE_ENV=test node tests/v216.test.js
NODE_ENV=test node tests/v217.test.js
NODE_ENV=test node tests/v218.test.js
NODE_ENV=test node tests/v219.test.js
```

## Invariants
R1 sacred files immutable · R2 suffix versioned identifiers · R3 zero npm deps ·
R4 NODE_ENV=test block · R5 version bump · R6 no endpoint removal · R7 no duplicate stores.

## Suggested V220 Work (P107)
1. **P107-A** (BLOCKER) — Merge patches into `ecos-api-server.js` (see `AI_PROTOCOL_V220.md`)
2. **P107-B** — Migrate `lib/` engines to `src/lib/`
3. **P107-C** — Fix `vitest.config.js` to include v216-v219 tests
4. **P107-D** — Workspace Federation (new feature, `_federation220`)
5. **Optional** — Run `researchTool216.jsx` artifact for strategic research

## How to Use the Artifacts
- `artifacts/ecosNavigator216.jsx` → paste as React artifact in Claude → drag ZIP in → copy session block
- `artifacts/researchTool216.jsx` → paste as React artifact in Claude → click Launch
