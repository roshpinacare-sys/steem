-- ============================================================
-- Migration Phase 40 — V166
-- Audit Trail Webhook Push Subscriptions
-- ============================================================

-- Table: workspace_audit_webhook_subscriptions
-- Stores audit event webhook subscriptions per workspace.
CREATE TABLE IF NOT EXISTS workspace_audit_webhook_subscriptions (
  id            TEXT        PRIMARY KEY,
  workspace_id  TEXT        NOT NULL,
  url           TEXT        NOT NULL,
  secret        TEXT        NOT NULL,
  event_types   JSONB       NOT NULL DEFAULT '["audit.*"]'::jsonb,
  active        BOOLEAN     NOT NULL DEFAULT TRUE,
  description   TEXT        NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index: fast lookup by workspace
CREATE INDEX IF NOT EXISTS idx_waws_workspace_id
  ON workspace_audit_webhook_subscriptions (workspace_id);

-- Index: active subscriptions per workspace (for hot push path)
CREATE INDEX IF NOT EXISTS idx_waws_workspace_active
  ON workspace_audit_webhook_subscriptions (workspace_id, active)
  WHERE active = TRUE;
