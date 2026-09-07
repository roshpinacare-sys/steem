-- ═══════════════════════════════════════════════════════════════════════════
-- ECOS V142 — Phase 25 DB Migration
-- P32: PDF Export, Demo Setup, Design Partner Pack, Readiness History
-- Safe to run multiple times (all idempotent).
-- Run AFTER migration_phase24.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── [V142-PDF-01] operator_report_exports — PDF/HTML export audit trail ──────
-- Records every report export (PDF or HTML), complementing operator_report_deliveries.
CREATE TABLE IF NOT EXISTS operator_report_exports (
  id             BIGSERIAL    PRIMARY KEY,
  format         TEXT         NOT NULL DEFAULT 'html',   -- 'pdf' | 'html'
  engine         TEXT,                                    -- 'puppeteer' | 'html-pdf-node' | 'built-in-fallback'
  size_bytes     INT,
  overall_status TEXT,
  operator_name  TEXT,
  output_path    TEXT,
  ecos_version   TEXT         NOT NULL DEFAULT 'V142',
  exported_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS operator_report_exports_exported_at_idx
  ON operator_report_exports (exported_at DESC);

COMMENT ON TABLE operator_report_exports IS 'V142: audit trail of operator compliance report exports (PDF/HTML)';

-- ── [V142-DEMO-01] demo_sessions — record demo-setup.js runs ─────────────────
-- Optional tracking of design partner demo sessions.
CREATE TABLE IF NOT EXISTS demo_sessions (
  id              BIGSERIAL    PRIMARY KEY,
  vertical        TEXT         NOT NULL DEFAULT 'insurance',
  tasks_submitted INT          NOT NULL DEFAULT 0,
  validators_seen INT          NOT NULL DEFAULT 0,
  api_base        TEXT,
  dry_run         BOOLEAN      NOT NULL DEFAULT false,
  metadata        JSONB,
  ecos_version    TEXT         NOT NULL DEFAULT 'V142',
  run_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS demo_sessions_run_at_idx
  ON demo_sessions (run_at DESC);

COMMENT ON TABLE demo_sessions IS 'V142: design partner demo session tracking';

-- ── [V142-OB-01] onboarding_readiness_log — extend with V142 fields ──────────
-- Add ecos_version column if column is still the default (backward-compat).
-- Table created in migration_phase24.sql; this is additive only.
ALTER TABLE onboarding_readiness_log
  ADD COLUMN IF NOT EXISTS vertical TEXT;

ALTER TABLE onboarding_readiness_log
  ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN onboarding_readiness_log.vertical IS 'V142: target vertical for this readiness check';
COMMENT ON COLUMN onboarding_readiness_log.notes    IS 'V142: free-text notes from the check run';

-- ── [V142-SEARCH-01] comm_messages cross-channel search index ────────────────
-- Composite index: channel_id + fts_vector for cross-channel search performance.
CREATE INDEX IF NOT EXISTS comm_messages_channel_fts_idx
  ON comm_messages (channel_id, created_at DESC)
  WHERE fts_vector IS NOT NULL;

COMMENT ON INDEX comm_messages_channel_fts_idx IS 'V142: composite index for per-channel FTS with recency ordering';
