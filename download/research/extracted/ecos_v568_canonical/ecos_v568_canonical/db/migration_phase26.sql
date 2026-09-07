-- ═══════════════════════════════════════════════════════════════════════════
-- ECOS V143 — Phase 26 DB Migration
-- P33: Real Auth (email/password + refresh tokens) + Stripe Connect accounts
-- Safe to run multiple times (all idempotent).
-- Run AFTER migration_phase25.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── [V143-AUTH-01] ecos_users — email/password accounts ──────────────────────
-- Core user identity table (separate from validator accounts).
-- Passwords stored as bcrypt/argon2-style hash — never plaintext.
CREATE TABLE IF NOT EXISTS ecos_users (
  id              TEXT         PRIMARY KEY,          -- 'usr_' + nanoid(16)
  email           TEXT         NOT NULL UNIQUE,
  password_hash   TEXT         NOT NULL,             -- scrypt hash (Node built-in)
  display_name    TEXT,
  roles           TEXT[]       NOT NULL DEFAULT '{}',-- ['user','validator','admin']
  account_id      TEXT,                              -- fiatLedger account (optional link)
  email_verified  BOOLEAN      NOT NULL DEFAULT FALSE,
  locked          BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ecos_users_email_idx ON ecos_users (email);
CREATE INDEX IF NOT EXISTS ecos_users_account_id_idx ON ecos_users (account_id) WHERE account_id IS NOT NULL;

COMMENT ON TABLE ecos_users IS 'V143: email/password user accounts for real auth flow';

-- ── [V143-AUTH-01] auth_refresh_tokens — refresh token store ──────────────────
-- Short-lived access JWTs (15m) + long-lived refresh tokens (30d).
-- Rotation: each refresh invalidates the old token and issues a new one.
CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id              TEXT         PRIMARY KEY,          -- 'rt_' + crypto.randomBytes(32).hex
  user_id         TEXT         NOT NULL REFERENCES ecos_users(id) ON DELETE CASCADE,
  token_hash      TEXT         NOT NULL UNIQUE,      -- SHA-256 of the raw token
  family          TEXT         NOT NULL,             -- rotation family (detect reuse attack)
  expires_at      TIMESTAMPTZ  NOT NULL,
  revoked         BOOLEAN      NOT NULL DEFAULT FALSE,
  revoked_reason  TEXT,
  ip_address      TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auth_refresh_tokens_user_idx
  ON auth_refresh_tokens (user_id, revoked, expires_at DESC);

CREATE INDEX IF NOT EXISTS auth_refresh_tokens_family_idx
  ON auth_refresh_tokens (family);

COMMENT ON TABLE auth_refresh_tokens IS 'V143: refresh token store with rotation + reuse detection';

-- ── [V143-STR-01] stripe_validator_accounts — Stripe Connect account registry ─
-- Maps ECOS validator IDs to their Stripe Connect account IDs for payouts.
CREATE TABLE IF NOT EXISTS stripe_validator_accounts (
  validator_id       TEXT         PRIMARY KEY,       -- 'validator::...'
  stripe_account_id  TEXT         NOT NULL UNIQUE,   -- 'acct_...'
  onboarding_status  TEXT         NOT NULL DEFAULT 'pending', -- pending|onboarded|restricted
  payouts_enabled    BOOLEAN      NOT NULL DEFAULT FALSE,
  charges_enabled    BOOLEAN      NOT NULL DEFAULT FALSE,
  country            TEXT,
  currency           TEXT         DEFAULT 'usd',
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE stripe_validator_accounts IS 'V143: Stripe Connect account registry for validator payouts';

-- ── [V143-STR-01] stripe_payout_log — payout audit trail ─────────────────────
-- Records every payout attempt (real or mock) with outcome.
CREATE TABLE IF NOT EXISTS stripe_payout_log (
  id                 BIGSERIAL    PRIMARY KEY,
  validator_id       TEXT         NOT NULL,
  stripe_account_id  TEXT,
  transfer_id        TEXT,                           -- Stripe Transfer id (tr_...)
  amount_microcents  BIGINT       NOT NULL,
  amount_cents       INT          NOT NULL,
  currency           TEXT         NOT NULL DEFAULT 'usd',
  status             TEXT         NOT NULL,          -- success|failed|mock
  mock               BOOLEAN      NOT NULL DEFAULT FALSE,
  error_message      TEXT,
  stripe_error_code  TEXT,
  initiated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS stripe_payout_log_validator_idx
  ON stripe_payout_log (validator_id, initiated_at DESC);

CREATE INDEX IF NOT EXISTS stripe_payout_log_transfer_idx
  ON stripe_payout_log (transfer_id) WHERE transfer_id IS NOT NULL;

COMMENT ON TABLE stripe_payout_log IS 'V143: full audit log of validator Stripe payouts';
