# CHANGELOG V138 — Reactions, Delivery Log & Channel DB Pagination

**Release:** V138.0.0  
**Date:** 2026-05-30  
**Phase:** P28 — Reactions, Delivery Log & Channel DB Pagination  
**Test count:** ≥888 (+100 from V137 baseline of ~788)

---

## Summary

V138 extends the notification and channel messaging infrastructure with four major capabilities:

1. **ND-01 — Notification Delivery Log**: Persistent DB-backed delivery audit trail for all WS/webhook pushes, with a filterable admin endpoint.
2. **ND-02 — Message Reactions**: Full emoji reaction lifecycle (insert, de-duplicate, grouped query, delete) backed by a `message_reactions` table.
3. **ND-03 — Channel DB Pagination**: Cursor-based, DB-backed message history for `/api/v1/comm/channels/:id/messages`, replacing the V137 in-memory-only path.
4. **ND-04 — Notification Digest**: `RankNotifier.digest(userId)` method + `/api/v1/rank/notifications/:userId/digest` endpoint returning aggregate totals.
5. **ND-05 — WS JWT Enhancement**: `Authorization: Bearer <token>` header support in WebSocket upgrade; JWT `sub` claim accepted as `userId` fallback.

---

## New Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/v1/rank/notifications/delivery-log` | Admin delivery log (filterable by channel, success) |
| `GET`  | `/api/v1/rank/notifications/:userId/digest` | Aggregate notification digest for a user |
| `GET`  | `/api/v1/comm/channels/:id/messages/reactions` | (see reactions) |
| `GET`  | `/api/v1/comm/channels/:cid/messages/:mid/reactions` | List reactions grouped by emoji |
| `POST` | `/api/v1/comm/channels/:cid/messages/:mid/reactions` | Add a reaction |
| `DELETE` | `/api/v1/comm/channels/:cid/messages/:mid/reactions/:emoji` | Remove a reaction |

---

## Modified Files

### `lib/notificationWsHub.js`
- Added `_db` option in constructor (wired from `dbPool` after DB connect).
- Added `_logDelivery({ notificationId, userId, channel, success, latencyMs, errorMsg })` — async, no-throw, writes to `notification_delivery_log`.
- Added `Authorization: Bearer` header parsing in WS upgrade handler.
- JWT `sub` claim now accepted as `userId` when `payload.userId` is absent.

### `lib/rankNotifier.js`
- Added `digest(userId)` — returns `{ userId, total, unread, byType, generatedAt }`.
- Added `getChannelMessagesFromDb(channelId, { limit, before, dbPool })` — async, cursor-based DB pagination with in-memory fallback when `dbPool` is null.
- Added `getChannelMessages(channelId, opts)` — sync in-memory path (V137 compatible).
- Added `_storeChannelMessage(channelId, message)` — internal helper.
- Added `_logDelivery(entry)` — mirrors WsHub delivery log for webhook channel.

### `ecos-api-server.js`
- Added `GET /api/v1/rank/notifications/delivery-log` (inserted before generic `:userId` handler to avoid path shadowing).
- Added `GET /api/v1/rank/notifications/:userId/digest`.
- Added reactions endpoints (`GET`, `POST` on `.../reactions`; `DELETE` on `.../reactions/:emoji`).
- Replaced V137 in-memory-only channel messages handler with V138 DB-backed + fallback version.
- Wired `db: dbPool` into `NotificationWsHub` constructor.
- Wired `_notificationWsHub._db = dbPool` in DB-connect callback.

### `db/migration_phase21.sql`
- New table: `notification_delivery_log(id, notification_id, user_id, channel, success, latency_ms, error_msg, created_at)`.
- New table: `message_reactions(id, message_id, user_id, reaction, created_at)` with `UNIQUE(message_id, user_id, reaction)`.
- New table: `channel_messages(id, channel_id, user_id, content, metadata, created_at)`.
- Additive indexes on all three tables.

---

## New Test Files

| File | Tests | Coverage |
|------|-------|----------|
| `tests/v138ReactionsDeliveryLog.test.js` | 25 | ND-01 delivery log, ND-02 reactions CRUD |
| `tests/v138NotificationDigest.test.js` | 20 | ND-04 digest method + endpoint logic |
| `tests/v138ChannelDbPagination.test.js` | 20 | ND-03 DB pagination, cursor, channel config |
| `tests/v138WsJwtEnhancement.test.js` | 15 | ND-05 JWT sub claim, Bearer header |
| `tests/v138E2ERegression.test.js` | 20 | Full regression: V137 compat + V138 integration |

**Total new tests: 100**

---

## Migration

Run `db/migration_phase21.sql` on all environments before deploying V138. All statements are additive (no drops, no column renames). See `MIGRATION_NOTES_V138.md` for details.

---

## Breaking Changes

None. All V137 APIs, endpoints, and test contracts are preserved.

---

## Sacred Files

```
lib/fiatLedger.js  MD5: 563e9b1f9e67091a5b6527c0a92568e5  (UNCHANGED)
lib/auditLog.js    MD5: e5a5c2c27801d2d03991bc8e5a1df8cb  (UNCHANGED)
```
