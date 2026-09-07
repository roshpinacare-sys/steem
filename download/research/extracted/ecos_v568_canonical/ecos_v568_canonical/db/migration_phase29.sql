-- ECOS V154 Migration — Phase 29: Withdrawal History
-- Persistent withdrawal records (promotes sessionStorage → DB)

BEGIN;

CREATE TABLE IF NOT EXISTS withdrawal_history (
  id               SERIAL PRIMARY KEY,
  account_id       VARCHAR(255) NOT NULL,
  rail_id          VARCHAR(64)  NOT NULL,
  reference        VARCHAR(128) NOT NULL UNIQUE,
  amount_usd       NUMERIC(12,4) NOT NULL,
  status           VARCHAR(32)  NOT NULL DEFAULT 'pending',
  requested_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ,
  operator_note    TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS withdrawal_history_account_idx ON withdrawal_history(account_id);
CREATE INDEX IF NOT EXISTS withdrawal_history_status_idx  ON withdrawal_history(status);
CREATE INDEX IF NOT EXISTS withdrawal_history_rail_idx    ON withdrawal_history(rail_id);

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION withdrawal_history_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS withdrawal_history_updated_at_trigger ON withdrawal_history;
CREATE TRIGGER withdrawal_history_updated_at_trigger
  BEFORE UPDATE ON withdrawal_history
  FOR EACH ROW EXECUTE FUNCTION withdrawal_history_updated_at();

COMMIT;
