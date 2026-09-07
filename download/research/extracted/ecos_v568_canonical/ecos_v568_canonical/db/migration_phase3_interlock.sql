-- =============================================================================
--  Migration: Phase 3 — Persistent System Interlock (v3.3)
-- =============================================================================
--  Replaces process-local IS_FROZEN boolean with a Postgres-backed key-value
--  table. Workers bootstrap freeze state from here and subscribe to
--  pg_notify('system_interlock', ...) for real-time propagation.
--
--  Apply after schema.sql:
--    psql $DATABASE_URL -f db/migration_phase3_interlock.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS system_state (
    key         TEXT        PRIMARY KEY,
    value       TEXT        NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE system_state IS
  'Persistent key-value store for critical system flags. '
  'interlock_frozen=true means all workers must reject API traffic.';

-- Seed with default (unfrozen) state so bootstrapInterlock() always finds a row
INSERT INTO system_state (key, value, updated_at)
  VALUES ('interlock_frozen', 'false', now())
ON CONFLICT (key) DO NOTHING;

COMMIT;
