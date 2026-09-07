import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpsRequest } from 'node:https';
import {
  DistributedLeaseAuthorityStoreV33_18,
  MonotonicFenceWitnessStoreV33_18,
  issueDistributedLeaseCommandV33_18,
  type DistributedLeaseTrustV33_18,
} from '../src/app/distributed-lease-authority-v33_18.js';
import {
  LocalLeaseAuthorityProcessSupervisorV33_19,
  MutualTlsCredentialStoreV33_19,
  MutualTlsCredentialVerifierV33_19,
  createMutualTlsLeaseAuthorityServerV33_19,
  probeExternalLeaseBackendsAndServiceManagersV33_19,
  sendMutualTlsLeaseCommandV33_19,
  type MutualTlsCredentialTrustV33_19,
} from '../src/app/separate-process-lease-authority-v33_19.js';
import {
  KeyRegistry,
  generateSigningIdentity,
  type ExportedPublicKeyRecord,
  type SigningIdentity,
} from '../src/contracts/crypto.js';

const pki = generatePki();
after(() => rmSync(pki.root, { recursive: true, force: true }));

function registry(...identities: SigningIdentity[]): KeyRegistry {
  const result = new KeyRegistry();
  for (const identity of identities) result.register(identity.keyId, identity.publicKey);
  return result;
}

function publicRecord(identity: SigningIdentity): ExportedPublicKeyRecord {
  const keys = registry(identity);
  return keys.exportPublicKey(identity.keyId);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'v33.19-test-'));
  const now = new Date();
  const suffix = root.split('-').at(-1)!;
  const ids = {
    controllerA: generateSigningIdentity(`controller-a-${suffix}`),
    controllerB: generateSigningIdentity(`controller-b-${suffix}`),
    attacker: generateSigningIdentity(`attacker-${suffix}`),
    authority: generateSigningIdentity(`authority-${suffix}`),
    authorityStore: generateSigningIdentity(`authority-store-${suffix}`),
    witness: generateSigningIdentity(`witness-${suffix}`),
    credentialIssuer: generateSigningIdentity(`credential-issuer-${suffix}`),
    credentialStore: generateSigningIdentity(`credential-store-${suffix}`),
    supervisor: generateSigningIdentity(`supervisor-${suffix}`),
  };
  const trust: DistributedLeaseTrustV33_18 = {
    controllerRegistry: registry(ids.controllerA, ids.controllerB),
    trustedControllerSignerIds: [ids.controllerA.keyId, ids.controllerB.keyId],
    authorityRegistry: registry(ids.authority),
    trustedAuthoritySignerIds: [ids.authority.keyId],
    witnessRegistry: registry(ids.witness),
    trustedWitnessSignerIds: [ids.witness.keyId],
    deliveryRegistry: new KeyRegistry(),
    trustedDeliverySignerIds: [],
  };
  const witness = new MonotonicFenceWitnessStoreV33_18({
    path: join(root, 'witness.json'),
    witnessId: 'witness-main',
    identity: ids.witness,
    registry: trust.witnessRegistry,
    trustedSignerIds: trust.trustedWitnessSignerIds,
    now,
  });
  const store = new DistributedLeaseAuthorityStoreV33_18({
    path: join(root, 'authority.json'),
    authorityId: 'authority-main',
    authorityIdentity: ids.authority,
    storeIdentity: ids.authorityStore,
    storeRegistry: registry(ids.authorityStore),
    trustedStoreSignerIds: [ids.authorityStore.keyId],
    trust,
    witness,
    now,
  });
  const credentialTrust: MutualTlsCredentialTrustV33_19 = {
    issuerRegistry: registry(ids.credentialIssuer),
    trustedIssuerSignerIds: [ids.credentialIssuer.keyId],
    storeRegistry: registry(ids.credentialStore),
    trustedStoreSignerIds: [ids.credentialStore.keyId],
  };
  const credentialPath = join(root, 'credentials.json');
  const credentialStore = new MutualTlsCredentialStoreV33_19({
    path: credentialPath,
    issuerIdentity: ids.credentialIssuer,
    storeIdentity: ids.credentialStore,
    trust: credentialTrust,
    now,
  });
  const credentialA = credentialStore.issue({ controllerId: 'controller-a', tenantId: 'tenant-a', serviceId: 'adaptive-control', certificatePem: readFileSync(pki.clientACert), now });
  const credentialB = credentialStore.issue({ controllerId: 'controller-b', tenantId: 'tenant-a', serviceId: 'adaptive-control', certificatePem: readFileSync(pki.clientBCert), now });
  const verifier = new MutualTlsCredentialVerifierV33_19({ path: credentialPath, trust: credentialTrust });
  return { root, now, ids, trust, witness, store, credentialTrust, credentialPath, credentialStore, credentialA, credentialB, verifier };
}

function cleanup(f: ReturnType<typeof fixture>): void { rmSync(f.root, { recursive: true, force: true }); }

function command(f: ReturnType<typeof fixture>, input: {
  readonly signer?: SigningIdentity;
  readonly controllerId?: string;
  readonly operation?: 'ACQUIRE' | 'RENEW' | 'ASSERT_FENCE';
  readonly now?: Date;
  readonly ttl?: number;
  readonly fence?: number;
  readonly leaseDigest?: string;
  readonly commandId?: string;
  readonly tenantId?: string;
  readonly serviceId?: string;
}) {
  return issueDistributedLeaseCommandV33_18({
    authorityId: 'authority-main',
    tenantId: input.tenantId ?? 'tenant-a',
    serviceId: input.serviceId ?? 'adaptive-control',
    controllerId: input.controllerId ?? 'controller-a',
    operation: input.operation ?? 'ACQUIRE',
    signer: input.signer ?? f.ids.controllerA,
    requestedTtlMs: input.ttl ?? 1000,
    ...(input.fence === undefined ? {} : { expectedFenceToken: input.fence }),
    ...(input.leaseDigest === undefined ? {} : { expectedLeaseDigest: input.leaseDigest }),
    ...(input.commandId === undefined ? {} : { commandId: input.commandId }),
    now: input.now ?? f.now,
  });
}

async function startServer(f: ReturnType<typeof fixture>, clock: { now: Date }) {
  const server = createMutualTlsLeaseAuthorityServerV33_19({
    store: f.store,
    credentialVerifier: f.verifier,
    tls: { key: readFileSync(pki.serverKey), cert: readFileSync(pki.serverCert), ca: readFileSync(pki.caCert) },
    now: () => clock.now,
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('server_address_invalid');
  return { server, endpoint: `https://127.0.0.1:${address.port}` };
}

async function closeServer(server: import('node:https').Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
}

function client(input: { endpoint: string; envelope: ReturnType<typeof command>; cert?: string; key?: string; ca?: string }) {
  return sendMutualTlsLeaseCommandV33_19({
    endpoint: input.endpoint,
    envelope: input.envelope,
    ca: readFileSync(input.ca ?? pki.caCert),
    cert: readFileSync(input.cert ?? pki.clientACert),
    key: readFileSync(input.key ?? pki.clientAKey),
    servername: 'localhost',
    timeoutMs: 2000,
  });
}

function rawWithoutClientCertificate(endpoint: string): Promise<void> {
  const url = new URL(endpoint);
  return new Promise((resolve, reject) => {
    const request = httpsRequest({ hostname: url.hostname, port: url.port, path: '/v1/distributed-lease/command', method: 'POST', ca: readFileSync(pki.caCert), servername: 'localhost', minVersion: 'TLSv1.3', rejectUnauthorized: true }, () => resolve());
    request.on('error', reject);
    request.end('{}');
  });
}

test('issues a signed mTLS credential and resolves its exact binding', () => {
  const f = fixture();
  try {
    const resolved = f.verifier.resolve({ certificateFingerprint256: f.credentialA.payload.certificateFingerprint256, controllerId: 'controller-a', tenantId: 'tenant-a', serviceId: 'adaptive-control', now: f.now });
    assert.equal(resolved.payload.credentialId, f.credentialA.payload.credentialId);
    assert.equal(resolved.payload.transport, 'MTLS_TLS_1_3');
    assert.equal(resolved.payload.productionAuthority, 'NONE');
  } finally { cleanup(f); }
});

test('returns the same credential for idempotent issuance of the same certificate binding', () => {
  const f = fixture();
  try {
    const again = f.credentialStore.issue({ controllerId: 'controller-a', tenantId: 'tenant-a', serviceId: 'adaptive-control', certificatePem: readFileSync(pki.clientACert), now: f.now });
    assert.deepEqual(again, f.credentialA);
    assert.equal(f.credentialStore.snapshot().credentials.length, 2);
  } finally { cleanup(f); }
});

test('rejects binding one certificate fingerprint to another controller', () => {
  const f = fixture();
  try {
    assert.throws(() => f.credentialStore.issue({ controllerId: 'controller-b', tenantId: 'tenant-a', serviceId: 'adaptive-control', certificatePem: readFileSync(pki.clientACert), now: f.now }), /fingerprint_already_bound/);
  } finally { cleanup(f); }
});

test('rotates a credential monotonically and revokes the prior generation', () => {
  const f = fixture();
  try {
    const rotated = f.credentialStore.issue({ controllerId: 'controller-a', tenantId: 'tenant-a', serviceId: 'adaptive-control', certificatePem: readFileSync(pki.clientA2Cert), previousCredentialId: f.credentialA.payload.credentialId, now: new Date(f.now.getTime() + 1) });
    assert.equal(rotated.payload.generation, 2);
    assert.equal(rotated.payload.previousCredentialId, f.credentialA.payload.credentialId);
    const old = f.credentialStore.snapshot().credentials.find((item) => item.payload.credentialId === f.credentialA.payload.credentialId)!;
    assert.equal(old.payload.status, 'REVOKED');
    assert.equal(old.payload.revocationReason, 'ROTATED');
  } finally { cleanup(f); }
});

test('detects credential-store tampering before resolving a client', () => {
  const f = fixture();
  try {
    const data = JSON.parse(readFileSync(f.credentialPath, 'utf8'));
    data.payload.credentials[0].payload.controllerId = 'attacker';
    writeFileSync(f.credentialPath, JSON.stringify(data));
    assert.throws(() => f.verifier.snapshot(), /signature|credential/);
  } finally { cleanup(f); }
});

test('rejects issuing a certificate outside its validity window', () => {
  const f = fixture();
  try {
    assert.throws(() => f.credentialStore.issue({ controllerId: 'controller-x', tenantId: 'tenant-a', serviceId: 'adaptive-control', certificatePem: readFileSync(pki.clientA2Cert), now: new Date(f.now.getTime() + 7 * 24 * 60 * 60 * 1000) }), /not_current/);
  } finally { cleanup(f); }
});

test('accepts a signed command only when mTLS and application identity agree', async () => {
  const f = fixture(); const clock = { now: f.now }; const running = await startServer(f, clock);
  try {
    const decision = await client({ endpoint: running.endpoint, envelope: command(f, {}) });
    assert.equal(decision.payload.accepted, true);
    assert.equal(decision.payload.currentFenceToken, 1);
  } finally { await closeServer(running.server); cleanup(f); }
});

test('requires a client certificate at the TLS layer', async () => {
  const f = fixture(); const clock = { now: f.now }; const running = await startServer(f, clock);
  try {
    await assert.rejects(() => rawWithoutClientCertificate(running.endpoint), /certificate|alert|socket|tls/i);
  } finally { await closeServer(running.server); cleanup(f); }
});

test('rejects a valid client certificate bound to a different controller command', async () => {
  const f = fixture(); const clock = { now: f.now }; const running = await startServer(f, clock);
  try {
    const envelope = command(f, { signer: f.ids.controllerB, controllerId: 'controller-b' });
    await assert.rejects(() => client({ endpoint: running.endpoint, envelope }), /binding_mismatch/);
  } finally { await closeServer(running.server); cleanup(f); }
});

test('mTLS does not replace the signed application authority command', async () => {
  const f = fixture(); const clock = { now: f.now }; const running = await startServer(f, clock);
  try {
    const envelope = command(f, { signer: f.ids.attacker, controllerId: 'controller-a' });
    await assert.rejects(() => client({ endpoint: running.endpoint, envelope }), /signature_invalid/);
  } finally { await closeServer(running.server); cleanup(f); }
});

test('revocation is enforced by a running daemon without restart', async () => {
  const f = fixture(); const clock = { now: f.now }; const running = await startServer(f, clock);
  try {
    f.credentialStore.revoke({ credentialId: f.credentialA.payload.credentialId, reason: 'COMPROMISED', now: new Date(f.now.getTime() + 1) });
    clock.now = new Date(f.now.getTime() + 2);
    await assert.rejects(() => client({ endpoint: running.endpoint, envelope: command(f, { now: clock.now }) }), /credential_revoked/);
  } finally { await closeServer(running.server); cleanup(f); }
});

test('credential rotation rejects the old certificate and accepts the new certificate', async () => {
  const f = fixture();
  const rotatedAt = new Date(f.now.getTime() + 1);
  f.credentialStore.issue({ controllerId: 'controller-a', tenantId: 'tenant-a', serviceId: 'adaptive-control', certificatePem: readFileSync(pki.clientA2Cert), previousCredentialId: f.credentialA.payload.credentialId, now: rotatedAt });
  const clock = { now: new Date(rotatedAt.getTime() + 1) }; const running = await startServer(f, clock);
  try {
    await assert.rejects(() => client({ endpoint: running.endpoint, envelope: command(f, { now: clock.now }) }), /credential_revoked/);
    const accepted = await client({ endpoint: running.endpoint, envelope: command(f, { now: clock.now }), cert: pki.clientA2Cert, key: pki.clientA2Key });
    assert.equal(accepted.payload.accepted, true);
  } finally { await closeServer(running.server); cleanup(f); }
});

test('rejects a server certificate that is not trusted by the client CA', async () => {
  const f = fixture(); const clock = { now: f.now }; const running = await startServer(f, clock);
  try {
    await assert.rejects(() => client({ endpoint: running.endpoint, envelope: command(f, {}), ca: pki.rogueCaCert }), /certificate|issuer|verify|self.signed/i);
  } finally { await closeServer(running.server); cleanup(f); }
});

test('a separate authority daemon survives crash restart and preserves fencing', async () => {
  const f = fixture();
  const configPath = writeDaemonConfig(f);
  const supervisorRegistry = registry(f.ids.supervisor);
  const supervisor = new LocalLeaseAuthorityProcessSupervisorV33_19({ supervisorId: 'supervisor-main', daemonId: 'daemon-main', statePath: join(f.root, 'supervisor.json'), identity: f.ids.supervisor, registry: supervisorRegistry, trustedSignerIds: [f.ids.supervisor.keyId] });
  try {
    const first = await supervisor.start({ command: process.execPath, args: ['dist/src/cli/lease-authority-daemon-v33_19.js'], cwd: process.cwd(), env: { V33_19_DAEMON_CONFIG: configPath } });
    const nowA = new Date();
    const acquire = command(f, { now: nowA, ttl: 150 });
    const firstDecision = await client({ endpoint: first.endpoint, envelope: acquire });
    assert.equal(firstDecision.payload.currentFenceToken, 1);
    await supervisor.crash(new Date(nowA.getTime() + 10));
    await new Promise((resolve) => setTimeout(resolve, 180));
    const second = await supervisor.start({ command: process.execPath, args: ['dist/src/cli/lease-authority-daemon-v33_19.js'], cwd: process.cwd(), env: { V33_19_DAEMON_CONFIG: configPath } });
    const nowB = new Date();
    const takeover = command(f, { signer: f.ids.controllerB, controllerId: 'controller-b', now: nowB, ttl: 500 });
    const secondDecision = await client({ endpoint: second.endpoint, envelope: takeover, cert: pki.clientBCert, key: pki.clientBKey });
    assert.equal(secondDecision.payload.currentFenceToken, 2);
    assert.equal(supervisor.snapshot().restartGeneration, 2);
    assert.equal(supervisor.snapshot().receipts.map((item) => item.payload.event).join(','), 'STARTED,CRASHED,RESTARTED');
    assert.equal(supervisor.verify(), true);
  } finally { await supervisor.stop(); cleanup(f); }
});

test('supervisor lifecycle snapshot detects tampering', async () => {
  const f = fixture();
  const supervisorRegistry = registry(f.ids.supervisor);
  const path = join(f.root, 'supervisor.json');
  const supervisor = new LocalLeaseAuthorityProcessSupervisorV33_19({ supervisorId: 'supervisor-main', daemonId: 'daemon-main', statePath: path, identity: f.ids.supervisor, registry: supervisorRegistry, trustedSignerIds: [f.ids.supervisor.keyId] });
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    data.payload.restartGeneration = 99;
    writeFileSync(path, JSON.stringify(data));
    assert.throws(() => new LocalLeaseAuthorityProcessSupervisorV33_19({ supervisorId: 'supervisor-main', daemonId: 'daemon-main', statePath: path, identity: f.ids.supervisor, registry: supervisorRegistry, trustedSignerIds: [f.ids.supervisor.keyId] }), /signature|snapshot/);
  } finally { cleanup(f); }
});

test('external backends and inactive systemd remain unavailable fail closed', () => {
  const result = probeExternalLeaseBackendsAndServiceManagersV33_19({ executables: { SYSTEMD: '/usr/bin/systemctl' }, systemdActive: false, now: new Date() });
  assert.equal(result.backends.every((item) => item.status === 'UNAVAILABLE_FAIL_CLOSED' && item.productionAuthority === 'NONE'), true);
  assert.equal(result.serviceManagers.find((item) => item.serviceManager === 'SYSTEMD')?.status, 'UNAVAILABLE_FAIL_CLOSED');
  assert.equal(result.serviceManagers.find((item) => item.serviceManager === 'LOCAL_PROCESS_SUPERVISOR')?.status, 'LOCAL_REFERENCE_AVAILABLE');
});

test('all V33.19 credentials and lifecycle evidence remain effect-free and non-production', async () => {
  const f = fixture();
  try {
    assert.equal(f.credentialStore.snapshot().credentials.every((item) => item.payload.externalEffectsExecuted === 0 && item.payload.productionAuthority === 'NONE' && item.payload.authorityExpanded === false), true);
    const result = probeExternalLeaseBackendsAndServiceManagersV33_19({ executables: {}, systemdActive: false, now: f.now });
    assert.equal(result.backends.every((item) => item.productionAuthority === 'NONE'), true);
    assert.equal(result.serviceManagers.every((item) => item.productionAuthority === 'NONE'), true);
  } finally { cleanup(f); }
});

function writeDaemonConfig(f: ReturnType<typeof fixture>): string {
  const stateDir = join(f.root, 'daemon-state');
  const config = {
    version: '33.19',
    daemonId: 'daemon-main',
    authorityId: 'authority-main',
    stateDir,
    listenHost: '127.0.0.1',
    listenPort: 0,
    tls: { keyPath: pki.serverKey, certPath: pki.serverCert, caPath: pki.caCert },
    authorityIdentity: serializeIdentity(f.ids.authority),
    authorityStoreIdentity: serializeIdentity(f.ids.authorityStore),
    witnessIdentity: serializeIdentity(f.ids.witness),
    controllerKeys: [publicRecord(f.ids.controllerA), publicRecord(f.ids.controllerB)],
    credentialStorePath: f.credentialPath,
    credentialIssuerKeys: [publicRecord(f.ids.credentialIssuer)],
    credentialStoreKeys: [publicRecord(f.ids.credentialStore)],
    trustedCredentialIssuerSignerIds: [f.ids.credentialIssuer.keyId],
    trustedCredentialStoreSignerIds: [f.ids.credentialStore.keyId],
  };
  const path = join(f.root, 'daemon-config.json');
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 });
  return path;
}

function serializeIdentity(identity: SigningIdentity): { readonly keyId: string; readonly privateKeyPem: string } {
  return { keyId: identity.keyId, privateKeyPem: identity.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
}

function generatePki() {
  const root = mkdtempSync(join(tmpdir(), 'v33.19-pki-'));
  const run = (...args: string[]) => execFileSync('openssl', args, { cwd: root, stdio: 'ignore' });
  run('req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-days', '3', '-subj', '/CN=V33.19 Test CA', '-keyout', 'ca.key', '-out', 'ca.crt');
  writeFileSync(join(root, 'server.ext'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n');
  run('req', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-subj', '/CN=localhost', '-keyout', 'server.key', '-out', 'server.csr');
  run('x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-days', '3', '-sha256', '-extfile', 'server.ext', '-out', 'server.crt');
  const makeClient = (name: string, commonName: string) => {
    writeFileSync(join(root, `${name}.ext`), 'extendedKeyUsage=clientAuth\n');
    run('req', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-subj', `/CN=${commonName}`, '-keyout', `${name}.key`, '-out', `${name}.csr`);
    run('x509', '-req', '-in', `${name}.csr`, '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-days', '3', '-sha256', '-extfile', `${name}.ext`, '-out', `${name}.crt`);
  };
  makeClient('client-a', 'controller-a');
  makeClient('client-a2', 'controller-a-rotated');
  makeClient('client-b', 'controller-b');
  run('req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-days', '3', '-subj', '/CN=Rogue CA', '-keyout', 'rogue-ca.key', '-out', 'rogue-ca.crt');
  return {
    root,
    caCert: join(root, 'ca.crt'),
    serverKey: join(root, 'server.key'), serverCert: join(root, 'server.crt'),
    clientAKey: join(root, 'client-a.key'), clientACert: join(root, 'client-a.crt'),
    clientA2Key: join(root, 'client-a2.key'), clientA2Cert: join(root, 'client-a2.crt'),
    clientBKey: join(root, 'client-b.key'), clientBCert: join(root, 'client-b.crt'),
    rogueCaCert: join(root, 'rogue-ca.crt'),
  };
}
