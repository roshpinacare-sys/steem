\set ON_ERROR_STOP on

-- v23 PostgreSQL qualification suite. Run only against a disposable qualification database.
DO $$
DECLARE
  missing_force_rls text[];
  missing_policies text[];
  missing_constraints text[];
BEGIN
  SELECT array_agg(c.relname ORDER BY c.relname)
    INTO missing_force_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = ANY (ARRAY['missions','approvals','outbox','effects','events','evidence','revocations','idempotency_records','recovery_checkpoints','memberships','private_sessions','artifact_records','trust_snapshots','action_passports','audit_records'])
    AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);
  IF missing_force_rls IS NOT NULL THEN
    RAISE EXCEPTION 'force_rls_missing:%', missing_force_rls;
  END IF;

  SELECT array_agg(required.name ORDER BY required.name)
    INTO missing_constraints
  FROM (VALUES
    ('approvals_mission_tenant_fk'),
    ('outbox_mission_tenant_fk'),
    ('events_mission_tenant_fk'),
    ('recovery_mission_tenant_fk')
  ) AS required(name)
  WHERE NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname = required.name AND c.contype = 'f');
  IF missing_constraints IS NOT NULL THEN
    RAISE EXCEPTION 'tenant_fk_missing:%', missing_constraints;
  END IF;

  SELECT array_agg(required.name ORDER BY required.name)
    INTO missing_policies
  FROM (VALUES
    ('missions'),('approvals'),('outbox'),('effects'),('events'),('evidence'),('revocations'),('idempotency_records'),('recovery_checkpoints'),
    ('memberships'),('private_sessions'),('artifact_records'),('trust_snapshots'),('action_passports')
  ) AS required(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname='public' AND p.tablename=required.name AND p.policyname='tenant_isolation'
  );
  IF missing_policies IS NOT NULL THEN
    RAISE EXCEPTION 'tenant_policy_missing:%', missing_policies;
  END IF;
END;
$$;

BEGIN;
SET LOCAL app.tenant_id = 'v23-tenant-a';

INSERT INTO missions (
  mission_id, tenant_id, subject_id, builder_id, scope, effect_key,
  approval_required, approval_status, state, revision, fence_token,
  cancelled, created_at, updated_at
) VALUES (
  'v23-qualification-mission', 'v23-tenant-a', 'subject', 'builder', 'qualification', 'v23-effect',
  true, 'PENDING', 'WAITING_APPROVAL', 1, 7,
  false, clock_timestamp(), clock_timestamp()
) ON CONFLICT (mission_id) DO UPDATE SET updated_at=EXCLUDED.updated_at;

INSERT INTO outbox (
  tenant_id, mission_id, effect_key, payload_json, payload_digest,
  status, attempt_count, fence_token, created_at
) VALUES (
  'v23-tenant-a', 'v23-qualification-mission', 'v23-effect', '{"kind":"qualification"}'::jsonb,
  encode(digest('{"kind":"qualification"}', 'sha256'),'hex'), 'PENDING', 0, 7, clock_timestamp()
) ON CONFLICT (tenant_id, effect_key) DO NOTHING;

DO $$
BEGIN
  BEGIN
    INSERT INTO approvals (tenant_id, mission_id, reviewer_id, decision, mission_revision, created_at)
    VALUES ('v23-tenant-b', 'v23-qualification-mission', 'reviewer', 'APPROVED', 1, clock_timestamp());
    RAISE EXCEPTION 'cross_tenant_fk_was_not_rejected';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
END;
$$;

INSERT INTO events (mission_id, tenant_id, event_type, payload_json, created_at, previous_digest, digest)
VALUES ('v23-qualification-mission', 'v23-tenant-a', 'QUALIFICATION', '{}'::jsonb, clock_timestamp(), NULL, 'v23-event-digest')
ON CONFLICT (mission_id, digest) DO NOTHING;

DO $$
BEGIN
  BEGIN
    UPDATE events SET event_type='TAMPERED' WHERE mission_id='v23-qualification-mission' AND digest='v23-event-digest';
    RAISE EXCEPTION 'append_only_update_was_not_rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'append_only_table' THEN RAISE; END IF;
  END;
END;
$$;

DO $$
DECLARE duplicate_count integer;
BEGIN
  SELECT count(*) INTO duplicate_count FROM outbox WHERE tenant_id='v23-tenant-a' AND effect_key='v23-effect';
  IF duplicate_count <> 1 THEN RAISE EXCEPTION 'idempotency_uniqueness_failed:%', duplicate_count; END IF;
END;
$$;

ROLLBACK;

SELECT json_build_object(
  'status','schema-and-invariants-exercised',
  'serverVersion',current_setting('server_version'),
  'forceRlsTables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relforcerowsecurity),
  'tenantPolicies',(SELECT count(*) FROM pg_policies WHERE schemaname='public'),
  'appendOnlyTriggers',(SELECT count(*) FROM pg_trigger WHERE tgname IN ('events_append_only','evidence_append_only','revocations_append_only','trust_snapshots_append_only','audit_records_append_only') AND NOT tgisinternal),
  'tenantCompositeForeignKeys',(SELECT count(*) FROM pg_constraint WHERE conname IN ('approvals_mission_tenant_fk','outbox_mission_tenant_fk','events_mission_tenant_fk','recovery_mission_tenant_fk'))
)::text;
