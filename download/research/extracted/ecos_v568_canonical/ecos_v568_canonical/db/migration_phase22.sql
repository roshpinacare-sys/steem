-- ═══════════════════════════════════════════════════════════════════════════
-- ECOS V139 — Phase 22 DB Migration: Message Threading + Reaction Notifications
-- Safe to run multiple times (all idempotent).
-- Run AFTER migration_phase21.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── [V139-MT01] Message threading — parent_id on comm_messages ───────────────
-- Add parent_id column so messages can form reply chains.
-- NULL = top-level message; non-NULL = reply to parent.
ALTER TABLE comm_messages
  ADD COLUMN IF NOT EXISTS parent_id TEXT REFERENCES comm_messages(id) ON DELETE CASCADE;

ALTER TABLE comm_messages
  ADD COLUMN IF NOT EXISTS reply_count INTEGER NOT NULL DEFAULT 0;

-- Index: fetch all direct replies to a message (thread view)
CREATE INDEX IF NOT EXISTS comm_messages_parent_idx
  ON comm_messages (parent_id, created_at ASC)
  WHERE parent_id IS NOT NULL;

-- Index: top-level messages per channel (parent_id IS NULL)
CREATE INDEX IF NOT EXISTS comm_messages_toplevel_idx
  ON comm_messages (channel_id, created_at DESC)
  WHERE parent_id IS NULL;

-- ── [V139-MT02] Reaction notifications ───────────────────────────────────────
-- Track which user "owns" each message so reaction_received notifications
-- can be routed to the correct user. comm_messages already has from_user_id.
-- We just need a new notification type in rank_notifications — no schema change.
-- But we do add a reaction_notifications helper view for admin observability.

CREATE VIEW IF NOT EXISTS reaction_notification_summary AS
  SELECT
    mr.message_id,
    mr.reaction,
    COUNT(*) AS reaction_count,
    cm.from_user_id AS message_owner,
    cm.channel_id
  FROM message_reactions mr
  JOIN comm_messages cm ON cm.id = mr.message_id
  GROUP BY mr.message_id, mr.reaction, cm.from_user_id, cm.channel_id;

-- ── [V139-MT03] Thread reply counter trigger (Postgres-side) ─────────────────
-- Atomically keep reply_count in sync via trigger to avoid N+1 read-increment.
CREATE OR REPLACE FUNCTION ecos_increment_reply_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    UPDATE comm_messages SET reply_count = reply_count + 1 WHERE id = NEW.parent_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_comm_messages_reply_count ON comm_messages;
CREATE TRIGGER trg_comm_messages_reply_count
  AFTER INSERT ON comm_messages
  FOR EACH ROW EXECUTE FUNCTION ecos_increment_reply_count();

-- ── comments ──────────────────────────────────────────────────────────────────
COMMENT ON COLUMN comm_messages.parent_id IS 'V139: reply threading — references parent message; NULL = top-level';
COMMENT ON COLUMN comm_messages.reply_count IS 'V139: denormalised reply count, maintained by trigger';
COMMENT ON VIEW reaction_notification_summary IS 'V139: admin view — reaction counts per message with owner routing info';
