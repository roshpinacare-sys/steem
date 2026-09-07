-- ═══════════════════════════════════════════════════════════════════════════
-- ECOS V144 — Phase 27 DB Migration
-- P34: Email Verification + Password Reset + Validator Auth Migration
-- Safe to run multiple times (all idempotent).
-- Run AFTER migration_phase26.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── [V144-EMAIL-01] email_verification_tokens ─────────────────────────────────
-- Stores SHA-256 hashes of email verification and password reset tokens.
-- Raw tokens are NEVER stored — only the hash.
-- One active token per (user_id, type): new token invalidates old via used_at.

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token_hash  TEXT         PRIMARY KEY,              -- SHA-256(rawToken)
  user_id     TEXT         NOT NULL,                 -- references ecos_users.id
  type        TEXT         NOT NULL                  -- 'verify_email' | 'reset_password'
                           CHECK (type IN ('verify_email', 'reset_password')),
  expires_at  TIMESTAMPTZ  NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  used_at     TIMESTAMPTZ  NULL                      -- NULL = unused; set on consume
);

-- Index: look up active tokens per user+type (for invalidation)
CREATE INDEX IF NOT EXISTS email_verification_tokens_user_type_idx
  ON email_verification_tokens (user_id, type)
  WHERE used_at IS NULL;

-- Index: auto-cleanup sweep (expired + used tokens)
CREATE INDEX IF NOT EXISTS email_verification_tokens_expires_idx
  ON email_verification_tokens (expires_at)
  WHERE used_at IS NOT NULL;

-- ── [V144-AUTH-02] ecos_users: add validator_id column ───────────────────────
-- Links an ecos_users account to a legacy validator:: account.
-- Used by the validator auth migration: email login → validator JWT bridge.

ALTER TABLE ecos_users
  ADD COLUMN IF NOT EXISTS validator_id TEXT NULL; -- e.g. 'validator::demo_001'

-- Index for validator_id lookup (used in auth migration endpoint)
CREATE INDEX IF NOT EXISTS ecos_users_validator_id_idx
  ON ecos_users (validator_id)
  WHERE validator_id IS NOT NULL;

-- ── [V144-AUTH-03] validator_auth_migration_log ───────────────────────────────
-- Audit trail of validators who have migrated to email auth.

CREATE TABLE IF NOT EXISTS validator_auth_migration_log (
  id            SERIAL       PRIMARY KEY,
  validator_id  TEXT         NOT NULL,
  user_id       TEXT         NOT NULL,              -- ecos_users.id
  migrated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ip_address    TEXT,
  user_agent    TEXT
);

COMMENT ON TABLE email_verification_tokens IS
  'V144: SHA-256 hashed email verification and password reset tokens. Raw tokens never stored.';

COMMENT ON TABLE validator_auth_migration_log IS
  'V144: Audit log of validator accounts migrated from shared-password to email auth.';
