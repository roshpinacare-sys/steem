-- Migration Phase 37 — V163
-- Comment Pinning + SLA Assignee Report

-- Table: workspace_pinned_comments
CREATE TABLE IF NOT EXISTS workspace_pinned_comments (
  id              BIGSERIAL PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  task_id         TEXT NOT NULL,
  comment_id      TEXT NOT NULL,
  pinned_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, task_id, comment_id)
);
CREATE INDEX IF NOT EXISTS idx_wpc_workspace_task ON workspace_pinned_comments(workspace_id, task_id);

-- Table: workspace_sla_assignee_events
CREATE TABLE IF NOT EXISTS workspace_sla_assignee_events (
  id              BIGSERIAL PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  assignee_id     TEXT NOT NULL,
  task_id         TEXT,
  breached        BOOLEAN NOT NULL DEFAULT FALSE,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wsae_workspace_assignee ON workspace_sla_assignee_events(workspace_id, assignee_id);
