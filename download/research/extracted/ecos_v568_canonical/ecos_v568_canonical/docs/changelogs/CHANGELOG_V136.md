# ECOS Changelog — V136: Notification & Observability Layer

**Release Date:** 2026-05-30
**Version:** 136.0.0
**Release Name:** Notification & Observability Layer (P26)

---

## Overview

V136 delivers P26 — the layer that lets the rank system *talk back to users*.
V133–V135 built scoring, persistence, hard reward enforcement, and rank-gated
communication channels, but everything was silent: a user could be promoted,
about to lose a streak, or the target of a steward broadcast and never know.

V136 adds an in-app notification queue (`lib/rankNotifier.js`) wired on top of
the existing rank, comm, and webhook infrastructure, plus a paginated rank-event
history endpoint and a STEWARD+ channel broadcast endpoint. It also fixes a
latent runtime bug discovered during the audit (BUG-J).

Sacred files (`lib/fiatLedger.js`, `lib/auditLog.js`) are **untouched**.

---

## Deliverables

### [V136-NO-01] Tier promotion notifications

`UserRankSystem.recordEvent()` now invokes an optional `_onTierChange(userId,
before, after, meta)` hook whenever a score change crosses a tier boundary. The
server wires this hook to `RankNotifier.notifyTierChange()`, which enqueues a
`tier_promotion` (or `tier_demotion`) in-app notification and pushes it via the
webhook `notificationService` when an account webhook is registered.

- New endpoint: `GET /api/v1/rank/notifications/:userId` — paginated, supports
  `?unreadOnly=true&limit=20&offset=0&type=tier_promotion`.
- New endpoint: `POST /api/v1/rank/notifications/:userId/read` — body
  `{ notificationId }` marks one read; omit it to mark all read.
- New endpoint: `GET /api/v1/rank/notifications-stats` — observability aggregate.
- The hook is wrapped in try/catch on both sides — it can never break scoring.

### [V136-NO-02] Streak reminder notifications

`RankNotifier.runStreakReminderSweep(engagementEngine)` scans the engagement
engine's streak store and enqueues a `streak_reminder` for any user with an
active streak (≥ `minStreakForReminder`, default 3) who has **not** been active
today. Per-user, per-day dedup prevents duplicates across repeated sweeps.

- Daily scheduler armed at startup when `ECOS_STREAK_REMINDER_INTERVAL_MINUTES`
  is set (e.g. `1440`). The handle is `unref()`'d so it never blocks shutdown.
- New endpoint: `POST /api/v1/rank/streak-reminders/run` — manual trigger for
  ops/testing; runs the exact same code path as the scheduler.

### [V136-NO-03] Paginated rank event history

`UserRankSystem.history(userId, { limit, offset, eventType })` returns a user's
score events newest-first with pagination and optional event-type filtering.

- New endpoint: `GET /api/v1/rank/history/:userId?limit=20&offset=0&eventType=task_approved`.
- In-memory event list is the served view; the `rank_events` table (V134)
  remains the canonical production store.

### [V136-NO-04] CommChannels broadcast

`RankNotifier.broadcast(channelId, fromUserId, message)` fans a message out to
every current subscriber of a channel as a `channel_broadcast` notification and
persists the message to the `comm_messages` audit table.

- New endpoint: `POST /api/v1/comm/channels/:id/broadcast` — body
  `{ userId, message }`, gated by `requireRank(defaultUserRankSystem, 'STEWARD')`.
- Returns 403 for sub-STEWARD users, 404 for unknown channels, 400 for empty
  messages.

### [V136-NO-05] Rank regression integration test

`tests/v136NotificationObservability.test.js` includes an end-to-end regression:
two users run a referral conversion, task approvals, validations, and an
anti-scam downrank; the test asserts scores, tier transitions, reward
eligibility/multiplier, comm access, history, promotion notifications, and
leaderboard ordering all match expected values.

---

## Bug fixes

### [BUG-J] `readBody` was undefined (high severity, latent)

Three rank endpoints introduced in V134 (`POST /api/v1/rank/users/:id/event`,
`POST /api/v1/rank/verify-token`, and one earlier handler) called
`await readBody(req)` — but no `readBody` helper exists in the server. Hitting
those endpoints over HTTP would throw `ReferenceError: readBody is not defined`
and return a 500. The existing tests never exercised those routes over HTTP, so
the bug was invisible. All three sites now use the existing `collectBody(req)`
helper. Marked in source with `[V136-BUG-J]`.

---

## Database migration

`db/migration_phase19.sql` (run after phase 18):

- `rank_notifications (id, user_id, type, title, body, meta JSONB, read, created_at)`
  — persistence for the in-app notification queue, with unread + type indexes.
- `comm_messages (id, channel_id, from_user_id, body, created_at)` — broadcast
  audit trail.

All `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` — safe to re-run.

---

## New / modified files

| File | Change |
|------|--------|
| `lib/rankNotifier.js` | **NEW** — notification queue + sweep + broadcast |
| `lib/userRankSystem.js` | `_onTierChange` hook + `history()` method (additive) |
| `db/migration_phase19.sql` | **NEW** — rank_notifications + comm_messages |
| `ecos-api-server.js` | RankNotifier singleton, onTierChange wiring, daily sweep, 6 endpoints, BUG-J fix |
| `tests/v136NotificationObservability.test.js` | **NEW** — ~45 tests |
| `tests/v135RankHardening.test.js` | version assertion relaxed to major ≥ 135 |
| `package.json` | 135.0.0 → 136.0.0 |

---

## Breaking changes

None. All V135 endpoints and behaviour preserved. Every addition is additive or
non-fatal. The daily scheduler is opt-in via env var (off by default).

---

## Sacred Files — UNTOUCHED

- `lib/fiatLedger.js`  MD5: 563e9b1f9e67091a5b6527c0a92568e5 ✅
- `lib/auditLog.js`    MD5: e5a5c2c27801d2d03991bc8e5a1df8cb ✅

**Expected test count:** ~1393 passing (V135: ~1348 + V136: ~45)
