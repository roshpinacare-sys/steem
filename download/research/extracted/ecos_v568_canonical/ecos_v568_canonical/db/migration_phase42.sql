-- migration_phase42.sql — V168
-- Validator Performance Dashboard
-- Phase 42: workspace_validator_perf_snapshots table + indexes

BEGIN;

CREATE TABLE IF NOT EXISTS workspace_validator_perf_snapshots (
  id             TEXT        PRIMARY KEY,
  workspace_id   TEXT        NOT NULL,
  validator_id   TEXT        NOT NULL,
  task_id        TEXT        NOT NULL,
  completed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolution_ms  BIGINT,
  sla_breached   BOOLEAN     NOT NULL DEFAULT FALSE
);

-- Fast listing per workspace + validator ordered by recency
CREATE INDEX IF NOT EXISTS idx_wvps_workspace_validator_completed
  ON workspace_validator_perf_snapshots (workspace_id, validator_id, completed_at DESC);

-- Filter by workspace + date range (cross-validator analytics)
CREATE INDEX IF NOT EXISTS idx_wvps_workspace_completed
  ON workspace_validator_perf_snapshots (workspace_id, completed_at DESC);

-- Filter SLA breaches quickly
CREATE INDEX IF NOT EXISTS idx_wvps_workspace_validator_sla
  ON workspace_validator_perf_snapshots (workspace_id, validator_id, sla_breached, completed_at DESC);

COMMIT;
