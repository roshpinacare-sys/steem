-- ECOS V155 Migration — Phase 30: AI Metrics Snapshots + Workspace UI
-- Adds tables for AI metrics persistence and workspace UI support
BEGIN;

-- ── AI Metrics Snapshots ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_metrics_snapshots (
  id               SERIAL PRIMARY KEY,
  snapshot_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  task_count       INTEGER      NOT NULL DEFAULT 0,
  avg_confidence   NUMERIC(6,4),
  pressure_rate    NUMERIC(6,2),
  calib_accuracy   NUMERIC(6,4),
  auto_calib_count INTEGER      NOT NULL DEFAULT 0,
  payload          JSONB,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ai_metrics_snapshots_at_idx ON ai_metrics_snapshots(snapshot_at DESC);

-- ── Workspace UI Support ──────────────────────────────────────────────────────
-- workspaces table already exists from migration_phase4.sql
-- Add display_name and description columns if not present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='workspaces' AND column_name='display_name'
  ) THEN
    ALTER TABLE workspaces ADD COLUMN display_name VARCHAR(255);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='workspaces' AND column_name='description'
  ) THEN
    ALTER TABLE workspaces ADD COLUMN description TEXT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='workspaces' AND column_name='task_count'
  ) THEN
    ALTER TABLE workspaces ADD COLUMN task_count INTEGER NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='workspaces' AND column_name='active_validators'
  ) THEN
    ALTER TABLE workspaces ADD COLUMN active_validators INTEGER NOT NULL DEFAULT 0;
  END IF;
END$$;

-- ── WS Admin Feed: audit_broadcast_log ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_broadcast_log (
  id           SERIAL PRIMARY KEY,
  event_type   VARCHAR(64)  NOT NULL,
  payload      JSONB,
  broadcast_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  recipient_count INTEGER   NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS audit_broadcast_log_at_idx ON audit_broadcast_log(broadcast_at DESC);

COMMIT;
