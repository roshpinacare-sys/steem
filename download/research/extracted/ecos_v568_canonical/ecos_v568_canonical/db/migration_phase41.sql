-- migration_phase41.sql — V167
-- Workspace Activity Feed
-- Phase 41: workspace_activity_feed table + indexes

BEGIN;

CREATE TABLE IF NOT EXISTS workspace_activity_feed (
  id            TEXT        PRIMARY KEY,
  workspace_id  TEXT        NOT NULL,
  event_type    TEXT        NOT NULL,
  actor_id      TEXT        NOT NULL,
  actor_name    TEXT,
  target_id     TEXT,
  target_type   TEXT,
  target_name   TEXT,
  payload       JSONB       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast listing per workspace ordered by recency
CREATE INDEX IF NOT EXISTS idx_waf_workspace_created
  ON workspace_activity_feed (workspace_id, created_at DESC);

-- Filter by event type within a workspace
CREATE INDEX IF NOT EXISTS idx_waf_workspace_event_type
  ON workspace_activity_feed (workspace_id, event_type, created_at DESC);

-- Filter by actor within a workspace
CREATE INDEX IF NOT EXISTS idx_waf_workspace_actor
  ON workspace_activity_feed (workspace_id, actor_id, created_at DESC);

COMMIT;
