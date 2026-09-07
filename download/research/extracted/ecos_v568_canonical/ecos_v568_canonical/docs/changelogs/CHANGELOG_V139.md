# CHANGELOG V139 — Message Threading & Reaction Notifications

**Release:** V139.0.0
**Date:** 2026-05-30
**Phase:** P29 — Message Threading + Reaction Notifications
**Test count:** ≥948 (+60 from V138 baseline of ≥888)

---

## Summary

V139 adds two tightly-coupled capabilities to the comm/notification layer:

1. **MT01 — Message Threading**: Reply chains on `comm_messages`. Users can reply to any top-level channel message (flat threading, max depth 1). Thread counts are exposed in the message list, and the full thread (parent + replies) is fetchable via a dedicated endpoint.

2. **RN01 — Reaction Notifications**: When a user reacts to a message, a `reaction_received` in-app notification is pushed to the message author. Includes self-reaction suppression, per-window dedup, and rate-cap protection.

---

## New Libraries (2)

### `lib/messageThreading.js`
- `postReply({ channelId, parentId, fromUserId, body })` — validate + persist reply; depth-1 enforcement
- `getThread({ channelId, parentId, pagination })` — returns parent + replies, cursor-paginated
- `enrichMessages(messages)` — annotates message list with `replyCount` + `hasReplies`
- `registerMessage(msg)` — in-memory seed (for offline/DB-free operation)
- DB path: `comm_messages(parent_id, reply_count)` via `migration_phase22.sql`
- In-memory fallback when `dbPool` is null

### `lib/reactionNotifier.js`
- `notify({ messageId, channelId, reactorId, emoji })` — fire `reaction_received` push to message author
- `registerOwner(messageId, authorId)` — in-memory fallback for author lookup
- Anti-spam: self-reaction suppression, 60s dedup window, 10/min rate cap per author
- DB path: author resolved from `comm_messages.from_user_id`

---

## Modified Files

### `lib/notificationTemplates.js`
- Added `reaction_received` template in 8 locales (en, he, ar, es, fr, de, zh, ru)
- `{{emoji}}`, `{{reactorId}}`, `{{channelId}}` interpolation variables

### `ecos-api-server.js`
- `POST /api/v1/comm/channels/:cid/messages/:mid/replies` — post a reply to a message
- `GET  /api/v1/comm/channels/:cid/messages/:mid/thread` — fetch thread (parent + replies, paginated)
- `GET  /api/v1/comm/threading/stats` — threading + reactionNotifier stats
- `POST .../reactions` handler: fires `_reactionNotifier.notify()` after DB insert (fire-and-forget)
- `_messageThreading._db` and `_reactionNotifier._db` wired on DB connect

### `db/migration_phase22.sql`
- `ALTER TABLE comm_messages ADD COLUMN parent_id TEXT REFERENCES comm_messages(id) ON DELETE CASCADE`
- `ALTER TABLE comm_messages ADD COLUMN reply_count INTEGER NOT NULL DEFAULT 0`
- Indexes: `comm_messages_parent_idx`, `comm_messages_toplevel_idx`
- PL/pgSQL trigger `trg_comm_messages_reply_count` — atomically increments `reply_count` on parent
- View `reaction_notification_summary` — admin observability for reaction→owner routing

---

## New API Endpoints (3)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/comm/channels/:cid/messages/:mid/replies` | Post reply to a message |
| `GET`  | `/api/v1/comm/channels/:cid/messages/:mid/thread`  | Fetch thread: parent + replies (paginated) |
| `GET`  | `/api/v1/comm/threading/stats`                     | Threading + reaction notifier stats |

**Reactions POST** (`/api/v1/comm/channels/:cid/messages/:mid/reactions`) now additionally fires `reaction_received` notification to the message author.

---

## New Test Files

| File | Tests | Coverage |
|------|-------|----------|
| `tests/v139MessageThreading.test.js`  | 20 | postReply, getThread, enrichMessages, stats, depth enforcement |
| `tests/v139ReactionNotifier.test.js` | 22 | notify, self-reaction, dedup, rate cap, registerOwner, no-notifier |
| `tests/v139E2ERegression.test.js`    | 18 | V138 compat + full thread+reaction lifecycle, multi-channel isolation |

**Total new tests: ~60**

---

## Migration

Run `db/migration_phase22.sql` on all environments before deploying V139.
- Additive only: two `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, two indexes, one trigger, one view.
- Safe to run on existing data: new columns have safe defaults (`NULL`, `0`).
- Trigger fires only on future INSERT; existing rows unchanged.

---

## Breaking Changes

None. All V138 APIs preserved. New reaction push is fire-and-forget — callers see no difference on the POST reactions response (except `ecosVersion: 'V139'`).

---

## Sacred Files

```
lib/fiatLedger.js  MD5: 563e9b1f9e67091a5b6527c0a92568e5  ✅ UNCHANGED
lib/auditLog.js    MD5: e5a5c2c27801d2d03991bc8e5a1df8cb  ✅ UNCHANGED
```
