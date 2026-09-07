-- Migration Phase 45 — V171
-- ============================================================
-- Workspace Notifications + Task Dependencies per-task CRUD
-- ============================================================
-- 1 new table: workspace_notifications  (6 indexes)
-- Note: task_dependencies table already exists from phase 34.
--       V171 adds REST endpoints on top of the existing service.

-- ── workspace_notifications ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workspace_notifications (
  id            TEXT        NOT NULL PRIMARY KEY,
  workspace_id  TEXT        NOT NULL,
  user_id       TEXT        NOT NULL,
  title         TEXT        NOT NULL,
  body          TEXT,
  type          TEXT        NOT NULL DEFAULT 'info',
  meta          JSONB       NOT NULL DEFAULT '{}',
  read          BOOLEAN     NOT NULL DEFAULT FALSE,
  read_at       TIMESTAMPTZ,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index: fast lookup by workspace + user (primary query pattern)
CREATE INDEX IF NOT EXISTS idx_wn_workspace_user
  ON workspace_notifications (workspace_id, user_id);

-- Index: filter unread per workspace+user
CREATE INDEX IF NOT EXISTS idx_wn_workspace_user_unread
  ON workspace_notifications (workspace_id, user_id, read)
  WHERE read = FALSE;

-- Index: range queries / ordering by creation time
CREATE INDEX IF NOT EXISTS idx_wn_created_at
  ON workspace_notifications (created_at DESC);

-- Index: lookup by workspace alone (admin/cleanup)
CREATE INDEX IF NOT EXISTS idx_wn_workspace
  ON workspace_notifications (workspace_id);

-- Index: lookup by user across workspaces
CREATE INDEX IF NOT EXISTS idx_wn_user
  ON workspace_notifications (user_id);

-- Index: type filtering
CREATE INDEX IF NOT EXISTS idx_wn_type
  ON workspace_notifications (type);

-- ── constraints ─────────────────────────────────────────────────────────────

ALTER TABLE workspace_notifications
  ADD CONSTRAINT IF NOT EXISTS chk_wn_type
  CHECK (type IN ('info','warning','success','error','mention','assignment','system'));
