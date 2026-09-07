-- Migration Phase 46 — ECOS V271 canonical persistence foundation
-- Date: 2026-06-01
-- Purpose: PostgreSQL tables for V263-V269 modules previously in-memory only.
-- Rules: additive only; zero destructive statements; idempotent (safe to run repeatedly).

BEGIN;

CREATE TABLE IF NOT EXISTS credit_reserve (
  id BIGSERIAL PRIMARY KEY,
  reserve_balance BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credits_issued (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount_micro BIGINT NOT NULL,
  source TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS breakage_cohorts (
  cohort_date DATE PRIMARY KEY,
  issued_micro BIGINT NOT NULL DEFAULT 0,
  redeemed_micro BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reputation_events (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  dimension TEXT NOT NULL,
  delta NUMERIC NOT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sybil_evaluations (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  score NUMERIC NOT NULL,
  flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS x402_receipts (
  id BIGSERIAL PRIMARY KEY,
  nonce TEXT UNIQUE NOT NULL,
  amount_micro BIGINT NOT NULL,
  user_id TEXT,
  resource TEXT,
  receipt JSONB NOT NULL DEFAULT '{}'::jsonb,
  settled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_receipts (
  id BIGSERIAL PRIMARY KEY,
  chain_id TEXT NOT NULL,
  step JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_bloom_state (
  id INT PRIMARY KEY DEFAULT 1,
  filter_bits BYTEA,
  count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT audit_bloom_state_singleton CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS program_missions (
  id BIGSERIAL PRIMARY KEY,
  program_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  user_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS onboarding_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quadratic_rounds (
  id TEXT PRIMARY KEY,
  pool_micro BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS splits (
  id TEXT PRIMARY KEY,
  recipients JSONB NOT NULL,
  cliff_days INT NOT NULL DEFAULT 365,
  vested BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for frequent query patterns
CREATE INDEX IF NOT EXISTS idx_credits_issued_user_id ON credits_issued(user_id);
CREATE INDEX IF NOT EXISTS idx_reputation_events_user_dimension ON reputation_events(user_id, dimension);
CREATE INDEX IF NOT EXISTS idx_sybil_evaluations_user_created ON sybil_evaluations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_x402_receipts_user_resource ON x402_receipts(user_id, resource);
CREATE INDEX IF NOT EXISTS idx_agent_receipts_chain_created ON agent_receipts(chain_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_program_missions_program_status ON program_missions(program_id, status);
CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_user_stage ON onboarding_sessions(user_id, stage);
CREATE INDEX IF NOT EXISTS idx_quadratic_rounds_status ON quadratic_rounds(status);

COMMIT;
