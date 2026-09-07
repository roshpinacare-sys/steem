-- ═══════════════════════════════════════════════════════════════════════════
-- ECOS V137 — Phase 20 DB Migration: Notification Delivery Layer (P27)
-- Safe to run multiple times (all idempotent).
-- Run AFTER migration_phase19.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── notification_prefs ────────────────────────────────────────────────────────
-- [V137-NC] Per-user notification preferences.
-- Stores muted types, quiet hours, preferred delivery channel, and locale.
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id     TEXT         PRIMARY KEY,
  prefs       JSONB        NOT NULL DEFAULT '{}'::jsonb,
              -- { locale, muted: [], quietHours: {start,end}|null, channel }
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notification_prefs_updated_idx
  ON notification_prefs (updated_at DESC);

-- ── message_reactions ────────────────────────────────────────────────────────
-- [V137-ND] Optional reactions / acknowledgements on channel broadcast messages.
-- Tracks emoji reactions per user per message.
CREATE TABLE IF NOT EXISTS message_reactions (
  id          TEXT         PRIMARY KEY,          -- rxn_<sha256-20>
  message_id  TEXT         NOT NULL REFERENCES comm_messages(id) ON DELETE CASCADE,
  user_id     TEXT         NOT NULL,
  reaction    TEXT         NOT NULL,             -- emoji or short code e.g. '👍', 'ack'
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, user_id, reaction)         -- one reaction type per user per message
);

CREATE INDEX IF NOT EXISTS message_reactions_message_idx
  ON message_reactions (message_id, created_at DESC);

CREATE INDEX IF NOT EXISTS message_reactions_user_idx
  ON message_reactions (user_id, created_at DESC);

-- ── notification_delivery_log ─────────────────────────────────────────────────
-- [V137-NF] Tracks delivery attempts and outcomes for observability metrics.
-- Separate from rank_notifications to keep the notification table lean.
CREATE TABLE IF NOT EXISTS notification_delivery_log (
  id               TEXT         PRIMARY KEY,       -- dl_<sha256-20>
  notification_id  TEXT         NOT NULL,
  user_id          TEXT         NOT NULL,
  channel          TEXT         NOT NULL,          -- 'ws' | 'webhook' | 'in-app'
  success          BOOLEAN      NOT NULL,
  latency_ms       INTEGER,                        -- delivery latency if measured
  error_msg        TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notification_delivery_log_notif_idx
  ON notification_delivery_log (notification_id);

CREATE INDEX IF NOT EXISTS notification_delivery_log_user_idx
  ON notification_delivery_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notification_delivery_log_channel_idx
  ON notification_delivery_log (channel, success, created_at DESC);

-- ── comments ──────────────────────────────────────────────────────────────────
COMMENT ON TABLE notification_prefs         IS 'V137: per-user notification preferences (mute, quiet hours, channel, locale)';
COMMENT ON TABLE message_reactions          IS 'V137: emoji reactions and acknowledgements on channel broadcast messages';
COMMENT ON TABLE notification_delivery_log  IS 'V137: delivery attempt log for observability and failure-rate monitoring';
