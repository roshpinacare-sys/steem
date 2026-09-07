-- =============================================================================
--  ECOS V108 — Phase 6 Migration
--  P6-PRODUCTION HARDENING: AgentBus Persistence, Snapshot DB, Health Wiring
-- =============================================================================
--
--  Apply AFTER schema.sql + migration_phase5.sql.
--  Idempotent: all statements use IF NOT EXISTS / ON CONFLICT DO NOTHING.
--
--  Changes:
--    1. agent_bus_messages — persistent AgentBus ring (P6-03)
--    2. agent_bus_subscribers — registered subscriber checkpoint (P6-03)
--    3. snapshots enhancements — source_version column (P5-04)
--    4. health_check_log — optional health check audit trail (P6-04)
--    5. Indexes for efficient replay and causality queries
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. agent_bus_messages — persistent ring for cross-restart AgentBus replay
--    P6-03: AgentBus DB persistence
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_bus_messages (
    id              BIGSERIAL   PRIMARY KEY,
    message_id      TEXT        NOT NULL UNIQUE,
    channel         TEXT        NOT NULL,
    sender_id       TEXT        NOT NULL,
    recipient_id    TEXT,                        -- NULL = broadcast
    parent_id       TEXT,                        -- causal parent messageId
    payload         JSONB       NOT NULL DEFAULT '{}',
    meta            JSONB       NOT NULL DEFAULT '{}',
    ts              TIMESTAMPTZ NOT NULL,
    persisted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bus_channel_ts
    ON agent_bus_messages(channel, ts DESC);

CREATE INDEX IF NOT EXISTS idx_bus_message_id
    ON agent_bus_messages(message_id);

CREATE INDEX IF NOT EXISTS idx_bus_parent_id
    ON agent_bus_messages(parent_id)
    WHERE parent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bus_sender
    ON agent_bus_messages(sender_id, ts DESC);

COMMENT ON TABLE agent_bus_messages
    IS 'Persistent ring for AgentBus messages (P6-03). Enables cross-restart causality replay.';

COMMENT ON COLUMN agent_bus_messages.parent_id
    IS 'messageId of the causing message — used for causal chain reconstruction.';

-- ---------------------------------------------------------------------------
-- 2. agent_bus_dead_letters — dead-letter entries for delivery failures
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_bus_dead_letters (
    id          BIGSERIAL   PRIMARY KEY,
    message_id  TEXT        NOT NULL,
    channel     TEXT        NOT NULL,
    sender_id   TEXT        NOT NULL,
    payload     JSONB       NOT NULL DEFAULT '{}',
    reason      TEXT        NOT NULL,
    ts          TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bus_dl_channel_ts
    ON agent_bus_dead_letters(channel, recorded_at DESC);

COMMENT ON TABLE agent_bus_dead_letters
    IS 'Dead-letter queue for undeliverable AgentBus messages. Cleared on retry.';

-- ---------------------------------------------------------------------------
-- 3. snapshots — add source_version column for V108 tagging
--    Table already created in migration_phase5.sql; this is additive only.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'snapshots' AND column_name = 'source_version'
  ) THEN
    ALTER TABLE snapshots
      ADD COLUMN source_version TEXT NOT NULL DEFAULT '108.0.0';
    RAISE NOTICE '[Phase6] snapshots.source_version column added';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'snapshots' AND column_name = 'saved_by'
  ) THEN
    ALTER TABLE snapshots
      ADD COLUMN saved_by TEXT NOT NULL DEFAULT 'api';
    RAISE NOTICE '[Phase6] snapshots.saved_by column added';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. health_check_log — audit trail for /api/v1/health/detailed calls
--    Enables health trend analysis and SLA tracking.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS health_check_log (
    id              BIGSERIAL   PRIMARY KEY,
    overall_status  TEXT        NOT NULL CHECK (overall_status IN ('healthy', 'degraded', 'unhealthy')),
    checks          JSONB       NOT NULL DEFAULT '{}',
    version         TEXT        NOT NULL DEFAULT '108.0.0',
    checked_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_health_log_checked_at
    ON health_check_log(checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_health_log_status
    ON health_check_log(overall_status, checked_at DESC);

COMMENT ON TABLE health_check_log
    IS 'Optional health check audit trail. Populated when HEALTH_LOG_DB=true (P6-04).';

-- ---------------------------------------------------------------------------
-- 5. audit_log — index for AgentBus audit channel events (P6-05)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_audit_bus_events
    ON audit_log (type, created_at DESC)
    WHERE type IN ('APPROVAL_RESOLVED_BUS', 'AGENT_BUS_PERSISTED', 'BUS_DEAD_LETTER');

COMMENT ON INDEX idx_audit_bus_events
    IS 'Partial index for AgentBus-originated audit entries (V108 P6-05).';

COMMIT;

-- =============================================================================
--  Retention policy helper (run manually or via cron)
--  Prunes agent_bus_messages older than N days.
--  Usage: SELECT ecos_prune_bus_messages(30);
-- =============================================================================

CREATE OR REPLACE FUNCTION ecos_prune_bus_messages(
  p_retain_days INTEGER DEFAULT 30
) RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM agent_bus_messages
  WHERE ts < NOW() - (p_retain_days || ' days')::INTERVAL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE '[Phase6] Pruned % agent_bus_messages older than % days', deleted_count, p_retain_days;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ecos_prune_bus_messages
    IS 'Retention cleanup for agent_bus_messages. Call periodically (e.g., daily cron).';

-- =============================================================================
--  Dead-letter drain helper
--  Usage: SELECT ecos_drain_bus_dead_letters(7);
-- =============================================================================

CREATE OR REPLACE FUNCTION ecos_drain_bus_dead_letters(
  p_retain_days INTEGER DEFAULT 7
) RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM agent_bus_dead_letters
  WHERE recorded_at < NOW() - (p_retain_days || ' days')::INTERVAL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ecos_drain_bus_dead_letters
    IS 'Retention cleanup for agent_bus_dead_letters. Safe to run daily.';
