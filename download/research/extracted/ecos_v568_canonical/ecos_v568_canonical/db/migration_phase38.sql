-- Migration Phase 38 — V164
-- Comment Mentions + Label Filter Index
-- Date: 2026-05-30

-- ── Table: workspace_comment_mentions ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_comment_mentions (
  id                TEXT        PRIMARY KEY,
  workspace_id      TEXT        NOT NULL,
  task_id           TEXT        NOT NULL,
  comment_id        TEXT        NOT NULL,
  mentioned_user_id TEXT        NOT NULL,
  author_id         TEXT,
  notified          BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wcm_workspace_comment
  ON workspace_comment_mentions (workspace_id, comment_id);

CREATE INDEX IF NOT EXISTS idx_wcm_workspace_user
  ON workspace_comment_mentions (workspace_id, mentioned_user_id);

CREATE INDEX IF NOT EXISTS idx_wcm_task
  ON workspace_comment_mentions (workspace_id, task_id);

-- ── Index: workspace_task_labels — for fast multi-label AND filtering ─────
CREATE INDEX IF NOT EXISTS idx_wtl_workspace_label
  ON workspace_task_labels (workspace_id, label_id);
