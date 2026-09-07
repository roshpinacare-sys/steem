-- Migration Phase 43 — V169
-- Task Recurrence Rules + Activity Feed Subscriptions
-- Applied: 2026-05-30

-- ── Table 1: workspace_task_recurrence_rules ────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_task_recurrence_rules (
  id             UUID         NOT NULL DEFAULT gen_random_uuid(),
  workspace_id   VARCHAR(255) NOT NULL,
  task_id        VARCHAR(255) NOT NULL,
  frequency      VARCHAR(16)  NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
  interval_val   INTEGER      NOT NULL DEFAULT 1 CHECK (interval_val >= 1 AND interval_val <= 365),
  until_date     TIMESTAMPTZ  NULL,
  max_count      INTEGER      NULL CHECK (max_count >= 1 AND max_count <= 1000),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_workspace_task_recurrence PRIMARY KEY (workspace_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_wtrr_workspace
  ON workspace_task_recurrence_rules (workspace_id);

CREATE INDEX IF NOT EXISTS idx_wtrr_workspace_task
  ON workspace_task_recurrence_rules (workspace_id, task_id);

CREATE INDEX IF NOT EXISTS idx_wtrr_frequency
  ON workspace_task_recurrence_rules (workspace_id, frequency);

-- ── Table 2: workspace_activity_subscriptions ────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_activity_subscriptions (
  id             UUID         NOT NULL DEFAULT gen_random_uuid(),
  workspace_id   VARCHAR(255) NOT NULL,
  target_url     TEXT         NOT NULL,
  event_types    JSONB        NOT NULL DEFAULT '[]',
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  active         BOOLEAN      NOT NULL DEFAULT TRUE,
  CONSTRAINT pk_workspace_activity_subscription PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_was_workspace_active
  ON workspace_activity_subscriptions (workspace_id, active);

CREATE INDEX IF NOT EXISTS idx_was_workspace_created
  ON workspace_activity_subscriptions (workspace_id, created_at DESC);
