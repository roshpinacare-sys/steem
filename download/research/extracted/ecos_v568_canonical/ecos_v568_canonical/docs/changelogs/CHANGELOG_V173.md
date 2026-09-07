# Changelog — V173

## Version: 173.0.0 | Phase: P62

### Critical Changes

#### Recurrence Route Deduplication (P62-1)
- **Removed** dead V169-T01 (`POST .../recurrence`) and V169-T03 (`DELETE .../recurrence`) — these were unreachable duplicates of V162-T01/T02 (Express takes first registered route).
- **Added** V173-T01: `GET /api/v1/workspaces/:workspaceId/tasks/:taskId/recurrence` — retrieves a single task's recurrence rule. Previously implemented as the dead V169-T02 (`_recurrence169.getRecurrence`); now re-wired to the canonical V162 `_recurrence.getRecurrence`. Response: `{ ok, rule, ecosVersion: 'V173' }`.
- `_recurrence169` instance kept (V169 Activity Feed Subscriptions block still references it for `_activitySubs`; `require` is shared).

#### Workspace Search — Real Comments Provider (P62-2)
- Replaced stub `comments: async () => []` in `GET /workspaces/:id/search` with a real provider that reads from `_taskComments._comments` (in-memory Map), filtering to the workspace and excluding deleted comments.
- Search now returns comment results when `types=comments` or when searching across all types.

### New Endpoints
| Tag | Method | Path | Description |
|-----|--------|------|-------------|
| V173-T01 | GET | `/api/v1/workspaces/:id/tasks/:taskId/recurrence` | Get task recurrence rule (canonical V162 service) |
| V173-T02 | GET | `/api/v1/admin/summary/v173` | V173 admin summary |

### Tests
- `tests/v173.test.js` — 18 tests (16 pass, 2 structural guards)

### Sacred Files
- `lib/fiatLedger.js` MD5: `563e9b1f9e67091a5b6527c0a92568e5` ✓ UNCHANGED
- `lib/auditLog.js` MD5: `e5a5c2c27801d2d03991bc8e5a1df8cb` ✓ UNCHANGED
