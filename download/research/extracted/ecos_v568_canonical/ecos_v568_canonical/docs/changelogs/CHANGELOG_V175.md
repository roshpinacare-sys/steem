# Changelog — V175

## Version: 175.0.0 | Phase: P64

### New Features

#### Activity Feed v2 (P64-1)
- **V175-T01** `GET /api/v1/workspaces/:workspaceId/activity/v2` — paginated activity feed with filtering by `types` (csv), `actorId`, `since`, `until`, `cursor`, `limit` (max 100). Returns `{ events, total, nextCursor, prevCursor, filters }`.
- **V175-T04** `GET /api/v1/workspaces/:workspaceId/activity/v2/types` — list all valid event types.

#### Search Facets (P64-2)
- **V175-T02** `GET /api/v1/workspaces/:workspaceId/search/facets?q=` — returns result counts grouped by type `{ task, tag, comment }` without returning the full result list. Reuses all existing search providers.

#### Audit Log Export (P64-3)
- **V175-T03** `GET /api/v1/workspaces/:workspaceId/audit/export?since=&until=&format=json` — exports all workspace audit events as a downloadable JSON file. Returns 501 for unsupported formats (csv reserved for future).

### New Endpoints
| Tag | Method | Path | Description |
|-----|--------|------|-------------|
| V175-T01 | GET | `/api/v1/workspaces/:id/activity/v2` | Activity feed v2 (filtered + paginated) |
| V175-T02 | GET | `/api/v1/workspaces/:id/search/facets` | Search result counts per type |
| V175-T03 | GET | `/api/v1/workspaces/:id/audit/export` | Audit log JSON export |
| V175-T04 | GET | `/api/v1/workspaces/:id/activity/v2/types` | Valid activity event types |
| V175-T05 | GET | `/api/v1/admin/summary/v175` | V175 admin summary |

### Tests
- `tests/v175.test.js` — 23 tests ✓

### Sacred Files
- `lib/fiatLedger.js` MD5: `563e9b1f9e67091a5b6527c0a92568e5` ✓ UNCHANGED
- `lib/auditLog.js` MD5: `e5a5c2c27801d2d03991bc8e5a1df8cb` ✓ UNCHANGED
