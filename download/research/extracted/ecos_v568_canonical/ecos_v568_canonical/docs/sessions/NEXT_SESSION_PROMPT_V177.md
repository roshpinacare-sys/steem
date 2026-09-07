# NEXT_SESSION_PROMPT_V177.md — Start of V178 (Phase P67)

## Context

You are continuing ECOS API Server development. The canonical ZIP for V177
is `ecos_v177_canonical.zip`.

**Extract with:**
```bash
mkdir -p /tmp/ecos_work
cd /tmp/ecos_work
python3 -c "
import zipfile, os
z = zipfile.ZipFile('ecos_v177_canonical.zip')
for info in z.infolist():
    if (info.external_attr >> 16) & 0xF000 == 0xA000:   # symlink
        target = z.read(info.filename).decode()
        dst    = os.path.join('/tmp/ecos_work', info.filename)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if os.path.lexists(dst): os.unlink(dst)
        os.symlink(target, dst)
    else:
        z.extract(info, '/tmp/ecos_work')
print('Done')
"
cd /tmp/ecos_work/ecos_v177_canonical
npm install
```

**Verify state:**
```bash
node --check ecos-api-server.js
NODE_ENV=test node tests/v177.test.js
```
Expected: 82 passed, 0 failed.

---

## Current Server State

- **File:** `ecos-api-server.js` · ~14,267 lines
- **Version:** 177.0.0
- **Phase completed:** P66

### Feature tags present
- V177-T01: Rate-limit middleware on `/api/v1/workspaces` routes
- V177-T02: Cursor pagination on `GET /workspaces/:id/search`
- V177-T03: RFC 4180 CSV audit export (replaces V175 501 stub)
- V177-T04: Admin summary `GET /api/v1/admin/summary/v177`

### Key services (lib/)
| File | Export | Role |
|---|---|---|
| `lib/workspaceRateLimiterService.js` | `WorkspaceRateLimiterService`, `defaultRateLimiterService` | Token-bucket per workspace |
| `lib/workspaceAuditTrailService.js` | `WorkspaceAuditTrailService`, `defaultAuditTrail` | Audit event store |
| `lib/workspaceSearchService.js` | `WorkspaceSearchService`, `defaultSearchService` | Workspace search |
| `lib/workspaceMemberService.js` | `WorkspaceMemberService`, `defaultMemberService` | Member management |
| `lib/workspaceTaskWatcherService.js` | `WorkspaceTaskWatcherService` | Task event watching |
| `lib/workspaceActivityFeedService.js` | `WorkspaceActivityFeedService` | Activity feed |
| `lib/fiatLedger.js` | _(sacred)_ | MD5: 563e9b1f9e67091a5b6527c0a92568e5 |
| `lib/auditLog.js` | _(sacred)_ | MD5: e5a5c2c27801d2d03991bc8e5a1df8cb |

### Test exports (NODE_ENV=test)
- `_wsRateLimiter177` — V177 singleton (new instance)
- `WorkspaceRateLimiterService177` — constructor alias
- `_rl177Capacity` / `_rl177Refill` — configured values
- `_wsRateLimiter176` — V176 singleton (preserved)
- `_taskWatcher176`, `_memberSvc176` — V176 services
- `_activityFeed175` — V175 service

---

## Invariants (must hold for all future phases)

- **R1 Sacred files:** `lib/fiatLedger.js` MD5 `563e9b1f9e67091a5b6527c0a92568e5` and
  `lib/auditLog.js` MD5 `e5a5c2c27801d2d03991bc8e5a1df8cb` — **never modify**.
- **R4 No removal:** All prior endpoints and route handlers must remain.
- **R5 Prior tests pass:** v175/v176/v177 suites must continue passing (only
  version-number checks are permitted to fail due to version bump).
- **R6 Zero new npm deps:** No new packages in `dependencies` or
  `devDependencies` beyond what is already present.
- **R8 NODE_ENV=test exports:** Services and constructors added in each phase
  must be exported under `if (process.env.NODE_ENV === 'test')`.

---

## Packaging Rules

- Archive name: `ecos_v178_canonical.zip`
- Root folder inside ZIP: `ecos_v178_canonical/`
- `src/lib` must be stored as a symlink entry (external_attr = 0xA1ED0000,
  content = `../lib`)
- Use Python `zipfile` module (no `zip`/`unzip` available in this env)
- Include: `ecos-api-server.js`, `package.json`, `package-lock.json`,
  `lib/`, `middleware/`, `db/`, `routes/`, `src/lib` (symlink), `tests/`
- Exclude: `node_modules/`, `.git/`, `*.zip`, `*.tsbuildinfo`

---

## Suggested P67 Work Items (next session)

These are candidates — confirm with the user at session start:

1. **V178-T01** — WebSocket heartbeat service (`lib/workspaceHeartbeatService.js`)
   broadcasting presence events on connected workspaces.
2. **V178-T02** — Bulk event ingestion endpoint
   `POST /api/v1/workspaces/:id/events/bulk` (up to 100 events per call).
3. **V178-T03** — Search relevance scoring: add a `score` field to each search
   result and expose a `sortBy=relevance|date` query param.
4. **V178-T04** — Admin summary V178 endpoint.

