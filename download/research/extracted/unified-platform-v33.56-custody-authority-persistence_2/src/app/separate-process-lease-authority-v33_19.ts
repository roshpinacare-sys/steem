import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID, X509Certificate } from 'node:crypto';
import { request as httpsRequest, createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { dirname, resolve } from 'node:path';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { TLSSocket } from 'node:tls';
import {
  KeyRegistry,
  sha256,
  signEnvelope,
  type SignedEnvelope,
  type SigningIdentity,
} from '../contracts/crypto.js';
import {
  DistributedLeaseAuthorityStoreV33_18,
  type DistributedLeaseCommandV33_18,
  type DistributedLeaseDecisionV33_18,
} from './distributed-lease-authority-v33_18.js';

export type ExternalLeaseBackendKindV33_19 = 'POSTGRESQL' | 'ETCD' | 'CONSUL';
export type ServiceManagerKindV33_19 = 'SYSTEMD' | 'LOCAL_PROCESS_SUPERVISOR';

export interface ExternalBackendQualificationProbeV33_19 {
  readonly version: '33.19';
  readonly backend: ExternalLeaseBackendKindV33_19;
  readonly status: 'AVAILABLE_NOT_QUALIFIED' | 'UNAVAILABLE_FAIL_CLOSED';
  readonly executable?: string;
  readonly qualification: 'EXTERNAL_QUALIFICATION_REQUIRED';
  readonly productionAuthority: 'NONE';
  readonly probedAt: string;
  readonly probeDigest: string;
}

export interface ServiceManagerProbeV33_19 {
  readonly version: '33.19';
  readonly serviceManager: ServiceManagerKindV33_19;
  readonly status: 'LOCAL_REFERENCE_AVAILABLE' | 'AVAILABLE_NOT_QUALIFIED' | 'UNAVAILABLE_FAIL_CLOSED';
  readonly executable?: string;
  readonly managerActive: boolean;
  readonly qualification: 'EXTERNAL_QUALIFICATION_REQUIRED';
  readonly productionAuthority: 'NONE';
  readonly probedAt: string;
  readonly probeDigest: string;
}

export interface MutualTlsControllerCredentialV33_19 {
  readonly version: '33.19';
  readonly credentialId: string;
  readonly generation: number;
  readonly controllerId: string;
  readonly tenantId: string;
  readonly serviceId: string;
  readonly certificateFingerprint256: string;
  readonly certificateSerialNumber: string;
  readonly certificateSubject: string;
  readonly notBefore: string;
  readonly expiresAt: string;
  readonly issuedAt: string;
  readonly previousCredentialId?: string;
  readonly revokedAt?: string;
  readonly revocationReason?: 'ROTATED' | 'ADMIN_REVOKED' | 'COMPROMISED';
  readonly status: 'ACTIVE' | 'REVOKED';
  readonly transport: 'MTLS_TLS_1_3';
  readonly authorityExpanded: false;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly credentialDigest: string;
}

export interface MutualTlsCredentialSnapshotV33_19 {
  readonly version: '33.19';
  readonly credentials: readonly SignedEnvelope<MutualTlsControllerCredentialV33_19>[];
  readonly generatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly snapshotDigest: string;
}

export interface MutualTlsCredentialTrustV33_19 {
  readonly issuerRegistry: KeyRegistry;
  readonly trustedIssuerSignerIds: readonly string[];
  readonly storeRegistry: KeyRegistry;
  readonly trustedStoreSignerIds: readonly string[];
}

export interface LeaseAuthorityDaemonLifecycleReceiptV33_19 {
  readonly version: '33.19';
  readonly receiptId: string;
  readonly daemonId: string;
  readonly event: 'STARTED' | 'STOPPED' | 'CRASHED' | 'RESTARTED';
  readonly pid: number;
  readonly restartGeneration: number;
  readonly endpoint?: string;
  readonly serverCertificateFingerprint256?: string;
  readonly priorReceiptDigest: string;
  readonly observedAt: string;
  readonly serviceManager: 'LOCAL_PROCESS_SUPERVISOR_REFERENCE';
  readonly mtlsRequired: true;
  readonly authorityExpanded: false;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly receiptDigest: string;
}

export interface LocalSupervisorSnapshotV33_19 {
  readonly version: '33.19';
  readonly supervisorId: string;
  readonly daemonId: string;
  readonly restartGeneration: number;
  readonly receipts: readonly SignedEnvelope<LeaseAuthorityDaemonLifecycleReceiptV33_19>[];
  readonly generatedAt: string;
  readonly productionAuthority: 'NONE';
  readonly externalEffectsExecuted: 0;
  readonly snapshotDigest: string;
}

export interface MutualTlsLeaseClientOptionsV33_19 {
  readonly endpoint: string;
  readonly envelope: SignedEnvelope<DistributedLeaseCommandV33_18>;
  readonly ca: string | Buffer;
  readonly cert: string | Buffer;
  readonly key: string | Buffer;
  readonly servername: string;
  readonly timeoutMs?: number;
}

export class MutualTlsCredentialStoreV33_19 {
  readonly #path: string;
  readonly #issuerIdentity: SigningIdentity;
  readonly #storeIdentity: SigningIdentity;
  readonly #trust: MutualTlsCredentialTrustV33_19;
  #snapshot: MutualTlsCredentialSnapshotV33_19;

  constructor(input: {
    readonly path: string;
    readonly issuerIdentity: SigningIdentity;
    readonly storeIdentity: SigningIdentity;
    readonly trust: MutualTlsCredentialTrustV33_19;
    readonly now?: Date;
  }) {
    this.#path = resolve(nonEmpty(input.path, 'credential_store_path_required'));
    this.#issuerIdentity = input.issuerIdentity;
    this.#storeIdentity = input.storeIdentity;
    this.#trust = input.trust;
    if (input.issuerIdentity.keyId === input.storeIdentity.keyId) throw new Error('credential_role_separation_required');
    if (!input.trust.trustedIssuerSignerIds.includes(input.issuerIdentity.keyId)) throw new Error('credential_issuer_untrusted');
    if (!input.trust.trustedStoreSignerIds.includes(input.storeIdentity.keyId)) throw new Error('credential_store_signer_untrusted');
    mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 });
    this.#snapshot = existsSync(this.#path) ? readCredentialSnapshot(this.#path, input.trust) : createCredentialSnapshot([], input.now ?? new Date());
    if (!existsSync(this.#path)) this.#persist(input.now ?? new Date());
  }

  snapshot(): MutualTlsCredentialSnapshotV33_19 { return structuredClone(this.#snapshot); }

  issue(input: {
    readonly controllerId: string;
    readonly tenantId: string;
    readonly serviceId: string;
    readonly certificatePem: string | Buffer;
    readonly now?: Date;
    readonly previousCredentialId?: string;
  }): SignedEnvelope<MutualTlsControllerCredentialV33_19> {
    const now = input.now ?? new Date();
    const certificate = new X509Certificate(input.certificatePem);
    const fingerprint = normalizeFingerprint(certificate.fingerprint256);
    const serial = nonEmpty(certificate.serialNumber, 'certificate_serial_required').toLowerCase();
    const notBefore = new Date(certificate.validFrom);
    const expiresAt = new Date(certificate.validTo);
    if (!Number.isFinite(notBefore.getTime()) || !Number.isFinite(expiresAt.getTime()) || now < notBefore || now >= expiresAt) throw new Error('credential_certificate_not_current');
    const activeFingerprint = this.#snapshot.credentials.find((item) => item.payload.status === 'ACTIVE' && item.payload.certificateFingerprint256 === fingerprint);
    if (activeFingerprint !== undefined) {
      if (activeFingerprint.payload.controllerId === input.controllerId && activeFingerprint.payload.tenantId === input.tenantId && activeFingerprint.payload.serviceId === input.serviceId) return structuredClone(activeFingerprint);
      throw new Error('certificate_fingerprint_already_bound');
    }
    const prior = input.previousCredentialId === undefined ? undefined : this.#find(input.previousCredentialId);
    if (prior !== undefined) {
      if (prior.payload.status !== 'ACTIVE') throw new Error('previous_credential_not_active');
      if (prior.payload.controllerId !== input.controllerId || prior.payload.tenantId !== input.tenantId || prior.payload.serviceId !== input.serviceId) throw new Error('credential_rotation_binding_mismatch');
    }
    const generation = 1 + this.#snapshot.credentials
      .filter((item) => item.payload.controllerId === input.controllerId && item.payload.tenantId === input.tenantId && item.payload.serviceId === input.serviceId)
      .reduce((maximum, item) => Math.max(maximum, item.payload.generation), 0);
    const material = {
      version: '33.19' as const,
      credentialId: `mtls-credential-${randomUUID()}`,
      generation,
      controllerId: nonEmpty(input.controllerId, 'controller_id_required'),
      tenantId: nonEmpty(input.tenantId, 'tenant_id_required'),
      serviceId: nonEmpty(input.serviceId, 'service_id_required'),
      certificateFingerprint256: fingerprint,
      certificateSerialNumber: serial,
      certificateSubject: nonEmpty(certificate.subject, 'certificate_subject_required'),
      notBefore: notBefore.toISOString(),
      expiresAt: expiresAt.toISOString(),
      issuedAt: now.toISOString(),
      ...(prior === undefined ? {} : { previousCredentialId: prior.payload.credentialId }),
      status: 'ACTIVE' as const,
      transport: 'MTLS_TLS_1_3' as const,
      authorityExpanded: false as const,
      productionAuthority: 'NONE' as const,
      externalEffectsExecuted: 0 as const,
    };
    const credential = signEnvelope({ ...material, credentialDigest: sha256(material) }, this.#issuerIdentity);
    let credentials = [...this.#snapshot.credentials];
    if (prior !== undefined) credentials = credentials.map((item) => item.payload.credentialId === prior.payload.credentialId ? this.#revokeEnvelope(item, 'ROTATED', now) : item);
    credentials.push(credential);
    this.#snapshot = createCredentialSnapshot(credentials.sort(byCredential), now);
    this.#persist(now);
    return structuredClone(credential);
  }

  revoke(input: { readonly credentialId: string; readonly reason: 'ADMIN_REVOKED' | 'COMPROMISED'; readonly now?: Date }): SignedEnvelope<MutualTlsControllerCredentialV33_19> {
    const now = input.now ?? new Date();
    const current = this.#find(input.credentialId);
    if (current === undefined) throw new Error('credential_not_found');
    if (current.payload.status === 'REVOKED') return structuredClone(current);
    const revoked = this.#revokeEnvelope(current, input.reason, now);
    this.#snapshot = createCredentialSnapshot(this.#snapshot.credentials.map((item) => item.payload.credentialId === input.credentialId ? revoked : item), now);
    this.#persist(now);
    return structuredClone(revoked);
  }

  #find(credentialId: string): SignedEnvelope<MutualTlsControllerCredentialV33_19> | undefined {
    return this.#snapshot.credentials.find((item) => item.payload.credentialId === credentialId);
  }

  #revokeEnvelope(current: SignedEnvelope<MutualTlsControllerCredentialV33_19>, reason: 'ROTATED' | 'ADMIN_REVOKED' | 'COMPROMISED', now: Date): SignedEnvelope<MutualTlsControllerCredentialV33_19> {
    const { credentialDigest: _priorDigest, revokedAt: _priorRevokedAt, revocationReason: _priorReason, ...base } = current.payload;
    const material = { ...base, revokedAt: now.toISOString(), revocationReason: reason, status: 'REVOKED' as const };
    return signEnvelope({ ...material, credentialDigest: sha256(material) }, this.#issuerIdentity);
  }

  #persist(now: Date): void {
    this.#snapshot = createCredentialSnapshot(this.#snapshot.credentials, now);
    atomicReplace(this.#path, `${JSON.stringify(signEnvelope(this.#snapshot, this.#storeIdentity), null, 2)}\n`);
  }
}

export class MutualTlsCredentialVerifierV33_19 {
  readonly #path: string;
  readonly #trust: MutualTlsCredentialTrustV33_19;
  #snapshot: MutualTlsCredentialSnapshotV33_19 | undefined;

  constructor(input: { readonly path: string; readonly trust: MutualTlsCredentialTrustV33_19 }) {
    this.#path = resolve(nonEmpty(input.path, 'credential_store_path_required'));
    this.#trust = input.trust;
  }

  resolve(input: {
    readonly certificateFingerprint256: string;
    readonly controllerId: string;
    readonly tenantId: string;
    readonly serviceId: string;
    readonly now?: Date;
  }): SignedEnvelope<MutualTlsControllerCredentialV33_19> {
    const now = input.now ?? new Date();
    const snapshot = this.#load();
    const fingerprint = normalizeFingerprint(input.certificateFingerprint256);
    const candidates = snapshot.credentials.filter((item) => item.payload.certificateFingerprint256 === fingerprint);
    if (candidates.length === 0) throw new Error('mtls_credential_not_registered');
    const credential = candidates.sort((a, b) => b.payload.generation - a.payload.generation)[0]!;
    if (credential.payload.status !== 'ACTIVE') throw new Error('mtls_credential_revoked');
    if (credential.payload.controllerId !== input.controllerId || credential.payload.tenantId !== input.tenantId || credential.payload.serviceId !== input.serviceId) throw new Error('mtls_credential_binding_mismatch');
    if (now < new Date(credential.payload.notBefore) || now >= new Date(credential.payload.expiresAt)) throw new Error('mtls_credential_expired');
    return structuredClone(credential);
  }

  snapshot(): MutualTlsCredentialSnapshotV33_19 { return structuredClone(this.#load()); }

  #load(): MutualTlsCredentialSnapshotV33_19 {
    // Security-sensitive revocation is re-read for every decision. This avoids
    // stale-cache windows caused by filesystem timestamp granularity.
    this.#snapshot = readCredentialSnapshot(this.#path, this.#trust);
    return this.#snapshot;
  }
}

export function createMutualTlsLeaseAuthorityServerV33_19(input: {
  readonly store: DistributedLeaseAuthorityStoreV33_18;
  readonly credentialVerifier: MutualTlsCredentialVerifierV33_19;
  readonly tls: { readonly key: string | Buffer; readonly cert: string | Buffer; readonly ca: string | Buffer };
  readonly now: () => Date;
  readonly maximumBodyBytes?: number;
}): HttpsServer {
  const maximumBodyBytes = input.maximumBodyBytes ?? 128 * 1024;
  return createHttpsServer({
    key: input.tls.key,
    cert: input.tls.cert,
    ca: input.tls.ca,
    requestCert: true,
    rejectUnauthorized: true,
    minVersion: 'TLSv1.3',
  }, (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/distributed-lease/command') { response.writeHead(404).end(); return; }
    const socket = request.socket as TLSSocket;
    if (!socket.authorized) { response.writeHead(401).end(JSON.stringify({ error: 'mtls_client_unauthorized' })); return; }
    const peer = socket.getPeerCertificate(true);
    if (peer.raw === undefined || peer.raw.length === 0) { response.writeHead(401).end(JSON.stringify({ error: 'mtls_client_certificate_required' })); return; }
    const fingerprint = createHash('sha256').update(peer.raw).digest('hex');
    const chunks: Buffer[] = [];
    let bytes = 0;
    let overflow = false;
    request.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maximumBodyBytes) { overflow = true; request.destroy(new Error('request_too_large')); }
      else chunks.push(chunk);
    });
    request.on('error', () => { if (!response.headersSent) response.writeHead(overflow ? 413 : 400).end(); });
    request.on('end', () => {
      if (overflow) return;
      try {
        const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')) as SignedEnvelope<DistributedLeaseCommandV33_18>;
        const credential = input.credentialVerifier.resolve({
          certificateFingerprint256: fingerprint,
          controllerId: envelope.payload.controllerId,
          tenantId: envelope.payload.tenantId,
          serviceId: envelope.payload.serviceId,
          now: input.now(),
        });
        const decision = input.store.processCommand(envelope, input.now());
        response.writeHead(decision.payload.accepted ? 200 : 409, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          'x-v33-19-credential-id': credential.payload.credentialId,
          'x-v33-19-mtls': 'required',
        });
        response.end(JSON.stringify(decision));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'mtls_lease_authority_error';
        const status = message.startsWith('mtls_credential_') ? 403 : 400;
        response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(JSON.stringify({ error: message }));
      }
    });
  });
}

export async function sendMutualTlsLeaseCommandV33_19(input: MutualTlsLeaseClientOptionsV33_19): Promise<SignedEnvelope<DistributedLeaseDecisionV33_18>> {
  const endpoint = new URL(input.endpoint);
  if (endpoint.protocol !== 'https:' || endpoint.username !== '' || endpoint.password !== '' || endpoint.hash !== '' || endpoint.search !== '') throw new Error('mtls_endpoint_invalid');
  const path = `${endpoint.pathname.replace(/\/$/, '')}/v1/distributed-lease/command`.replace('//v1', '/v1');
  return await new Promise((resolvePromise, rejectPromise) => {
    const request = httpsRequest({
      protocol: 'https:',
      hostname: endpoint.hostname,
      port: endpoint.port,
      path,
      method: 'POST',
      ca: input.ca,
      cert: input.cert,
      key: input.key,
      servername: input.servername,
      minVersion: 'TLSv1.3',
      rejectUnauthorized: true,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(JSON.stringify(input.envelope)) },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode !== 200 && response.statusCode !== 409) {
          let error = `mtls_lease_authority_http_${response.statusCode ?? 0}`;
          try { const parsed = JSON.parse(body) as { error?: string }; if (typeof parsed.error === 'string') error = parsed.error; } catch { /* preserve transport error */ }
          rejectPromise(new Error(error));
          return;
        }
        try { resolvePromise(JSON.parse(body) as SignedEnvelope<DistributedLeaseDecisionV33_18>); }
        catch { rejectPromise(new Error('mtls_lease_authority_response_invalid')); }
      });
    });
    request.setTimeout(input.timeoutMs ?? 2500, () => request.destroy(new Error('mtls_lease_authority_unavailable_fail_closed')));
    request.on('error', rejectPromise);
    request.end(JSON.stringify(input.envelope));
  });
}

export class LocalLeaseAuthorityProcessSupervisorV33_19 {
  readonly #supervisorId: string;
  readonly #daemonId: string;
  readonly #statePath: string;
  readonly #identity: SigningIdentity;
  readonly #registry: KeyRegistry;
  readonly #trustedSignerIds: readonly string[];
  #snapshot: LocalSupervisorSnapshotV33_19;
  #child: ChildProcessByStdio<null, Readable, Readable> | undefined;

  constructor(input: {
    readonly supervisorId: string;
    readonly daemonId: string;
    readonly statePath: string;
    readonly identity: SigningIdentity;
    readonly registry: KeyRegistry;
    readonly trustedSignerIds: readonly string[];
    readonly now?: Date;
  }) {
    this.#supervisorId = nonEmpty(input.supervisorId, 'supervisor_id_required');
    this.#daemonId = nonEmpty(input.daemonId, 'daemon_id_required');
    this.#statePath = resolve(nonEmpty(input.statePath, 'supervisor_state_path_required'));
    this.#identity = input.identity;
    this.#registry = input.registry;
    this.#trustedSignerIds = unique(input.trustedSignerIds, 'duplicate_supervisor_signer');
    if (!this.#trustedSignerIds.includes(input.identity.keyId)) throw new Error('supervisor_signer_untrusted');
    mkdirSync(dirname(this.#statePath), { recursive: true, mode: 0o700 });
    this.#snapshot = existsSync(this.#statePath) ? this.#read() : createSupervisorSnapshot(this.#supervisorId, this.#daemonId, 0, [], input.now ?? new Date());
    if (!existsSync(this.#statePath)) this.#persist(input.now ?? new Date());
  }

  snapshot(): LocalSupervisorSnapshotV33_19 { return structuredClone(this.#snapshot); }

  async start(input: { readonly command: string; readonly args: readonly string[]; readonly cwd: string; readonly env?: Readonly<Record<string, string>>; readonly timeoutMs?: number; readonly now?: Date }): Promise<{ readonly endpoint: string; readonly pid: number; readonly restartGeneration: number }> {
    if (this.#child !== undefined && this.#child.exitCode === null) throw new Error('daemon_already_running');
    const generation = this.#snapshot.restartGeneration + 1;
    const child = spawn(input.command, [...input.args], {
      cwd: input.cwd,
      env: { ...process.env, ...(input.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
    this.#child = child;
    const ready = await waitForReadyLine(child, input.timeoutMs ?? 5000);
    if (typeof ready.endpoint !== 'string' || typeof ready.pid !== 'number') { child.kill('SIGKILL'); throw new Error('daemon_ready_payload_invalid'); }
    const receipt = this.#appendReceipt({
      event: generation === 1 ? 'STARTED' : 'RESTARTED',
      pid: ready.pid,
      restartGeneration: generation,
      endpoint: ready.endpoint,
      ...(typeof ready.serverCertificateFingerprint256 === 'string' ? { serverCertificateFingerprint256: ready.serverCertificateFingerprint256 } : {}),
      now: input.now ?? new Date(),
    });
    void receipt;
    return { endpoint: ready.endpoint, pid: ready.pid, restartGeneration: generation };
  }

  async stop(input?: { readonly signal?: NodeJS.Signals; readonly timeoutMs?: number; readonly now?: Date }): Promise<void> {
    const child = this.#child;
    if (child === undefined || child.exitCode !== null) return;
    const signal = input?.signal ?? 'SIGTERM';
    child.kill(signal);
    const result = await waitForExit(child, input?.timeoutMs ?? 3000);
    if (!result.exited) { child.kill('SIGKILL'); await waitForExit(child, 1000); }
    this.#appendReceipt({ event: signal === 'SIGKILL' ? 'CRASHED' : 'STOPPED', pid: child.pid ?? -1, restartGeneration: this.#snapshot.restartGeneration, now: input?.now ?? new Date() });
    this.#child = undefined;
  }

  async crash(now = new Date()): Promise<void> {
    const child = this.#child;
    if (child === undefined || child.exitCode !== null) throw new Error('daemon_not_running');
    child.kill('SIGKILL');
    await waitForExit(child, 1500);
    this.#appendReceipt({ event: 'CRASHED', pid: child.pid ?? -1, restartGeneration: this.#snapshot.restartGeneration, now });
    this.#child = undefined;
  }

  verify(): boolean {
    try {
      verifySupervisorSnapshot(this.#snapshot, this.#supervisorId, this.#daemonId, this.#registry, this.#trustedSignerIds);
      return true;
    } catch { return false; }
  }

  #appendReceipt(input: {
    readonly event: LeaseAuthorityDaemonLifecycleReceiptV33_19['event'];
    readonly pid: number;
    readonly restartGeneration: number;
    readonly endpoint?: string;
    readonly serverCertificateFingerprint256?: string;
    readonly now: Date;
  }): SignedEnvelope<LeaseAuthorityDaemonLifecycleReceiptV33_19> {
    const priorReceiptDigest = this.#snapshot.receipts.at(-1)?.payload.receiptDigest ?? sha256('lease-authority-daemon-lifecycle-genesis-v33.19');
    const material = {
      version: '33.19' as const,
      receiptId: `daemon-lifecycle-${randomUUID()}`,
      daemonId: this.#daemonId,
      event: input.event,
      pid: input.pid,
      restartGeneration: input.restartGeneration,
      ...(input.endpoint === undefined ? {} : { endpoint: input.endpoint }),
      ...(input.serverCertificateFingerprint256 === undefined ? {} : { serverCertificateFingerprint256: normalizeFingerprint(input.serverCertificateFingerprint256) }),
      priorReceiptDigest,
      observedAt: input.now.toISOString(),
      serviceManager: 'LOCAL_PROCESS_SUPERVISOR_REFERENCE' as const,
      mtlsRequired: true as const,
      authorityExpanded: false as const,
      productionAuthority: 'NONE' as const,
      externalEffectsExecuted: 0 as const,
    };
    const receipt = signEnvelope({ ...material, receiptDigest: sha256(material) }, this.#identity);
    const generation = Math.max(this.#snapshot.restartGeneration, input.restartGeneration);
    this.#snapshot = createSupervisorSnapshot(this.#supervisorId, this.#daemonId, generation, [...this.#snapshot.receipts, receipt], input.now);
    this.#persist(input.now);
    return receipt;
  }

  #read(): LocalSupervisorSnapshotV33_19 {
    let envelope: SignedEnvelope<LocalSupervisorSnapshotV33_19>;
    try { envelope = JSON.parse(readFileSync(this.#statePath, 'utf8')) as SignedEnvelope<LocalSupervisorSnapshotV33_19>; }
    catch { throw new Error('supervisor_store_parse_invalid'); }
    if (!this.#trustedSignerIds.includes(envelope.issuerKeyId) || !this.#registry.verifyAt(envelope, envelope.payload.generatedAt)) throw new Error('supervisor_store_signature_invalid');
    verifySupervisorSnapshot(envelope.payload, this.#supervisorId, this.#daemonId, this.#registry, this.#trustedSignerIds);
    return structuredClone(envelope.payload);
  }

  #persist(now: Date): void {
    this.#snapshot = createSupervisorSnapshot(this.#supervisorId, this.#daemonId, this.#snapshot.restartGeneration, this.#snapshot.receipts, now);
    atomicReplace(this.#statePath, `${JSON.stringify(signEnvelope(this.#snapshot, this.#identity), null, 2)}\n`);
  }
}

export function probeExternalLeaseBackendsAndServiceManagersV33_19(input: {
  readonly executables: Readonly<Partial<Record<ExternalLeaseBackendKindV33_19 | 'SYSTEMD', string>>>;
  readonly systemdActive?: boolean;
  readonly now?: Date;
}): { readonly backends: readonly ExternalBackendQualificationProbeV33_19[]; readonly serviceManagers: readonly ServiceManagerProbeV33_19[] } {
  const now = input.now ?? new Date();
  const backends = (['POSTGRESQL', 'ETCD', 'CONSUL'] as const).map((backend) => {
    const executable = input.executables[backend];
    const material = {
      version: '33.19' as const,
      backend,
      status: executable === undefined ? 'UNAVAILABLE_FAIL_CLOSED' as const : 'AVAILABLE_NOT_QUALIFIED' as const,
      ...(executable === undefined ? {} : { executable }),
      qualification: 'EXTERNAL_QUALIFICATION_REQUIRED' as const,
      productionAuthority: 'NONE' as const,
      probedAt: now.toISOString(),
    };
    return { ...material, probeDigest: sha256(material) };
  });
  const systemdExecutable = input.executables.SYSTEMD;
  const systemdMaterial = {
    version: '33.19' as const,
    serviceManager: 'SYSTEMD' as const,
    status: systemdExecutable === undefined || input.systemdActive !== true ? 'UNAVAILABLE_FAIL_CLOSED' as const : 'AVAILABLE_NOT_QUALIFIED' as const,
    ...(systemdExecutable === undefined ? {} : { executable: systemdExecutable }),
    managerActive: input.systemdActive === true,
    qualification: 'EXTERNAL_QUALIFICATION_REQUIRED' as const,
    productionAuthority: 'NONE' as const,
    probedAt: now.toISOString(),
  };
  const localMaterial = {
    version: '33.19' as const,
    serviceManager: 'LOCAL_PROCESS_SUPERVISOR' as const,
    status: 'LOCAL_REFERENCE_AVAILABLE' as const,
    managerActive: true,
    qualification: 'EXTERNAL_QUALIFICATION_REQUIRED' as const,
    productionAuthority: 'NONE' as const,
    probedAt: now.toISOString(),
  };
  return {
    backends,
    serviceManagers: [
      { ...systemdMaterial, probeDigest: sha256(systemdMaterial) },
      { ...localMaterial, probeDigest: sha256(localMaterial) },
    ],
  };
}

function readCredentialSnapshot(path: string, trust: MutualTlsCredentialTrustV33_19): MutualTlsCredentialSnapshotV33_19 {
  let envelope: SignedEnvelope<MutualTlsCredentialSnapshotV33_19>;
  try { envelope = JSON.parse(readFileSync(path, 'utf8')) as SignedEnvelope<MutualTlsCredentialSnapshotV33_19>; }
  catch { throw new Error('credential_store_parse_invalid'); }
  if (!trust.trustedStoreSignerIds.includes(envelope.issuerKeyId) || !trust.storeRegistry.verifyAt(envelope, envelope.payload.generatedAt)) throw new Error('credential_store_signature_invalid');
  verifyCredentialSnapshot(envelope.payload, trust);
  return structuredClone(envelope.payload);
}

function verifyCredentialSnapshot(snapshot: MutualTlsCredentialSnapshotV33_19, trust: MutualTlsCredentialTrustV33_19): void {
  const { snapshotDigest, ...material } = snapshot;
  if (snapshot.version !== '33.19' || snapshot.productionAuthority !== 'NONE' || snapshot.externalEffectsExecuted !== 0 || sha256(material) !== snapshotDigest) throw new Error('credential_snapshot_invalid');
  const ids = new Set<string>();
  const activeFingerprints = new Set<string>();
  const maximumGeneration = new Map<string, number>();
  for (const envelope of snapshot.credentials) {
    if (!trust.trustedIssuerSignerIds.includes(envelope.issuerKeyId) || !trust.issuerRegistry.verifyAt(envelope, envelope.payload.issuedAt)) throw new Error('credential_signature_invalid');
    verifyCredential(envelope.payload);
    if (ids.has(envelope.payload.credentialId)) throw new Error('duplicate_credential_id');
    ids.add(envelope.payload.credentialId);
    const binding = `${envelope.payload.tenantId}\0${envelope.payload.serviceId}\0${envelope.payload.controllerId}`;
    const priorGeneration = maximumGeneration.get(binding) ?? 0;
    if (envelope.payload.generation <= priorGeneration) throw new Error('credential_generation_not_monotonic');
    maximumGeneration.set(binding, envelope.payload.generation);
    if (envelope.payload.status === 'ACTIVE') {
      if (activeFingerprints.has(envelope.payload.certificateFingerprint256)) throw new Error('duplicate_active_certificate_fingerprint');
      activeFingerprints.add(envelope.payload.certificateFingerprint256);
    }
  }
}

function verifyCredential(credential: MutualTlsControllerCredentialV33_19): void {
  const { credentialDigest, ...material } = credential;
  if (credential.version !== '33.19' || credential.transport !== 'MTLS_TLS_1_3' || credential.authorityExpanded !== false || credential.productionAuthority !== 'NONE' || credential.externalEffectsExecuted !== 0 || sha256(material) !== credentialDigest) throw new Error('credential_invalid');
  if (!/^[0-9a-f]{64}$/.test(credential.certificateFingerprint256)) throw new Error('credential_fingerprint_invalid');
  if (credential.status === 'ACTIVE' && (credential.revokedAt !== undefined || credential.revocationReason !== undefined)) throw new Error('active_credential_revocation_fields_present');
  if (credential.status === 'REVOKED' && (credential.revokedAt === undefined || credential.revocationReason === undefined)) throw new Error('revoked_credential_fields_missing');
}

function createCredentialSnapshot(credentials: readonly SignedEnvelope<MutualTlsControllerCredentialV33_19>[], now: Date): MutualTlsCredentialSnapshotV33_19 {
  const material = {
    version: '33.19' as const,
    credentials: [...credentials].sort(byCredential),
    generatedAt: now.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return { ...material, snapshotDigest: sha256(material) };
}

function createSupervisorSnapshot(supervisorId: string, daemonId: string, restartGeneration: number, receipts: readonly SignedEnvelope<LeaseAuthorityDaemonLifecycleReceiptV33_19>[], now: Date): LocalSupervisorSnapshotV33_19 {
  const material = {
    version: '33.19' as const,
    supervisorId,
    daemonId,
    restartGeneration,
    receipts: [...receipts],
    generatedAt: now.toISOString(),
    productionAuthority: 'NONE' as const,
    externalEffectsExecuted: 0 as const,
  };
  return { ...material, snapshotDigest: sha256(material) };
}

function verifySupervisorSnapshot(snapshot: LocalSupervisorSnapshotV33_19, supervisorId: string, daemonId: string, registry: KeyRegistry, trustedSignerIds: readonly string[]): void {
  const { snapshotDigest, ...material } = snapshot;
  if (snapshot.version !== '33.19' || snapshot.supervisorId !== supervisorId || snapshot.daemonId !== daemonId || snapshot.productionAuthority !== 'NONE' || snapshot.externalEffectsExecuted !== 0 || sha256(material) !== snapshotDigest) throw new Error('supervisor_snapshot_invalid');
  let previous = sha256('lease-authority-daemon-lifecycle-genesis-v33.19');
  let maximumGeneration = 0;
  for (const envelope of snapshot.receipts) {
    if (!trustedSignerIds.includes(envelope.issuerKeyId) || !registry.verifyAt(envelope, envelope.payload.observedAt)) throw new Error('supervisor_receipt_signature_invalid');
    const { receiptDigest, ...receiptMaterial } = envelope.payload;
    if (envelope.payload.version !== '33.19' || envelope.payload.daemonId !== daemonId || envelope.payload.priorReceiptDigest !== previous || envelope.payload.productionAuthority !== 'NONE' || envelope.payload.externalEffectsExecuted !== 0 || envelope.payload.authorityExpanded !== false || sha256(receiptMaterial) !== receiptDigest) throw new Error('supervisor_receipt_invalid');
    maximumGeneration = Math.max(maximumGeneration, envelope.payload.restartGeneration);
    previous = receiptDigest;
  }
  if (snapshot.restartGeneration !== maximumGeneration) throw new Error('supervisor_generation_mismatch');
}

async function waitForReadyLine(child: ChildProcessByStdio<null, Readable, Readable>, timeoutMs: number): Promise<Record<string, unknown>> {
  return await new Promise((resolvePromise, rejectPromise) => {
    let buffer = '';
    const timer = setTimeout(() => { cleanup(); rejectPromise(new Error('daemon_start_timeout')); }, timeoutMs);
    const cleanup = (): void => { clearTimeout(timer); child.stdout.off('data', onData); child.off('exit', onExit); };
    const onExit = (code: number | null): void => { cleanup(); rejectPromise(new Error(`daemon_exited_before_ready:${code ?? 'signal'}`)); };
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line !== '') {
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            if (parsed.type === 'READY') { cleanup(); resolvePromise(parsed); return; }
          } catch { /* ignore non-readiness output */ }
        }
        newline = buffer.indexOf('\n');
      }
    };
    child.stdout.on('data', onData);
    child.once('exit', onExit);
  });
}

async function waitForExit(child: ChildProcessByStdio<null, Readable, Readable>, timeoutMs: number): Promise<{ readonly exited: boolean; readonly code: number | null }> {
  if (child.exitCode !== null) return { exited: true, code: child.exitCode };
  return await new Promise((resolvePromise) => {
    const timer = setTimeout(() => { child.off('exit', onExit); resolvePromise({ exited: false, code: null }); }, timeoutMs);
    const onExit = (code: number | null): void => { clearTimeout(timer); resolvePromise({ exited: true, code }); };
    child.once('exit', onExit);
  });
}

function atomicReplace(path: string, contents: string): void {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, contents, 'utf8'); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(temporary, path);
  const directory = openSync(dirname(path), 'r');
  try { fsyncSync(directory); } finally { closeSync(directory); }
}

function normalizeFingerprint(value: string): string {
  const normalized = value.replaceAll(':', '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error('certificate_fingerprint_invalid');
  return normalized;
}

function byCredential(a: SignedEnvelope<MutualTlsControllerCredentialV33_19>, b: SignedEnvelope<MutualTlsControllerCredentialV33_19>): number {
  return a.payload.controllerId.localeCompare(b.payload.controllerId) || a.payload.generation - b.payload.generation || a.payload.credentialId.localeCompare(b.payload.credentialId);
}

function unique(values: readonly string[], code: string): readonly string[] {
  const result = [...new Set(values.map((value) => nonEmpty(value, code)))];
  if (result.length !== values.length) throw new Error(code);
  return result;
}

function nonEmpty(value: string, code: string): string {
  const normalized = value.trim();
  if (normalized === '') throw new Error(code);
  return normalized;
}
