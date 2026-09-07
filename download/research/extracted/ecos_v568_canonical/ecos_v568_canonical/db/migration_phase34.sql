-- =============================================================================
-- Migration: Phase 34 — V160 Task Dependencies + Quotas + Templates + Retry Queue
-- =============================================================================
-- Tables:
--   task_dependencies           — directed acyclic graph of task-to-task blockers
--   workspace_quotas            — per-workspace resource limits by plan
--   workspace_task_templates    — reusable task templates
--   webhook_retry_queue         — persistent retry queue for failed webhook deliveries
--
-- Depends on: all previous migrations (Phase 1–33)
-- Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
-- [V160-TASK-DB]
-- =============================================================================

BEGIN;

-- ── task_dependencies ──────────────────────────────────────────────────────────
-- Stores directed edges: task_id depends-on depends_on_id
-- Cycle detection is enforced at application layer (lib/taskDependencyService.js)
CREATE TABLE IF NOT EXISTS task_dependencies (
  id             TEXT        PRIMARY KEY,
  workspace_id   TEXT        NOT NULL,
  task_id        TEXT        NOT NULL,     -- downstream (waiting) task
  depends_on_id  TEXT        NOT NULL,     -- upstream (blocking) task
  type           TEXT        NOT NULL DEFAULT 'finish-to-start'
                             CHECK (type IN ('finish-to-start','start-to-start','finish-to-finish')),
  created_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, task_id, depends_on_id)
);

CREATE INDEX IF NOT EXISTS idx_task_dep_task      ON task_dependencies(workspace_id, task_id);
CREATE INDEX IF NOT EXISTS idx_task_dep_blocker   ON task_dependencies(workspace_id, depends_on_id);
CREATE INDEX IF NOT EXISTS idx_task_dep_workspace ON task_dependencies(workspace_id, created_at DESC);

-- ── workspace_quotas ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_quotas (
  workspace_id        TEXT        PRIMARY KEY,
  plan                TEXT        NOT NULL DEFAULT 'pro'
                                  CHECK (plan IN ('free','pro','enterprise','unlimited')),
  max_tasks           INTEGER     NOT NULL DEFAULT 2000,
  max_members         INTEGER     NOT NULL DEFAULT 25,
  max_webhooks        INTEGER     NOT NULL DEFAULT 10,
  max_templates       INTEGER     NOT NULL DEFAULT 50,
  max_dependencies    INTEGER     NOT NULL DEFAULT 500,
  override_by         TEXT,       -- admin userId who set override
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotas_plan ON workspace_quotas(plan);

-- ── workspace_task_templates ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_task_templates (
  id                   TEXT        PRIMARY KEY,
  workspace_id         TEXT        NOT NULL,
  name                 TEXT        NOT NULL,
  description          TEXT        NOT NULL DEFAULT '',
  default_title        TEXT        NOT NULL DEFAULT '',
  default_description  TEXT        NOT NULL DEFAULT '',
  default_priority     TEXT        NOT NULL DEFAULT 'medium'
                                   CHECK (default_priority IN ('critical','high','medium','low')),
  default_assignee_id  TEXT,
  default_tags         JSONB       NOT NULL DEFAULT '[]',
  default_metadata     JSONB       NOT NULL DEFAULT '{}',
  category             TEXT        NOT NULL DEFAULT '',
  times_used           INTEGER     NOT NULL DEFAULT 0,
  created_by           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_templates_workspace ON workspace_task_templates(workspace_id, times_used DESC);
CREATE INDEX IF NOT EXISTS idx_templates_category  ON workspace_task_templates(workspace_id, category);
CREATE INDEX IF NOT EXISTS idx_templates_created   ON workspace_task_templates(workspace_id, created_at DESC);

-- Auto-update updated_at on workspace_task_templates
CREATE OR REPLACE FUNCTION update_template_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_template_updated_at ON workspace_task_templates;
CREATE TRIGGER trg_template_updated_at
  BEFORE UPDATE ON workspace_task_templates
  FOR EACH ROW EXECUTE FUNCTION update_template_updated_at();

-- ── webhook_retry_queue ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_retry_queue (
  id              TEXT        PRIMARY KEY,
  webhook_id      TEXT        NOT NULL,
  workspace_id    TEXT,
  event_type      TEXT        NOT NULL,
  payload         JSONB       NOT NULL DEFAULT '{}',
  url             TEXT        NOT NULL,
  secret          TEXT        NOT NULL DEFAULT '',
  attempt_num     INTEGER     NOT NULL DEFAULT 1,
  max_retries     INTEGER     NOT NULL DEFAULT 10,
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','processing','success','failed','abandoned')),
  last_error      TEXT,
  retry_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_retry_queue_pending   ON webhook_retry_queue(status, retry_at ASC) WHERE status='pending';
CREATE INDEX IF NOT EXISTS idx_retry_queue_webhook   ON webhook_retry_queue(webhook_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_retry_queue_workspace ON webhook_retry_queue(workspace_id, created_at DESC);

-- Partial index for fast polling
CREATE INDEX IF NOT EXISTS idx_retry_queue_due ON webhook_retry_queue(retry_at ASC)
  WHERE status = 'pending';

COMMIT;
