-- ────────────────────────────────────────────────────────────────────────────
-- ECOS DB Migration — Phase 28 (V146)
-- P36: Stripe Connect Express Onboarding
-- ────────────────────────────────────────────────────────────────────────────

-- stripe_validator_accounts already exists from migration_phase26.sql (V143).
-- This phase adds the onboarding session log table.

-- ── [V146-STRIPE-01] stripe_connect_onboarding_log ─────────────────────────
-- Tracks each Stripe-hosted onboarding link generation (expires quickly).
-- Useful for debugging failed onboarding flows and support cases.
CREATE TABLE IF NOT EXISTS stripe_connect_onboarding_log (
  id                 BIGSERIAL    PRIMARY KEY,
  validator_id       TEXT         NOT NULL,
  stripe_account_id  TEXT         NOT NULL,
  onboarding_url     TEXT,                          -- Stripe Account Link URL
  return_url         TEXT,
  refresh_url        TEXT,
  expires_at         BIGINT,                        -- UNIX timestamp from Stripe
  mock               BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS stripe_connect_log_validator_idx
  ON stripe_connect_onboarding_log (validator_id, created_at DESC);

CREATE INDEX IF NOT EXISTS stripe_connect_log_account_idx
  ON stripe_connect_onboarding_log (stripe_account_id);

COMMENT ON TABLE stripe_connect_onboarding_log IS
  'V146: Audit log of every Stripe Connect onboarding URL generation per validator';

-- ── [V146-STRIPE-01] Add onboarding_started_at column to stripe_validator_accounts ─
-- Tracks when the validator first initiated onboarding.
ALTER TABLE stripe_validator_accounts
  ADD COLUMN IF NOT EXISTS onboarding_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN stripe_validator_accounts.onboarding_started_at IS
  'V146: When the validator first clicked the Stripe onboarding link';
COMMENT ON COLUMN stripe_validator_accounts.onboarding_completed_at IS
  'V146: When Stripe confirmed payouts_enabled=true (account.updated webhook)';

-- ── [V146-AUTH-01] Validator email auth migration — ensure ecos_users has validator_id ─
-- Column already added in migration_phase27.sql (V144). This is a no-op guard.
ALTER TABLE ecos_users
  ADD COLUMN IF NOT EXISTS validator_id TEXT;

CREATE INDEX IF NOT EXISTS ecos_users_validator_id_idx
  ON ecos_users (validator_id) WHERE validator_id IS NOT NULL;

COMMENT ON COLUMN ecos_users.validator_id IS
  'V144+V146: Linked ECOS validator ID — populated via /api/v1/auth/validator/migrate';
