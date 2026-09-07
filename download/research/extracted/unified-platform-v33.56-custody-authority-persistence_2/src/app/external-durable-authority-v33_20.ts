import { createHash, randomUUID, X509Certificate } from 'node:crypto';
import { existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, closeSync } from 'node:fs';
import { request as httpsRequest, createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { dirname, resolve } from 'node:path';
import type { TLSSocket } from 'node:tls';
import { DatabaseSync } from 'node:sqlite';
import {
  KeyRegistry,
  sha256,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../contracts/crypto.js';
import type {
  DistributedLeaseCommandV33_18,
  DistributedLeaseDecisionV33_18,
  DistributedLeaseGrantV33_18,
  DistributedLeaseOutboxRecordV33_18,
  OutboxAcknowledgementV33_18,
} from './distributed-lease-authority-v33_18.js';

export type ExternalDurableBackendKindV33_20 = 'SQLITE_WAL' | 'POSTGRESQL' | 'ETCD' | 'CONSUL';
export type EnterpriseIdentityProviderKindV33_20 = 'LOCAL_ENTERPRISE_PKI_REFERENCE' | 'SPIFFE_SPIRE';

export interface ExternalInfrastructureProbeV33_20 {
  readonly version: '33.20';
  readonly component: ExternalDurableBackendKindV33_20 | 'SUPERVISORD' | 'SYSTEMD' | 'SPIFFE_SPIRE' | 'NETEM';
  readonly status: 'LOCAL_REFERENCE_QUALIFIED' | 'AVAILABLE_NOT_QUALIFIED' | 'UNAVAILABLE_FAIL_CLOSED';
  readonly executable?: string;
  readonly qualification: 'LOCAL_REFERENCE_ONLY' | 'EXTERNAL_QUALIFICATION_REQUIRED';
  readonly productionAuthority: 'NONE';
  readonly probedAt: string;
  readonly probeDigest: string;
}

export interface EnterpriseWorkloadIdentityV33_20 {
  readonly version: '33.20';
  readonly identityId: string;
  readonly generation: number;
  readonly controllerId: string;
  readonly tenantId: string;
  readonly serviceId: string;
  readonly trustDomain: string;
  readonly workloadUri: string;
  readonly certificateFingerprint256: string;
  readonly certificateSerialNumber: string;
  readonly certificateSubject: string;
  readonly issuedAt: string;
  readonly notBefore: string;
  readonly expiresAt: string;
  readonly previousIdentityId?: string;
  readonly revokedAt?: string;
  readonly revocationReason?: 'ROTATED' | 'ADMIN_REVOKED' | 'COMPROMISED';
  readonly status: 'ACTIVE' | 'REVOKED';
  readonly identityProvider: 'LOCAL_ENTERPRISE_PKI_REFERENCE';
  readonly spiffeSpireQualification: 'EXTERNAL_QUALIFICATION_REQUIRED';
  readonly authorityExpanded: false;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly identityDigest: string;
}

export interface EnterpriseIdentitySnapshotV33_20 {
  readonly version: '33.20';
  readonly identities: readonly SignedEnvelope<EnterpriseWorkloadIdentityV33_20>[];
  readonly generatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly snapshotDigest: string;
}

export interface EnterpriseIdentityTrustV33_20 {
  readonly issuerRegistry: KeyRegistry;
  readonly trustedIssuerSignerIds: readonly string[];
  readonly storeRegistry: KeyRegistry;
  readonly trustedStoreSignerIds: readonly string[];
}

export interface DurableWitnessReceiptV33_20 {
  readonly version: '33.20';
  readonly witnessId: string;
  readonly authorityId: string;
  readonly leaseKey: string;
  readonly fenceToken: number;
  readonly previousReceiptDigest: string;
  readonly observedAt: string;
  readonly storage: 'SEPARATE_SQLITE_WAL_REFERENCE';
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly receiptDigest: string;
}

export interface DurableAuthoritySnapshotV33_20 {
  readonly version: '33.20';
  readonly authorityId: string;
  readonly backend: 'SQLITE_WAL';
  readonly authorityEpoch: number;
  readonly fenceCounter: number;
  readonly activeLeases: readonly DistributedLeaseGrantV33_18[];
  readonly decisions: readonly SignedEnvelope<DistributedLeaseDecisionV33_18>[];
  readonly outbox: readonly SignedEnvelope<DistributedLeaseOutboxRecordV33_18>[];
  readonly witnessReceipts: readonly SignedEnvelope<DurableWitnessReceiptV33_20>[];
  readonly lastObservedAt: string;
  readonly generatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly snapshotDigest: string;
}

export interface DurableAuthorityTrustV33_20 {
  readonly controllerRegistry: KeyRegistry;
  readonly trustedControllerSignerIds: readonly string[];
  readonly authorityRegistry: KeyRegistry;
  readonly trustedAuthoritySignerIds: readonly string[];
  readonly witnessRegistry: KeyRegistry;
  readonly trustedWitnessSignerIds: readonly string[];
  readonly deliveryRegistry: KeyRegistry;
  readonly trustedDeliverySignerIds: readonly string[];
}

export interface EnterpriseDurableLeaseClientOptionsV33_20 {
  readonly endpoint: string;
  readonly envelope: SignedEnvelope<DistributedLeaseCommandV33_18>;
  readonly ca: string | Buffer;
  readonly cert: string | Buffer;
  readonly key: string | Buffer;
  readonly servername: string;
  readonly timeoutMs?: number;
}

export class EnterpriseIdentityRegistryV33_20 {
  readonly #path: string;
  readonly #issuerIdentity: SigningIdentity;
  readonly #storeIdentity: SigningIdentity;
  readonly #trust: EnterpriseIdentityTrustV33_20;
  #snapshot: EnterpriseIdentitySnapshotV33_20;

  constructor(input: { readonly path: string; readonly issuerIdentity: SigningIdentity; readonly storeIdentity: SigningIdentity; readonly trust: EnterpriseIdentityTrustV33_20; readonly now?: Date }) {
    this.#path = resolve(nonEmpty(input.path, 'identity_store_path_required'));
    this.#issuerIdentity = input.issuerIdentity;
    this.#storeIdentity = input.storeIdentity;
    this.#trust = input.trust;
    if (input.issuerIdentity.keyId === input.storeIdentity.keyId) throw new Error('identity_role_separation_required');
    if (!input.trust.trustedIssuerSignerIds.includes(input.issuerIdentity.keyId)) throw new Error('identity_issuer_untrusted');
    if (!input.trust.trustedStoreSignerIds.includes(input.storeIdentity.keyId)) throw new Error('identity_store_signer_untrusted');
    mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 });
    this.#snapshot = existsSync(this.#path) ? readIdentitySnapshot(this.#path, input.trust) : createIdentitySnapshot([], input.now ?? new Date());
    if (!existsSync(this.#path)) this.#persist(input.now ?? new Date());
  }

  issue(input: { readonly controllerId: string; readonly tenantId: string; readonly serviceId: string; readonly trustDomain: string; readonly certificatePem: string | Buffer; readonly previousIdentityId?: string; readonly now?: Date }): SignedEnvelope<EnterpriseWorkloadIdentityV33_20> {
    const now = input.now ?? new Date();
    const certificate = new X509Certificate(input.certificatePem);
    const fingerprint = normalizeFingerprint(certificate.fingerprint256);
    const workloadUri = `spiffe://${nonEmpty(input.trustDomain, 'trust_domain_required')}/controller/${nonEmpty(input.controllerId, 'controller_id_required')}`;
    if (!certificateHasUri(certificate, workloadUri)) throw new Error('enterprise_identity_uri_san_missing');
    const notBefore = new Date(certificate.validFrom);
    const expiresAt = new Date(certificate.validTo);
    if (!Number.isFinite(notBefore.getTime()) || !Number.isFinite(expiresAt.getTime()) || now < notBefore || now >= expiresAt) throw new Error('enterprise_identity_certificate_not_current');
    const duplicate = this.#snapshot.identities.find((item) => item.payload.status === 'ACTIVE' && item.payload.certificateFingerprint256 === fingerprint);
    if (duplicate !== undefined) {
      if (duplicate.payload.controllerId === input.controllerId && duplicate.payload.tenantId === input.tenantId && duplicate.payload.serviceId === input.serviceId) return structuredClone(duplicate);
      throw new Error('enterprise_identity_fingerprint_already_bound');
    }
    const prior = input.previousIdentityId === undefined ? undefined : this.#find(input.previousIdentityId);
    if (prior !== undefined) {
      if (prior.payload.status !== 'ACTIVE') throw new Error('previous_enterprise_identity_not_active');
      if (prior.payload.controllerId !== input.controllerId || prior.payload.tenantId !== input.tenantId || prior.payload.serviceId !== input.serviceId || prior.payload.trustDomain !== input.trustDomain) throw new Error('enterprise_identity_rotation_binding_mismatch');
    }
    const generation = 1 + this.#snapshot.identities.filter((item) => item.payload.controllerId === input.controllerId && item.payload.tenantId === input.tenantId && item.payload.serviceId === input.serviceId).reduce((maximum, item) => Math.max(maximum, item.payload.generation), 0);
    const material = {
      version: '33.20' as const,
      identityId: `enterprise-identity-${randomUUID()}`,
      generation,
      controllerId: input.controllerId,
      tenantId: nonEmpty(input.tenantId, 'tenant_id_required'),
      serviceId: nonEmpty(input.serviceId, 'service_id_required'),
      trustDomain: input.trustDomain,
      workloadUri,
      certificateFingerprint256: fingerprint,
      certificateSerialNumber: nonEmpty(certificate.serialNumber, 'certificate_serial_required').toLowerCase(),
      certificateSubject: nonEmpty(certificate.subject, 'certificate_subject_required'),
      issuedAt: now.toISOString(),
      notBefore: notBefore.toISOString(),
      expiresAt: expiresAt.toISOString(),
      ...(prior === undefined ? {} : { previousIdentityId: prior.payload.identityId }),
      status: 'ACTIVE' as const,
      identityProvider: 'LOCAL_ENTERPRISE_PKI_REFERENCE' as const,
      spiffeSpireQualification: 'EXTERNAL_QUALIFICATION_REQUIRED' as const,
      authorityExpanded: false as const,
      productionAuthority: 'NONE' as const,
      externalEffectsExecuted: 0 as const,
    };
    const identity = signEnvelope({ ...material, identityDigest: sha256(material) }, this.#issuerIdentity);
    let identities = [...this.#snapshot.identities];
    if (prior !== undefined) identities = identities.map((item) => item.payload.identityId === prior.payload.identityId ? this.#revokeEnvelope(item, 'ROTATED', now) : item);
    identities.push(identity);
    this.#snapshot = createIdentitySnapshot(identities.sort(byIdentity), now);
    this.#persist(now);
    return structuredClone(identity);
  }

  revoke(input: { readonly identityId: string; readonly reason: 'ADMIN_REVOKED' | 'COMPROMISED'; readonly now?: Date }): SignedEnvelope<EnterpriseWorkloadIdentityV33_20> {
    const now = input.now ?? new Date();
    const current = this.#find(input.identityId);
    if (current.payload.status === 'REVOKED') return structuredClone(current);
    const revoked = this.#revokeEnvelope(current, input.reason, now);
    this.#snapshot = createIdentitySnapshot(this.#snapshot.identities.map((item) => item.payload.identityId === input.identityId ? revoked : item), now);
    this.#persist(now);
    return structuredClone(revoked);
  }

  snapshot(): EnterpriseIdentitySnapshotV33_20 { return structuredClone(this.#snapshot); }

  #find(identityId: string): SignedEnvelope<EnterpriseWorkloadIdentityV33_20> {
    const found = this.#snapshot.identities.find((item) => item.payload.identityId === identityId);
    if (found === undefined) throw new Error('enterprise_identity_not_found');
    return found;
  }

  #revokeEnvelope(current: SignedEnvelope<EnterpriseWorkloadIdentityV33_20>, reason: NonNullable<EnterpriseWorkloadIdentityV33_20['revocationReason']>, now: Date): SignedEnvelope<EnterpriseWorkloadIdentityV33_20> {
    const { identityDigest: _digest, ...prior } = current.payload;
    const material = { ...prior, status: 'REVOKED' as const, revokedAt: now.toISOString(), revocationReason: reason };
    return signEnvelope({ ...material, identityDigest: sha256(material) }, this.#issuerIdentity);
  }

  #persist(now: Date): void {
    this.#snapshot = createIdentitySnapshot(this.#snapshot.identities, now);
    atomicReplace(this.#path, `${JSON.stringify(signEnvelope(this.#snapshot, this.#storeIdentity), null, 2)}\n`);
  }
}

export class EnterpriseIdentityVerifierV33_20 {
  readonly #path: string;
  readonly #trust: EnterpriseIdentityTrustV33_20;
  #snapshot: EnterpriseIdentitySnapshotV33_20;

  constructor(input: { readonly path: string; readonly trust: EnterpriseIdentityTrustV33_20 }) {
    this.#path = resolve(input.path);
    this.#trust = input.trust;
    this.#snapshot = readIdentitySnapshot(this.#path, this.#trust);
  }

  resolve(input: { readonly certificateFingerprint256: string; readonly certificate: X509Certificate; readonly controllerId: string; readonly tenantId: string; readonly serviceId: string; readonly now?: Date }): SignedEnvelope<EnterpriseWorkloadIdentityV33_20> {
    const now = input.now ?? new Date();
    this.#snapshot = readIdentitySnapshot(this.#path, this.#trust);
    const fingerprint = normalizeFingerprint(input.certificateFingerprint256);
    const candidates = this.#snapshot.identities.filter((item) => item.payload.certificateFingerprint256 === fingerprint);
    if (candidates.length === 0) throw new Error('enterprise_identity_not_registered');
    const identity = candidates.sort((a, b) => b.payload.generation - a.payload.generation)[0]!;
    if (identity.payload.status !== 'ACTIVE') throw new Error('enterprise_identity_revoked');
    if (identity.payload.controllerId !== input.controllerId || identity.payload.tenantId !== input.tenantId || identity.payload.serviceId !== input.serviceId) throw new Error('enterprise_identity_binding_mismatch');
    if (!certificateHasUri(input.certificate, identity.payload.workloadUri)) throw new Error('enterprise_identity_uri_san_mismatch');
    if (now < new Date(identity.payload.notBefore) || now >= new Date(identity.payload.expiresAt)) throw new Error('enterprise_identity_expired');
    return structuredClone(identity);
  }
}

export class SqliteMonotonicWitnessV33_20 {
  readonly #db: DatabaseSync;
  readonly #witnessId: string;
  readonly #identity: SigningIdentity;
  readonly #registry: KeyRegistry;
  readonly #trustedSignerIds: readonly string[];

  constructor(input: { readonly path: string; readonly witnessId: string; readonly identity: SigningIdentity; readonly registry: KeyRegistry; readonly trustedSignerIds: readonly string[] }) {
    mkdirSync(dirname(resolve(input.path)), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(resolve(input.path));
    this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS witness (lease_key TEXT PRIMARY KEY, fence_token INTEGER NOT NULL, envelope_json TEXT NOT NULL);');
    this.#witnessId = nonEmpty(input.witnessId, 'witness_id_required');
    this.#identity = input.identity;
    this.#registry = input.registry;
    this.#trustedSignerIds = unique(input.trustedSignerIds, 'duplicate_witness_signer');
    if (!this.#trustedSignerIds.includes(input.identity.keyId)) throw new Error('witness_signer_untrusted');
  }

  close(): void { this.#db.close(); }

  highest(leaseKey: string): number {
    const row = this.#db.prepare('SELECT fence_token FROM witness WHERE lease_key = ?').get(leaseKey) as { fence_token: number } | undefined;
    return row?.fence_token ?? 0;
  }

  maximumFence(): number {
    const row = this.#db.prepare('SELECT COALESCE(MAX(fence_token), 0) AS maximum FROM witness').get() as { maximum: number };
    return row.maximum;
  }

  advance(input: { readonly authorityId: string; readonly leaseKey: string; readonly fenceToken: number; readonly now: Date }): SignedEnvelope<DurableWitnessReceiptV33_20> {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.#db.prepare('SELECT fence_token, envelope_json FROM witness WHERE lease_key = ?').get(input.leaseKey) as { fence_token: number; envelope_json: string } | undefined;
      const current = row === undefined ? undefined : JSON.parse(row.envelope_json) as SignedEnvelope<DurableWitnessReceiptV33_20>;
      const currentFence = row?.fence_token ?? 0;
      if (input.fenceToken <= currentFence) {
        if (input.fenceToken === currentFence && current !== undefined) { this.#db.exec('COMMIT'); return structuredClone(current); }
        throw new Error('durable_witness_fence_not_monotonic');
      }
      const material = {
        version: '33.20' as const,
        witnessId: this.#witnessId,
        authorityId: input.authorityId,
        leaseKey: input.leaseKey,
        fenceToken: input.fenceToken,
        previousReceiptDigest: current?.payload.receiptDigest ?? sha256('durable-witness-genesis-v33.20'),
        observedAt: input.now.toISOString(),
        storage: 'SEPARATE_SQLITE_WAL_REFERENCE' as const,
        productionAuthority: 'NONE' as const,
        externalEffectsExecuted: 0 as const,
      };
      const receipt = signEnvelope({ ...material, receiptDigest: sha256(material) }, this.#identity);
      this.#db.prepare('INSERT INTO witness(lease_key,fence_token,envelope_json) VALUES(?,?,?) ON CONFLICT(lease_key) DO UPDATE SET fence_token=excluded.fence_token,envelope_json=excluded.envelope_json').run(input.leaseKey, input.fenceToken, JSON.stringify(receipt));
      this.#db.exec('COMMIT');
      return structuredClone(receipt);
    } catch (error) { try { this.#db.exec('ROLLBACK'); } catch { /* preserve original */ } throw error; }
  }

  receipts(): readonly SignedEnvelope<DurableWitnessReceiptV33_20>[] {
    const rows = this.#db.prepare('SELECT envelope_json FROM witness ORDER BY lease_key').all() as unknown as { envelope_json: string }[];
    return rows.map((row) => JSON.parse(row.envelope_json) as SignedEnvelope<DurableWitnessReceiptV33_20>);
  }

  verifyReceipt(envelope: SignedEnvelope<DurableWitnessReceiptV33_20>): boolean {
    if (!this.#trustedSignerIds.includes(envelope.issuerKeyId) || !this.#registry.verifyAt(envelope, envelope.payload.observedAt)) return false;
    const { receiptDigest, ...material } = envelope.payload;
    return envelope.payload.version === '33.20' && envelope.payload.witnessId === this.#witnessId && envelope.payload.storage === 'SEPARATE_SQLITE_WAL_REFERENCE' && envelope.payload.productionAuthority === 'NONE' && envelope.payload.externalEffectsExecuted === 0 && sha256(material) === receiptDigest;
  }
}

export class SqliteDurableLeaseAuthorityV33_20 {
  readonly #db: DatabaseSync;
  readonly #authorityId: string;
  readonly #authorityIdentity: SigningIdentity;
  readonly #trust: DurableAuthorityTrustV33_20;
  readonly #witness: SqliteMonotonicWitnessV33_20;

  constructor(input: { readonly path: string; readonly authorityId: string; readonly authorityIdentity: SigningIdentity; readonly trust: DurableAuthorityTrustV33_20; readonly witness: SqliteMonotonicWitnessV33_20; readonly now?: Date }) {
    mkdirSync(dirname(resolve(input.path)), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(resolve(input.path));
    this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS metadata(authority_id TEXT PRIMARY KEY, authority_epoch INTEGER NOT NULL, fence_counter INTEGER NOT NULL, last_observed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS leases(lease_key TEXT PRIMARY KEY, grant_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS decisions(command_id TEXT PRIMARY KEY, command_digest TEXT NOT NULL, envelope_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox(sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL, event_digest TEXT NOT NULL, envelope_json TEXT NOT NULL, acknowledged_at TEXT, acknowledged_by TEXT);
    `);
    this.#authorityId = nonEmpty(input.authorityId, 'authority_id_required');
    this.#authorityIdentity = input.authorityIdentity;
    this.#trust = input.trust;
    this.#witness = input.witness;
    if (!input.trust.trustedAuthoritySignerIds.includes(input.authorityIdentity.keyId)) throw new Error('authority_signer_untrusted');
    const now = input.now ?? new Date();
    this.#db.prepare('INSERT OR IGNORE INTO metadata(authority_id,authority_epoch,fence_counter,last_observed_at) VALUES(?,1,0,?)').run(this.#authorityId, now.toISOString());
    this.#assertWitnessFloor();
  }

  close(): void { this.#db.close(); }

  processCommand(envelope: SignedEnvelope<DistributedLeaseCommandV33_18>, now = new Date()): SignedEnvelope<DistributedLeaseDecisionV33_18> {
    verifyCommand(envelope, this.#authorityId, this.#trust, now);
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const meta = this.#metadata();
      if (now.getTime() < Date.parse(meta.last_observed_at)) throw new Error('durable_authority_clock_rollback');
      if (meta.fence_counter < this.#witness.maximumFence()) throw new Error('durable_authority_rollback_detected');
      const prior = this.#db.prepare('SELECT command_digest,envelope_json FROM decisions WHERE command_id=?').get(envelope.payload.commandId) as { command_digest: string; envelope_json: string } | undefined;
      if (prior !== undefined) {
        if (prior.command_digest !== envelope.payload.commandDigest) throw new Error('durable_command_id_conflict');
        this.#db.exec('COMMIT');
        return JSON.parse(prior.envelope_json) as SignedEnvelope<DistributedLeaseDecisionV33_18>;
      }
      const key = leaseKey(envelope.payload.tenantId, envelope.payload.serviceId);
      const active = this.#lease(key);
      let decision: SignedEnvelope<DistributedLeaseDecisionV33_18>;
      if (envelope.payload.operation === 'ACQUIRE') {
        const activeNow = active !== undefined && Date.parse(active.expiresAt) > now.getTime();
        if (activeNow) decision = this.#decision(envelope.payload, false, active!.controllerId === envelope.payload.controllerId ? 'LEASE_ALREADY_HELD' : 'LEASE_BUSY', active!.fenceToken, now);
        else {
          const nextFence = Math.max(meta.fence_counter, this.#witness.highest(key)) + 1;
          const witness = this.#witness.advance({ authorityId: this.#authorityId, leaseKey: key, fenceToken: nextFence, now });
          const grant = createGrant(envelope.payload, nextFence, meta.authority_epoch, witness.payload.receiptDigest, now);
          decision = this.#decision(envelope.payload, true, 'LEASE_GRANTED', nextFence, now, grant);
          this.#db.prepare('INSERT INTO leases(lease_key,grant_json) VALUES(?,?) ON CONFLICT(lease_key) DO UPDATE SET grant_json=excluded.grant_json').run(key, JSON.stringify(grant));
          this.#db.prepare('UPDATE metadata SET fence_counter=?,last_observed_at=? WHERE authority_id=?').run(nextFence, now.toISOString(), this.#authorityId);
          this.#appendOutbox(active === undefined ? 'LEASE_GRANTED' : 'LEASE_TAKEOVER', decision.payload, now);
          if (active !== undefined) this.#appendFallback(active, decision.payload, now);
        }
      } else if (envelope.payload.operation === 'RENEW') {
        if (active === undefined) decision = this.#decision(envelope.payload, false, 'LEASE_NOT_FOUND', meta.fence_counter, now);
        else if (Date.parse(active.expiresAt) <= now.getTime()) decision = this.#decision(envelope.payload, false, 'LEASE_EXPIRED', active.fenceToken, now);
        else if (!matchesExpected(envelope.payload, active)) decision = this.#decision(envelope.payload, false, 'STALE_FENCE', active.fenceToken, now);
        else {
          const grant = renewGrant(active, envelope.payload, now);
          decision = this.#decision(envelope.payload, true, 'LEASE_RENEWED', grant.fenceToken, now, grant);
          this.#db.prepare('UPDATE leases SET grant_json=? WHERE lease_key=?').run(JSON.stringify(grant), key);
          this.#db.prepare('UPDATE metadata SET last_observed_at=? WHERE authority_id=?').run(now.toISOString(), this.#authorityId);
          this.#appendOutbox('LEASE_RENEWED', decision.payload, now);
        }
      } else {
        if (active === undefined) decision = this.#decision(envelope.payload, false, 'LEASE_NOT_FOUND', meta.fence_counter, now);
        else if (Date.parse(active.expiresAt) <= now.getTime()) decision = this.#decision(envelope.payload, false, 'LEASE_EXPIRED', active.fenceToken, now);
        else if (!matchesExpected(envelope.payload, active)) {
          decision = this.#decision(envelope.payload, false, 'STALE_FENCE', active.fenceToken, now);
          this.#appendOutbox('STALE_FENCE_REJECTED', decision.payload, now);
        } else decision = this.#decision(envelope.payload, true, 'FENCE_VALID', active.fenceToken, now, active);
        this.#db.prepare('UPDATE metadata SET last_observed_at=? WHERE authority_id=?').run(now.toISOString(), this.#authorityId);
      }
      this.#db.prepare('INSERT INTO decisions(command_id,command_digest,envelope_json) VALUES(?,?,?)').run(envelope.payload.commandId, envelope.payload.commandDigest, JSON.stringify(decision));
      this.#db.exec('COMMIT');
      return structuredClone(decision);
    } catch (error) { try { this.#db.exec('ROLLBACK'); } catch { /* preserve original */ } throw error; }
  }

  acknowledgeOutbox(envelope: SignedEnvelope<OutboxAcknowledgementV33_18>, now = new Date()): SignedEnvelope<DistributedLeaseOutboxRecordV33_18> {
    verifyAcknowledgement(envelope, this.#trust, now);
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.#db.prepare('SELECT event_digest,envelope_json,acknowledged_at,acknowledged_by FROM outbox WHERE event_id=?').get(envelope.payload.eventId) as { event_digest: string; envelope_json: string; acknowledged_at: string | null; acknowledged_by: string | null } | undefined;
      if (row === undefined) throw new Error('outbox_event_not_found');
      if (row.event_digest !== envelope.payload.eventDigest) throw new Error('outbox_ack_digest_mismatch');
      if (row.acknowledged_at !== null) {
        if (row.acknowledged_at !== envelope.payload.acknowledgedAt || row.acknowledged_by !== envelope.payload.deliveryWorkerId) throw new Error('outbox_ack_conflict');
        this.#db.exec('COMMIT');
        return JSON.parse(row.envelope_json) as SignedEnvelope<DistributedLeaseOutboxRecordV33_18>;
      }
      const current = JSON.parse(row.envelope_json) as SignedEnvelope<DistributedLeaseOutboxRecordV33_18>;
      const updated = signEnvelope({ ...current.payload, acknowledgedAt: envelope.payload.acknowledgedAt, acknowledgedBy: envelope.payload.deliveryWorkerId }, this.#authorityIdentity);
      this.#db.prepare('UPDATE outbox SET envelope_json=?,acknowledged_at=?,acknowledged_by=? WHERE event_id=?').run(JSON.stringify(updated), envelope.payload.acknowledgedAt, envelope.payload.deliveryWorkerId, envelope.payload.eventId);
      this.#db.exec('COMMIT');
      return structuredClone(updated);
    } catch (error) { try { this.#db.exec('ROLLBACK'); } catch { /* preserve original */ } throw error; }
  }

  snapshot(now = new Date()): DurableAuthoritySnapshotV33_20 {
    const meta = this.#metadata();
    const activeLeases = (this.#db.prepare('SELECT grant_json FROM leases ORDER BY lease_key').all() as unknown as { grant_json: string }[]).map((row) => JSON.parse(row.grant_json) as DistributedLeaseGrantV33_18);
    const decisions = (this.#db.prepare('SELECT envelope_json FROM decisions ORDER BY command_id').all() as unknown as { envelope_json: string }[]).map((row) => JSON.parse(row.envelope_json) as SignedEnvelope<DistributedLeaseDecisionV33_18>);
    const outbox = (this.#db.prepare('SELECT envelope_json FROM outbox ORDER BY sequence').all() as unknown as { envelope_json: string }[]).map((row) => JSON.parse(row.envelope_json) as SignedEnvelope<DistributedLeaseOutboxRecordV33_18>);
    const witnessReceipts = this.#witness.receipts();
    const material = { version: '33.20' as const, authorityId: this.#authorityId, backend: 'SQLITE_WAL' as const, authorityEpoch: meta.authority_epoch, fenceCounter: meta.fence_counter, activeLeases, decisions, outbox, witnessReceipts, lastObservedAt: meta.last_observed_at, generatedAt: now.toISOString(), productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const };
    return { ...material, snapshotDigest: sha256(material) };
  }

  verifyIntegrity(now = new Date()): boolean {
    try {
      const snapshot = this.snapshot(now);
      const { snapshotDigest, ...material } = snapshot;
      if (sha256(material) !== snapshotDigest || snapshot.fenceCounter < this.#witness.maximumFence()) return false;
      for (const receipt of snapshot.witnessReceipts) if (!this.#witness.verifyReceipt(receipt)) return false;
      for (const lease of snapshot.activeLeases) {
        const witness = snapshot.witnessReceipts.find((item) => item.payload.leaseKey === leaseKey(lease.tenantId, lease.serviceId));
        if (witness === undefined || witness.payload.fenceToken !== lease.fenceToken || witness.payload.receiptDigest !== lease.witnessReceiptDigest) return false;
        const { leaseDigest, ...leaseMaterial } = lease;
        if (sha256(leaseMaterial) !== leaseDigest) return false;
      }
      for (const decision of snapshot.decisions) if (!this.#verifyDecision(decision)) return false;
      let prior = sha256('distributed-lease-outbox-genesis-v33.18');
      for (const event of snapshot.outbox) {
        if (!this.#trust.trustedAuthoritySignerIds.includes(event.issuerKeyId) || !this.#trust.authorityRegistry.verifyAt(event, event.payload.createdAt)) return false;
        if (event.payload.previousEventDigest !== prior) return false;
        const { eventDigest, acknowledgedAt: _ackAt, acknowledgedBy: _ackBy, ...eventMaterial } = event.payload;
        if (sha256(eventMaterial) !== eventDigest) return false;
        prior = eventDigest;
      }
      return true;
    } catch { return false; }
  }

  #metadata(): { authority_epoch: number; fence_counter: number; last_observed_at: string } {
    const row = this.#db.prepare('SELECT authority_epoch,fence_counter,last_observed_at FROM metadata WHERE authority_id=?').get(this.#authorityId) as { authority_epoch: number; fence_counter: number; last_observed_at: string } | undefined;
    if (row === undefined) throw new Error('durable_authority_metadata_missing');
    return row;
  }

  #lease(key: string): DistributedLeaseGrantV33_18 | undefined {
    const row = this.#db.prepare('SELECT grant_json FROM leases WHERE lease_key=?').get(key) as { grant_json: string } | undefined;
    return row === undefined ? undefined : JSON.parse(row.grant_json) as DistributedLeaseGrantV33_18;
  }

  #decision(command: DistributedLeaseCommandV33_18, accepted: boolean, reason: DistributedLeaseDecisionV33_18['reason'], currentFenceToken: number, now: Date, grant?: DistributedLeaseGrantV33_18): SignedEnvelope<DistributedLeaseDecisionV33_18> {
    const material = { version: '33.18' as const, decisionId: `durable-decision-${randomUUID()}`, commandId: command.commandId, commandDigest: command.commandDigest, authorityId: this.#authorityId, tenantId: command.tenantId, serviceId: command.serviceId, controllerId: command.controllerId, operation: command.operation, accepted, reason, currentFenceToken, ...(grant === undefined ? {} : { grant }), decidedAt: now.toISOString(), fallbackRoute: 'FULL_GOVERNED_WORKFLOW' as const, authorityExpanded: false as const, externalEffectsExecuted: 0 as const };
    return signEnvelope({ ...material, decisionDigest: sha256(material) }, this.#authorityIdentity);
  }

  #verifyDecision(envelope: SignedEnvelope<DistributedLeaseDecisionV33_18>): boolean {
    if (!this.#trust.trustedAuthoritySignerIds.includes(envelope.issuerKeyId) || !this.#trust.authorityRegistry.verifyAt(envelope, envelope.payload.decidedAt)) return false;
    const { decisionDigest, ...material } = envelope.payload;
    return envelope.payload.authorityId === this.#authorityId && envelope.payload.authorityExpanded === false && envelope.payload.externalEffectsExecuted === 0 && sha256(material) === decisionDigest;
  }

  #appendOutbox(eventType: DistributedLeaseOutboxRecordV33_18['eventType'], decision: DistributedLeaseDecisionV33_18, now: Date): void {
    const row = this.#db.prepare('SELECT sequence,event_digest FROM outbox ORDER BY sequence DESC LIMIT 1').get() as { sequence: number; event_digest: string } | undefined;
    const sequence = (row?.sequence ?? 0) + 1;
    const material = { version: '33.18' as const, eventId: `durable-outbox-${randomUUID()}`, sequence, eventType, authorityId: this.#authorityId, tenantId: decision.tenantId, serviceId: decision.serviceId, controllerId: decision.controllerId, fenceToken: decision.currentFenceToken, commandId: decision.commandId, decisionDigest: decision.decisionDigest, createdAt: now.toISOString(), previousEventDigest: row?.event_digest ?? sha256('distributed-lease-outbox-genesis-v33.18'), externalEffectsExecuted: 0 as const };
    const event = signEnvelope({ ...material, eventDigest: sha256(material) }, this.#authorityIdentity);
    this.#db.prepare('INSERT INTO outbox(event_id,event_digest,envelope_json) VALUES(?,?,?)').run(event.payload.eventId, event.payload.eventDigest, JSON.stringify(event));
  }

  #appendFallback(prior: DistributedLeaseGrantV33_18, replacement: DistributedLeaseDecisionV33_18, now: Date): void {
    const material = { version: '33.18' as const, decisionId: `durable-fallback-${randomUUID()}`, commandId: replacement.commandId, commandDigest: replacement.commandDigest, authorityId: this.#authorityId, tenantId: prior.tenantId, serviceId: prior.serviceId, controllerId: prior.controllerId, operation: 'ASSERT_FENCE' as const, accepted: false, reason: 'STALE_FENCE' as const, currentFenceToken: replacement.currentFenceToken, decidedAt: now.toISOString(), fallbackRoute: 'FULL_GOVERNED_WORKFLOW' as const, authorityExpanded: false as const, externalEffectsExecuted: 0 as const };
    this.#appendOutbox('FALLBACK_REQUIRED', { ...material, decisionDigest: sha256(material) }, now);
  }

  #assertWitnessFloor(): void {
    const meta = this.#metadata();
    if (meta.fence_counter < this.#witness.maximumFence()) throw new Error('durable_authority_rollback_detected');
  }
}

export function createEnterpriseDurableLeaseAuthorityServerV33_20(input: { readonly store: SqliteDurableLeaseAuthorityV33_20; readonly identityVerifier: EnterpriseIdentityVerifierV33_20; readonly tls: { readonly key: string | Buffer; readonly cert: string | Buffer; readonly ca: string | Buffer }; readonly now: () => Date; readonly maximumBodyBytes?: number }): HttpsServer {
  const maximumBodyBytes = input.maximumBodyBytes ?? 128 * 1024;
  return createHttpsServer({ key: input.tls.key, cert: input.tls.cert, ca: input.tls.ca, requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.3' }, (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/durable-lease/command') { response.writeHead(404).end(); return; }
    const socket = request.socket as TLSSocket;
    if (!socket.authorized) { response.writeHead(401).end(JSON.stringify({ error: 'mtls_client_unauthorized' })); return; }
    const peer = socket.getPeerCertificate(true);
    if (peer.raw === undefined || peer.raw.length === 0) { response.writeHead(401).end(JSON.stringify({ error: 'mtls_client_certificate_required' })); return; }
    const fingerprint = createHash('sha256').update(peer.raw).digest('hex');
    const certificate = new X509Certificate(peer.raw);
    const chunks: Buffer[] = [];
    let bytes = 0;
    let overflow = false;
    request.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > maximumBodyBytes) { overflow = true; request.destroy(new Error('request_too_large')); } else chunks.push(chunk); });
    request.on('error', () => { if (!response.headersSent) response.writeHead(overflow ? 413 : 400).end(); });
    request.on('end', () => {
      if (overflow) return;
      try {
        const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')) as SignedEnvelope<DistributedLeaseCommandV33_18>;
        const identity = input.identityVerifier.resolve({ certificateFingerprint256: fingerprint, certificate, controllerId: envelope.payload.controllerId, tenantId: envelope.payload.tenantId, serviceId: envelope.payload.serviceId, now: input.now() });
        const decision = input.store.processCommand(envelope, input.now());
        response.writeHead(decision.payload.accepted ? 200 : 409, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-v33-20-enterprise-identity-id': identity.payload.identityId, 'x-v33-20-backend': 'sqlite-wal', 'x-v33-20-production-authority': 'none' });
        response.end(JSON.stringify(decision));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'enterprise_durable_authority_error';
        const status = message.startsWith('enterprise_identity_') ? 403 : 400;
        response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(JSON.stringify({ error: message }));
      }
    });
  });
}

export async function sendEnterpriseDurableLeaseCommandV33_20(input: EnterpriseDurableLeaseClientOptionsV33_20): Promise<SignedEnvelope<DistributedLeaseDecisionV33_18>> {
  const endpoint = new URL(input.endpoint);
  if (endpoint.protocol !== 'https:' || endpoint.username !== '' || endpoint.password !== '' || endpoint.hash !== '' || endpoint.search !== '') throw new Error('enterprise_durable_endpoint_invalid');
  const path = `${endpoint.pathname.replace(/\/$/, '')}/v1/durable-lease/command`.replace('//v1', '/v1');
  return await new Promise((resolvePromise, rejectPromise) => {
    const body = JSON.stringify(input.envelope);
    const request = httpsRequest({ protocol: 'https:', hostname: endpoint.hostname, port: endpoint.port, path, method: 'POST', ca: input.ca, cert: input.cert, key: input.key, servername: input.servername, minVersion: 'TLSv1.3', rejectUnauthorized: true, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode !== 200 && response.statusCode !== 409) {
          let message = `enterprise_durable_http_${response.statusCode ?? 0}`;
          try { const parsed = JSON.parse(responseBody) as { error?: string }; if (typeof parsed.error === 'string') message = parsed.error; } catch { /* preserve */ }
          rejectPromise(new Error(message)); return;
        }
        try { resolvePromise(JSON.parse(responseBody) as SignedEnvelope<DistributedLeaseDecisionV33_18>); }
        catch { rejectPromise(new Error('enterprise_durable_response_invalid')); }
      });
    });
    request.setTimeout(input.timeoutMs ?? 3000, () => request.destroy(new Error('enterprise_durable_timeout')));
    request.once('error', rejectPromise);
    request.end(body);
  });
}

export function renderSupervisordConfigurationV33_20(input: { readonly socketPath: string; readonly pidFile: string; readonly logFile: string; readonly programs: readonly { readonly name: string; readonly nodeExecutable: string; readonly daemonScript: string; readonly configPath: string; readonly stdoutLog: string; readonly stderrLog: string }[] }): string {
  if (input.programs.length < 2) throw new Error('supervisord_two_programs_required');
  const header = `[unix_http_server]\nfile=${input.socketPath}\nchmod=0700\n\n[supervisord]\nnodaemon=true\npidfile=${input.pidFile}\nlogfile=${input.logFile}\nchildlogdir=${dirname(input.logFile)}\n\n[rpcinterface:supervisor]\nsupervisor.rpcinterface_factory=supervisor.rpcinterface:make_main_rpcinterface\n\n[supervisorctl]\nserverurl=unix://${input.socketPath}\n`;
  const programs = input.programs.map((program) => `\n[program:${program.name}]\ncommand=${program.nodeExecutable} ${program.daemonScript}\nenvironment=V33_20_DAEMON_CONFIG=\"${program.configPath}\"\nautostart=true\nautorestart=true\nstartsecs=1\nstopasgroup=true\nkillasgroup=true\nstdout_logfile=${program.stdoutLog}\nstderr_logfile=${program.stderrLog}\n`).join('');
  return `${header}${programs}`;
}

export function probeExternalAuthorityInfrastructureV33_20(input: { readonly executables: Readonly<Record<string, string | undefined>>; readonly systemdActive: boolean; readonly netemUsable: boolean; readonly now?: Date }): readonly ExternalInfrastructureProbeV33_20[] {
  const now = input.now ?? new Date();
  const definitions: readonly { component: ExternalInfrastructureProbeV33_20['component']; executableKey: string; localReference?: boolean; active?: boolean }[] = [
    { component: 'SQLITE_WAL', executableKey: 'nodeSqlite', localReference: true, active: true },
    { component: 'POSTGRESQL', executableKey: 'postgres' },
    { component: 'ETCD', executableKey: 'etcd' },
    { component: 'CONSUL', executableKey: 'consul' },
    { component: 'SUPERVISORD', executableKey: 'supervisord', localReference: true },
    { component: 'SYSTEMD', executableKey: 'systemctl', active: input.systemdActive },
    { component: 'SPIFFE_SPIRE', executableKey: 'spire' },
    { component: 'NETEM', executableKey: 'tc', active: input.netemUsable },
  ];
  return definitions.map((definition) => {
    const executable = input.executables[definition.executableKey];
    const localQualified = definition.localReference === true && executable !== undefined && definition.active !== false;
    const status = localQualified ? 'LOCAL_REFERENCE_QUALIFIED' as const : executable === undefined || definition.active === false ? 'UNAVAILABLE_FAIL_CLOSED' as const : 'AVAILABLE_NOT_QUALIFIED' as const;
    const material = { version: '33.20' as const, component: definition.component, status, ...(executable === undefined ? {} : { executable }), qualification: localQualified ? 'LOCAL_REFERENCE_ONLY' as const : 'EXTERNAL_QUALIFICATION_REQUIRED' as const, productionAuthority: 'NONE' as const, probedAt: now.toISOString() };
    return { ...material, probeDigest: sha256(material) };
  });
}

function verifyCommand(envelope: SignedEnvelope<DistributedLeaseCommandV33_18>, authorityId: string, trust: DurableAuthorityTrustV33_20, now: Date): void {
  if (!trust.trustedControllerSignerIds.includes(envelope.issuerKeyId) || !trust.controllerRegistry.verifyAt(envelope, envelope.payload.requestedAt)) throw new Error('durable_command_signature_invalid');
  const { commandDigest, ...material } = envelope.payload;
  if (envelope.payload.version !== '33.18' || envelope.payload.authorityId !== authorityId || envelope.payload.authorityExpanded !== false || envelope.payload.externalEffectsExecuted !== 0 || sha256(material) !== commandDigest) throw new Error('durable_command_invalid');
  if (Date.parse(envelope.payload.requestedAt) > now.getTime() + 5000) throw new Error('durable_command_from_future');
  if ((envelope.payload.operation === 'ACQUIRE' || envelope.payload.operation === 'RENEW') && (envelope.payload.requestedTtlMs === undefined || envelope.payload.requestedTtlMs <= 0)) throw new Error('durable_requested_ttl_invalid');
  if (envelope.payload.operation !== 'ACQUIRE' && (envelope.payload.expectedFenceToken === undefined || envelope.payload.expectedLeaseDigest === undefined)) throw new Error('durable_expected_lease_required');
}

function verifyAcknowledgement(envelope: SignedEnvelope<OutboxAcknowledgementV33_18>, trust: DurableAuthorityTrustV33_20, now: Date): void {
  if (!trust.trustedDeliverySignerIds.includes(envelope.issuerKeyId) || !trust.deliveryRegistry.verifyAt(envelope, envelope.payload.acknowledgedAt)) throw new Error('outbox_ack_signature_invalid');
  const { acknowledgementDigest, ...material } = envelope.payload;
  if (envelope.payload.version !== '33.18' || envelope.payload.externalEffectsExecuted !== 0 || sha256(material) !== acknowledgementDigest || Date.parse(envelope.payload.acknowledgedAt) > now.getTime() + 5000) throw new Error('outbox_ack_invalid');
}

function createGrant(command: DistributedLeaseCommandV33_18, fenceToken: number, authorityEpoch: number, witnessReceiptDigest: string, now: Date): DistributedLeaseGrantV33_18 {
  const ttl = command.requestedTtlMs ?? 1;
  const material = { version: '33.18' as const, leaseId: `durable-lease-${randomUUID()}`, authorityId: command.authorityId, tenantId: command.tenantId, serviceId: command.serviceId, controllerId: command.controllerId, fenceToken, authorityEpoch, acquiredAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttl).toISOString(), witnessReceiptDigest, authorityExpanded: false as const, externalEffectsExecuted: 0 as const };
  return { ...material, leaseDigest: sha256(material) };
}

function renewGrant(active: DistributedLeaseGrantV33_18, command: DistributedLeaseCommandV33_18, now: Date): DistributedLeaseGrantV33_18 {
  const material = { version: '33.18' as const, leaseId: active.leaseId, authorityId: active.authorityId, tenantId: active.tenantId, serviceId: active.serviceId, controllerId: active.controllerId, fenceToken: active.fenceToken, authorityEpoch: active.authorityEpoch, acquiredAt: active.acquiredAt, expiresAt: new Date(now.getTime() + (command.requestedTtlMs ?? 1)).toISOString(), witnessReceiptDigest: active.witnessReceiptDigest, authorityExpanded: false as const, externalEffectsExecuted: 0 as const };
  return { ...material, leaseDigest: sha256(material) };
}

function matchesExpected(command: DistributedLeaseCommandV33_18, active: DistributedLeaseGrantV33_18): boolean { return command.controllerId === active.controllerId && command.expectedFenceToken === active.fenceToken && command.expectedLeaseDigest === active.leaseDigest; }
function leaseKey(tenantId: string, serviceId: string): string { return `${tenantId}\u0000${serviceId}`; }
function certificateHasUri(certificate: X509Certificate, uri: string): boolean { return (certificate.subjectAltName ?? '').split(',').map((part) => part.trim()).includes(`URI:${uri}`); }
function normalizeFingerprint(value: string): string { return value.replaceAll(':', '').toLowerCase(); }
function nonEmpty(value: string, error: string): string { if (value.trim() === '') throw new Error(error); return value; }
function unique(values: readonly string[], error: string): readonly string[] { if (new Set(values).size !== values.length) throw new Error(error); return [...values]; }
function byIdentity(a: SignedEnvelope<EnterpriseWorkloadIdentityV33_20>, b: SignedEnvelope<EnterpriseWorkloadIdentityV33_20>): number { return a.payload.identityId.localeCompare(b.payload.identityId); }

function createIdentitySnapshot(identities: readonly SignedEnvelope<EnterpriseWorkloadIdentityV33_20>[], now: Date): EnterpriseIdentitySnapshotV33_20 {
  const material = { version: '33.20' as const, identities: [...identities].sort(byIdentity), generatedAt: now.toISOString(), productionAuthority: 'NONE' as const, externalEffectsExecuted: 0 as const };
  return { ...material, snapshotDigest: sha256(material) };
}

function readIdentitySnapshot(path: string, trust: EnterpriseIdentityTrustV33_20): EnterpriseIdentitySnapshotV33_20 {
  let envelope: SignedEnvelope<EnterpriseIdentitySnapshotV33_20>;
  try { envelope = JSON.parse(readFileSync(path, 'utf8')) as SignedEnvelope<EnterpriseIdentitySnapshotV33_20>; }
  catch { throw new Error('enterprise_identity_store_parse_invalid'); }
  if (!trust.trustedStoreSignerIds.includes(envelope.issuerKeyId) || !trust.storeRegistry.verifyAt(envelope, envelope.payload.generatedAt)) throw new Error('enterprise_identity_store_signature_invalid');
  const { snapshotDigest, ...material } = envelope.payload;
  if (envelope.payload.version !== '33.20' || envelope.payload.productionAuthority !== 'NONE' || envelope.payload.externalEffectsExecuted !== 0 || sha256(material) !== snapshotDigest) throw new Error('enterprise_identity_store_digest_invalid');
  const fingerprints = new Set<string>();
  for (const identity of envelope.payload.identities) {
    if (!trust.trustedIssuerSignerIds.includes(identity.issuerKeyId) || !trust.issuerRegistry.verifyAt(identity, identity.payload.issuedAt)) throw new Error('enterprise_identity_signature_invalid');
    const { identityDigest, ...identityMaterial } = identity.payload;
    if (sha256(identityMaterial) !== identityDigest || identity.payload.productionAuthority !== 'NONE' || identity.payload.externalEffectsExecuted !== 0) throw new Error('enterprise_identity_digest_invalid');
    if (identity.payload.status === 'ACTIVE' && fingerprints.has(identity.payload.certificateFingerprint256)) throw new Error('enterprise_identity_duplicate_active_fingerprint');
    if (identity.payload.status === 'ACTIVE') fingerprints.add(identity.payload.certificateFingerprint256);
  }
  return structuredClone(envelope.payload);
}

function atomicReplace(path: string, contents: string): void {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, contents, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, path);
  try { const directory = openSync(dirname(path), 'r'); try { fsyncSync(directory); } finally { closeSync(directory); } } catch { /* best effort directory fsync */ }
}
