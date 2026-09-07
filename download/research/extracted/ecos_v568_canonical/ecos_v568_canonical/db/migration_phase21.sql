-- ═══════════════════════════════════════════════════════════════════════════
-- ECOS V138 — Phase 21 DB Migration: Reactions, Delivery Log, Channel Pages
-- Safe to run multiple times (all idempotent).
-- Run AFTER migration_phase20.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── notification_delivery_log indexes (additive — table already in phase20) ──
-- Additional composite index for paginated admin queries.
CREATE INDEX IF NOT EXISTS notification_delivery_log_admin_idx
  ON notification_delivery_log (created_at DESC, channel, success);

-- ── message_reactions composite index (additive — table already in phase20) ──
-- Speeds up count-by-reaction queries used by the reactions endpoint.
CREATE INDEX IF NOT EXISTS message_reactions_reaction_idx
  ON message_reactions (message_id, reaction, created_at DESC);

-- ── comm_messages pagination index ───────────────────────────────────────────
-- Cursor-based pagination on (channel_id, created_at DESC) for V138-ND03.
-- Table already exists from migration_phase19.sql.
CREATE INDEX IF NOT EXISTS comm_messages_cursor_idx
  ON comm_messages (channel_id, created_at DESC);

-- ── comments ──────────────────────────────────────────────────────────────────
COMMENT ON INDEX notification_delivery_log_admin_idx IS 'V138: admin delivery-log pagination index';
COMMENT ON INDEX message_reactions_reaction_idx      IS 'V138: reaction count per message/reaction query';
COMMENT ON INDEX comm_messages_cursor_idx            IS 'V138: cursor-based channel message pagination';
