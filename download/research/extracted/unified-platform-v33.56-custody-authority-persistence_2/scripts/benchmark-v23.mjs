import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { sign as cryptoSign } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { AttestedKmsSigningAdapter } from '../dist/src/security/attested-kms-adapter.js';
import { canonicalJson, generateSigningIdentity, sha256 } from '../dist/src/contracts/crypto.js';
import { KeyLifecycleRegistry } from '../dist/src/security/key-lifecycle.js';
import { MonotonicTrustCheckpointStore } from '../dist/src/security/trust-checkpoint-store.js';
import { evaluateSlo } from '../dist/src/operations/slo-qualification.js';
import { runSignedWasmCapability, signWasmCapabilityManifest } from '../dist/src/isolation/wasm-capability-runner.js';

const now = new Date('2026-07-17T10:00:00.000Z');
const identity = generateSigningIdentity('v23-benchmark-key');
const publicPem = identity.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const registry = new KeyLifecycleRegistry();
registry.register(identity, { keyId: identity.keyId, familyId: 'v23-benchmark', purpose: 'action-passport', environment: 'test', tenantId: 'tenant-1', notBefore: '2026-07-17T09:00:00.000Z', notAfter: '2026-07-18T09:00:00.000Z' });
const snapshot = registry.snapshot(now);
const contextFor = (index) => ({ purpose: 'action-passport', environment: 'test', tenantId: 'tenant-1', nonce: `bench-${index}`, issuedAt: now.toISOString(), expiresAt: '2026-07-17T10:05:00.000Z' });
const kms = new AttestedKmsSigningAdapter('rehearsal-kms', identity.keyId, publicPem, { async sign(request) { return { provider: 'rehearsal-kms', keyId: request.keyId, algorithm: 'Ed25519', signature: cryptoSign(null, Buffer.from(request.message), identity.privateKey).toString('base64url'), attestation: { requestDigest: request.requestDigest, nonce: JSON.parse(request.message).context.nonce, issuedAt: JSON.parse(request.message).context.issuedAt } }; } });

async function samples(count, operation) {
  const values = [];
  for (let index = 0; index < count; index += 1) {
    const start = performance.now();
    await operation(index);
    values.push(performance.now() - start);
  }
  return values;
}

const kmsSamples = await samples(250, (index) => kms.sign({ artifact: `artifact-${index}` }, contextFor(index)));
const verifySamples = await samples(2000, () => { if (!KeyLifecycleRegistry.verifySnapshot(snapshot)) throw new Error('snapshot_verify_failed'); });
const dir = mkdtempSync(join(tmpdir(), 'v23-benchmark-'));
let checkpointSamples;
try {
  const store = new MonotonicTrustCheckpointStore(join(dir, 'trust.json'));
  store.apply({ tenantId: 'tenant-1', channel: 'staging', snapshot, approvedBy: ['a','b'], createdAt: now });
  checkpointSamples = await samples(1000, () => { store.verify(); });
} finally { rmSync(dir, { recursive: true, force: true }); }

const wasmBytes = readFileSync('isolation/wasm-core/artifacts/allowed.wasm');
const wasmIdentity = generateSigningIdentity('v23-wasm-benchmark');
const wasmRegistry = new KeyLifecycleRegistry();
wasmRegistry.register(wasmIdentity, { keyId: wasmIdentity.keyId, familyId: 'wasm-bench', purpose: 'capability-publisher', environment: 'test', tenantId: 'tenant-1', notBefore: '2026-07-17T09:00:00.000Z', notAfter: '2026-07-18T09:00:00.000Z' });
const wasmManifest = { capabilityId: 'benchmark-sum', version: '1.0.0', tenantId: 'tenant-1', moduleDigest: sha256(wasmBytes), allowedImports: ['cap.read_byte','cap.emit'], timeoutMs: 500, maxModuleBytes: 1024 * 1024, maxInputBytes: 16, maxMemoryBytes: 131072, declaredEffects: ['emit-result'], evidenceClass: 'COMPUTED' };
const wasmEnvelope = signWasmCapabilityManifest(wasmManifest, wasmIdentity, wasmRegistry, now);
const wasmSamples = await samples(30, async () => { const receipt = await runSignedWasmCapability({ moduleBytes: wasmBytes, envelope: wasmEnvelope, registry: wasmRegistry, input: [1,2,3,4], now }); if (receipt.output !== 10) throw new Error('wasm_output_wrong'); });

const evaluations = [
  evaluateSlo({ metric: 'kms-protocol-sign', samplesMs: kmsSamples, environment: 'local-single-host' }, { metric: 'kms-protocol-sign', percentile: 95, maximumMs: 10, minimumSamples: 100 }),
  evaluateSlo({ metric: 'trust-snapshot-verify', samplesMs: verifySamples, environment: 'local-single-host' }, { metric: 'trust-snapshot-verify', percentile: 95, maximumMs: 2, minimumSamples: 1000 }),
  evaluateSlo({ metric: 'checkpoint-verify', samplesMs: checkpointSamples, environment: 'local-single-host' }, { metric: 'checkpoint-verify', percentile: 95, maximumMs: 5, minimumSamples: 500 }),
  evaluateSlo({ metric: 'wasm-capability-execute', samplesMs: wasmSamples, environment: 'local-single-host' }, { metric: 'wasm-capability-execute', percentile: 95, maximumMs: 150, minimumSamples: 20 }),
];
const report = {
  version: '23.0',
  status: evaluations.every((item) => item.status === 'local-evidence-only') ? 'passed-local-only' : 'failed',
  classification: 'measured-local-single-host-not-production-slo',
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  evaluations,
  sampleDigests: { kms: sha256(kmsSamples), trustVerify: sha256(verifySamples), checkpoint: sha256(checkpointSamples), wasm: sha256(wasmSamples) },
  limitations: ['No PostgreSQL server', 'No multi-host network', 'Rehearsal KMS transport uses an in-process test signer', 'Single-host WebAssembly worker measurements'],
};
const output = resolve('evidence/generated/V23_LOCAL_SLO_MEASUREMENTS.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.status === 'failed') process.exit(1);
