# Next Session Prompt — V175 → V176

## Context Summary
- **Current version:** V175 (Phase P64 COMPLETE)
- **Server:** `ecos-api-server.js` parses clean (`node --check` ✓)
- **Sacred files:** fiatLedger.js `563e9b1f9e67091a5b6527c0a92568e5` · auditLog.js `e5a5c2c27801d2d03991bc8e5a1df8cb`

## V175 Deliverables
- **Activity Feed v2:** `GET /activity/v2` (types/actorId/since/until/cursor/limit), `GET /activity/v2/types`
- **Search Facets:** `GET /search/facets?q=` → `{ facets: { task, tag, comment }, total }`
- **Audit Export:** `GET /audit/export?format=json` → downloadable JSON, 501 for csv
- `tests/v175.test.js` — 23 tests ✓

## ⚠️ Pre-flight check (do FIRST, every session)
```
node --check ecos-api-server.js   # must print nothing
NODE_ENV=test node tests/v175.test.js  # must pass
```

## V176 Candidates — Phase P65
### P1
1. **Task Watcher Service (in-memory)** — `lib/taskWatcherService.js` with `POST/DELETE/GET /tasks/:taskId/watchers` backed by in-memory store + optional DB. V159 has DB-only routes; this gives them a testable service layer.
2. **Workspace Members Role API** — `lib/workspaceMemberService.js`: in-memory member registry with roles (owner/admin/member), `POST /members`, `GET /members`, `PATCH /members/:userId/role`, `DELETE /members/:userId`.
3. **Rate limiting middleware** — per-workspace request rate limiter (in-memory token bucket), `GET /admin/rate-limits` stats.

### P2
4. Search pagination cursor — cursor-based (vs offset) for large result sets
5. Audit export CSV format — currently returns 501; implement csv serialization

## Rules: R1 sacred immutable · R2 ascending [V176-Txx] · R3 full ZIP ·
R4 no renumbering · R5 prior tests pass · R6 zero new deps · R7 in-mem+DB · R8 NODE_ENV test exports ·
R9 handoff docs · R10 JSDoc version tags · R12 audit append-only.

## Startup checklist
1. Extract `ecos_v175_canonical.zip`
2. `md5sum lib/fiatLedger.js lib/auditLog.js`
3. `node --check ecos-api-server.js`
4. `NODE_ENV=test node tests/v175.test.js`
5. `node -e "console.log(require('./package.json').version)"` → 175.0.0
