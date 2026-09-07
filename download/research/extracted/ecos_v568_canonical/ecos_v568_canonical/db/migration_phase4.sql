-- =============================================================================
  --  ECOS V104 — Phase 4 Migration
  -- ─────────────────────────────────────────────────────────────────────────────
  --  Adds tables for:
  --    P1 — Intelligence Registry accounting
  --    P2 — Memory Substrate persistence
  --    P3 — Execution Journal persistence
  --    P4 — Workspace Registry + User Profiles
  --
  --  Run AFTER migration_phase3_ml.sql.
  --  Safe to re-run: all DDL uses IF NOT EXISTS.
  -- =============================================================================

  BEGIN;

  -- ── P1: Intelligence Provider Accounting ─────────────────────────────────────
  CREATE TABLE IF NOT EXISTS intelligence_provider_stats (
      provider_id     TEXT        PRIMARY KEY,
      calls           BIGINT      NOT NULL DEFAULT 0,
      failures        BIGINT      NOT NULL DEFAULT 0,
      total_tokens    BIGINT      NOT NULL DEFAULT 0,
      total_cost_usd  NUMERIC(18,8) NOT NULL DEFAULT 0,
      total_latency_ms BIGINT     NOT NULL DEFAULT 0,
      avg_confidence  NUMERIC(6,4) NOT NULL DEFAULT 0,
      last_used_at    TIMESTAMPTZ,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- ── P2: Memory Substrate (vector-ready, pgvector opt-in) ─────────────────────
  -- Note: pgvector extension enables VECTOR columns for semantic retrieval.
  -- Without pgvector, store vectors as JSONB for compatibility.
  CREATE TABLE IF NOT EXISTS memory_entries (
      id              TEXT        PRIMARY KEY,
      scope           TEXT        NOT NULL CHECK (scope IN ('agent','user','workspace','global')),
      owner_id        TEXT        NOT NULL,
      content         TEXT        NOT NULL,
      vector_json     JSONB,      -- float[] serialized as JSONB (fallback without pgvector)
      metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
      importance      NUMERIC(4,3) NOT NULL DEFAULT 0.5
                                  CHECK (importance BETWEEN 0 AND 1),
      access_count    BIGINT      NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      accessed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_memory_scope_owner ON memory_entries(scope, owner_id);
  CREATE INDEX IF NOT EXISTS idx_memory_created     ON memory_entries(created_at DESC);

  -- ── P3: Execution Journal ─────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS execution_runs (
      run_id          TEXT        PRIMARY KEY,
      agent_id        TEXT,
      plan_id         TEXT,
      description     TEXT,
      status          TEXT        NOT NULL
                                  CHECK (status IN ('PENDING','RUNNING','CHECKPOINT','COMPLETED','FAILED','CANCELLED')),
      started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at    TIMESTAMPTZ,
      error_msg       TEXT,
      result          JSONB,
      checkpoint_count SMALLINT   NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS execution_journal_entries (
      id              TEXT        PRIMARY KEY,
      run_id          TEXT        NOT NULL REFERENCES execution_runs(run_id) ON DELETE CASCADE,
      step_id         TEXT,
      agent_id        TEXT,
      type            TEXT        NOT NULL,
      status          TEXT        NOT NULL,
      payload         JSONB       NOT NULL DEFAULT '{}'::jsonb,
      error_msg       TEXT,
      ts              TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_journal_run     ON execution_journal_entries(run_id, ts);
  CREATE INDEX IF NOT EXISTS idx_journal_agent   ON execution_journal_entries(agent_id, ts DESC);

  -- ── P4: User Profiles ─────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS user_profiles (
      user_id         TEXT        PRIMARY KEY,
      name            TEXT        NOT NULL DEFAULT 'Anonymous',
      email           TEXT        UNIQUE,
      score           SMALLINT    NOT NULL DEFAULT 50 CHECK (score BETWEEN 0 AND 100),
      metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_active_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS user_contribution_events (
      id              BIGSERIAL   PRIMARY KEY,
      user_id         TEXT        NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
      event_key       TEXT        NOT NULL,
      points          SMALLINT    NOT NULL DEFAULT 0,
      meta            JSONB       NOT NULL DEFAULT '{}'::jsonb,
      ts              TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_contrib_user_ts ON user_contribution_events(user_id, ts DESC);

  -- ── P4: Workspaces ────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS workspaces (
      workspace_id    TEXT        PRIMARY KEY,
      owner_id        TEXT        NOT NULL REFERENCES user_profiles(user_id),
      name            TEXT        NOT NULL,
      description     TEXT        NOT NULL DEFAULT '',
      visibility      TEXT        NOT NULL DEFAULT 'private'
                                  CHECK (visibility IN ('private','shared','public')),
      metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_workspace_owner      ON workspaces(owner_id);
  CREATE INDEX IF NOT EXISTS idx_workspace_visibility ON workspaces(visibility);

  CREATE TABLE IF NOT EXISTS workspace_collaborators (
      workspace_id    TEXT        NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      user_id         TEXT        NOT NULL REFERENCES user_profiles(user_id)  ON DELETE CASCADE,
      added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, user_id)
  );

  -- ── P4: Agent Templates ───────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS agent_templates (
      template_id     TEXT        PRIMARY KEY,
      workspace_id    TEXT        NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
      author_id       TEXT        NOT NULL REFERENCES user_profiles(user_id),
      name            TEXT        NOT NULL,
      description     TEXT        NOT NULL DEFAULT '',
      agent_type      TEXT        NOT NULL,
      config          JSONB       NOT NULL DEFAULT '{}'::jsonb,
      published_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_templates_workspace ON agent_templates(workspace_id);
  CREATE INDEX IF NOT EXISTS idx_templates_author    ON agent_templates(author_id);
  CREATE INDEX IF NOT EXISTS idx_templates_public    ON agent_templates(published_at DESC);

  -- ── SLA Tracking ──────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS sla_missions (
      mission_id      TEXT        PRIMARY KEY,
      price_usd       NUMERIC(12,4) NOT NULL DEFAULT 0,
      tier_label      TEXT        NOT NULL,
      ttl_ms          BIGINT      NOT NULL,
      deadline        TIMESTAMPTZ NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at     TIMESTAMPTZ,
      escalated       BOOLEAN     NOT NULL DEFAULT false
  );

  CREATE INDEX IF NOT EXISTS idx_sla_deadline     ON sla_missions(deadline) WHERE resolved_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_sla_escalated    ON sla_missions(escalated) WHERE escalated = false;

  COMMIT;
  