-- =============================================================================
-- ECOS DB Migration — Phase 7 (V109)
-- =============================================================================
-- Covers:
--   1. memory_audit_trail — records every MEMORY_INGEST event for causal tracing
--   2. replay_checkpoints improvements — ensure table exists + add label index
--   3. stripe_deposit_events — idempotent log of inbound Stripe webhook deposits
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. memory_audit_trail
--    Records every MemorySubstrate.ingest() call for causal tracing.
--    Allows answering: "which agent wrote this memory, when, and from what input?"
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_audit_trail (
    id              TEXT        PRIMARY KEY,
    memory_id       TEXT        NOT NULL,
    scope           TEXT        NOT NULL,
    owner_id        TEXT        NOT NULL,
    content_hash    CHAR(64)    NOT NULL,
    importance      NUMERIC(4,3) NOT NULL DEFAULT 0.5,
    backend         TEXT        NOT NULL DEFAULT 'in-memory',
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mat_memory_id   ON memory_audit_trail(memory_id);
CREATE INDEX IF NOT EXISTS idx_mat_owner       ON memory_audit_trail(owner_id, scope);
CREATE INDEX IF NOT EXISTS idx_mat_recorded_at ON memory_audit_trail(recorded_at DESC);

COMMENT ON TABLE memory_audit_trail
    IS 'Causal audit trail for every MemorySubstrate.ingest() call (V109).';

COMMENT ON COLUMN memory_audit_trail.content_hash
    IS 'SHA-256 over the raw content string — tamper-evident, no PII stored.';

-- ---------------------------------------------------------------------------
-- 2. replay_checkpoints — ensure table exists with all required columns
--    (originally created in migration_phase5.sql; this migration adds
--     indexes and the optional source_version column for cross-version tracing)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS replay_checkpoints (
    id               TEXT        PRIMARY KEY,
    label            TEXT        NOT NULL,
    from_index       INTEGER     NOT NULL,
    to_index         INTEGER     NOT NULL,
    events_applied   INTEGER     NOT NULL DEFAULT 0,
    final_state_hash CHAR(64)    NOT NULL,
    replay_proof     CHAR(64)    NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'replay_checkpoints' AND column_name = 'source_version'
  ) THEN
    ALTER TABLE replay_checkpoints
      ADD COLUMN source_version TEXT NOT NULL DEFAULT '109.0.0';
    RAISE NOTICE '[Phase7] replay_checkpoints.source_version column added';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_replay_ckpt_label   ON replay_checkpoints(label);
CREATE INDEX IF NOT EXISTS idx_replay_ckpt_created ON replay_checkpoints(created_at DESC);

COMMENT ON TABLE replay_checkpoints
    IS 'Records of completed replay verifications — audit trail and resumable replay (V106+).';

COMMENT ON COLUMN replay_checkpoints.source_version
    IS 'ECOS version that produced this checkpoint (added V109).';

-- ---------------------------------------------------------------------------
-- 3. stripe_deposit_events
--    Idempotent log of inbound Stripe webhook deposit events.
--    Prevents double-crediting if Stripe delivers a webhook more than once.
--    Stripe guarantees "at least once" delivery, so dedup is required.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stripe_deposit_events (
    stripe_event_id     TEXT        PRIMARY KEY,
    payment_intent_id   TEXT,
    client_account_id   TEXT,
    amount_microcents   BIGINT      NOT NULL DEFAULT 0,
    currency            TEXT        NOT NULL DEFAULT 'usd',
    status              TEXT        NOT NULL DEFAULT 'received'
                                    CHECK (status IN ('received','credited','failed','refunded')),
    error_msg           TEXT,
    received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sde_client_account ON stripe_deposit_events(client_account_id);
CREATE INDEX IF NOT EXISTS idx_sde_received_at    ON stripe_deposit_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_sde_status         ON stripe_deposit_events(status, received_at DESC);

COMMENT ON TABLE stripe_deposit_events
    IS 'Idempotent log of Stripe payment_intent.succeeded events (V109 BUG-K partial fix).';

COMMENT ON COLUMN stripe_deposit_events.stripe_event_id
    IS 'Stripe event ID — PRIMARY KEY ensures webhook idempotency.';

COMMENT ON COLUMN stripe_deposit_events.amount_microcents
    IS 'Amount in microcents (Stripe cents × 10000) — BigInt-safe for ledger.';

COMMIT;
