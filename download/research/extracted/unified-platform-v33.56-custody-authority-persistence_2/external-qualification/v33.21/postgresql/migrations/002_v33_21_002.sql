CREATE OR REPLACE FUNCTION governed_authority.process_lease_command_v1(command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, governed_authority
AS $$
DECLARE
  v_command_id text := command->>'commandId';
  v_command_digest text := command->>'commandDigest';
  v_authority_id text := command->>'authorityId';
  v_tenant_id text := command->>'tenantId';
  v_service_id text := command->>'serviceId';
  v_controller_id text := command->>'controllerId';
  v_operation text := command->>'operation';
  v_requested_ttl_ms bigint := COALESCE((command->>'requestedTtlMs')::bigint, 0);
  v_now timestamptz := COALESCE((command->>'issuedAt')::timestamptz, clock_timestamp());
  v_existing governed_authority.decisions%ROWTYPE;
  v_lease governed_authority.leases%ROWTYPE;
  v_fence bigint;
  v_decision jsonb;
  v_decision_digest text;
  v_event jsonb;
  v_event_digest text;
  v_had_lease boolean := false;
  v_active_same_controller boolean := false;
BEGIN
  IF v_command_id IS NULL OR v_command_digest IS NULL OR v_authority_id IS NULL OR v_tenant_id IS NULL OR v_service_id IS NULL OR v_controller_id IS NULL OR v_operation IS NULL THEN
    RAISE EXCEPTION 'command fields required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing FROM governed_authority.decisions WHERE command_id = v_command_id;
  IF FOUND THEN
    IF v_existing.command_digest <> v_command_digest THEN
      RAISE EXCEPTION 'command id conflict' USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.decision_json;
  END IF;

  INSERT INTO governed_authority.authority_state(authority_id) VALUES (v_authority_id)
  ON CONFLICT (authority_id) DO NOTHING;

  SELECT * INTO v_lease
  FROM governed_authority.leases
  WHERE authority_id = v_authority_id AND tenant_id = v_tenant_id AND service_id = v_service_id
  FOR UPDATE;
  v_had_lease := FOUND;
  v_active_same_controller := v_had_lease AND v_lease.expires_at > v_now AND v_lease.controller_id = v_controller_id;

  IF v_operation IN ('ACQUIRE', 'RENEW') THEN
    IF v_requested_ttl_ms <= 0 THEN RAISE EXCEPTION 'ttl required' USING ERRCODE = '22023'; END IF;
    IF v_had_lease AND v_lease.expires_at > v_now AND v_lease.controller_id <> v_controller_id THEN
      v_decision := jsonb_build_object('accepted', false, 'reason', 'LEASE_BUSY', 'currentFenceToken', v_lease.fence_token, 'commandId', v_command_id);
    ELSE
      IF v_active_same_controller THEN
        v_fence := v_lease.fence_token;
      ELSE
        UPDATE governed_authority.authority_state
        SET fence_counter = fence_counter + 1, updated_at = clock_timestamp()
        WHERE authority_id = v_authority_id
        RETURNING fence_counter INTO v_fence;
      END IF;
      v_decision := jsonb_build_object(
        'accepted', true,
        'reason', CASE WHEN v_active_same_controller THEN 'RENEWED' WHEN v_had_lease THEN 'TAKEN_OVER' ELSE 'ACQUIRED' END,
        'currentFenceToken', v_fence,
        'commandId', v_command_id,
        'grant', jsonb_build_object('authorityId', v_authority_id, 'tenantId', v_tenant_id, 'serviceId', v_service_id, 'controllerId', v_controller_id, 'fenceToken', v_fence, 'expiresAt', v_now + make_interval(secs => v_requested_ttl_ms / 1000.0))
      );
      INSERT INTO governed_authority.leases(authority_id, tenant_id, service_id, controller_id, fence_token, lease_digest, expires_at, grant_json)
      VALUES (v_authority_id, v_tenant_id, v_service_id, v_controller_id, v_fence, encode(governed_crypto.digest(v_decision::text, 'sha256'), 'hex'), v_now + make_interval(secs => v_requested_ttl_ms / 1000.0), v_decision->'grant')
      ON CONFLICT (authority_id, tenant_id, service_id) DO UPDATE SET controller_id=EXCLUDED.controller_id, fence_token=EXCLUDED.fence_token, lease_digest=EXCLUDED.lease_digest, expires_at=EXCLUDED.expires_at, grant_json=EXCLUDED.grant_json, updated_at=clock_timestamp();
    END IF;
  ELSIF v_operation = 'ASSERT_FENCE' THEN
    v_decision := jsonb_build_object('accepted', FOUND AND v_lease.controller_id = v_controller_id AND v_lease.fence_token = (command->>'expectedFenceToken')::bigint AND v_lease.expires_at > v_now, 'reason', CASE WHEN FOUND AND v_lease.controller_id = v_controller_id AND v_lease.fence_token = (command->>'expectedFenceToken')::bigint AND v_lease.expires_at > v_now THEN 'FENCE_CURRENT' ELSE 'STALE_FENCE' END, 'currentFenceToken', COALESCE(v_lease.fence_token, 0), 'commandId', v_command_id);
  ELSE
    RAISE EXCEPTION 'unsupported operation' USING ERRCODE = '22023';
  END IF;

  v_decision_digest := encode(governed_crypto.digest(v_decision::text, 'sha256'), 'hex');
  INSERT INTO governed_authority.decisions(command_id, command_digest, authority_id, tenant_id, service_id, decision_json, decision_digest)
  VALUES (v_command_id, v_command_digest, v_authority_id, v_tenant_id, v_service_id, v_decision, v_decision_digest);

  v_event := jsonb_build_object('eventId', 'pg-outbox-' || v_command_id, 'commandId', v_command_id, 'decisionDigest', v_decision_digest, 'authorityId', v_authority_id, 'tenantId', v_tenant_id, 'serviceId', v_service_id, 'productionAuthority', 'NONE', 'externalEffectsExecuted', 0);
  v_event_digest := encode(governed_crypto.digest(v_event::text, 'sha256'), 'hex');
  INSERT INTO governed_authority.outbox(event_id, event_digest, authority_id, tenant_id, service_id, payload_json)
  VALUES (v_event->>'eventId', v_event_digest, v_authority_id, v_tenant_id, v_service_id, v_event)
  ON CONFLICT (event_id) DO NOTHING;

  RETURN v_decision;
END;
$$;
