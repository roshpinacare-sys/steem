-- ═══════════════════════════════════════════════════════════════════════════
-- ECOS V124 — Phase 15 DB Migration
-- Safe to run multiple times (all idempotent).
-- Run AFTER migration_phase14.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── nonce_counters ─────────────────────────────────────────────────────────────
-- Monotonic nonce counter per (scope, account_id) for replay-attack protection.
-- Persisted by NonceTracker on every consume() call.
CREATE TABLE IF NOT EXISTS nonce_counters (
  scope       TEXT         NOT NULL,
  account_id  TEXT         NOT NULL,
  nonce       BIGINT       NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope, account_id)
);

CREATE INDEX IF NOT EXISTS nonce_counters_updated_at_idx
  ON nonce_counters (updated_at DESC);

-- ── mmr_checkpoints ────────────────────────────────────────────────────────────
-- Immutable archive of signed MMR checkpoints (one per checkpoint request).
-- The canonical column allows offline re-verification without a live server.
CREATE TABLE IF NOT EXISTS mmr_checkpoints (
  id           BIGSERIAL    PRIMARY KEY,
  root         TEXT         NOT NULL,        -- MMR bagged root (hex64)
  leaf_count   INT          NOT NULL,
  server_id    TEXT,                          -- agentId at time of checkpoint
  ecos_version TEXT         NOT NULL DEFAULT 'V124',
  signature    TEXT         NOT NULL,        -- HMAC-SHA256 over canonical JSON
  canonical    TEXT         NOT NULL,        -- the exact string that was signed
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mmr_checkpoints_created_at_idx
  ON mmr_checkpoints (created_at DESC);

-- validator_identity_public — public key export table
-- Allows external verifiers to resolve vid → publicKeyHint without master seed.
CREATE TABLE IF NOT EXISTS validator_identity_public (
  vid          TEXT         PRIMARY KEY,     -- 16-hex derived identity
  display      TEXT         NOT NULL,        -- "V-" + vid[0:8]
  validator_id TEXT         NOT NULL,        -- raw UUID
  public_key   TEXT         NOT NULL,        -- vid (safe to publish)
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS validator_identity_public_validator_idx
  ON validator_identity_public (validator_id);

COMMENT ON TABLE nonce_counters            IS 'V124: monotonic nonce counters for replay protection';
COMMENT ON TABLE mmr_checkpoints           IS 'V124: signed MMR checkpoint archive for external audit';
COMMENT ON TABLE validator_identity_public IS 'V124: public validator identity export for attestation verification';
