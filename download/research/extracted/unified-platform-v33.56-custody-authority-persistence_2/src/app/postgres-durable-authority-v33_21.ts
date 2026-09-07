import { createHash, randomUUID } from 'node:crypto';
import {
  KeyRegistry,
  sha256,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../contracts/crypto.js';

export type PostgresEvidenceClassV33_21 =
  | 'SYNTHETIC_CONTRACT_TEST'
  | 'LIVE_EXTERNAL_POSTGRESQL_OPERATOR_OBSERVATION';

export interface PostgresMigrationV33_21 {
  readonly version: '33.21';
  readonly migrationId: string;
  readonly ordinal: number;
  readonly description: string;
  readonly sql: string;
  readonly previousMigrationDigest: string;
  readonly migrationDigest: string;
}

export interface PostgresAuthoritySqlPlanV33_21 {
  readonly version: '33.21';
  readonly beginSql: 'BEGIN ISOLATION LEVEL SERIALIZABLE';
  readonly localSettingsSql: readonly string[];
  readonly advisoryLockSql: string;
  readonly processCommandSql: string;
  readonly commitSql: 'COMMIT';
  readonly rollbackSql: 'ROLLBACK';
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly planDigest: string;
}

export interface PgQueryResultV33_21<Row extends Record<string, unknown> = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number;
  readonly command?: string;
}

export interface PgTransactionalClientV33_21 {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<PgQueryResultV33_21<Row>>;
  release(): void;
}

export interface PgPoolV33_21 {
  connect(): Promise<PgTransactionalClientV33_21>;
}

export interface PostgresAuthorityExecutionInputV33_21 {
  readonly leaseKey: string;
  readonly commandId: string;
  readonly commandDigest: string;
  readonly commandJson: Readonly<Record<string, unknown>>;
  readonly statementTimeoutMs?: number;
  readonly lockTimeoutMs?: number;
}

export interface PostgresAuthorityExecutionReceiptV33_21 {
  readonly version: '33.21';
  readonly executionId: string;
  readonly leaseKey: string;
  readonly commandId: string;
  readonly commandDigest: string;
  readonly accepted: boolean;
  readonly reason: 'PROCESSED' | 'LEASE_LOCK_BUSY';
  readonly decision: Readonly<Record<string, unknown>> | null;
  readonly attempts: number;
  readonly transactionIsolation: 'SERIALIZABLE';
  readonly advisoryLockScope: 'TRANSACTION';
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly receiptDigest: string;
}

export interface PostgresQualificationChallengeV33_21 {
  readonly version: '33.21';
  readonly challengeId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly migrationChainDigest: string;
  readonly minimumServerVersionNum: number;
  readonly requiredIndependentOperators: 2;
  readonly requiredIndependentHosts: 2;
  readonly requiredControls: readonly [
    'TLS_REQUIRED',
    'SERIALIZABLE_TRANSACTION',
    'TRANSACTION_ADVISORY_LOCK',
    'ROW_LOCK_FOR_UPDATE',
    'ATOMIC_DECISION_AND_OUTBOX',
    'SINGLE_WINNER_RACE',
    'RESTART_SAFE_FENCE',
    'SEPARATE_WITNESS_ROLLBACK_REJECTION',
    'LEAST_PRIVILEGE_ROLES',
    'NO_EMBEDDED_SECRETS',
  ];
  readonly syntheticEvidenceAccepted: false;
  readonly sameHostEvidenceAccepted: false;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly challengeDigest: string;
}

export interface PostgresOperatorObservationV33_21 {
  readonly version: '33.21';
  readonly observationId: string;
  readonly challengeId: string;
  readonly evidenceClass: PostgresEvidenceClassV33_21;
  readonly operatorOrganizationId: string;
  readonly operatorSignerId: string;
  readonly hostId: string;
  readonly databaseSystemIdentifier: string;
  readonly serverVersionNum: number;
  readonly sslInUse: boolean;
  readonly migrationChainDigest: string;
  readonly controls: Readonly<Record<PostgresQualificationChallengeV33_21['requiredControls'][number], boolean>>;
  readonly controlEvidenceDigests: Readonly<Record<PostgresQualificationChallengeV33_21['requiredControls'][number], string>>;
  readonly observedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly observationDigest: string;
}

export interface PostgresQualificationVerdictV33_21 {
  readonly version: '33.21';
  readonly verdictId: string;
  readonly challengeId: string;
  readonly status: 'EXTERNAL_QUALIFICATION_REQUIRED' | 'QUALIFIED_FOR_EXTERNAL_PILOT';
  readonly acceptedObservationIds: readonly string[];
  readonly rejectedObservationIds: readonly string[];
  readonly distinctOperatorOrganizations: number;
  readonly distinctHosts: number;
  readonly distinctDatabaseSystems: number;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly verdictDigest: string;
}

export interface PostgresQualificationTrustV33_21 {
  readonly operatorRegistry: KeyRegistry;
  readonly trustedOperatorSignerIds: readonly string[];
  readonly verifierRegistry: KeyRegistry;
  readonly trustedVerifierSignerIds: readonly string[];
}

export function buildPostgresAuthorityMigrationsV33_21(): readonly PostgresMigrationV33_21[] {
  const sql = [
    migration001(),
    migration002(),
    migration003(),
  ];
  const descriptions = [
    'authority tables, witness tables, decisions and durable outbox',
    'transactional lease command function with monotonic fencing',
    'least-privilege grants, integrity views and qualification checks',
  ];
  let previousMigrationDigest = 'GENESIS';
  return sql.map((statement, index) => {
    const material = {
      version: '33.21' as const,
      migrationId: `v33.21.${String(index + 1).padStart(3, '0')}`,
      ordinal: index + 1,
      description: descriptions[index]!,
      sql: normalizeSql(statement),
      previousMigrationDigest,
    };
    const migration = { ...material, migrationDigest: sha256(material) };
    previousMigrationDigest = migration.migrationDigest;
    return migration;
  });
}

export function postgresMigrationChainDigestV33_21(
  migrations: readonly PostgresMigrationV33_21[] = buildPostgresAuthorityMigrationsV33_21(),
): string {
  verifyPostgresMigrationChainV33_21(migrations);
  return sha256(migrations.map((item) => ({ id: item.migrationId, digest: item.migrationDigest })));
}

export function verifyPostgresMigrationChainV33_21(migrations: readonly PostgresMigrationV33_21[]): true {
  if (migrations.length !== 3) throw new Error('postgres_migration_count_invalid');
  let previous = 'GENESIS';
  migrations.forEach((migration, index) => {
    if (migration.version !== '33.21' || migration.ordinal !== index + 1) throw new Error('postgres_migration_order_invalid');
    if (migration.previousMigrationDigest !== previous) throw new Error('postgres_migration_chain_invalid');
    const { migrationDigest, ...material } = migration;
    if (sha256(material) !== migrationDigest) throw new Error('postgres_migration_digest_invalid');
    if (/\bPASSWORD\b|postgres(?:ql)?:\/\//i.test(migration.sql)) throw new Error('postgres_migration_secret_material_forbidden');
    previous = migrationDigest;
  });
  return true;
}

export function buildPostgresAuthoritySqlPlanV33_21(): PostgresAuthoritySqlPlanV33_21 {
  const material = {
    version: '33.21' as const,
    beginSql: 'BEGIN ISOLATION LEVEL SERIALIZABLE' as const,
    localSettingsSql: [
      "SET LOCAL statement_timeout = $1",
      "SET LOCAL lock_timeout = $1",
      "SET LOCAL idle_in_transaction_session_timeout = $1",
    ] as const,
    advisoryLockSql: 'SELECT pg_try_advisory_xact_lock(hashtextextended($1::text, 0)) AS locked',
    processCommandSql: 'SELECT governed_authority.process_lease_command_v1($1::jsonb) AS decision',
    commitSql: 'COMMIT' as const,
    rollbackSql: 'ROLLBACK' as const,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return { ...material, planDigest: sha256(material) };
}

export class PostgresDurableAuthorityAdapterV33_21 {
  readonly #pool: PgPoolV33_21;
  readonly #maxSerializationAttempts: number;

  constructor(input: { readonly pool: PgPoolV33_21; readonly maxSerializationAttempts?: number }) {
    this.#pool = input.pool;
    this.#maxSerializationAttempts = boundedInteger(input.maxSerializationAttempts ?? 3, 1, 5, 'serialization_attempts_invalid');
  }

  async execute(input: PostgresAuthorityExecutionInputV33_21): Promise<PostgresAuthorityExecutionReceiptV33_21> {
    nonEmpty(input.leaseKey, 'lease_key_required');
    nonEmpty(input.commandId, 'command_id_required');
    nonEmpty(input.commandDigest, 'command_digest_required');
    const statementTimeoutMs = boundedInteger(input.statementTimeoutMs ?? 5_000, 100, 60_000, 'statement_timeout_invalid');
    const lockTimeoutMs = boundedInteger(input.lockTimeoutMs ?? 1_000, 50, statementTimeoutMs, 'lock_timeout_invalid');
    let attempt = 0;
    while (attempt < this.#maxSerializationAttempts) {
      attempt += 1;
      const client = await this.#pool.connect();
      let transactionOpen = false;
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        transactionOpen = true;
        await client.query("SET LOCAL statement_timeout = $1", [`${statementTimeoutMs}ms`]);
        await client.query("SET LOCAL lock_timeout = $1", [`${lockTimeoutMs}ms`]);
        await client.query("SET LOCAL idle_in_transaction_session_timeout = $1", [`${statementTimeoutMs}ms`]);
        const lock = await client.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_xact_lock(hashtextextended($1::text, 0)) AS locked',
          [input.leaseKey],
        );
        if (lock.rows[0]?.locked !== true) {
          await client.query('ROLLBACK');
          transactionOpen = false;
          return receipt(input, false, 'LEASE_LOCK_BUSY', null, attempt);
        }
        const command = {
          ...structuredClone(input.commandJson),
          commandId: input.commandId,
          commandDigest: input.commandDigest,
          leaseKey: input.leaseKey,
        };
        const result = await client.query<{ decision: Readonly<Record<string, unknown>> }>(
          'SELECT governed_authority.process_lease_command_v1($1::jsonb) AS decision',
          [JSON.stringify(command)],
        );
        const decision = result.rows[0]?.decision;
        if (decision === undefined || decision === null || typeof decision !== 'object' || Array.isArray(decision)) {
          throw new Error('postgres_decision_missing');
        }
        await client.query('COMMIT');
        transactionOpen = false;
        return receipt(input, true, 'PROCESSED', decision, attempt);
      } catch (error) {
        if (transactionOpen) {
          try { await client.query('ROLLBACK'); } catch { /* preserve original error */ }
        }
        if (isRetryablePostgresError(error) && attempt < this.#maxSerializationAttempts) continue;
        throw error;
      } finally {
        client.release();
      }
    }
    throw new Error('postgres_serialization_attempts_exhausted');
  }
}

export function issuePostgresQualificationChallengeV33_21(input: {
  readonly signer: SigningIdentity;
  readonly now?: Date;
  readonly expiresInMs?: number;
}): SignedEnvelope<PostgresQualificationChallengeV33_21> {
  const now = input.now ?? new Date();
  const expiresInMs = boundedInteger(input.expiresInMs ?? 7 * 24 * 60 * 60 * 1_000, 60_000, 30 * 24 * 60 * 60 * 1_000, 'challenge_expiry_invalid');
  const material = {
    version: '33.21' as const,
    challengeId: `postgres-challenge-${randomUUID()}`,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + expiresInMs).toISOString(),
    migrationChainDigest: postgresMigrationChainDigestV33_21(),
    minimumServerVersionNum: 150000,
    requiredIndependentOperators: 2 as const,
    requiredIndependentHosts: 2 as const,
    requiredControls: [
      'TLS_REQUIRED',
      'SERIALIZABLE_TRANSACTION',
      'TRANSACTION_ADVISORY_LOCK',
      'ROW_LOCK_FOR_UPDATE',
      'ATOMIC_DECISION_AND_OUTBOX',
      'SINGLE_WINNER_RACE',
      'RESTART_SAFE_FENCE',
      'SEPARATE_WITNESS_ROLLBACK_REJECTION',
      'LEAST_PRIVILEGE_ROLES',
      'NO_EMBEDDED_SECRETS',
    ] as const,
    syntheticEvidenceAccepted: false as const,
    sameHostEvidenceAccepted: false as const,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, challengeDigest: sha256(material) }, input.signer);
}

export function issuePostgresOperatorObservationV33_21(input: {
  readonly challenge: SignedEnvelope<PostgresQualificationChallengeV33_21>;
  readonly signer: SigningIdentity;
  readonly evidenceClass: PostgresEvidenceClassV33_21;
  readonly operatorOrganizationId: string;
  readonly hostId: string;
  readonly databaseSystemIdentifier: string;
  readonly serverVersionNum: number;
  readonly sslInUse: boolean;
  readonly controls: PostgresOperatorObservationV33_21['controls'];
  readonly controlEvidenceDigests: PostgresOperatorObservationV33_21['controlEvidenceDigests'];
  readonly now?: Date;
}): SignedEnvelope<PostgresOperatorObservationV33_21> {
  const now = input.now ?? new Date();
  const material = {
    version: '33.21' as const,
    observationId: `postgres-observation-${randomUUID()}`,
    challengeId: input.challenge.payload.challengeId,
    evidenceClass: input.evidenceClass,
    operatorOrganizationId: nonEmpty(input.operatorOrganizationId, 'operator_organization_required'),
    operatorSignerId: input.signer.keyId,
    hostId: nonEmpty(input.hostId, 'host_id_required'),
    databaseSystemIdentifier: nonEmpty(input.databaseSystemIdentifier, 'database_system_identifier_required'),
    serverVersionNum: boundedInteger(input.serverVersionNum, 1, 99_999_999, 'server_version_invalid'),
    sslInUse: input.sslInUse,
    migrationChainDigest: input.challenge.payload.migrationChainDigest,
    controls: structuredClone(input.controls),
    controlEvidenceDigests: structuredClone(input.controlEvidenceDigests),
    observedAt: now.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, observationDigest: sha256(material) }, input.signer);
}

export function evaluatePostgresQualificationV33_21(input: {
  readonly challenge: SignedEnvelope<PostgresQualificationChallengeV33_21>;
  readonly observations: readonly SignedEnvelope<PostgresOperatorObservationV33_21>[];
  readonly challengeRegistry: KeyRegistry;
  readonly trustedChallengeSignerIds: readonly string[];
  readonly trust: PostgresQualificationTrustV33_21;
  readonly verifier: SigningIdentity;
  readonly now?: Date;
}): SignedEnvelope<PostgresQualificationVerdictV33_21> {
  const now = input.now ?? new Date();
  if (!input.trustedChallengeSignerIds.includes(input.challenge.issuerKeyId) || !input.challengeRegistry.verify(input.challenge)) throw new Error('postgres_challenge_untrusted');
  if (!input.trust.trustedVerifierSignerIds.includes(input.verifier.keyId) || input.trust.verifierRegistry.fingerprint(input.verifier.keyId) === undefined) throw new Error('postgres_verifier_untrusted');
  if (input.trust.trustedOperatorSignerIds.includes(input.verifier.keyId) || input.trustedChallengeSignerIds.includes(input.verifier.keyId)) throw new Error('postgres_verifier_role_separation_required');
  const accepted: string[] = [];
  const rejected: string[] = [];
  const organizations = new Set<string>();
  const hosts = new Set<string>();
  const systems = new Set<string>();
  const signers = new Set<string>();
  for (const envelope of input.observations) {
    let valid = true;
    try {
      if (!input.trust.trustedOperatorSignerIds.includes(envelope.issuerKeyId) || !input.trust.operatorRegistry.verify(envelope)) throw new Error('postgres_operator_untrusted');
      const observation = envelope.payload;
      const { observationDigest, ...material } = observation;
      if (sha256(material) !== observationDigest) valid = false;
      if (observation.challengeId !== input.challenge.payload.challengeId) valid = false;
      if (observation.operatorSignerId !== envelope.issuerKeyId) valid = false;
      if (observation.evidenceClass !== 'LIVE_EXTERNAL_POSTGRESQL_OPERATOR_OBSERVATION') valid = false;
      if (observation.serverVersionNum < input.challenge.payload.minimumServerVersionNum) valid = false;
      if (!observation.sslInUse) valid = false;
      if (observation.migrationChainDigest !== input.challenge.payload.migrationChainDigest) valid = false;
      if (input.challenge.payload.requiredControls.some((control) => observation.controls[control] !== true || !/^[0-9a-f]{64}$/.test(observation.controlEvidenceDigests[control] ?? ''))) valid = false;
      const observedAt = new Date(observation.observedAt);
      const issuedAt = new Date(input.challenge.payload.issuedAt);
      const expiresAt = new Date(input.challenge.payload.expiresAt);
      if (!Number.isFinite(observedAt.getTime()) || observedAt < issuedAt || observedAt > now || now >= expiresAt) valid = false;
      if (envelope.issuerKeyId === input.challenge.issuerKeyId || envelope.issuerKeyId === input.verifier.keyId) valid = false;
      if (observation.productionAuthority !== 'NONE' || observation.externalEffectsExecuted !== 0) valid = false;
    } catch {
      valid = false;
    }
    if (!valid) {
      rejected.push(envelope.payload.observationId);
      continue;
    }
    if (signers.has(envelope.issuerKeyId) || organizations.has(envelope.payload.operatorOrganizationId) || hosts.has(envelope.payload.hostId) || systems.has(envelope.payload.databaseSystemIdentifier)) {
      rejected.push(envelope.payload.observationId);
      continue;
    }
    signers.add(envelope.issuerKeyId);
    organizations.add(envelope.payload.operatorOrganizationId);
    hosts.add(envelope.payload.hostId);
    systems.add(envelope.payload.databaseSystemIdentifier);
    accepted.push(envelope.payload.observationId);
  }
  const qualified = accepted.length >= input.challenge.payload.requiredIndependentOperators
    && organizations.size >= input.challenge.payload.requiredIndependentOperators
    && hosts.size >= input.challenge.payload.requiredIndependentHosts
    && systems.size >= 2;
  const material = {
    version: '33.21' as const,
    verdictId: `postgres-verdict-${randomUUID()}`,
    challengeId: input.challenge.payload.challengeId,
    status: qualified ? 'QUALIFIED_FOR_EXTERNAL_PILOT' as const : 'EXTERNAL_QUALIFICATION_REQUIRED' as const,
    acceptedObservationIds: accepted,
    rejectedObservationIds: rejected,
    distinctOperatorOrganizations: organizations.size,
    distinctHosts: hosts.size,
    distinctDatabaseSystems: systems.size,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return signEnvelope({ ...material, verdictDigest: sha256(material) }, input.verifier);
}

export function renderPostgresOperatorEnvironmentTemplateV33_21(): string {
  return [
    '# V33.21 external PostgreSQL qualification — values must be supplied out-of-band',
    'PGHOST=<external-postgres-host>',
    'PGPORT=5432',
    'PGDATABASE=<authority-database>',
    'PGUSER=<migration-or-qualification-role>',
    'PGSSLMODE=verify-full',
    'PGSSLROOTCERT=<path-to-ca.pem>',
    'PGSSLCERT=<path-to-client-cert.pem>',
    'PGSSLKEY=<path-to-client-key.pem>',
    '# PGPASSWORD is intentionally forbidden; use .pgpass, a secret manager, workload identity, or an injected file descriptor.',
  ].join('\n') + '\n';
}

function receipt(
  input: PostgresAuthorityExecutionInputV33_21,
  accepted: boolean,
  reason: PostgresAuthorityExecutionReceiptV33_21['reason'],
  decision: Readonly<Record<string, unknown>> | null,
  attempts: number,
): PostgresAuthorityExecutionReceiptV33_21 {
  const material = {
    version: '33.21' as const,
    executionId: `postgres-execution-${randomUUID()}`,
    leaseKey: input.leaseKey,
    commandId: input.commandId,
    commandDigest: input.commandDigest,
    accepted,
    reason,
    decision,
    attempts,
    transactionIsolation: 'SERIALIZABLE' as const,
    advisoryLockScope: 'TRANSACTION' as const,
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return { ...material, receiptDigest: sha256(material) };
}

function isRetryablePostgresError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = 'code' in error ? String((error as { readonly code?: unknown }).code ?? '') : '';
  return code === '40001' || code === '40P01';
}

function migration001(): string {
  return `
CREATE SCHEMA IF NOT EXISTS governed_crypto;
DO $$
DECLARE v_schema text;
BEGIN
  SELECT n.nspname INTO v_schema FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto';
  IF v_schema IS NULL THEN
    CREATE EXTENSION pgcrypto WITH SCHEMA governed_crypto;
  ELSIF v_schema <> 'governed_crypto' THEN
    RAISE EXCEPTION 'pgcrypto must be installed in governed_crypto schema, found %', v_schema USING ERRCODE='55000';
  END IF;
END
$$;
CREATE SCHEMA IF NOT EXISTS governed_authority;
CREATE SCHEMA IF NOT EXISTS governed_witness;

CREATE TABLE IF NOT EXISTS governed_authority.schema_migrations (
  migration_id text PRIMARY KEY,
  ordinal integer NOT NULL UNIQUE CHECK (ordinal > 0),
  migration_digest text NOT NULL UNIQUE,
  previous_migration_digest text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS governed_authority.authority_state (
  authority_id text PRIMARY KEY,
  authority_epoch bigint NOT NULL DEFAULT 1 CHECK (authority_epoch > 0),
  fence_counter bigint NOT NULL DEFAULT 0 CHECK (fence_counter >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS governed_authority.leases (
  authority_id text NOT NULL,
  tenant_id text NOT NULL,
  service_id text NOT NULL,
  controller_id text NOT NULL,
  fence_token bigint NOT NULL CHECK (fence_token > 0),
  lease_digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  grant_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (authority_id, tenant_id, service_id),
  FOREIGN KEY (authority_id) REFERENCES governed_authority.authority_state(authority_id)
);

CREATE TABLE IF NOT EXISTS governed_authority.decisions (
  command_id text PRIMARY KEY,
  command_digest text NOT NULL,
  authority_id text NOT NULL,
  tenant_id text NOT NULL,
  service_id text NOT NULL,
  decision_json jsonb NOT NULL,
  decision_digest text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS governed_authority.outbox (
  event_id text PRIMARY KEY,
  event_digest text NOT NULL UNIQUE,
  authority_id text NOT NULL,
  tenant_id text NOT NULL,
  service_id text NOT NULL,
  payload_json jsonb NOT NULL,
  acknowledged_at timestamptz,
  acknowledgement_json jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((acknowledged_at IS NULL) = (acknowledgement_json IS NULL))
);

CREATE TABLE IF NOT EXISTS governed_witness.fences (
  authority_id text NOT NULL,
  tenant_id text NOT NULL,
  service_id text NOT NULL,
  highest_fence_token bigint NOT NULL CHECK (highest_fence_token >= 0),
  witness_receipt_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (authority_id, tenant_id, service_id)
);
`;
}

function migration002(): string {
  return `
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
`;
}

function migration003(): string {
  return `
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
`;
}

function normalizeSql(sql: string): string {
  return sql.trim().replace(/\r\n/g, '\n') + '\n';
}

function nonEmpty(value: string, error: string): string {
  if (value.trim().length === 0) throw new Error(error);
  return value;
}

function boundedInteger(value: number, minimum: number, maximum: number, error: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(error);
  return value;
}

export function sha256TextV33_21(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
