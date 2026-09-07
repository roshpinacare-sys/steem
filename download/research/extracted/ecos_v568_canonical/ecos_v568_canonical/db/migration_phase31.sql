-- ECOS V156 Migration Phase 31
-- Workspace Member Management + Metrics Persistence Cron
-- ─────────────────────────────────────────────────────────────────────────────

-- [V156-TASK-03] Workspace members table
CREATE TABLE IF NOT EXISTS workspace_members (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'VIEWER', -- OWNER | ADMIN | EDITOR | VIEWER
  added_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, user_id),
  CONSTRAINT valid_role CHECK (role IN ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER'))
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_role ON workspace_members(role);

-- [V156-TASK-05] Metrics persistence cron log
CREATE TABLE IF NOT EXISTS metrics_persistence_log (
  id BIGSERIAL PRIMARY KEY,
  snapshot_count INTEGER NOT NULL,
  persisted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  duration_ms INTEGER,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_metrics_persistence_log_persisted_at ON metrics_persistence_log(persisted_at);

-- [V156-TASK-04] Admin WS connection rate limiting
CREATE TABLE IF NOT EXISTS admin_ws_rate_limit (
  id BIGSERIAL PRIMARY KEY,
  ip_address TEXT NOT NULL,
  connection_count INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(ip_address)
);

CREATE INDEX IF NOT EXISTS idx_admin_ws_rate_limit_ip ON admin_ws_rate_limit(ip_address);
CREATE INDEX IF NOT EXISTS idx_admin_ws_rate_limit_window ON admin_ws_rate_limit(window_start);

-- [V156-TASK-06] Workspace task assignment
CREATE TABLE IF NOT EXISTS workspace_tasks (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  UNIQUE(workspace_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_tasks_workspace_id ON workspace_tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_tasks_task_id ON workspace_tasks(task_id);
CREATE INDEX IF NOT EXISTS idx_workspace_tasks_completed ON workspace_tasks(completed_at);

-- [V156-TASK-07] Calibration history tracking
CREATE TABLE IF NOT EXISTS calibration_history (
  id BIGSERIAL PRIMARY KEY,
  calibrator_id TEXT,
  training_samples INTEGER NOT NULL,
  accuracy NUMERIC(5, 4),
  threshold NUMERIC(5, 4),
  triggered_at TIMESTAMP NOT NULL DEFAULT NOW(),
  auto_triggered BOOLEAN DEFAULT FALSE,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_calibration_history_triggered_at ON calibration_history(triggered_at);
CREATE INDEX IF NOT EXISTS idx_calibration_history_accuracy ON calibration_history(accuracy);
