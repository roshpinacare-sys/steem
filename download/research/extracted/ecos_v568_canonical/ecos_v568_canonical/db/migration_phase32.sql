-- =============================================================================
-- Migration: Phase 32 — V158 Workspace Tasks + Calibration History
-- =============================================================================
-- Tables:
--   workspace_tasks        — task records assigned within a workspace
--   workspace_members      — workspace membership roster
--   workspace_activity_log — audit trail of workspace actions
--   calibration_history    — history of calibrator fit operations
--
-- Depends on: all previous migrations (Phase 1–31)
-- Sacred Files: fiatLedger.js, auditLog.js — UNTOUCHED
-- [V158-TASK-06, V158-TASK-07, V158-TASK-08]
-- =============================================================================

BEGIN;

-- ── workspace_tasks ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_tasks (
  id             TEXT        PRIMARY KEY,
  workspace_id   TEXT        NOT NULL,
  title          TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  description    TEXT        NOT NULL DEFAULT '',
  status         TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','in_progress','review','done','blocked','cancelled')),
  priority       TEXT        NOT NULL DEFAULT 'medium'
                             CHECK (priority IN ('critical','high','medium','low')),
  assignee_id    TEXT,
  created_by     TEXT,
  due_at         TIMESTAMPTZ,
  tags           JSONB       NOT NULL DEFAULT '[]',
  metadata       JSONB       NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_workspace_tasks_workspace  ON workspace_tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_tasks_status     ON workspace_tasks(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_workspace_tasks_assignee   ON workspace_tasks(workspace_id, assignee_id);
CREATE INDEX IF NOT EXISTS idx_workspace_tasks_priority   ON workspace_tasks(workspace_id, priority);
CREATE INDEX IF NOT EXISTS idx_workspace_tasks_due        ON workspace_tasks(workspace_id, due_at) WHERE due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workspace_tasks_created    ON workspace_tasks(workspace_id, created_at DESC);

-- Full-text search index on title + description
CREATE INDEX IF NOT EXISTS idx_workspace_tasks_fts
  ON workspace_tasks USING gin(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'')));

-- updated_at auto-update trigger
CREATE OR REPLACE FUNCTION workspace_tasks_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workspace_tasks_updated ON workspace_tasks;
CREATE TRIGGER trg_workspace_tasks_updated
  BEFORE UPDATE ON workspace_tasks
  FOR EACH ROW EXECUTE FUNCTION workspace_tasks_set_updated_at();

-- ── workspace_members ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_members (
  id             TEXT        PRIMARY KEY DEFAULT concat('wm_', extract(epoch from now())::bigint::text, '_', substr(md5(random()::text),1,8)),
  workspace_id   TEXT        NOT NULL,
  user_id        TEXT        NOT NULL,
  role           TEXT        NOT NULL DEFAULT 'member'
                             CHECK (role IN ('owner','admin','manager','member','viewer')),
  invited_by     TEXT,
  joined_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user      ON workspace_members(user_id);

-- ── workspace_activity_log ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_activity_log (
  id             BIGSERIAL   PRIMARY KEY,
  workspace_id   TEXT        NOT NULL,
  actor_id       TEXT,
  event_type     TEXT        NOT NULL,
  entity_type    TEXT,               -- 'task' | 'member' | 'workspace'
  entity_id      TEXT,
  payload        JSONB       NOT NULL DEFAULT '{}',
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_activity_ws   ON workspace_activity_log(workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_activity_type ON workspace_activity_log(workspace_id, event_type);
CREATE INDEX IF NOT EXISTS idx_workspace_activity_actor ON workspace_activity_log(workspace_id, actor_id);

-- ── calibration_history ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calibration_history (
  id             TEXT        PRIMARY KEY,
  a_param        DOUBLE PRECISION,
  b_param        DOUBLE PRECISION,
  sample_count   INTEGER     NOT NULL DEFAULT 0,
  brier_score    DOUBLE PRECISION,
  roc_auc        DOUBLE PRECISION,
  accuracy       DOUBLE PRECISION,
  trigger_type   TEXT        NOT NULL DEFAULT 'manual'
                             CHECK (trigger_type IN ('auto','manual','startup','api')),
  fitted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note           TEXT        NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_calibration_history_fitted ON calibration_history(fitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_calibration_history_trigger ON calibration_history(trigger_type, fitted_at DESC);

-- ── workspace_task_comments ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_task_comments (
  id             TEXT        PRIMARY KEY,
  workspace_id   TEXT        NOT NULL,
  task_id        TEXT        NOT NULL REFERENCES workspace_tasks(id) ON DELETE CASCADE,
  author_id      TEXT,
  text           TEXT        NOT NULL CHECK (char_length(text) BETWEEN 1 AND 2000),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wtask_comments_task ON workspace_task_comments(task_id, created_at DESC);

COMMIT;
