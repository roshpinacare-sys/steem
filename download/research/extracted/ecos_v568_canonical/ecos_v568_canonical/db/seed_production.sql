-- =============================================================================
--  ECOS B2B Core - Production Accounts & Economical Seeding
--  Initializes the system's sovereign financial baseline.
-- =============================================================================

BEGIN;

-- Seed System Core Financial Nodes (Accounts must exist prior to transactional flow)
INSERT INTO accounts (id, kind, balance_micro, metadata) VALUES
  ('sys::platform', 'system', 0, '{"name": "ECOS Platform Fees Reserve", "split_bps": 4000}'),
  ('sys::insurance_pool', 'system', 0, '{"name": "ECOS Cryptographic Insurance Vault", "split_bps": 2000}'),
  ('sys::escrow', 'system', 0, '{"name": "ECOS Escrow Hold Transit Pool", "split_bps": 4000}')
ON CONFLICT (id) DO UPDATE SET updated_at = now();

COMMIT;
