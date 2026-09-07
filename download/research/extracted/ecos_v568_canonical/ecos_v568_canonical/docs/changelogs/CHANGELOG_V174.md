# Changelog — V174

## Version: 174.0.0 | Phase: P63

### New Features

#### Audit Log Query API (P63-1)
- **V174-T01** `GET /api/v1/workspaces/:workspaceId/audit` — paginated + filtered audit event query. Query params: `actorId`, `eventType`, `targetId`, `since`, `until`, `limit` (max 200), `cursor`. Returns `{ events, total, hasMore, nextCursor }`.
- **V174-T02** `GET /api/v1/workspaces/:workspaceId/audit/verify` — verifies the cryptographic hash chain of the workspace audit log. Returns `{ ok, verification }`. Status 409 if chain is broken.
- **V174-T03** `GET /api/v1/workspaces/:workspaceId/audit/stats` — aggregate audit statistics.

#### Search Result Highlighting (P63-2)
- Added `highlight(text, q)` to `lib/workspaceSearchService.js` — returns `[{ start, end, text }]` spans (all occurrences, case-insensitive).
- Every search result now carries a `highlights` array (spans in the title for tasks/tags, body for comments).
- **V174-T04** `GET /api/v1/admin/summary/v174`

### New Endpoints
| Tag | Method | Path | Description |
|-----|--------|------|-------------|
| V174-T01 | GET | `/api/v1/workspaces/:id/audit` | Paginated filtered audit log |
| V174-T02 | GET | `/api/v1/workspaces/:id/audit/verify` | Chain integrity verify |
| V174-T03 | GET | `/api/v1/workspaces/:id/audit/stats` | Audit aggregate stats |
| V174-T04 | GET | `/api/v1/admin/summary/v174` | V174 admin summary |

### Tests
- `tests/v174.test.js` — 23 tests ✓

### Sacred Files
- `lib/fiatLedger.js` MD5: `563e9b1f9e67091a5b6527c0a92568e5` ✓ UNCHANGED
- `lib/auditLog.js` MD5: `e5a5c2c27801d2d03991bc8e5a1df8cb` ✓ UNCHANGED
