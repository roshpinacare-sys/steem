# Next Session Prompt — V174 → V175

## Context Summary
- **Current version:** V174 (Phase P63 COMPLETE)
- **Server:** `ecos-api-server.js` parses clean (`node --check` ✓)
- **Sacred files:** fiatLedger.js `563e9b1f9e67091a5b6527c0a92568e5` · auditLog.js `e5a5c2c27801d2d03991bc8e5a1df8cb`

## V174 Deliverables
- **Audit Log Query:** V174-T01 `GET /audit` (paginated+filtered), V174-T02 `GET /audit/verify` (chain integrity), V174-T03 `GET /audit/stats`
- **Search Highlighting:** `highlight(text, q)` in `workspaceSearchService.js`; all search results now carry `highlights:[{start,end,text}]`
- `tests/v174.test.js` — 23 tests ✓

## ⚠️ Pre-flight check (do FIRST, every session)
```
node --check ecos-api-server.js   # must print nothing
NODE_ENV=test node tests/v174.test.js  # must pass
```

## V175 Candidates — Phase P64
### P1
1. **Activity Feed v2** — `GET /workspaces/:id/activity?eventType=&actorId=&limit=&cursor=` (paginated, typed), building on existing `_auditTrail`.
2. **Task Watchers in-memory service** — `lib/taskWatcherService.js` with `POST/DELETE/GET /tasks/:id/watchers` (V159 DB-only routes exist; add in-memory + test coverage).
3. **Workspace Members** — `POST/GET/DELETE /workspaces/:id/members` with role (owner/admin/member) validation.

### P2
4. Search facets — `GET /workspaces/:id/search/facets?q=` returns counts per type
5. Audit log export — `GET /workspaces/:id/audit/export?format=json|csv`

## Rules (carry forward): R1 sacred immutable · R2 ascending [V175-Txx] · R3 full ZIP ·
R4 no renumbering · R5 prior tests pass · R6 zero new deps · R7 in-mem+DB · R8 NODE_ENV test exports ·
R9 handoff docs · R10 JSDoc version tags · R12 audit append-only.

## Startup checklist
1. Extract `ecos_v174_canonical.zip`
2. `md5sum lib/fiatLedger.js lib/auditLog.js`
3. `node --check ecos-api-server.js`
4. `NODE_ENV=test node tests/v174.test.js`
5. `node -e "console.log(require('./package.json').version)"` → 174.0.0
