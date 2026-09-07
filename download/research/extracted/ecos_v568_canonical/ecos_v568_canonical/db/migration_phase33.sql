-- =============================================================================
-- Migration: Phase 33 — V159 Webhooks + Invitations + Task Activity + Workspaces
-- =============================================================================
-- Tables:
--   workspace_webhooks          — outbound HTTP webhook registrations
--   workspace_webhook_deliveries — delivery history per webhook
--   workspace_invitations       — membership invitation tokens
--   workspace_task_activity     — per-task activity sub-log
--   workspace_task_watchers     — users watching specific tasks
--   workspace_archived          — soft-delete/archive tracking
--   validator_routing_log       — auto-assignment decisions
--
-- Depends on: all previous migrations (Phase 1–32)
-- Sacred Files: fiatLedger.js, auditLog.js — UNTOUCHED
-- [V159-TASK-02]
-- =============================================================================

BEGIN;

-- ── workspace_webhooks ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_webhooks (
  id             TEXT        PRIMARY KEY,
  workspace_id   TEXT        NOT NULL,
  url            TEXT        NOT NULL,
  secret         TEXT        NOT NULL,
  events         JSONB       NOT NULL DEFAULT '["*"]',
  active         BOOLEAN     NOT NULL DEFAULT TRUE,
  description    TEXT        NOT NULL DEFAULT '',
  delivery_count INTEGER     NOT NULL DEFAULT 0,
  success_count  INTEGER     NOT NULL DEFAULT 0,
  fail_count     INTEGER     NOT NULL DEFAULT 0,
  last_used_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_workspace  ON workspace_webhooks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_active     ON workspace_webhooks(workspace_id, active);

-- ── workspace_webhook_deliveries ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_webhook_deliveries (
  id             BIGSERIAL   PRIMARY KEY,
  webhook_id     TEXT        NOT NULL REFERENCES workspace_webhooks(id) ON DELETE CASCADE,
  workspace_id   TEXT        NOT NULL,
  delivery_id    TEXT        NOT NULL,
  event_type     TEXT        NOT NULL,
  http_status    INTEGER,
  success        BOOLEAN     NOT NULL DEFAULT FALSE,
  attempt_count  INTEGER     NOT NULL DEFAULT 1,
  error_message  TEXT,
  delivered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_hook ON workspace_webhook_deliveries(webhook_id, delivered_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_ws   ON workspace_webhook_deliveries(workspace_id, delivered_at DESC);

-- ── workspace_invitations ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_invitations (
  id             TEXT        PRIMARY KEY,
  workspace_id   TEXT        NOT NULL,
  email          TEXT        NOT NULL,
  role           TEXT        NOT NULL DEFAULT 'member'
                             CHECK (role IN ('admin','manager','member','viewer')),
  invited_by     TEXT,
  token          TEXT,
  status         TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','accepted','revoked','expired')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL,
  accepted_at    TIMESTAMPTZ,
  UNIQUE (workspace_id, email, status)
);

CREATE INDEX IF NOT EXISTS idx_invitations_workspace ON workspace_invitations(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_invitations_email     ON workspace_invitations(email, status);
CREATE INDEX IF NOT EXISTS idx_invitations_expires   ON workspace_invitations(expires_at) WHERE status='pending';

-- ── workspace_task_activity ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_task_activity (
  id             BIGSERIAL   PRIMARY KEY,
  workspace_id   TEXT        NOT NULL,
  task_id        TEXT        NOT NULL,
  actor_id       TEXT,
  action         TEXT        NOT NULL,  -- 'status_changed'|'assigned'|'commented'|'priority_changed'|'created'|'deleted'
  old_value      JSONB,
  new_value      JSONB,
  metadata       JSONB       NOT NULL DEFAULT '{}',
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_activity_task ON workspace_task_activity(task_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_activity_ws   ON workspace_task_activity(workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_activity_actor ON workspace_task_activity(actor_id, occurred_at DESC);

-- ── workspace_task_watchers ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_task_watchers (
  task_id        TEXT        NOT NULL,
  workspace_id   TEXT        NOT NULL,
  user_id        TEXT        NOT NULL,
  watched_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_watchers_task ON workspace_task_watchers(task_id);
CREATE INDEX IF NOT EXISTS idx_task_watchers_user ON workspace_task_watchers(user_id);

-- ── workspace_archive ─────────────────────────────────────────────────────────
-- Tracks workspace archive/restore status
CREATE TABLE IF NOT EXISTS workspace_archive (
  workspace_id   TEXT        PRIMARY KEY,
  archived_by    TEXT,
  archived_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  restored_at    TIMESTAMPTZ,
  reason         TEXT        NOT NULL DEFAULT '',
  is_archived    BOOLEAN     NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_workspace_archive_archived ON workspace_archive(is_archived, archived_at DESC);

-- ── validator_routing_log ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS validator_routing_log (
  id             TEXT        PRIMARY KEY,
  task_id        TEXT        NOT NULL,
  workspace_id   TEXT,
  validator_id   TEXT        NOT NULL,
  routing_score  DOUBLE PRECISION,
  task_tags      JSONB       NOT NULL DEFAULT '[]',
  task_priority  TEXT,
  dry_run        BOOLEAN     NOT NULL DEFAULT FALSE,
  decided_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_routing_log_task      ON validator_routing_log(task_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_routing_log_validator ON validator_routing_log(validator_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_routing_log_decided   ON validator_routing_log(decided_at DESC);

COMMIT;
