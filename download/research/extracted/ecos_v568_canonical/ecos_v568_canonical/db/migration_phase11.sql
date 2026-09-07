-- ECOS V115 — Phase 11 DB Migration
-- No structural changes to fiatLedger or auditLog (sacred files).
-- Adds tables for: validator onboarding sybil checks, golden task scores,
-- orientation task progress, stablecoin rail transactions.
--
-- Run: psql $DATABASE_URL < db/migration_phase11.sql
-- Safe to run multiple times (idempotent).

-- ── Sybil resistance decisions ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sybil_decisions (
  id            BIGSERIAL PRIMARY KEY,
  user_id       TEXT NOT NULL,
  verdict       TEXT NOT NULL CHECK (verdict IN ('ALLOW','REVIEW','BLOCK')),
  score         INT NOT NULL,
  signals       JSONB NOT NULL DEFAULT '[]',
  evaluated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sybil_decisions_user_id  ON sybil_decisions(user_id);
CREATE INDEX IF NOT EXISTS idx_sybil_decisions_verdict  ON sybil_decisions(verdict);
CREATE INDEX IF NOT EXISTS idx_sybil_decisions_score    ON sybil_decisions(score DESC);

-- ── Golden task scores ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS golden_task_submissions (
  id            BIGSERIAL PRIMARY KEY,
  validator_id  TEXT NOT NULL,
  task_id       TEXT NOT NULL,
  is_correct    BOOLEAN NOT NULL,
  answer        TEXT,
  expected      TEXT,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_golden_sub_validator_task ON golden_task_submissions(validator_id, task_id);
CREATE INDEX IF NOT EXISTS idx_golden_sub_validator  ON golden_task_submissions(validator_id);

CREATE TABLE IF NOT EXISTS golden_task_scores (
  validator_id  TEXT PRIMARY KEY,
  total         INT NOT NULL DEFAULT 0,
  correct       INT NOT NULL DEFAULT 0,
  accuracy      DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  flagged       BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Orientation task progress ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orientation_progress (
  user_id       TEXT NOT NULL,
  task_id       TEXT NOT NULL,
  completed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pay_micro     BIGINT NOT NULL DEFAULT 2500,
  time_taken_s  INT,
  PRIMARY KEY (user_id, task_id)
);
CREATE INDEX IF NOT EXISTS idx_orientation_user ON orientation_progress(user_id);

-- ── Stablecoin rail transactions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stablecoin_transactions (
  ref           TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL,
  amount_micro  BIGINT NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'USDC',
  direction     TEXT NOT NULL CHECK (direction IN ('deposit','withdrawal')),
  status        TEXT NOT NULL DEFAULT 'pending',
  provider      TEXT NOT NULL,
  iso_meta      JSONB,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stablecoin_account  ON stablecoin_transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_stablecoin_status   ON stablecoin_transactions(status);
CREATE INDEX IF NOT EXISTS idx_stablecoin_provider ON stablecoin_transactions(provider);

COMMENT ON TABLE sybil_decisions         IS 'V115 P11-09: Sybil resistance evaluations for validator onboarding';
COMMENT ON TABLE golden_task_submissions IS 'V115 P11-08: Golden task (known-answer QC) submission log';
COMMENT ON TABLE golden_task_scores      IS 'V115 P11-08: Aggregate golden task accuracy per validator';
COMMENT ON TABLE orientation_progress    IS 'V115 P11-06: Displaced worker orientation task completion';
COMMENT ON TABLE stablecoin_transactions IS 'V115 P11-07: Stablecoin rail (BVNK/Bridge/Circle) transaction log';
