# CHANGELOG_V184.md — V184 (Phase P73)

## Summary

V184 extends ECOS with three new feature groups and an updated admin summary,
all implemented additively with zero modification to prior-version code or sacred files.

---

## V184-T01 — Event Log Statistics (`GET /workspaces/:id/events/stats`)

**Endpoint:** `GET /api/v1/workspaces/:workspaceId/events/stats`

Computes live statistics from the workspace event ring-buffer (`_eventLog181`):

| Field | Description |
|-------|-------------|
| `totalEvents` | Number of events currently in the ring-buffer |
| `typeCounts` | Object mapping event `type` → count |
| `firstAt` | ISO 8601 timestamp of the earliest event (`sentAt`) |
| `lastAt` | ISO 8601 timestamp of the most recent event (`sentAt`) |
| `topSenders` | Array of up to 5 `{ senderId, count }` objects, sorted by count descending |

Constants introduced:
- `V184_TOP_SENDERS_MAX = 5`

---

## V184-T02 — Event Replay Cursor Bookmarks

Three new endpoints provide a named-cursor bookmark system per workspace,
stored in the in-memory map `_bookmarks184`:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/workspaces/:workspaceId/events/bookmark` | Create or overwrite a named cursor bookmark |
| `GET` | `/api/v1/workspaces/:workspaceId/events/bookmarks` | List all bookmarks for a workspace (ordered by `createdAt` asc) |
| `DELETE` | `/api/v1/workspaces/:workspaceId/events/bookmarks/:name` | Remove a single named bookmark |

Each bookmark stores: `{ name, messageId, createdAt }`.

Constants introduced:
- `V184_BOOKMARK_MAX = 100` — maximum bookmarks per workspace

Error codes:
- `BOOKMARK_LIMIT_REACHED_184` — HTTP 400 when per-workspace limit is exceeded

---

## V184-T03 — Token Expiry

Extends `POST /api/v1/workspaces/:workspaceId/token` (V181-T03) with an optional
`expiresAt` body field (ISO 8601 datetime string).

**Behaviour:**
- If `expiresAt` is provided and valid (future datetime), the expiry is stored in
  `_tokenExpiry184` (Map: workspaceId → ISO string).
- If `expiresAt` is omitted, any existing expiry for the workspace is removed.
- **Lazy check:** the broadcast auth guard middleware (V181-T03) runs
  `_checkTokenExpiry184` before verifying the token — the token is auto-cleared if
  its expiry time has passed.
- **Periodic sweep:** `_expirySweep184` runs every `V184_EXPIRY_SWEEP_MS` (1 minute)
  to clean up all expired tokens. The timer is `unref()`'d.

Implementation uses an additive router-stack patch (`_patchTokenPost184`) with an
idempotency guard (`_v184tokenPatched`), consistent with V183-T01's `_patchEventsLog183`.

Error codes:
- `TOKEN_EXPIRY_INVALID_184` — HTTP 400 when `expiresAt` is not a valid date
- `TOKEN_EXPIRY_PAST_184`    — HTTP 400 when `expiresAt` is not in the future

Constants introduced:
- `V184_EXPIRY_SWEEP_MS = 60_000`

---

## V184-T04 — Admin Summary V184

**Endpoint:** `GET /api/v1/admin/summary/v184`

Returns version `V184`, phase `P73`, feature list, config, and live stats for
broadcast, tokens, persistence, event log, bookmarks, and token expiry.

---

## Invariants

| Rule | Status |
|------|--------|
| R1 — Sacred files (fiatLedger.js, auditLog.js) | ✅ UNTOUCHED (MD5 verified) |
| R4 — No endpoint removal | ✅ All prior endpoints preserved |
| R5 — Prior suites pass | ✅ v178–v183 all green |
| R6 — Zero new npm deps | ✅ Built-ins only |
| R8 — NODE_ENV=test exports | ✅ All new services exported |

## Test suite

`tests/v184.test.js` — **60 tests, 0 failed**

## Files changed

- `ecos-api-server.js` — appended V184 block (~371 lines)
- `package.json` — version bumped to `184.0.0`
- `tests/v184.test.js` — new (60 tests)
- `CHANGELOG_V184.md` — new (this file)
- `NEXT_SESSION_PROMPT_V184.md` — new
- `AI_PROTOCOL_V184.md` — new
