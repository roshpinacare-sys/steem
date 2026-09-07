-- ECOS V116 — Phase 12 DB Migration
  -- Adds user_id PRIMARY KEY constraint to graduation_stages (missing in phase11),
  -- adds orientation_progress unique constraint, adds stablecoin_transactions table.
  -- Safe to run multiple times (idempotent).

  -- ── graduation_stages — ensure proper schema ─────────────────────────────────
  CREATE TABLE IF NOT EXISTS graduation_stages (
    user_id     TEXT PRIMARY KEY,
    stage_id    INT NOT NULL DEFAULT 1 CHECK (stage_id BETWEEN 1 AND 5),
    unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_graduation_stages_stage_id ON graduation_stages(stage_id);

  -- ── Ensure orientation_progress has unique constraint ────────────────────────
  DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_name='orientation_progress' AND constraint_type='UNIQUE'
    ) THEN
      CREATE UNIQUE INDEX IF NOT EXISTS idx_orientation_progress_user_task
        ON orientation_progress(user_id, task_id);
    END IF;
  END $$;

  -- ── stablecoin_transactions ───────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS stablecoin_transactions (
    ref          TEXT PRIMARY KEY,
    type         TEXT NOT NULL CHECK (type IN ('deposit','withdrawal')),
    provider     TEXT NOT NULL,
    currency     TEXT NOT NULL DEFAULT 'USDC',
    amount_micro BIGINT NOT NULL,
    status       TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    iso20022     JSONB NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_stablecoin_tx_user_id   ON stablecoin_transactions(user_id);
  CREATE INDEX IF NOT EXISTS idx_stablecoin_tx_status    ON stablecoin_transactions(status);
  CREATE INDEX IF NOT EXISTS idx_stablecoin_tx_created   ON stablecoin_transactions(created_at DESC);

  -- ── iso20022_audit_events — V116 P12-07 ──────────────────────────────────────
  CREATE TABLE IF NOT EXISTS iso20022_audit_events (
    id           BIGSERIAL PRIMARY KEY,
    event_type   TEXT NOT NULL,
    originator   TEXT NOT NULL,
    beneficiary  TEXT NOT NULL,
    amount_micro BIGINT NOT NULL,
    currency     TEXT NOT NULL DEFAULT 'USD',
    purpose_code TEXT,
    reference_id TEXT,
    iso20022     JSONB NOT NULL DEFAULT '{}',
    emitted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_iso20022_events_originator  ON iso20022_audit_events(originator);
  CREATE INDEX IF NOT EXISTS idx_iso20022_events_beneficiary ON iso20022_audit_events(beneficiary);
  CREATE INDEX IF NOT EXISTS idx_iso20022_events_emitted     ON iso20022_audit_events(emitted_at DESC);
  