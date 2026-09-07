import { createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { KeyRegistry, type ExportedPublicKeyRecord, type SigningIdentity } from '../contracts/crypto.js';
import {
  EnterpriseIdentityVerifierV33_20,
  SqliteDurableLeaseAuthorityV33_20,
  SqliteMonotonicWitnessV33_20,
  createEnterpriseDurableLeaseAuthorityServerV33_20,
  type DurableAuthorityTrustV33_20,
  type EnterpriseIdentityTrustV33_20,
} from '../app/external-durable-authority-v33_20.js';

interface SerializedIdentity { readonly keyId: string; readonly privateKeyPem: string; }
interface DaemonConfigV33_20 {
  readonly version: '33.20';
  readonly daemonId: string;
  readonly authorityId: string;
  readonly authorityDbPath: string;
  readonly witnessDbPath: string;
  readonly listenHost: '127.0.0.1';
  readonly listenPort: number;
  readonly readyPath: string;
  readonly tls: { readonly keyPath: string; readonly certPath: string; readonly caPath: string };
  readonly authorityIdentity: SerializedIdentity;
  readonly witnessIdentity: SerializedIdentity;
  readonly controllerKeys: readonly ExportedPublicKeyRecord[];
  readonly deliveryKeys: readonly ExportedPublicKeyRecord[];
  readonly enterpriseIdentityStorePath: string;
  readonly identityIssuerKeys: readonly ExportedPublicKeyRecord[];
  readonly identityStoreKeys: readonly ExportedPublicKeyRecord[];
  readonly trustedIdentityIssuerSignerIds: readonly string[];
  readonly trustedIdentityStoreSignerIds: readonly string[];
}

const configPath = process.env.V33_20_DAEMON_CONFIG;
if (configPath === undefined || configPath.trim() === '') throw new Error('V33_20_DAEMON_CONFIG_required');
const config = JSON.parse(readFileSync(resolve(configPath), 'utf8')) as DaemonConfigV33_20;
if (config.version !== '33.20' || config.listenHost !== '127.0.0.1' || !Number.isInteger(config.listenPort) || config.listenPort <= 0 || config.listenPort > 65535) throw new Error('durable_daemon_config_invalid');

const authorityIdentity = importIdentity(config.authorityIdentity);
const witnessIdentity = importIdentity(config.witnessIdentity);
const controllerRegistry = registryFrom(config.controllerKeys);
const authorityRegistry = registryFrom([exportIdentity(authorityIdentity)]);
const witnessRegistry = registryFrom([exportIdentity(witnessIdentity)]);
const deliveryRegistry = registryFrom(config.deliveryKeys);
const trust: DurableAuthorityTrustV33_20 = { controllerRegistry, trustedControllerSignerIds: config.controllerKeys.map((item) => item.keyId), authorityRegistry, trustedAuthoritySignerIds: [authorityIdentity.keyId], witnessRegistry, trustedWitnessSignerIds: [witnessIdentity.keyId], deliveryRegistry, trustedDeliverySignerIds: config.deliveryKeys.map((item) => item.keyId) };
const witness = new SqliteMonotonicWitnessV33_20({ path: config.witnessDbPath, witnessId: `${config.authorityId}-witness`, identity: witnessIdentity, registry: witnessRegistry, trustedSignerIds: [witnessIdentity.keyId] });
const store = new SqliteDurableLeaseAuthorityV33_20({ path: config.authorityDbPath, authorityId: config.authorityId, authorityIdentity, trust, witness });
const identityTrust: EnterpriseIdentityTrustV33_20 = { issuerRegistry: registryFrom(config.identityIssuerKeys), trustedIssuerSignerIds: config.trustedIdentityIssuerSignerIds, storeRegistry: registryFrom(config.identityStoreKeys), trustedStoreSignerIds: config.trustedIdentityStoreSignerIds };
const identityVerifier = new EnterpriseIdentityVerifierV33_20({ path: config.enterpriseIdentityStorePath, trust: identityTrust });
const key = readFileSync(resolve(config.tls.keyPath));
const cert = readFileSync(resolve(config.tls.certPath));
const ca = readFileSync(resolve(config.tls.caPath));
const server = createEnterpriseDurableLeaseAuthorityServerV33_20({ store, identityVerifier, tls: { key, cert, ca }, now: () => new Date() });
await new Promise<void>((resolvePromise, rejectPromise) => { server.once('error', rejectPromise); server.listen(config.listenPort, config.listenHost, () => resolvePromise()); });
const address = server.address();
if (address === null || typeof address === 'string') throw new Error('durable_daemon_address_invalid');
const ready = { version: '33.20', type: 'READY', daemonId: config.daemonId, pid: process.pid, endpoint: `https://${config.listenHost}:${address.port}`, serverCertificateFingerprint256: new X509Certificate(cert).fingerprint256.replaceAll(':', '').toLowerCase(), backend: 'SQLITE_WAL', witness: 'SEPARATE_SQLITE_WAL_REFERENCE', enterpriseIdentity: 'LOCAL_ENTERPRISE_PKI_REFERENCE', productionAuthority: 'NONE' };
const temporary = `${config.readyPath}.tmp-${process.pid}`; writeFileSync(temporary, `${JSON.stringify(ready, null, 2)}\n`, { mode: 0o600 }); renameSync(temporary, config.readyPath);
process.stdout.write(`${JSON.stringify(ready)}\n`);
let closing = false;
const shutdown = (): void => { if (closing) return; closing = true; server.close(() => { store.close(); witness.close(); process.exit(0); }); setTimeout(() => process.exit(1), 3000).unref(); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);

function importIdentity(record: SerializedIdentity): SigningIdentity { const privateKey = createPrivateKey(record.privateKeyPem); return { keyId: record.keyId, privateKey, publicKey: createPublicKey(privateKey) }; }
function exportIdentity(identity: SigningIdentity): ExportedPublicKeyRecord { const registry = new KeyRegistry(); registry.register(identity.keyId, identity.publicKey); return registry.exportPublicKey(identity.keyId); }
function registryFrom(records: readonly ExportedPublicKeyRecord[]): KeyRegistry { const registry = new KeyRegistry(); for (const record of records) registry.registerExported(record); return registry; }
