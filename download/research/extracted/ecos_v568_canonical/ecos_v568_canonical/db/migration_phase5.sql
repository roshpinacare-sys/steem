-- =============================================================================
--  ECOS V106 — Phase 5 Migration
--  P5-DETERMINISM: Replay, Snapshot, Real Embeddings, Provenance Hardening
-- =============================================================================
--
--  Apply AFTER schema.sql + all prior migrations.
--  Idempotent: all statements use IF NOT EXISTS / ON CONFLICT DO NOTHING.
--
--  Changes:
--    1. pgvector extension + vector columns for real embeddings
--    2. snapshots table for persistent snapshot storage
--    3. replay_checkpoints table for labeled replay points
--    4. inference_provenance index on audit_log
--    5. embedding_migration_log for re-embedding tracking
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. pgvector extension (real semantic embeddings)
--    Requires: CREATE EXTENSION vector; — install pgvector on Postgres first.
--    https://github.com/pgvector/pgvector
--    If pgvector is not available, this block is skipped gracefully.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'vector'
  ) THEN
    BEGIN
      CREATE EXTENSION vector;
      RAISE NOTICE '[Phase5] pgvector extension created';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '[Phase5] pgvector not available — skip vector columns (heuristic fallback active)';
    END;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. knowledge_patches — add vector column for real embeddings
--    Migration tag: embeddingType distinguishes heuristic vs real embeddings.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Add embedding_type column (heuristic | ollama | openai | openai-compat)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'knowledge_patches' AND column_name = 'embedding_type'
  ) THEN
    ALTER TABLE knowledge_patches
      ADD COLUMN embedding_type TEXT NOT NULL DEFAULT 'heuristic'
        CHECK (embedding_type IN ('heuristic', 'ollama', 'openai', 'openai-compat', 'custom'));
    RAISE NOTICE '[Phase5] knowledge_patches.embedding_type column added';
  END IF;

  -- Add embedding_dims column to track vector dimensionality
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'knowledge_patches' AND column_name = 'embedding_dims'
  ) THEN
    ALTER TABLE knowledge_patches
      ADD COLUMN embedding_dims INTEGER;
    RAISE NOTICE '[Phase5] knowledge_patches.embedding_dims column added';
  END IF;
END $$;

-- pgvector column — only add if extension is available
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'knowledge_patches' AND column_name = 'embedding_v2'
    ) THEN
      -- embedding_v2: real semantic embedding (1536 for OpenAI, 768 for Ollama)
      -- Named _v2 to avoid collision with legacy 'embedding' column (heuristic, if present)
      EXECUTE 'ALTER TABLE knowledge_patches ADD COLUMN embedding_v2 vector(1536)';
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_patches_embedding_v2 ON knowledge_patches USING ivfflat (embedding_v2 vector_cosine_ops) WITH (lists = 100)';
      RAISE NOTICE '[Phase5] knowledge_patches.embedding_v2 (pgvector) column + index added';
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. snapshots — persistent snapshot storage
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS snapshots (
    id              TEXT        PRIMARY KEY,
    label           TEXT        NOT NULL,
    exported_at     TIMESTAMPTZ NOT NULL,
    integrity_hash  CHAR(64)    NOT NULL,
    version         INTEGER     NOT NULL DEFAULT 1,
    account_count   INTEGER     NOT NULL DEFAULT 0,
    audit_entries   INTEGER     NOT NULL DEFAULT 0,
    approval_count  INTEGER     NOT NULL DEFAULT 0,
    body            JSONB       NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_exported ON snapshots(exported_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_hash ON snapshots(integrity_hash);

COMMENT ON TABLE snapshots
    IS 'Persistent runtime snapshots for disaster recovery and cold-start bootstrap.';

COMMENT ON COLUMN snapshots.integrity_hash
    IS 'SHA-256 over canonicalized snapshot body — tamper-evident.';

-- ---------------------------------------------------------------------------
-- 4. replay_checkpoints — labeled replay points in the audit chain
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS replay_checkpoints (
    id              TEXT        PRIMARY KEY,
    label           TEXT        NOT NULL,
    from_index      INTEGER     NOT NULL,
    to_index        INTEGER     NOT NULL,
    events_applied  INTEGER     NOT NULL DEFAULT 0,
    final_state_hash CHAR(64)   NOT NULL,
    replay_proof    CHAR(64)    NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_replay_checkpoints_created ON replay_checkpoints(created_at DESC);

COMMENT ON TABLE replay_checkpoints
    IS 'Records of completed replay verifications for audit trail and resumable replay.';

-- ---------------------------------------------------------------------------
-- 5. audit_log — inference_provenance index
--    Allows fast lookup of audit entries that carry inference provenance.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_audit_inference_provenance
    ON audit_log ((payload->>'inferenceProvenance'))
    WHERE payload ? 'inferenceProvenance';

COMMENT ON INDEX idx_audit_inference_provenance
    IS 'Partial index: fast lookup of audit entries with inference provenance attached (V106).';

-- ---------------------------------------------------------------------------
-- 6. embedding_migration_log — tracks re-embedding progress
--    When switching from heuristic → real embeddings, records which patches
--    have been re-embedded and which are still pending.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS embedding_migration_log (
    id              BIGSERIAL   PRIMARY KEY,
    patch_id        TEXT        NOT NULL,
    old_type        TEXT        NOT NULL DEFAULT 'heuristic',
    new_type        TEXT        NOT NULL,
    new_dims        INTEGER     NOT NULL,
    migrated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    status          TEXT        NOT NULL DEFAULT 'ok'
                                CHECK (status IN ('ok', 'failed', 'skipped'))
);

CREATE INDEX IF NOT EXISTS idx_embed_migration_patch ON embedding_migration_log(patch_id);
CREATE INDEX IF NOT EXISTS idx_embed_migration_status ON embedding_migration_log(status, migrated_at DESC);

COMMENT ON TABLE embedding_migration_log
    IS 'Tracks re-embedding migration from heuristic to real embeddings (V106 P5-01).';

COMMIT;

-- =============================================================================
--  Re-embedding migration procedure (run manually after extension is ready)
--  Usage: SELECT ecos_reembed_patches('openai', 1536);
-- =============================================================================

CREATE OR REPLACE FUNCTION ecos_reembed_patches(
  p_new_type TEXT,
  p_new_dims INTEGER
) RETURNS TABLE(patch_id TEXT, status TEXT) AS $$
BEGIN
  -- This is a placeholder. Actual re-embedding is done by the
  -- scripts/reembed-patches.js script which calls the embedding API.
  -- This function marks patches as pending re-embedding.
  RETURN QUERY
    UPDATE knowledge_patches
    SET embedding_type = 'heuristic'  -- reset so re-embed script picks them up
    WHERE embedding_type = 'heuristic'
    RETURNING id::TEXT AS patch_id, 'pending_reembed'::TEXT AS status;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ecos_reembed_patches
    IS 'Marks patches for re-embedding. Run scripts/reembed-patches.js to execute.';
