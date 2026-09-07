-- =============================================================================
-- Migration: Phase 35 — V161 Labels + Comments + SLA + Audit Trail
-- =============================================================================
-- Tables:
--   workspace_labels            — color-coded labels per workspace
--   workspace_task_labels       — many-to-many: tasks ↔ labels
--   workspace_task_comments     — threaded comments on tasks
--   workspace_sla_policies      — SLA hour-budgets per priority per workspace
--   workspace_sla_events        — immutable breach/escalation log
--   workspace_audit_trail       — immutable append-only audit log
--
-- Depends on: all previous migrations (Phase 1–34)
-- Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
-- [V161-TASK-DB]
-- =============================================================================

BEGIN;

-- ── workspace_labels ──────────────────────────────────────────────────────────
-- Color-coded labels for organizational tagging of tasks
CREATE TABLE IF NOT EXISTS workspace_labels (
  id            TEXT        PRIMARY KEY,
  workspace_id  TEXT        NOT NULL,
  name          TEXT        NOT NULL,
  color         TEXT        NOT NULL DEFAULT '#6B7280'
                            CHECK (color ~ '^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$'),
  description   TEXT        NOT NULL DEFAULT '',
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_labels_workspace ON workspace_labels(workspace_id, name ASC);
CREATE INDEX IF NOT EXISTS idx_labels_created   ON workspace_labels(workspace_id, created_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_label_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_label_updated_at ON workspace_labels;
CREATE TRIGGER trg_label_updated_at
  BEFORE UPDATE ON workspace_labels
  FOR EACH ROW EXECUTE FUNCTION update_label_updated_at();

-- ── workspace_task_labels ────────────────────────────────────────────────────
-- Many-to-many join between tasks and labels
CREATE TABLE IF NOT EXISTS workspace_task_labels (
  workspace_id  TEXT        NOT NULL,
  task_id       TEXT        NOT NULL,
  label_id      TEXT        NOT NULL,
  applied_by    TEXT,
  applied_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, task_id, label_id)
);

CREATE INDEX IF NOT EXISTS idx_task_labels_task    ON workspace_task_labels(workspace_id, task_id);
CREATE INDEX IF NOT EXISTS idx_task_labels_label   ON workspace_task_labels(workspace_id, label_id);
CREATE INDEX IF NOT EXISTS idx_task_labels_applied ON workspace_task_labels(workspace_id, applied_at DESC);

-- ── workspace_task_comments ───────────────────────────────────────────────────
-- Threaded comments on workspace tasks with soft-delete + reactions
CREATE TABLE IF NOT EXISTS workspace_task_comments (
  id                TEXT        PRIMARY KEY,
  workspace_id      TEXT        NOT NULL,
  task_id           TEXT        NOT NULL,
  parent_comment_id TEXT,                   -- NULL = top-level; set = reply
  body              TEXT        NOT NULL,
  author_id         TEXT,
  reactions         JSONB       NOT NULL DEFAULT '{}',  -- { "👍": 3, "🎉": 1 }
  edited_at         TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ,             -- soft-delete; body shown as "[deleted]"
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_task      ON workspace_task_comments(workspace_id, task_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_comments_thread    ON workspace_task_comments(workspace_id, task_id, parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_comments_author    ON workspace_task_comments(workspace_id, author_id);
CREATE INDEX IF NOT EXISTS idx_comments_active    ON workspace_task_comments(workspace_id, task_id)
  WHERE deleted_at IS NULL;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_comment_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comment_updated_at ON workspace_task_comments;
CREATE TRIGGER trg_comment_updated_at
  BEFORE UPDATE ON workspace_task_comments
  FOR EACH ROW EXECUTE FUNCTION update_comment_updated_at();

-- ── workspace_sla_policies ────────────────────────────────────────────────────
-- Per-workspace SLA configurations (hours per priority)
CREATE TABLE IF NOT EXISTS workspace_sla_policies (
  id                   TEXT        PRIMARY KEY,
  workspace_id         TEXT        NOT NULL,
  name                 TEXT        NOT NULL,
  description          TEXT        NOT NULL DEFAULT '',
  is_default           BOOLEAN     NOT NULL DEFAULT FALSE,
  hours_critical       NUMERIC(10,2) NOT NULL DEFAULT 4,
  hours_high           NUMERIC(10,2) NOT NULL DEFAULT 24,
  hours_medium         NUMERIC(10,2) NOT NULL DEFAULT 72,
  hours_low            NUMERIC(10,2) NOT NULL DEFAULT 168,
  warn_multiplier      NUMERIC(4,2) NOT NULL DEFAULT 0.80,
  alert_multiplier     NUMERIC(4,2) NOT NULL DEFAULT 1.00,
  critical_multiplier  NUMERIC(4,2) NOT NULL DEFAULT 1.50,
  created_by           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sla_policy_workspace ON workspace_sla_policies(workspace_id);
CREATE INDEX IF NOT EXISTS idx_sla_policy_default   ON workspace_sla_policies(workspace_id, is_default)
  WHERE is_default = TRUE;

-- ── workspace_sla_events ──────────────────────────────────────────────────────
-- Immutable breach / escalation event log — no UPDATE or DELETE
CREATE TABLE IF NOT EXISTS workspace_sla_events (
  id                TEXT        PRIMARY KEY,
  workspace_id      TEXT        NOT NULL,
  task_id           TEXT        NOT NULL,
  policy_id         TEXT,
  priority          TEXT        NOT NULL,
  escalation_level  TEXT        NOT NULL DEFAULT 'warn'
                                CHECK (escalation_level IN ('warn','alert','critical')),
  age_hours         NUMERIC(10,2),
  sla_hours         NUMERIC(10,2),
  overage_percent   NUMERIC(8,1),
  detected_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sla_events_workspace ON workspace_sla_events(workspace_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_sla_events_task      ON workspace_sla_events(workspace_id, task_id);
CREATE INDEX IF NOT EXISTS idx_sla_events_level     ON workspace_sla_events(workspace_id, escalation_level);

-- ── workspace_audit_trail ─────────────────────────────────────────────────────
-- Immutable append-only log of all workspace mutations with SHA-256 chain
-- IMPORTANT: Never UPDATE or DELETE rows in this table — use triggers to enforce
CREATE TABLE IF NOT EXISTS workspace_audit_trail (
  id           TEXT        PRIMARY KEY,
  workspace_id TEXT        NOT NULL,
  event_type   TEXT        NOT NULL,
  actor_id     TEXT,
  target_id    TEXT,
  target_type  TEXT,
  payload      JSONB       NOT NULL DEFAULT '{}',
  metadata     JSONB       NOT NULL DEFAULT '{}',
  prev_hash    TEXT,       -- SHA-256 of previous event in this workspace (NULL for first)
  hash         TEXT        NOT NULL,   -- SHA-256 of this event
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_workspace ON workspace_audit_trail(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor     ON workspace_audit_trail(workspace_id, actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_event     ON workspace_audit_trail(workspace_id, event_type);
CREATE INDEX IF NOT EXISTS idx_audit_target    ON workspace_audit_trail(workspace_id, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_hash      ON workspace_audit_trail(hash);

-- Immutability guard: prevent UPDATE/DELETE on audit_trail
CREATE OR REPLACE FUNCTION deny_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'workspace_audit_trail is immutable — UPDATE/DELETE forbidden';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_no_update ON workspace_audit_trail;
CREATE TRIGGER trg_audit_no_update
  BEFORE UPDATE ON workspace_audit_trail
  FOR EACH ROW EXECUTE FUNCTION deny_audit_mutation();

DROP TRIGGER IF EXISTS trg_audit_no_delete ON workspace_audit_trail;
CREATE TRIGGER trg_audit_no_delete
  BEFORE DELETE ON workspace_audit_trail
  FOR EACH ROW EXECUTE FUNCTION deny_audit_mutation();

COMMIT;
