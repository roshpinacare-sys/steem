# Next Session Prompt — V176 → V177

## Context Summary

- **Current version:** V176 (Phase P65 COMPLETE)
- **Server:** `ecos-api-server.js` parses clean (`node --check` ✓), 14 118 lines
- **Sacred files:** fiatLedger.js `563e9b1f9e67091a5b6527c0a92568e5` · auditLog.js `e5a5c2c27801d2d03991bc8e5a1df8cb`
- **vendor/nanoid:** pure-JS vendored module present (`vendor/nanoid/index.js`)
- **src/lib:** symlink to `../lib` present (required by smoke tests)

## V176 Deliverables

- **Task Watcher Service:** `lib/taskWatcherService.js` — in-memory + DB, idempotent watch/unwatch, listWatchers, listWatchedTasks, isWatching, stats
  - `POST /tasks/:taskId/watchers` (V176-T01), `DELETE` (V176-T02), `GET /watchers/v2` (V176-T03), `GET /watchers/by-user/:userId` (V176-T04)
- **Workspace Member Service:** `lib/workspaceMemberService.js` — in-memory + DB, upsert, role validation, listMembers (role filter), updateRole, removeMember, stats
  - `POST/GET /members/v2` (V176-T05/T06), `GET/PATCH/DELETE /members/v2/:userId` (V176-T07/T08/T09)
- **Rate Limiter Service:** `lib/workspaceRateLimiterService.js` — per-workspace token bucket, configurable capacity/refill, getBucketStats, stats, auto-cleanup
  - `GET /admin/rate-limits` (V176-T10), `GET /admin/rate-limits/:workspaceId` (V176-T11), `GET /admin/summary/v176` (V176-T12)
- `tests/v176.test.js` — 81 tests ✓

## ⚠️ Pre-flight check (do FIRST, every session)

```bash
node --check ecos-api-server.js          # must print nothing
NODE_ENV=test node tests/v176.test.js    # must show 81 passed, 0 failed
NODE_ENV=test node tests/v175.test.js    # must show 23 passed, 0 failed
node scripts/smoke.js                    # must print ALL SMOKE TESTS PASSED
node -e "console.log(require('./package.json').version)"  # → 176.0.0
md5sum lib/fiatLedger.js lib/auditLog.js  # verify sacred files
```

## V177 Candidates — Phase P66

### P1 (implement these)

1. **Rate-limit middleware integration** — wire `_wsRateLimiter176.check()` as Express middleware
   on workspace routes (`/api/v1/workspaces/:workspaceId/*`). Return `429` with `Retry-After`
   header when bucket is empty. Add `WORKSPACE_RATE_LIMIT_CAPACITY` / `WORKSPACE_RATE_LIMIT_REFILL`
   env vars for configuration.

2. **Search pagination cursor** — cursor-based pagination for `GET /workspaces/:id/search` (currently
   offset-based). Encode cursor as base64 JSON `{ offset, q, types }`. Add `nextCursor` /
   `prevCursor` to response. Backward-compatible: `offset` still works when `cursor` absent.

3. **Audit export CSV** — `GET /workspaces/:id/audit/export?format=csv` currently returns 501.
   Implement RFC 4180 CSV serialization for audit events. Fields: `id, workspaceId, actorId,
   eventType, targetId, targetType, payload, hash, createdAt`. Content-Type:
   `text/csv; charset=utf-8`. Content-Disposition: `attachment; filename=audit-{workspaceId}.csv`.

### P2 (backlog)

4. **Task Watcher notifications** — when a watched task is updated (via `PUT/PATCH /tasks/:taskId`),
   fan out a notification to all watchers via `_wsNotif` (WorkspaceNotificationService).
5. **Member activity log** — log `member.added` / `member.role_changed` / `member.removed` events
   to `_activityFeed` (WorkspaceActivityFeedService) when the V176 member service is used.

## Rules

- **R1** — `lib/fiatLedger.js` and `lib/auditLog.js` are sacred and immutable.
- **R2** — Tag all new endpoints `[V177-Txx]` in ascending order.
- **R3** — Deliver a full ZIP (`ecos_v177_canonical.zip`) with all files.
- **R4** — Do not renumber or remove any prior endpoint.
- **R5** — All prior tests must still pass.
- **R6** — Zero new npm dependencies.
- **R7** — In-memory + optional DB for all new persistence.
- **R8** — `NODE_ENV=test` export block for all new singletons.
- **R9** — Deliver CHANGELOG_V177.md + NEXT_SESSION_PROMPT_V177.md.
- **R10** — JSDoc `@version` tags on all new lib files.
- **R12** — Audit log is append-only; never mutate existing entries.

## Startup checklist

1. Extract `ecos_v176_canonical.zip`
2. `md5sum lib/fiatLedger.js lib/auditLog.js`
3. `node --check ecos-api-server.js`
4. `NODE_ENV=test node tests/v176.test.js`
5. `node -e "console.log(require('./package.json').version)"` → 176.0.0
