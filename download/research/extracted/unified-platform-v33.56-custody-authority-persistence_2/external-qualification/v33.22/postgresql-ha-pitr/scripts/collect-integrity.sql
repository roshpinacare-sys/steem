SELECT * FROM governed_authority.integrity_summary;
SELECT authority_id, tenant_id, service_id, highest_fence_token, updated_at
FROM governed_witness.fences
ORDER BY authority_id, tenant_id, service_id;
SELECT event_id, event_digest, created_at, acknowledged_at
FROM governed_authority.outbox
ORDER BY created_at, event_id;
