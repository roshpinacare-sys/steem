-- ═══════════════════════════════════════════════════════════════════════════
-- ECOS V135 — Phase 18 DB Migration: CommSubscriptions + Streak Hardening
-- Safe to run multiple times (all idempotent).
-- Run AFTER migration_phase17.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── comm_subscriptions ───────────────────────────────────────────────────────
-- Persistent subscriptions for CommChannelSystem.
-- CommChannelSystem already writes here (V134 DB hook); this migration
-- creates the table so the hook can succeed in production.
CREATE TABLE IF NOT EXISTS comm_subscriptions (
  user_id       TEXT         NOT NULL,
  channel_id    TEXT         NOT NULL,
  subscribed_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, channel_id)
);

CREATE INDEX IF NOT EXISTS comm_subscriptions_user_idx
  ON comm_subscriptions (user_id);

CREATE INDEX IF NOT EXISTS comm_subscriptions_channel_idx
  ON comm_subscriptions (channel_id, subscribed_at DESC);

-- ── streak_events ────────────────────────────────────────────────────────────
-- Audit log for streak milestones (7d, 30d) to support rank events + notifications.
-- Prevents double-firing the rank bonus if server restarts mid-streak.
CREATE TABLE IF NOT EXISTS streak_events (
  id            BIGSERIAL    PRIMARY KEY,
  user_id       TEXT         NOT NULL,
  milestone     INT          NOT NULL,       -- 7 or 30
  streak_value  INT          NOT NULL,       -- streak count when fired
  fired_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS streak_events_user_milestone_uniq
  ON streak_events (user_id, milestone)
  WHERE milestone IN (7, 30);

CREATE INDEX IF NOT EXISTS streak_events_user_idx
  ON streak_events (user_id, fired_at DESC);

COMMENT ON TABLE comm_subscriptions IS 'V135: persistent CommChannelSystem subscriptions (user ↔ channel)';
COMMENT ON TABLE streak_events       IS 'V135: streak milestone audit log — prevents duplicate rank events on restart';
