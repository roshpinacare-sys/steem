-- ═══════════════════════════════════════════════════════════════════════════
-- ECOS V123 — Phase 14 DB Migration
-- Safe to run multiple times (all idempotent).
-- Run AFTER migration_phase13.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── mmr_state ────────────────────────────────────────────────────────────────
-- Persists the Merkle Mountain Range singleton state so the MMR survives
-- server restarts. One row per named MMR (default: 'default').
-- Updated on every _snapshotLedger() call.
CREATE TABLE IF NOT EXISTS mmr_state (
  mmr_id       TEXT         PRIMARY KEY DEFAULT 'default',
  leaf_count   INT          NOT NULL DEFAULT 0,
  root_hash    TEXT,                          -- current bagged root (hex64)
  mmr_json     JSONB        NOT NULL,          -- full serialised MerkleMountainRange
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mmr_state_updated_at_idx
  ON mmr_state (updated_at DESC);

-- ── validator_attestations ────────────────────────────────────────────────────
-- Stores the ValidatorIdentity attestation produced at resolution time.
-- Linked to the approval record by approval_id.
CREATE TABLE IF NOT EXISTS validator_attestations (
  id           BIGSERIAL    PRIMARY KEY,
  approval_id  TEXT         NOT NULL,
  validator_id TEXT         NOT NULL,          -- raw validatorAccountId
  vid          TEXT         NOT NULL,          -- derived short identity (16 hex)
  task_hash    TEXT         NOT NULL,          -- hash attested (approval.id sha256)
  signature    TEXT         NOT NULL,          -- HMAC-SHA256 signature (hex)
  attested_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS validator_attestations_approval_idx
  ON validator_attestations (approval_id);
CREATE INDEX IF NOT EXISTS validator_attestations_validator_idx
  ON validator_attestations (validator_id);

COMMENT ON TABLE mmr_state             IS 'V123: persisted Merkle Mountain Range state';
COMMENT ON TABLE validator_attestations IS 'V123: validator identity attestations at resolution';
