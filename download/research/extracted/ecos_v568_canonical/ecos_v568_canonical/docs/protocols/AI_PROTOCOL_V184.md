# AI_PROTOCOL_V184.md — ECOS V184 AI Development Protocol

## Version Context
- **Version:** V184.0.0  **Phase:** P73
- **Previous:** V183 (P72) — event log filtering + search + bulk token clear
- **This version:** V184 (P73) — event log stats + cursor bookmarks + token expiry + admin summary

---

## Feature Summary

### V184-T01 — Event Log Statistics
`GET /api/v1/workspaces/:workspaceId/events/stats`

Reads the workspace ring-buffer (`_eventLog181`) and returns:
- `typeCounts` — per-type event counts
- `firstAt` / `lastAt` — first and last event timestamps
- `topSenders` — top 5 senders by event count (Map reduce + sort)
- `totalEvents` — total events in ring

**Key identifiers:** `V184_TOP_SENDERS_MAX`, `typeCounts184`, `senderCounts184`,
`topSenders184`, `firstAt184`, `lastAt184`

### V184-T02 — Event Replay Cursor Bookmarks
Three endpoints backed by `_bookmarks184 = new Map()` (workspaceId → Map<name, bookmark>):

- `POST  /api/v1/workspaces/:workspaceId/events/bookmark` — upsert bookmark `{name, messageId}`
- `GET   /api/v1/workspaces/:workspaceId/events/bookmarks` — list all (sorted by createdAt)
- `DELETE /api/v1/workspaces/:workspaceId/events/bookmarks/:name` — remove one

**Key identifiers:** `V184_BOOKMARK_MAX`, `_bookmarks184`, `_getBookmarkMap184`,
`BOOKMARK_LIMIT_REACHED_184`

### V184-T03 — Token Expiry
Additive runtime patch (`_patchTokenPost184`) on the V181 `POST /workspaces/:id/token`
handler. Adds optional `expiresAt` (ISO 8601) body field.

- Validates: must be valid date, must be in the future
- Stores expiry in `_tokenExpiry184 = new Map()`
- Lazy check: `_checkTokenExpiry184` called by broadcast auth middleware before token verify
- Periodic sweep: `_expirySweep184` every `V184_EXPIRY_SWEEP_MS` = 60_000 ms (unref'd)
- `_clearTokenWithExpiry184` atomically clears token + expiry map entry

**Key identifiers:** `V184_EXPIRY_SWEEP_MS`, `_tokenExpiry184`, `_checkTokenExpiry184`,
`_expirySweep184`, `_expirySweepTimer184`, `_clearTokenWithExpiry184`,
`_patchTokenPost184`, `_v184tokenPatched`,
`TOKEN_EXPIRY_INVALID_184`, `TOKEN_EXPIRY_PAST_184`

### V184-T04 — Admin Summary
`GET /api/v1/admin/summary/v184` returns phase `P73`, feature tags, config, and live stats.

---

## Implementation Patterns Used

### Additive Router-Stack Patch (consistent with V183-T01)
V184-T03 patches `POST /workspaces/:id/token` by walking `app._router.stack`, wrapping the
handler, and marking `_v184tokenPatched = true` for idempotency. Same approach as
`_patchEventsLog183` / `_v183patched`.

### Version-Suffixed Identifiers (R8)
All new variables, functions, constants, and labels carry the `184` / `_184` suffix to prevent
`Identifier already declared` errors in the single-file server.

### Zero New npm Dependencies (R6)
All logic uses only built-ins: `Map`, `Array`, `Date`, `setInterval`.

---

## Integrity Checks

```bash
md5sum lib/fiatLedger.js lib/auditLog.js
# 563e9b1f9e67091a5b6527c0a92568e5  lib/fiatLedger.js
# e5a5c2c27801d2d03991bc8e5a1df8cb  lib/auditLog.js

node --check ecos-api-server.js   # must be silent
NODE_ENV=test node tests/v184.test.js  # 60/60 pass
```

---

## Notes for Next AI Session

1. Do NOT re-wrap `_broadcast179.broadcast` originals — chain onto current wrapper.
2. Do NOT re-patch V181 `GET /events/log` from scratch — chain onto `_v183patched` function.
3. Do NOT re-patch V181 `POST /token` from scratch — chain onto `_v184tokenPatched` function.
4. Always suffix new identifiers with `_185` / `185` to avoid duplicate declarations.
5. `lib/fiatLedger.js` and `lib/auditLog.js` are sacred — NEVER modify.
