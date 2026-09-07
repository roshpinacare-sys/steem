-- ============================================================
-- ECOS V162 — DB Migration Phase 36
-- Task Recurrence, Bulk Ops, Time Tracking
-- ============================================================

-- ── 1. Recurrence Rules ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recurrence_rules (
  id               TEXT        PRIMARY KEY,
  workspace_id     TEXT        NOT NULL,
  task_id          TEXT        NOT NULL,
  frequency        TEXT        NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
  interval_n       INTEGER     NOT NULL DEFAULT 1 CHECK (interval_n BETWEEN 1 AND 365),
  weekday          TEXT        CHECK (weekday IN ('mon','tue','wed','thu','fri','sat','sun')),
  day_of_month     INTEGER     CHECK (day_of_month BETWEEN 1 AND 28),
  enabled          BOOLEAN     NOT NULL DEFAULT TRUE,
  spawn_count      INTEGER     NOT NULL DEFAULT 0,
  last_spawn_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recurrence_rules_workspace ON recurrence_rules (workspace_id);
CREATE INDEX IF NOT EXISTS idx_recurrence_rules_task ON recurrence_rules (task_id);

-- ── 2. Recurrence Instances (spawned child tasks) ────────────────────────
CREATE TABLE IF NOT EXISTS recurrence_instances (
  id              TEXT        PRIMARY KEY,
  rule_id         TEXT        NOT NULL REFERENCES recurrence_rules(id) ON DELETE CASCADE,
  workspace_id    TEXT        NOT NULL,
  parent_task_id  TEXT        NOT NULL,
  child_task_id   TEXT        NOT NULL,
  spawned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recurrence_instances_rule ON recurrence_instances (rule_id);
CREATE INDEX IF NOT EXISTS idx_recurrence_instances_workspace ON recurrence_instances (workspace_id);

-- ── 3. Bulk Ops Log ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bulk_ops_log (
  id              TEXT        PRIMARY KEY,
  workspace_id    TEXT        NOT NULL,
  operation       TEXT        NOT NULL CHECK (operation IN ('status','assign','delete')),
  actor_id        TEXT,
  task_ids        JSONB       NOT NULL DEFAULT '[]',
  params          JSONB       NOT NULL DEFAULT '{}',
  results         JSONB       NOT NULL DEFAULT '[]',
  success_count   INTEGER     NOT NULL DEFAULT 0,
  error_count     INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bulk_ops_log_workspace ON bulk_ops_log (workspace_id);
CREATE INDEX IF NOT EXISTS idx_bulk_ops_log_op ON bulk_ops_log (operation);
CREATE INDEX IF NOT EXISTS idx_bulk_ops_log_created ON bulk_ops_log (created_at DESC);

-- ── 4. Workspace Time Entries ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_time_entries (
  id              TEXT        PRIMARY KEY,
  workspace_id    TEXT        NOT NULL,
  task_id         TEXT        NOT NULL,
  user_id         TEXT,
  type            TEXT        NOT NULL CHECK (type IN ('manual','timer')) DEFAULT 'manual',
  started_at      TIMESTAMPTZ,
  stopped_at      TIMESTAMPTZ,
  duration_sec    INTEGER     NOT NULL DEFAULT 0 CHECK (duration_sec >= 0),
  note            TEXT        NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_time_entries_workspace ON workspace_time_entries (workspace_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_task ON workspace_time_entries (task_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_user ON workspace_time_entries (user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_created ON workspace_time_entries (created_at DESC);

-- ── 5. Add recurrence_rule column to workspace_tasks (if not exists) ──────
ALTER TABLE workspace_tasks ADD COLUMN IF NOT EXISTS recurrence_rule TEXT;

-- ── Phase 36 complete ─────────────────────────────────────────────────────
