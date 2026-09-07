-- ═══════════════════════════════════════════════════════════════════════════
-- ECOS V141 — Phase 24 DB Migration
-- P31: Full-Text Search, Operator Report Email Delivery, Onboarding Checker
-- Safe to run multiple times (all idempotent).
-- Run AFTER migration_phase23.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── [V141-FTS-01] Full-text search on comm_messages ─────────────────────────
-- Add tsvector column to comm_messages (if not present) and populate from body.
ALTER TABLE comm_messages
  ADD COLUMN IF NOT EXISTS fts_vector tsvector;

-- Populate tsvector from body for existing rows
UPDATE comm_messages
SET fts_vector = to_tsvector('simple', coalesce(body, ''))
WHERE fts_vector IS NULL;

-- GIN index for full-text search
CREATE INDEX IF NOT EXISTS comm_messages_fts_idx
  ON comm_messages USING GIN (fts_vector);

-- Trigger: keep fts_vector current on insert/update
CREATE OR REPLACE FUNCTION comm_messages_fts_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW.fts_vector := to_tsvector('simple', coalesce(NEW.body, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS comm_messages_fts_trigger ON comm_messages;
CREATE TRIGGER comm_messages_fts_trigger
  BEFORE INSERT OR UPDATE OF body ON comm_messages
  FOR EACH ROW EXECUTE FUNCTION comm_messages_fts_update();

-- ── [V141-ORM-01] operator_report_deliveries — email delivery audit trail ───
-- Records every operator report email delivery attempt.
CREATE TABLE IF NOT EXISTS operator_report_deliveries (
  id             BIGSERIAL    PRIMARY KEY,
  recipient      TEXT         NOT NULL,
  subject        TEXT,
  overall_status TEXT,
  method         TEXT         NOT NULL DEFAULT 'logged',  -- 'smtp'|'webhook'|'logged'
  message_id     TEXT,                                     -- SMTP message ID if available
  report_json    JSONB,
  sent_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ecos_version   TEXT         NOT NULL DEFAULT 'V141'
);

CREATE INDEX IF NOT EXISTS operator_report_deliveries_sent_at_idx
  ON operator_report_deliveries (sent_at DESC);
CREATE INDEX IF NOT EXISTS operator_report_deliveries_recipient_idx
  ON operator_report_deliveries (recipient);

-- ── [V141-OB-01] onboarding_readiness_log — readiness check history ─────────
-- Optional: log readiness check results over time (useful for tracking improvements).
CREATE TABLE IF NOT EXISTS onboarding_readiness_log (
  id           BIGSERIAL    PRIMARY KEY,
  ready        BOOLEAN      NOT NULL,
  score        INT          NOT NULL,
  passed       INT          NOT NULL,
  warnings     INT          NOT NULL,
  failed       INT          NOT NULL,
  blockers     TEXT[],
  checks_json  JSONB        NOT NULL,
  ecos_version TEXT         NOT NULL DEFAULT 'V141',
  checked_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS onboarding_readiness_log_checked_at_idx
  ON onboarding_readiness_log (checked_at DESC);

COMMENT ON TABLE operator_report_deliveries  IS 'V141: audit trail of operator report email delivery attempts';
COMMENT ON TABLE onboarding_readiness_log    IS 'V141: history of production readiness check results';
COMMENT ON COLUMN comm_messages.fts_vector   IS 'V141: tsvector for full-text search (auto-updated by trigger)';
