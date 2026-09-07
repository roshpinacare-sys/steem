-- =============================================================================
--  ECOS B2B Phase 3 — Enterprise Major League Migration
--  Enables pgvector for blazing fast semantic vector searches inside Postgres.
-- =============================================================================

BEGIN;

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding vector column to knowledge_patches (384 dimensions for all-MiniLM-L6-v2)
ALTER TABLE knowledge_patches 
ADD COLUMN IF NOT EXISTS embedding vector(384);

-- Create an HNSW index for ultra-fast cosine distance search
-- (We use cosine distance <=> which is optimal for normalized embeddings)
CREATE INDEX IF NOT EXISTS idx_kp_embedding_hnsw 
ON knowledge_patches USING hnsw (embedding vector_cosine_ops);

COMMIT;

-- Add table for calibration parameters
CREATE TABLE IF NOT EXISTS calibration_settings (
    id SERIAL PRIMARY KEY,
    calibrator_name TEXT NOT NULL UNIQUE,
    param_a NUMERIC(10, 8) NOT NULL,
    param_b NUMERIC(10, 8) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add function to update updated_at column automatically
CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_calibration_settings_updated_at ON calibration_settings;
CREATE TRIGGER update_calibration_settings_updated_at BEFORE UPDATE ON calibration_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
