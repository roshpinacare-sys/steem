-- ECOS V113 — Stripe PaymentIntent Status Sync Migration (Phase 10)
-- Run once per environment: psql $DATABASE_URL -f db/migration_phase10.sql
--
-- Adds updated_at column to stripe_payment_intents if it doesn't exist.
-- Required for P9-04: status sync on payment_intent.succeeded webhook.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stripe_payment_intents' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE stripe_payment_intents ADD COLUMN updated_at TIMESTAMPTZ;
    COMMENT ON COLUMN stripe_payment_intents.updated_at IS 'Last status update timestamp (set by V113 P9-04 webhook sync)';
    RAISE NOTICE 'Added updated_at column to stripe_payment_intents';
  ELSE
    RAISE NOTICE 'updated_at column already exists in stripe_payment_intents — skipping';
  END IF;
END $$;

-- Ensure stripe_payment_intents table exists with all columns (idempotent)
CREATE TABLE IF NOT EXISTS stripe_payment_intents (
  payment_intent_id   TEXT PRIMARY KEY,
  client_account_id   TEXT NOT NULL,
  amount_cents        INTEGER NOT NULL,
  currency            TEXT DEFAULT 'usd',
  status              TEXT DEFAULT 'created',
  mock                BOOLEAN DEFAULT FALSE,
  client_secret_hash  TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ
);
