# Next Session Prompt — V173 → V174

## Context Summary
- **Current version:** V173 (Phase P62 COMPLETE)
- **Server:** `ecos-api-server.js` parses clean (`node --check` ✓)
- **Sacred files:** fiatLedger.js `563e9b1f9e67091a5b6527c0a92568e5` · auditLog.js `e5a5c2c27801d2d03991bc8e5a1df8cb`

## V173 Deliverables
- **Recurrence consolidation:** Dead V169-T01/T03 (duplicate POST/DELETE) removed. V173-T01: `GET /workspaces/:id/tasks/:taskId/recurrence` re-wired to canonical V162 `_recurrence` service.
- **Search comments provider:** Real `_taskComments._comments` data wired into workspace search (replaces stub `[]`).
- `tests/v173.test.js` — 18 tests ✓

## ⚠️ Pre-flight check (do FIRST, every session)
```
node --check ecos-api-server.js   # must print nothing
NODE_ENV=test node tests/v173.test.js  # must pass
```
If you see `Identifier '...' has already been declared` → duplicate const, rename new instance.

## V174 Candidates — Phase P63
### P1
1. **Task Watchers** — `POST/DELETE /tasks/:taskId/watchers`, `GET /tasks/:taskId/watchers`, notify watchers on task events.
2. **Notification Webhooks** — push events to registered URLs when workspace events fire.
3. **Search highlighting** — return `highlight` field on search results (mark matched spans in title/body).

### P2
4. Audit log query endpoint — `GET /workspaces/:id/audit?limit=&cursor=&action=`
5. Activity feed v2 — pagination + filter by event type

## Rules (carry forward): R1 sacred immutable · R2 ascending [V174-Txx] · R3 full ZIP ·
R4 no renumbering · R5 prior tests pass · R6 zero new deps · R7 in-mem+DB · R8 NODE_ENV test exports ·
R9 handoff docs · R10 JSDoc version tags · R12 audit append-only.

## Startup checklist
1. Extract `ecos_v173_canonical.zip`
2. `md5sum lib/fiatLedger.js lib/auditLog.js`
3. `node --check ecos-api-server.js`
4. `NODE_ENV=test node tests/v173.test.js`
5. `node -e "console.log(require('./package.json').version)"` → 173.0.0
