-- ═══════════════════════════════════════════════════════════════════════════
-- ECOS V136 — Phase 19 DB Migration: Notification & Observability Layer (P26)
-- Safe to run multiple times (all idempotent).
-- Run AFTER migration_phase18.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── rank_notifications ───────────────────────────────────────────────────────
-- [V136-NO-01/02/04] In-app notification queue (tier promotions, streak
-- reminders, channel broadcasts). RankNotifier writes here (DB hook); the
-- in-memory ring buffer remains the live read path. Persistence lets the queue
-- survive restarts and supports the GET /api/v1/rank/notifications endpoint.
CREATE TABLE IF NOT EXISTS rank_notifications (
  id          TEXT         PRIMARY KEY,           -- ntf_<sha256-20>
  user_id     TEXT         NOT NULL,
  type        TEXT         NOT NULL,              -- tier_promotion | tier_demotion | streak_reminder | channel_broadcast
  title       TEXT         NOT NULL,
  body        TEXT         NOT NULL,
  meta        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  read        BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rank_notifications_user_idx
  ON rank_notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS rank_notifications_unread_idx
  ON rank_notifications (user_id, read)
  WHERE read = FALSE;

CREATE INDEX IF NOT EXISTS rank_notifications_type_idx
  ON rank_notifications (type, created_at DESC);

-- ── comm_messages ────────────────────────────────────────────────────────────
-- [V136-NO-04] Persistent record of channel broadcasts. Authored by STEWARD+
-- users (enforced at the API layer via requireRank), fanned out to subscribers
-- as rank_notifications. This table is the canonical broadcast audit trail.
CREATE TABLE IF NOT EXISTS comm_messages (
  id            TEXT         PRIMARY KEY,         -- msg_<sha256-24>
  channel_id    TEXT         NOT NULL,
  from_user_id  TEXT         NOT NULL,
  body          TEXT         NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS comm_messages_channel_idx
  ON comm_messages (channel_id, created_at DESC);

CREATE INDEX IF NOT EXISTS comm_messages_from_idx
  ON comm_messages (from_user_id, created_at DESC);

COMMENT ON TABLE rank_notifications IS 'V136: in-app notification queue (tier promotions, streak reminders, channel broadcasts)';
COMMENT ON TABLE comm_messages       IS 'V136: persistent channel broadcast audit trail (STEWARD+ authored)';
