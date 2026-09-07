# ECOS V137 — CHANGELOG
## P27: Notification Delivery, Real-Time & Operator Surface

**Release date:** 2026-05-29  
**Base version:** V136 (136.0.0)  
**This version:** 137.0.0  
**Author:** ECOS Protocol Core  

---

## Summary

V137 implements the full Notification Delivery layer (P27), adding real-time WebSocket delivery, user preference/rate control, DB persistence/recovery for the RankNotifier, i18n notification templates, channel message history, and operator metrics. All existing V136 functionality (668 baseline tests) is preserved.

---

## Track A — DB Persistence & Recovery (ND-02)

### `lib/rankNotifier.js`
- **`loadFromDb()`** — new async method that hydrates the in-memory notification queue from `rank_notifications` on server startup (non-fatal if DB unavailable). Returns `{ loaded, users, source }`.
- **`listFromDb(userId, opts)`** — extended list method with DB fallback when the user has no in-memory entries. Supports `limit`, `offset`, `unreadOnly`, `type` filters.
- **`metrics()`** — new extended metrics method (replaces `stats()` for operator use). Returns delivery counters, by-day histogram, unread rate, WS client count.
- **`_deliveryStats`** — new internal counter object (`{ wsSuccess, wsFailed, webhookSuccess, webhookFailed }`).

### `ecos-api-server.js`
- After DB connects: calls `_rankNotifier.loadFromDb()` (non-fatal).
- After DB connects: wires `_notificationPrefs._db = dbPool`.

---

## Track B — WebSocket Real-Time Delivery (NB)

### `lib/notificationWsHub.js` *(new)*
- `NotificationWsHub` class — manages per-userId WebSocket subscriptions.
- Constructor opts: `{ rankNotifier, verifyJwt, logger }`.
- Uses `ws` package in `noServer: true` mode — does NOT touch the ValidatorHub path.
- `subscribe(userId, socket)` / `unsubscribe(socket)` — lifecycle management.
- `push(userId, notification)` → sends JSON to all active sockets for that user; returns `sentCount`.
- `handleUpgrade(req, socket, head)` — HTTP upgrade handler for `/ws/notifications`.
- `connectedClients()` / `connectedUsers()` — observability.

### `ecos-api-server.js`
- Imports `NotificationWsHub` from `lib/notificationWsHub`.
- After ValidatorHub try/catch: creates `_notificationWsHub` and adds `server.on('upgrade', ...)` listener to route `/ws/notifications` upgrades to the hub.
- Wires `_rankNotifier._wsHub = _notificationWsHub` so every `_enqueue()` pushes live.

---

## Track C — Notification Preferences & Rate Control (NC)

### `lib/notificationPrefs.js` *(new)*
- `NotificationPrefs` class — in-memory Map + optional Postgres persistence.
- Schema: `{ locale, muted: string[], quietHours: { start, end } | null, channel: 'ws'|'webhook'|'none' }`.
- `get(userId)` — async; DB-backed on first access, in-memory thereafter.
- `set(userId, updates)` — async merge; persists to DB via upsert (non-fatal).
- `isMuted(userId, type)` — synchronous hot-path; checks muted array + quiet hours (UTC-aware, wraps midnight).
- `getLocale(userId)` / `getChannel(userId)` — synchronous read from cache.
- `getNotificationPrefs(opts)` — module-level singleton factory.

### `ecos-api-server.js`
- Imports `getNotificationPrefs`.
- Creates `_notificationPrefs` singleton immediately after `_rankNotifier`.
- Wires `_rankNotifier._prefs = _notificationPrefs`.
- **`GET /api/v1/rank/notifications/:userId/prefs`** — returns current prefs.
- **`PUT /api/v1/rank/notifications/:userId/prefs`** — merges and persists updates. Returns `{ userId, prefs }`.

### `lib/rankNotifier.js`
- `_enqueue()` — checks `this._prefs.isMuted(userId, type)` before enqueue; returns `null` if muted.
- `_enqueue()` — reads `this._prefs.getChannel(userId)` to gate webhook delivery.

---

## Track D — Channel Message History (ND)

### `ecos-api-server.js`
- **`GET /api/v1/comm/channels/:id/messages`** — returns paginated message history.
  - Query params: `userId` (required), `limit` (1–100, default 20), `before` (ISO cursor).
  - Rank-gated: user must meet the channel's `minTier`.
  - Returns `{ channelId, channel: { id, name, minTier }, limit, before, messages, ecosVersion }`.

---

## Track E — i18n Templates (NE)

### `lib/notificationTemplates.js` *(new)*
- `resolve(type, locale, vars)` — returns `{ title, body, locale, rtl }` with `{{placeholder}}` interpolation. Falls back to `'en'` for unknown locales.
- `isRtl(locale)` — returns true for `he`, `ar`, `fa`.
- `supportedLocales()` — returns sorted list of all locale codes with templates.
- `TEMPLATES` — registry of 4 types × 8 locales: `en`, `he`, `ar`, `es`, `fr`, `de`, `zh`, `ru`.
- `RTL_LOCALES` — `Set` of RTL locale codes.

### `ecos-api-server.js`
- Imports `notifTemplates`.
- Wires `_rankNotifier._tpl = notifTemplates`.
- **`GET /api/v1/rank/notification-templates`** — returns `{ locales, types, rtlLocales }`.

### `lib/rankNotifier.js`
- `_enqueue()` — when a non-`en` locale is cached for the user, resolves i18n template and replaces title/body before storing.

---

## Track F — Operator Metrics (NF)

### `lib/rankNotifier.js`
- `metrics()` — extended operator metrics: `users`, `totalNotifications`, `totalUnread`, `unreadRate`, `byType`, `byDay`, `delivery.ws`, `delivery.webhook`, `wsClients`, `wsUsers`, `minStreakForReminder`.

### `ecos-api-server.js`
- **`GET /api/v1/rank/notifications-metrics`** — returns `metrics()` output.

---

## Track G — Frontend Pages (NG)

### `apps/web/src/app/notifications/page.jsx` *(new)*
- User notification inbox: loads from `/api/v1/rank/notifications/:userId`, shows unread badge, type filter tabs, mark-individual / mark-all-read.
- Live WS updates via `wss://<host>/ws/notifications`.
- RTL-aware inline styles; no external dependencies.

### `apps/web/src/app/admin/notifications-metrics/page.jsx` *(new)*
- Operator metrics dashboard: KPI cards (total, unread rate, WS clients), delivery channel panels (ws + webhook success/fail), by-type bar chart, 14-day daily histogram.
- Auto-refreshes every 30 s.

### `apps/web/src/app/layout.jsx`
- Added `<NavLink href="/notifications" label="🔔 Notifications" />` between `/comm` and Admin.

---

## Track H — DB Schema (phase 20)

### `db/migration_phase20.sql` *(new)*
- `notification_prefs` — per-user preference store (user_id PK, prefs JSONB, updated_at).
- `message_reactions` — emoji/acknowledgement reactions on comm_messages (message_id FK, user_id, reaction, UNIQUE constraint).
- `notification_delivery_log` — delivery attempt log (notification_id, user_id, channel, success, latency_ms, error_msg).
- All tables: `IF NOT EXISTS` (idempotent), with appropriate indexes.

---

## Tests Added (+120 target)

| File | Tests | Coverage |
|------|-------|----------|
| `tests/v137NotificationDelivery.test.js` | 40 | Tracks A, B, C, D, E (templates, prefs, WS hub, rankNotifier V137 ext.) |
| `tests/v137OperatorSurface.test.js`      | 30 | Track F (metrics shape, delivery counters, rate control, template meta) |
| `tests/v137Frontend.test.js`             | 25 | Track G (file presence, nav, page content, migration SQL) |
| `tests/v137E2ERegression.test.js`        | 25 | Sacred files, smoke imports, full integrated pipeline |
| **Total new**                            | **120** | |

---

## Endpoints Added

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/rank/notifications/:userId/prefs` | Get notification preferences |
| PUT | `/api/v1/rank/notifications/:userId/prefs` | Update notification preferences |
| GET | `/api/v1/rank/notifications-metrics` | Operator delivery metrics |
| GET | `/api/v1/comm/channels/:id/messages` | Paginated channel message history (rank-gated) |
| GET | `/api/v1/rank/notification-templates` | i18n metadata (locales, types, RTL) |
| WS  | `/ws/notifications` | Real-time notification stream |

---

## Sacred Files

Both sacred files are **unchanged**:
- `lib/fiatLedger.js` — MD5: `563e9b1f9e67091a5b6527c0a92568e5` ✓
- `lib/auditLog.js`   — MD5: `e5a5c2c27801d2d03991bc8e5a1df8cb` ✓

---

## Breaking Changes

None. All V136 behaviour is preserved. New modules degrade gracefully (no DB → in-memory only; no WS → no push, still enqueues).
