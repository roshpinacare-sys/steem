import { createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { KeyRegistry, type ExportedPublicKeyRecord, type SigningIdentity } from '../contracts/crypto.js';
import {
  DistributedLeaseAuthorityStoreV33_18,
  MonotonicFenceWitnessStoreV33_18,
  type DistributedLeaseTrustV33_18,
} from '../app/distributed-lease-authority-v33_18.js';
import {
  MutualTlsCredentialVerifierV33_19,
  createMutualTlsLeaseAuthorityServerV33_19,
  type MutualTlsCredentialTrustV33_19,
} from '../app/separate-process-lease-authority-v33_19.js';

interface SerializedIdentity {
  readonly keyId: string;
  readonly privateKeyPem: string;
}

interface DaemonConfigV33_19 {
  readonly version: '33.19';
  readonly daemonId: string;
  readonly authorityId: string;
  readonly stateDir: string;
  readonly listenHost: '127.0.0.1';
  readonly listenPort: number;
  readonly tls: { readonly keyPath: string; readonly certPath: string; readonly caPath: string };
  readonly authorityIdentity: SerializedIdentity;
  readonly authorityStoreIdentity: SerializedIdentity;
  readonly witnessIdentity: SerializedIdentity;
  readonly controllerKeys: readonly ExportedPublicKeyRecord[];
  readonly credentialStorePath: string;
  readonly credentialIssuerKeys: readonly ExportedPublicKeyRecord[];
  readonly credentialStoreKeys: readonly ExportedPublicKeyRecord[];
  readonly trustedCredentialIssuerSignerIds: readonly string[];
  readonly trustedCredentialStoreSignerIds: readonly string[];
}

const configPath = process.env.V33_19_DAEMON_CONFIG;
if (configPath === undefined || configPath.trim() === '') throw new Error('V33_19_DAEMON_CONFIG_required');
const config = JSON.parse(readFileSync(resolve(configPath), 'utf8')) as DaemonConfigV33_19;
if (config.version !== '33.19' || config.listenHost !== '127.0.0.1' || !Number.isInteger(config.listenPort) || config.listenPort < 0 || config.listenPort > 65535) throw new Error('daemon_config_invalid');

const authorityIdentity = importIdentity(config.authorityIdentity);
const authorityStoreIdentity = importIdentity(config.authorityStoreIdentity);
const witnessIdentity = importIdentity(config.witnessIdentity);
const controllerRegistry = registryFrom(config.controllerKeys);
const authorityRegistry = registryFrom([exportIdentity(authorityIdentity)]);
const witnessRegistry = registryFrom([exportIdentity(witnessIdentity)]);
const deliveryRegistry = new KeyRegistry();
const storeRegistry = registryFrom([exportIdentity(authorityStoreIdentity)]);
const trust: DistributedLeaseTrustV33_18 = {
  controllerRegistry,
  trustedControllerSignerIds: config.controllerKeys.map((item) => item.keyId),
  authorityRegistry,
  trustedAuthoritySignerIds: [authorityIdentity.keyId],
  witnessRegistry,
  trustedWitnessSignerIds: [witnessIdentity.keyId],
  deliveryRegistry,
  trustedDeliverySignerIds: [],
};
const witness = new MonotonicFenceWitnessStoreV33_18({
  path: resolve(config.stateDir, 'witness.json'),
  witnessId: `${config.authorityId}-witness`,
  identity: witnessIdentity,
  registry: witnessRegistry,
  trustedSignerIds: [witnessIdentity.keyId],
});
const store = new DistributedLeaseAuthorityStoreV33_18({
  path: resolve(config.stateDir, 'authority.json'),
  authorityId: config.authorityId,
  authorityIdentity,
  storeIdentity: authorityStoreIdentity,
  storeRegistry,
  trustedStoreSignerIds: [authorityStoreIdentity.keyId],
  trust,
  witness,
});
const credentialTrust: MutualTlsCredentialTrustV33_19 = {
  issuerRegistry: registryFrom(config.credentialIssuerKeys),
  trustedIssuerSignerIds: config.trustedCredentialIssuerSignerIds,
  storeRegistry: registryFrom(config.credentialStoreKeys),
  trustedStoreSignerIds: config.trustedCredentialStoreSignerIds,
};
const credentialVerifier = new MutualTlsCredentialVerifierV33_19({ path: config.credentialStorePath, trust: credentialTrust });
const key = readFileSync(resolve(config.tls.keyPath));
const cert = readFileSync(resolve(config.tls.certPath));
const ca = readFileSync(resolve(config.tls.caPath));
const server = createMutualTlsLeaseAuthorityServerV33_19({ store, credentialVerifier, tls: { key, cert, ca }, now: () => new Date() });

await new Promise<void>((resolvePromise, rejectPromise) => {
  server.once('error', rejectPromise);
  server.listen(config.listenPort, config.listenHost, () => resolvePromise());
});
const address = server.address();
if (address === null || typeof address === 'string') throw new Error('daemon_address_invalid');
const fingerprint = new X509Certificate(cert).fingerprint256.replaceAll(':', '').toLowerCase();
process.stdout.write(`${JSON.stringify({ type: 'READY', daemonId: config.daemonId, pid: process.pid, endpoint: `https://${config.listenHost}:${address.port}`, serverCertificateFingerprint256: fingerprint, mtlsRequired: true, productionAuthority: 'NONE' })}\n`);

let closing = false;
const shutdown = (): void => {
  if (closing) return;
  closing = true;
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 2000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function importIdentity(record: SerializedIdentity): SigningIdentity {
  const privateKey = createPrivateKey(record.privateKeyPem);
  return { keyId: record.keyId, privateKey, publicKey: createPublicKey(privateKey) };
}

function exportIdentity(identity: SigningIdentity): ExportedPublicKeyRecord {
  const registry = new KeyRegistry();
  registry.register(identity.keyId, identity.publicKey);
  return registry.exportPublicKey(identity.keyId);
}

function registryFrom(records: readonly ExportedPublicKeyRecord[]): KeyRegistry {
  const registry = new KeyRegistry();
  for (const record of records) registry.registerExported(record);
  return registry;
}
