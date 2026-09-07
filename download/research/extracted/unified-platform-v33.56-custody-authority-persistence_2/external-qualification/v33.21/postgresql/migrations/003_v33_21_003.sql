CREATE INDEX IF NOT EXISTS decisions_authority_scope_idx ON governed_authority.decisions(authority_id, tenant_id, service_id, created_at);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON governed_authority.outbox(created_at) WHERE acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS leases_expiry_idx ON governed_authority.leases(expires_at);

REVOKE ALL ON SCHEMA governed_crypto FROM PUBLIC;
REVOKE ALL ON SCHEMA governed_authority FROM PUBLIC;
REVOKE ALL ON SCHEMA governed_witness FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA governed_authority FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA governed_witness FROM PUBLIC;
REVOKE ALL ON FUNCTION governed_authority.process_lease_command_v1(jsonb) FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='governed_authority_runtime') THEN CREATE ROLE governed_authority_runtime NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='governed_authority_delivery') THEN CREATE ROLE governed_authority_delivery NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='governed_authority_verifier') THEN CREATE ROLE governed_authority_verifier NOLOGIN; END IF;
END
$$;

GRANT USAGE ON SCHEMA governed_crypto TO governed_authority_runtime;
GRANT EXECUTE ON FUNCTION governed_crypto.digest(text, text) TO governed_authority_runtime;
GRANT USAGE ON SCHEMA governed_authority TO governed_authority_runtime, governed_authority_delivery, governed_authority_verifier;
GRANT EXECUTE ON FUNCTION governed_authority.process_lease_command_v1(jsonb) TO governed_authority_runtime;
GRANT SELECT, INSERT, UPDATE ON governed_authority.authority_state, governed_authority.leases, governed_authority.decisions, governed_authority.outbox TO governed_authority_runtime;
GRANT SELECT ON governed_authority.outbox TO governed_authority_delivery;
GRANT UPDATE (acknowledged_at, acknowledgement_json) ON governed_authority.outbox TO governed_authority_delivery;

CREATE OR REPLACE VIEW governed_authority.integrity_summary AS
SELECT
  (SELECT count(*) FROM governed_authority.authority_state) AS authority_count,
  (SELECT count(*) FROM governed_authority.leases) AS lease_count,
  (SELECT count(*) FROM governed_authority.decisions) AS decision_count,
  (SELECT count(*) FROM governed_authority.outbox) AS outbox_count,
  (SELECT count(*) FROM governed_authority.outbox WHERE acknowledged_at IS NULL) AS pending_outbox_count,
  (SELECT COALESCE(max(fence_counter), 0) FROM governed_authority.authority_state) AS maximum_fence_token;

GRANT SELECT ON governed_authority.integrity_summary TO governed_authority_verifier;
