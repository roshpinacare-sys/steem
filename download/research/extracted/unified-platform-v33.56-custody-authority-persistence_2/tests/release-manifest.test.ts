import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { generateSigningIdentity } from '../src/contracts/crypto.js';
import { KeyLifecycleRegistry } from '../src/security/key-lifecycle.js';
import { buildCycloneDxLikeSbom, buildSourceManifest, scanPotentialSecrets, signDevelopmentRelease } from '../src/supply-chain/release-manifest.js';

const now = new Date('2026-07-17T00:00:00Z');

function releaseRegistry() {
  const identity = generateSigningIdentity('v20-release-signer');
  const registry = new KeyLifecycleRegistry();
  registry.register(identity, {
    keyId: identity.keyId, familyId: 'release-family', purpose: 'release-signer', environment: 'test',
    notBefore: new Date(now.getTime() - 1000).toISOString(), notAfter: new Date(now.getTime() + 86_400_000).toISOString(),
  });
  return { identity, registry };
}

test('source manifest and SBOM are deterministic for an unchanged isolated tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'v32-source-manifest-stable-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'stable.ts'), 'export const stable = true;\n');
  cpSync(resolve('package-lock.json'), join(root, 'package-lock.json'));
  const first = buildSourceManifest(root);
  const second = buildSourceManifest(root);
  assert.equal(first.root, second.root);
  assert.deepEqual(first.files, second.files);
  const sbom = buildCycloneDxLikeSbom(join(root, 'package-lock.json'));
  assert.equal(sbom.bomFormat, 'CycloneDX');
  assert.ok(sbom.components.some((component) => component.name === 'typescript'));
});

test('source manifest ignores isolated run evidence and current-run pointer churn', () => {
  const root = mkdtempSync(join(tmpdir(), 'v32-source-manifest-runs-'));
  writeFileSync(join(root, 'source.ts'), 'export const stable = true;\n');
  mkdirSync(join(root, 'evidence', 'runs', 'run-a'), { recursive: true });
  writeFileSync(join(root, 'evidence', 'runs', 'run-a', 'FULL.tap.log'), 'partial');
  writeFileSync(join(root, 'evidence', 'V32_6_CURRENT_RUN.json'), '{"runId":"run-a"}');
  const before = buildSourceManifest(root);
  writeFileSync(join(root, 'evidence', 'runs', 'run-a', 'FULL.tap.log'), 'complete');
  writeFileSync(join(root, 'evidence', 'V32_6_CURRENT_RUN.json'), '{"runId":"run-b"}');
  const after = buildSourceManifest(root);
  assert.equal(before.root, after.root);
  assert.deepEqual(before.files.map((entry) => entry.path), ['source.ts']);
});

test('development release is purpose-bound and verifies with release signer', () => {
  const { identity, registry } = releaseRegistry();
  const release = signDevelopmentRelease({ root: resolve('.'), project: 'canonical-proof-v20', version: '0.4.0', identity, registry, now });
  assert.equal(release.envelope.payload.evidenceClass, 'ATTESTED');
  assert.equal(registry.verify(release.envelope, { purpose: 'release-signer', environment: 'test' }, now), true);
  assert.equal(release.sourceManifest.root.length, 64);
});

test('tampered lockfile changes SBOM and package-lock digest', () => {
  const root = mkdtempSync(join(tmpdir(), 'v20-release-lock-'));
  cpSync(resolve('package-lock.json'), join(root, 'package-lock.json'));
  const before = buildCycloneDxLikeSbom(join(root, 'package-lock.json'));
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as Record<string, unknown>;
  lock.version = '99.99.99';
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock));
  const after = buildCycloneDxLikeSbom(join(root, 'package-lock.json'));
  assert.notEqual(before.serialNumber, after.serialNumber);
});

test('secret scanner detects private key and token-like assignments', () => {
  const root = mkdtempSync(join(tmpdir(), 'v20-secret-scan-'));
  writeFileSync(join(root, 'bad.txt'), "token = 'abcdefghijklmnopqrstuvwxyz1234567890'\n-----BEGIN PRIVATE KEY-----\n");
  const rules = scanPotentialSecrets(root).map((finding) => finding.rule);
  assert.equal(rules.includes('private-key'), true);
  assert.equal(rules.includes('generic-token-assignment'), true);
});

test('revoked release signer cannot issue or verify development releases', () => {
  const { identity, registry } = releaseRegistry();
  registry.revoke(identity.keyId, { status: 'REVOKED', reason: 'release key compromise', effectiveAt: now, approvedBy: ['security-1', 'security-2'] });
  assert.throws(() => signDevelopmentRelease({ root: resolve('.'), project: 'canonical-proof-v20', version: '0.4.0', identity, registry, now }), /signing_key_not_active/);
});
