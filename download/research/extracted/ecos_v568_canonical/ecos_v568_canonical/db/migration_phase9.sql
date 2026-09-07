-- ECOS V112 — Economy Persistence Migration (Phase 9)
-- Run once per environment: psql $DATABASE_URL -f db/migration_phase9.sql

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE,
  display_name  TEXT,
  referral_code TEXT UNIQUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_accounts (
  account_id            TEXT PRIMARY KEY,
  balance_micro         BIGINT NOT NULL DEFAULT 0 CHECK (balance_micro >= 0),
  free_tier_granted_at  TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS engagement_streaks (
  account_id   TEXT PRIMARY KEY,
  streak_days  INTEGER DEFAULT 0,
  last_action  TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS validator_tombstones (
  identity_id  TEXT PRIMARY KEY,
  revoked_at   TIMESTAMPTZ DEFAULT NOW(),
  reason       TEXT,
  strike_count INTEGER DEFAULT 0
);
