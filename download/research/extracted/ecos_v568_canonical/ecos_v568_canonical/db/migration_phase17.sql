-- ═══════════════════════════════════════════════════════════════════════════
-- ECOS V134 — Phase 17 DB Migration: Rank Persistence
-- Safe to run multiple times (all idempotent).
-- Run AFTER migration_phase16.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── rank_scores ──────────────────────────────────────────────────────────────
-- Persistent rank scores per user.
-- UserRankSystem loads from here on startup; saves on every recordEvent().
CREATE TABLE IF NOT EXISTS rank_scores (
  user_id       TEXT         PRIMARY KEY,
  score         INT          NOT NULL DEFAULT 0 CHECK (score >= 0),
  flags         INT          NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rank_scores_score_idx
  ON rank_scores (score DESC);

-- ── rank_events ──────────────────────────────────────────────────────────────
-- Immutable audit log of every rank event recorded.
-- Never deleted — provides full replay capability.
CREATE TABLE IF NOT EXISTS rank_events (
  id            BIGSERIAL    PRIMARY KEY,
  user_id       TEXT         NOT NULL,
  event_type    TEXT         NOT NULL,
  delta         INT          NOT NULL,           -- positive or negative
  score_after   INT          NOT NULL,
  tier_before   TEXT,
  tier_after    TEXT,
  source        TEXT,                            -- e.g. 'task_approved', 'api'
  ref_id        TEXT,                            -- task/approval/patch ID, optional
  recorded_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rank_events_user_id_idx
  ON rank_events (user_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS rank_events_event_type_idx
  ON rank_events (event_type, recorded_at DESC);

-- ── rank_tier_changes ────────────────────────────────────────────────────────
-- Log of tier-promotion and tier-demotion events only.
-- Subset of rank_events, optimized for leaderboard / notification queries.
CREATE TABLE IF NOT EXISTS rank_tier_changes (
  id            BIGSERIAL    PRIMARY KEY,
  user_id       TEXT         NOT NULL,
  tier_before   TEXT         NOT NULL,
  tier_after    TEXT         NOT NULL,
  score_at      INT          NOT NULL,
  changed_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rank_tier_changes_user_idx
  ON rank_tier_changes (user_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS rank_tier_changes_changed_at_idx
  ON rank_tier_changes (changed_at DESC);

COMMENT ON TABLE rank_scores       IS 'V134: persistent rank scores — source of truth for UserRankSystem';
COMMENT ON TABLE rank_events       IS 'V134: immutable audit log of every rank score event';
COMMENT ON TABLE rank_tier_changes IS 'V134: log of tier promotions/demotions for notifications';
