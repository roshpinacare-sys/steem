-- ═══════════════════════════════════════════════════════════════════════════
-- ECOS V125 — Phase 16 DB Migration
-- Safe to run multiple times (all idempotent).
-- Run AFTER migration_phase15.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── mmr_compaction_log ──────────────────────────────────────────────────────
-- Records each compaction event: how many leaves were archived, what root was
-- captured, and when it happened. Keeps proof-of-existence after leaf pruning.
CREATE TABLE IF NOT EXISTS mmr_compaction_log (
  id              BIGSERIAL    PRIMARY KEY,
  leaves_archived INT          NOT NULL,        -- number of leaves compacted out
  leaves_remaining INT         NOT NULL,        -- leaves still live in MMR
  root_before     TEXT         NOT NULL,        -- MMR root BEFORE compaction
  root_after      TEXT         NOT NULL,        -- MMR root AFTER compaction
  ecos_version    TEXT         NOT NULL DEFAULT 'V125',
  compacted_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mmr_compaction_log_compacted_at_idx
  ON mmr_compaction_log (compacted_at DESC);

-- ── audit_backfill_log ──────────────────────────────────────────────────────
-- Tracks which audit_log entries have been backfilled into the MMR.
-- Prevents double-insertion on re-run.
CREATE TABLE IF NOT EXISTS audit_backfill_log (
  audit_entry_id  TEXT         PRIMARY KEY,     -- unique ID of the audit entry
  leaf_index      INT          NOT NULL,        -- MMR leaf position assigned
  entry_hash      TEXT         NOT NULL,        -- SHA-256 of the entry
  backfilled_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_backfill_log_backfilled_at_idx
  ON audit_backfill_log (backfilled_at DESC);

-- ── checkpoint_schedule_config ──────────────────────────────────────────────
-- Runtime-configurable checkpoint schedule.
-- Only one row exists (singleton). Default: every 50 new MMR leaves.
CREATE TABLE IF NOT EXISTS checkpoint_schedule_config (
  id                   INT          PRIMARY KEY DEFAULT 1,
  checkpoint_interval  INT          NOT NULL DEFAULT 50,  -- every N new leaves
  enabled              BOOLEAN      NOT NULL DEFAULT TRUE,
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT singleton CHECK (id = 1)
);

INSERT INTO checkpoint_schedule_config (id, checkpoint_interval, enabled)
VALUES (1, 50, TRUE)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE mmr_compaction_log       IS 'V125: audit trail of MMR compaction events';
COMMENT ON TABLE audit_backfill_log       IS 'V125: tracks which pre-V123 audit entries have been backfilled into MMR';
COMMENT ON TABLE checkpoint_schedule_config IS 'V125: runtime config for auto-checkpoint schedule';
