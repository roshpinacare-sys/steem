-- ═══════════════════════════════════════════════════════════════════════════
-- ECOS V140 — Phase 23 DB Migration
-- P30: EU AI Act Operator Report + Thread Aggregation + Delivery Log Retention
-- Safe to run multiple times (all idempotent).
-- Run AFTER migration_phase22.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── [V140-EU-01] operator_reports — archived compliance reports ──────────────
-- Stores generated EU AI Act compliance reports for audit trail.
-- One row per report generation event.
CREATE TABLE IF NOT EXISTS operator_reports (
  id               BIGSERIAL    PRIMARY KEY,
  report_version   TEXT         NOT NULL DEFAULT '1.0',
  operator_name    TEXT,
  operator_contact TEXT,
  overall_status   TEXT         NOT NULL,        -- COMPLIANT | COMPLIANT_WITH_WARNINGS | NON_COMPLIANT
  chain_length     INT,
  chain_intact     BOOLEAN,
  open_issues_json JSONB,                         -- array of issue objects
  report_json      JSONB        NOT NULL,          -- full report payload
  generated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ecos_version     TEXT         NOT NULL DEFAULT 'V140'
);

CREATE INDEX IF NOT EXISTS operator_reports_generated_at_idx
  ON operator_reports (generated_at DESC);
CREATE INDEX IF NOT EXISTS operator_reports_status_idx
  ON operator_reports (overall_status);

-- ── [V140-DL-01] delivery_log_retention_runs — audit trail for purge runs ───
-- Records when and how many rows were purged from notification_delivery_log.
CREATE TABLE IF NOT EXISTS delivery_log_retention_runs (
  id             BIGSERIAL    PRIMARY KEY,
  retention_days INT          NOT NULL,
  cutoff_at      TIMESTAMPTZ  NOT NULL,
  rows_deleted   INT          NOT NULL DEFAULT 0,
  run_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  triggered_by   TEXT         NOT NULL DEFAULT 'scheduler'  -- 'scheduler' | 'api' | 'manual'
);

CREATE INDEX IF NOT EXISTS retention_runs_run_at_idx
  ON delivery_log_retention_runs (run_at DESC);

-- ── [V140-TA-01] Thread aggregation index ───────────────────────────────────
-- Optimises enrichMessages() query: reply_count lookup by message ids.
-- (comm_messages table already exists from V138; index is additive.)
CREATE INDEX IF NOT EXISTS comm_messages_id_reply_count_idx
  ON comm_messages (id, reply_count)
  WHERE parent_id IS NULL;

COMMENT ON TABLE operator_reports               IS 'V140: archived EU AI Act operator compliance reports';
COMMENT ON TABLE delivery_log_retention_runs    IS 'V140: audit trail for notification_delivery_log purge runs';
