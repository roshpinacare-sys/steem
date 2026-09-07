-- Migration Phase 39 — V165
-- Task Custom Fields
-- Date: 2026-05-30

-- ── Table: workspace_custom_fields ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_custom_fields (
  id           TEXT        PRIMARY KEY,
  workspace_id TEXT        NOT NULL,
  name         TEXT        NOT NULL,
  type         TEXT        NOT NULL CHECK (type IN ('text','number','date','select')),
  options      JSONB       NOT NULL DEFAULT '[]',
  required     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wcf_workspace
  ON workspace_custom_fields (workspace_id);

-- ── Table: workspace_task_custom_values ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_task_custom_values (
  id           TEXT        PRIMARY KEY,
  workspace_id TEXT        NOT NULL,
  task_id      TEXT        NOT NULL,
  field_id     TEXT        NOT NULL,
  value        JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, task_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_wtcv_workspace_task
  ON workspace_task_custom_values (workspace_id, task_id);

CREATE INDEX IF NOT EXISTS idx_wtcv_workspace_field_value
  ON workspace_task_custom_values (workspace_id, field_id, value);
