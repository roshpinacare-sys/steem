-- =============================================================================
--  ECOS B2B Phase 2 — Database Migration
--  Apply AFTER schema.sql with: psql $DATABASE_URL -f db/migration_phase2.sql
--  Idempotent (all IF NOT EXISTS / ON CONFLICT DO NOTHING).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- knowledge_patches
--   Stores every manual correction a validator applies to an AI output.
--   When a future AI output hashes to the same ai_output_hash for the same
--   task_type, the patch is injected as context and the original validator
--   earns a micro-reward via ledger credit().
--
--   Immutability contract:
--     - id, approval_id, ai_output_hash, patch_hash, patch_body → never updated
--     - reuse_count, earned_micro → updated ONLY via atomic INCREMENT
--     - active → can be set to false to retire a bad patch
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_patches (
    id                  TEXT        PRIMARY KEY,
    approval_id         TEXT        NOT NULL REFERENCES approvals(id),
    validator_id        TEXT        NOT NULL REFERENCES accounts(id),
    task_type           TEXT        NOT NULL,
    ai_output_hash      CHAR(64)    NOT NULL,
    patch_hash          CHAR(64)    NOT NULL,
    patch_body          JSONB       NOT NULL,
    patch_diff          JSONB,
    similarity_keys     TEXT[]      NOT NULL DEFAULT '{}',
    reuse_count         INTEGER     NOT NULL DEFAULT 0 CHECK (reuse_count >= 0),
    earned_micro        BIGINT      NOT NULL DEFAULT 0 CHECK (earned_micro >= 0),
    reward_per_reuse    BIGINT      NOT NULL DEFAULT 500,   -- μ¢; 500 = $0.05
    active              BOOLEAN     NOT NULL DEFAULT true,
    metadata            JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookup: given a new AI output hash for a task type, find matching patches.
CREATE INDEX IF NOT EXISTS idx_kp_task_hash
    ON knowledge_patches(task_type, ai_output_hash)
    WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_kp_validator
    ON knowledge_patches(validator_id);

-- GIN index for similarity_keys array overlap queries (@> or &&).
CREATE INDEX IF NOT EXISTS idx_kp_similarity
    ON knowledge_patches USING GIN(similarity_keys);

-- Unique: one active patch per (task_type, ai_output_hash).
-- If validator corrects same AI output twice we update in place (upsert).
CREATE UNIQUE INDEX IF NOT EXISTS idx_kp_unique_active
    ON knowledge_patches(task_type, ai_output_hash)
    WHERE active = true;

-- -----------------------------------------------------------------------------
-- approval_claims
--   Soft advisory lock for the HITL claim flow.
--   A validator calls POST /approvals/:id/claim → row inserted here with a
--   30-minute expiry. Concurrent claimants are rejected until expires_at or
--   released_at is set. Expired rows are cleaned lazily.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approval_claims (
    approval_id         TEXT        PRIMARY KEY REFERENCES approvals(id),
    validator_id        TEXT        NOT NULL REFERENCES accounts(id),
    claimed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at          TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 minutes'),
    released_at         TIMESTAMPTZ,
    CONSTRAINT claim_window_positive CHECK (expires_at > claimed_at)
);

CREATE INDEX IF NOT EXISTS idx_claims_active
    ON approval_claims(expires_at)
    WHERE released_at IS NULL;

COMMIT;
