# CHANGELOG_V177.md — ECOS V177 (Phase P66)

**Release date:** 2026-05-30
**Base:** V176 canonical
**Server:** ecos-api-server.js · 14,267 lines
**package.json:** 177.0.0
**Test suite:** tests/v177.test.js · 82 tests, 0 failures

---

## P1 Deliverables

### V177-T01 · Rate-Limit Middleware on Workspace Routes

**Route:** `app.use('/api/v1/workspaces', fn)` (Express 5 prefix middleware)

Added a per-workspace token-bucket rate-limiter as Express middleware on every
`/api/v1/workspaces` route. The middleware extracts the workspaceId from the
first path segment of `req.url` (which Express strips the mount prefix from),
calls `_wsRateLimiter177.check(workspaceId)`, and on exhaustion returns:

```
HTTP 429 Too Many Requests
Retry-After: <seconds>
{ ok: false, code: "WORKSPACE_RATE_LIMITED", workspaceId, remaining: 0,
  resetAt: <ISO8601>, ecosVersion: "V177" }
```

Configuration via environment variables:
| Variable | Default | Meaning |
|---|---|---|
| `WORKSPACE_RATE_LIMIT_CAPACITY` | 60 | Token-bucket capacity per workspace |
| `WORKSPACE_RATE_LIMIT_REFILL` | 60 | Tokens refilled per window |

The V177 limiter (`_wsRateLimiter177`) is a **new, separate instance** from
the V176 per-route limiter (`_wsRateLimiter176`). Both coexist.

Test exports (NODE_ENV=test):
- `exports._wsRateLimiter177` — singleton instance
- `exports.WorkspaceRateLimiterService177` — constructor
- `exports._rl177Capacity` / `exports._rl177Refill` — configured values

---

### V177-T02 · Search Cursor Pagination on GET /workspaces/:id/search

**Route:** `GET /api/v1/workspaces/:workspaceId/search`

The search endpoint now supports opaque base64 cursor tokens alongside the
existing `offset=` query parameter. Cursor encoding:

```js
// encode
cursor = Buffer.from(JSON.stringify({ offset, q, types })).toString('base64')
// decode
{ offset, q, types } = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'))
```

Response shape additions:
```json
{
  "results": [...],
  "total": 42,
  "offset": 20,
  "limit": 20,
  "hasMore": true,
  "nextCursor": "<base64>",
  "prevCursor": "<base64>|null",
  "ecosVersion": "V177"
}
```

- `nextCursor` — present and non-null only when `hasMore === true`
- `prevCursor` — non-null only when `offset > 0`
- Malformed cursor falls through silently to raw `?q=&offset=` params
- `?offset=` parameter still accepted for backward compatibility

---

### V177-T03 · Audit Export CSV Implementation (replaces 501 stub)

**Route:** `GET /api/v1/workspaces/:workspaceId/audit/export?format=csv`

Replaced the V175 `501 Not Implemented` stub with a full RFC 4180–compliant
CSV export.

Response headers:
```
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="audit-{workspaceId}.csv"
```

CSV schema (9 columns, all fields double-quoted per RFC 4180):
```
id,workspaceId,actorId,eventType,targetId,targetType,payload,hash,createdAt
```

RFC 4180 compliance:
- Every data field wrapped in double-quotes
- Internal double-quotes escaped as `""`
- Object/array fields (e.g. `payload`) serialized as JSON before quoting
- `null` / `undefined` fields render as `""`
- Lines separated by CRLF (`\r\n`)
- File ends with a trailing CRLF

Unknown `format=` values now return **HTTP 400** (was 501).
`format=json` default behaviour unchanged.

---

### V177-T04 · Admin Summary Endpoint

**Route:** `GET /api/v1/admin/summary/v177`

Returns a JSON document describing the V177 feature set and current runtime
configuration:

```json
{
  "ok": true,
  "phase": "P66",
  "version": "V177",
  "features": [
    "workspace-rate-limit-middleware",
    "search-cursor-pagination",
    "audit-export-csv"
  ],
  "config": {
    "rateLimitCapacity": 60,
    "rateLimitRefill": 60
  },
  "rateLimiter177": { "activeBuckets": 0, "totalRequests": 0 },
  "ecosVersion": "V177"
}
```

---

## Backward Compatibility

| Guarantee | Status |
|---|---|
| All V176 test tags preserved (V176-T01..T12) | ✓ |
| All V175 test tags preserved (V175-T01..T05) | ✓ |
| V172-T01 (search route), V158-T12 (task search) preserved | ✓ |
| Sacred files unchanged (fiatLedger.js, auditLog.js) | ✓ MD5 verified |
| `_wsRateLimiter176` singleton still exported | ✓ |
| `_taskWatcher176`, `_memberSvc176` still exported | ✓ |
| `_activityFeed175` still exported | ✓ |
| `?offset=` param on search still accepted | ✓ |
| `format=json` still default for audit export | ✓ |
| JSON audit export response unchanged | ✓ |

---

## Bug Fix

**lib/notificationTemplates.js line 164** — Pre-existing unescaped apostrophe
in a French string literal (`'Quelqu'un a réagi…'`) escaped to
`'Quelqu\'un a réagi…'`. This was a latent syntax error that prevented
direct `require()` of any file that (transitively) loaded this module.

---

## Test Results Summary

| Suite | Passed | Failed | Notes |
|---|---|---|---|
| v177.test.js | 82 | 0 | All P66 deliverables |
| v176.test.js | 80 | 1 | Expected: version check (176→177) |
| v175.test.js | 22 | 1 | Pre-existing: version check (175→177) |

