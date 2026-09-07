-- =============================================================================
-- ECOS DB Migration — Phase 8 (V110)
-- =============================================================================
-- Covers:
--   1. memory_entries.embedding — native pgvector column for <=> operator (P8-01)
--      Only added if the pgvector extension is installed.
--      Falls back gracefully when extension is absent (column stays absent,
--      MemorySubstrate._pgRetrieve() auto-detects and uses JS cosine fallback).
--   2. stripe_payment_intents   — idempotent log of create-intent calls (BUG-K-2)
--   3. replay_checkpoints.source_version default — bump to '110.0.0'
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. memory_entries.embedding — native pgvector column
--
-- Attempt to install pgvector extension and add the vector column.
-- Wrapped in a DO block so the migration succeeds even if pgvector is not
-- available (column is left absent; MemorySubstrate falls back to JS cosine).
--
-- When the column IS added, re-embed existing rows by running:
--   node scripts/reembed-patches.js   (V107 script, still valid for phase 8)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Ensure pgvector extension is available
  CREATE EXTENSION IF NOT EXISTS vector;

  -- Add embedding column if not already present (idempotent)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memory_entries' AND column_name = 'embedding'
  ) THEN
    ALTER TABLE memory_entries
      ADD COLUMN embedding vector(1536);
    RAISE NOTICE '[Phase8] memory_entries.embedding column added (pgvector native <=> path enabled)';
  ELSE
    RAISE NOTICE '[Phase8] memory_entries.embedding already exists — skipping ADD COLUMN';
  END IF;

  -- Create IVFFlat index for approximate nearest-neighbour search.
  -- lists = 100 is a conservative default for up to ~1M rows.
  -- Rebuild with higher lists count when row count exceeds 1M.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'memory_entries' AND indexname = 'idx_memory_embedding_ivfflat'
  ) THEN
    CREATE INDEX idx_memory_embedding_ivfflat
      ON memory_entries USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100);
    RAISE NOTICE '[Phase8] IVFFlat index on memory_entries.embedding created';
  END IF;

EXCEPTION WHEN others THEN
  -- pgvector extension not installed — migration continues without the column.
  -- MemorySubstrate will detect the absent column and use JS cosine fallback.
  RAISE WARNING '[Phase8] pgvector not available (%). Skipping embedding column. JS cosine fallback remains active.', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- 2. stripe_payment_intents
--    Idempotent log of every POST /api/v1/payments/stripe/create-intent call.
--    Allows auditing which intents were created, their status, and which
--    account they were created for — even before the webhook arrives.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stripe_payment_intents (
    payment_intent_id   TEXT        PRIMARY KEY,
    client_account_id   TEXT        NOT NULL,
    amount_cents        INTEGER     NOT NULL,
    currency            TEXT        NOT NULL DEFAULT 'usd',
    status              TEXT        NOT NULL DEFAULT 'created'
                                    CHECK (status IN ('created','succeeded','failed','cancelled')),
    mock                BOOLEAN     NOT NULL DEFAULT FALSE,
    client_secret_hash  CHAR(64),   -- SHA-256 of client_secret (never store raw secret)
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spi_client_account ON stripe_payment_intents(client_account_id);
CREATE INDEX IF NOT EXISTS idx_spi_status         ON stripe_payment_intents(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_spi_created_at     ON stripe_payment_intents(created_at DESC);

COMMENT ON TABLE stripe_payment_intents
    IS 'Audit log of Stripe PaymentIntent creation calls (V110 BUG-K-2 full fix).';

COMMENT ON COLUMN stripe_payment_intents.client_secret_hash
    IS 'SHA-256 of the Stripe client_secret — tamper-evident reference without storing the secret itself.';

-- ---------------------------------------------------------------------------
-- 3. replay_checkpoints.source_version — update default for V110 rows
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Only update the column default; existing rows keep their version stamp.
  ALTER TABLE replay_checkpoints
    ALTER COLUMN source_version SET DEFAULT '110.0.0';
  RAISE NOTICE '[Phase8] replay_checkpoints.source_version default updated to 110.0.0';
EXCEPTION WHEN others THEN
  RAISE WARNING '[Phase8] Could not update replay_checkpoints.source_version default: %', SQLERRM;
END $$;

COMMIT;
