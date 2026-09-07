-- migration_phase44.sql — V170
-- Workspace Tags + Bulk Task Status
-- 3 new tables + 7 new indexes
-- Phase: P59 | Version: 170.0.0

-- ── Table: workspace_tags ──────────────────────────────────────────────────
-- One row per tag in a workspace
CREATE TABLE IF NOT EXISTS workspace_tags (
  id              TEXT        NOT NULL,
  workspace_id    TEXT        NOT NULL,
  name            TEXT        NOT NULL,
  color           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_workspace_tags PRIMARY KEY (id),
  CONSTRAINT uq_workspace_tags_name UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_wt_workspace
  ON workspace_tags (workspace_id);

CREATE INDEX IF NOT EXISTS idx_wt_workspace_name
  ON workspace_tags (workspace_id, lower(name));

-- ── Table: workspace_task_tags ─────────────────────────────────────────────
-- Many-to-many: task ↔ tag attachments
CREATE TABLE IF NOT EXISTS workspace_task_tags (
  id              TEXT        NOT NULL,
  workspace_id    TEXT        NOT NULL,
  task_id         TEXT        NOT NULL,
  tag_id          TEXT        NOT NULL,
  attached_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_workspace_task_tags PRIMARY KEY (id),
  CONSTRAINT uq_workspace_task_tags_attach UNIQUE (workspace_id, task_id, tag_id),
  CONSTRAINT fk_wtt_tag FOREIGN KEY (tag_id)
    REFERENCES workspace_tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wtt_workspace_task
  ON workspace_task_tags (workspace_id, task_id);

CREATE INDEX IF NOT EXISTS idx_wtt_workspace_tag
  ON workspace_task_tags (workspace_id, tag_id);

CREATE INDEX IF NOT EXISTS idx_wtt_tag
  ON workspace_task_tags (tag_id);

-- ── Table: workspace_task_statuses ────────────────────────────────────────
-- Stores the current status of each task for bulk operations
CREATE TABLE IF NOT EXISTS workspace_task_statuses (
  workspace_id    TEXT        NOT NULL,
  task_id         TEXT        NOT NULL,
  status          TEXT        NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_workspace_task_statuses PRIMARY KEY (workspace_id, task_id),
  CONSTRAINT chk_wts_status CHECK (
    status IN ('open', 'in_progress', 'done', 'blocked', 'cancelled')
  )
);

CREATE INDEX IF NOT EXISTS idx_wts_workspace_status
  ON workspace_task_statuses (workspace_id, status);
