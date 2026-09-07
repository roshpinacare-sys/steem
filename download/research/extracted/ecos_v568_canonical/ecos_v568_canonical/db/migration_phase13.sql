-- ═══════════════════════════════════════════════════════════════════════════
-- ECOS V117 — Phase 13 DB Migration
-- Safe to run multiple times (all idempotent).
-- Run AFTER migration_phase12.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── validator_dashboard_cache ────────────────────────────────────────────────
-- Materialised cache for the /api/v1/validator/dashboard/:id endpoint.
-- Refreshed on each dashboard fetch; avoids N+1 queries across 5 subsystems.
CREATE TABLE IF NOT EXISTS validator_dashboard_cache (
  validator_id      TEXT PRIMARY KEY,
  golden_task_score NUMERIC(5,4) DEFAULT 0,
  sybil_verdict     TEXT         DEFAULT 'ALLOW',
  graduation_stage  TEXT         DEFAULT 'USE',
  task_earnings_micro BIGINT     DEFAULT 0,
  royalty_micro     BIGINT       DEFAULT 0,
  updated_at        TIMESTAMPTZ  DEFAULT NOW()
);

-- ── iso20022_wiring_log ──────────────────────────────────────────────────────
-- Tracks every ISO 20022 wrapper invocation for audit/compliance reporting.
CREATE TABLE IF NOT EXISTS iso20022_wiring_log (
  id            BIGSERIAL    PRIMARY KEY,
  event_type    TEXT         NOT NULL,   -- HITL_PAYOUT | ROYALTY_PAYOUT | TASK_CHARGE
  originator_id TEXT,
  beneficiary_id TEXT,
  amount_micro  BIGINT,
  currency      TEXT         DEFAULT 'USD',
  reference_id  TEXT,
  iso20022_json JSONB,
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS iso20022_wiring_log_event_type_idx
  ON iso20022_wiring_log (event_type);
CREATE INDEX IF NOT EXISTS iso20022_wiring_log_beneficiary_idx
  ON iso20022_wiring_log (beneficiary_id);
CREATE INDEX IF NOT EXISTS iso20022_wiring_log_created_at_idx
  ON iso20022_wiring_log (created_at DESC);

-- ── demo_sessions ────────────────────────────────────────────────────────────
-- Tracks live demo sessions created by the seed-demo.js script.
CREATE TABLE IF NOT EXISTS demo_sessions (
  id            TEXT         PRIMARY KEY,
  created_by    TEXT,
  seeded_at     TIMESTAMPTZ  DEFAULT NOW(),
  scenario      TEXT         DEFAULT 'insurance_claims',
  task_count    INT          DEFAULT 0,
  validator_count INT        DEFAULT 0,
  notes         TEXT
);

COMMENT ON TABLE validator_dashboard_cache IS 'V117: materialised validator dashboard data';
COMMENT ON TABLE iso20022_wiring_log       IS 'V117: ISO 20022 wrapper invocation audit trail';
COMMENT ON TABLE demo_sessions             IS 'V117: demo seeder session tracker';
