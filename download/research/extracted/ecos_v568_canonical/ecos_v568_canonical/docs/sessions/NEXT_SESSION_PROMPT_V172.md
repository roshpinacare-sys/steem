# Next Session Prompt — V172 → V173

## Context Summary
- **Current version:** V172 (Phase P61 COMPLETE)
- **Server:** `ecos-api-server.js` parses clean again (`node --check` ✓) — was BROKEN V169–V171 (BUG-L)
- **Cumulative tests:** ≥2,240 (V172: +18; all passing ✓)
- **Sacred files:** fiatLedger.js `563e9b1f9e67091a5b6527c0a92568e5` · auditLog.js `e5a5c2c27801d2d03991bc8e5a1df8cb`

## V172 Deliverables
- **BUG-L fix (CRITICAL):** removed duplicate `const` (`_recurrence`, `RecurrenceNotFoundError`)
  introduced by V169's parallel `taskRecurrenceService`. V169 instance is now `_recurrence169`.
- `lib/workspaceSearchService.js` + `GET /workspaces/:id/search` (V172-T01), admin summary (V172-T02)
- `tests/v172.test.js` — 18 tests

## ⚠️ Pre-flight check (do FIRST, every session — this caught BUG-L)
`node --check ecos-api-server.js`  →  must print nothing.
`NODE_ENV=test node tests/v172.test.js`  →  must pass.
If you see `Identifier '...' has already been declared`, a session re-required a
module and re-declared a `const` — rename the new instance (e.g. `_xxx<ver>`).
If you see `__manus_ec` / `trap '' PIPE`, it is shell corruption — replace with `!!`.

## V173 Candidates — Phase P62
### P1
1. **De-duplicate the two recurrence subsystems** — V162 (`workspaceTaskRecurrenceService`)
   and V169 (`taskRecurrenceService`) both register `POST .../tasks/:taskId/recurrence`.
   Pick one canonical service, remove the dead routes, keep one set of tests.
2. **Task Comments** (P1 from V171 plan) — verify whether `workspaceTaskCommentService`
   already exists before adding; if so, add REST + `@mention` parsing only.
3. **Workspace Search → comments provider** — wire the real comment service into the
   V172 search `comments` provider (currently returns []).
### P2
4. Task Watchers · 5. Notification Webhooks · 6. Search result highlighting in apps/web.

## Rules (carry forward): R1 sacred immutable · R2 ascending [V173-Txx] · R3 full ZIP ·
R4 no renumbering · R5 prior tests pass · R6 zero new deps · R7 in-mem+DB · R8 NODE_ENV test exports ·
R9 handoff docs · R10 JSDoc version tags · R12 audit append-only.

## Startup checklist
1. Extract `ecos_v172_canonical.zip`
2. `md5sum lib/fiatLedger.js lib/auditLog.js`
3. `node --check ecos-api-server.js`   ← BUG-L guard
4. `NODE_ENV=test node tests/v172.test.js`
5. `node -e "console.log(require('./package.json').version)"` → 172.0.0
