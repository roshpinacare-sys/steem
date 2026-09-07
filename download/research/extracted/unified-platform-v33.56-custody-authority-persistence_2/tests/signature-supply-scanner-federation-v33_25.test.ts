import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  KeyRegistry,
  generateSigningIdentity,
  sha256,
  signEnvelope,
  type SigningIdentity,
} from '../src/contracts/crypto.js';
import {
  SignatureFeedLedgerV33_25,
  createExternalScannerFederationObservationV33_25,
  createFederatedArtifactPackageV33_25,
  createGenesisSignatureFeedV33_25,
  createSignatureFeedRevocationV33_25,
  createSignatureFeedUpdateV33_25,
  evaluateExternalScannerFederationQualificationV33_25,
  probeScannerFederationToolsV33_25,
  runFederatedScannerV33_25,
  type FederatedSignatureRuleV33_25,
  type ScannerSignatureFeedV33_25,
} from '../src/app/signature-supply-scanner-federation-v33_25.js';

const t0 = new Date('2026-07-22T00:00:00.000Z');
const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

function ids() {
  return {
    publisher: generateSigningIdentity('feed-publisher'),
    attacker: generateSigningIdentity('feed-attacker'),
    store: generateSigningIdentity('feed-store'),
    witness: generateSigningIdentity('feed-witness'),
    revoker: generateSigningIdentity('feed-revoker'),
    packageSigner: generateSigningIdentity('package-signer'),
    alpha: generateSigningIdentity('scanner-alpha'),
    beta: generateSigningIdentity('scanner-beta'),
    federation: generateSigningIdentity('scanner-federation'),
    operator1: generateSigningIdentity('external-operator-1'),
    operator2: generateSigningIdentity('external-operator-2'),
    verifier: generateSigningIdentity('external-verifier'),
  };
}
function registry(...values: readonly SigningIdentity[]): KeyRegistry { const r = new KeyRegistry(); for (const value of values) r.register(value.keyId, value.publicKey); return r; }
function withRoot(run: (root: string) => void): void { const root = mkdtempSync(join(tmpdir(), 'v3325-')); try { run(root); } finally { rmSync(root, { recursive: true, force: true }); } }
function ledger(root: string, x = ids(), now = t0): SignatureFeedLedgerV33_25 {
  return new SignatureFeedLedgerV33_25({
    root,
    storeIdentity: x.store, storeRegistry: registry(x.store), trustedStoreSignerIds: [x.store.keyId],
    witnessIdentity: x.witness, witnessRegistry: registry(x.witness), trustedWitnessSignerIds: [x.witness.keyId],
    publisherRegistry: registry(x.publisher), trustedPublisherSignerIds: [x.publisher.keyId],
    revokerRegistry: registry(x.revoker), trustedRevokerSignerIds: [x.revoker.keyId],
    now,
  });
}
function feedChain(root: string, extra?: readonly Omit<FederatedSignatureRuleV33_25, 'ruleDigest' | 'critical'>[]) {
  const x = ids(); const l = ledger(root, x);
  const f1 = createGenesisSignatureFeedV33_25({ signer: x.publisher, publisherOrganizationId: 'publisher-org', now: t0 });
  const f2 = createSignatureFeedUpdateV33_25({ previous: f1, signer: x.publisher, publisherOrganizationId: 'publisher-org', now: new Date(t0.getTime() + 60_000), ...(extra === undefined ? {} : { additionalRules: extra }) });
  l.append(f1, t0); l.append(f2, new Date(t0.getTime() + 60_000));
  return { x, l, f1, f2 };
}
function pkg(signer: SigningIdentity, kind: 'clean' | 'malicious' | 'alpha-only' = 'clean') {
  const bytes = kind === 'malicious' ? Buffer.from(eicar) : kind === 'alpha-only' ? Buffer.from('ALPHA_ONLY_MARKER') : Buffer.from('{"status":"clean"}');
  return createFederatedArtifactPackageV33_25({ signer, now: new Date(t0.getTime() + 120_000), artifacts: { 'evidence/result.json': { mediaType: 'application/json', bytes } } });
}
function scan(root: string, kind: 'clean' | 'malicious' | 'alpha-only' = 'clean') {
  const extra = kind === 'alpha-only' ? [{ ruleId: 'ALPHA_ONLY_RULE', category: 'MALWARE' as const, encoding: 'UTF8_LITERAL' as const, engineScope: 'ENGINE_ALPHA' as const, pattern: 'ALPHA_ONLY_MARKER' }] : undefined;
  const { x, l, f2 } = feedChain(root, extra);
  return { x, l, f2, result: runFederatedScannerV33_25({ package: pkg(x.packageSigner, kind), packageRegistry: registry(x.packageSigner), trustedPackageSignerIds: [x.packageSigner.keyId], feed: f2, ledger: l, alphaIdentity: x.alpha, betaIdentity: x.beta, federationIdentity: x.federation, now: new Date(t0.getTime() + 180_000) }) };
}
function resignFeed(feed: any, signer: SigningIdentity): any { const p = { ...feed.payload }; delete p.feedDigest; return signEnvelope({ ...p, feedDigest: sha256(p) }, signer); }
function observation(signer: SigningIdentity, verifier: SigningIdentity, overrides: Record<string, unknown> = {}) {
  return createExternalScannerFederationObservationV33_25({
    signer, verifierSignerId: verifier.keyId, operatorOrganizationId: signer.keyId + '-org', operatorHostId: signer.keyId + '-operator-host', clamavHostId: signer.keyId + '-clamav-host', yaraHostId: signer.keyId + '-yara-host', clamavOrganizationId: signer.keyId + '-clamav-org', yaraOrganizationId: signer.keyId + '-yara-org', feedPublisherOrganizationId: signer.keyId + '-publisher-org', observedAt: t0, ...overrides,
  } as any);
}

test('tool probes never claim external qualification', () => { const p = probeScannerFederationToolsV33_25(t0); assert.equal(p.externalScannerFederationQualified, false); assert.equal(p.productionAuthority, 'NONE'); assert.equal(p.externalEffectsExecuted, 0); });
test('genesis and update form a monotonic feed chain', () => withRoot((root) => { const { l, f1, f2 } = feedChain(root); assert.equal(f1.payload.sequence, 1); assert.equal(f2.payload.sequence, 2); assert.equal(f2.payload.previousFeedDigest, f1.payload.feedDigest); assert.equal(l.snapshot().payload.highestSequence, 2); assert.equal(l.witness().payload.latestFeedDigest, f2.payload.feedDigest); }));
test('same feed append is idempotent', () => withRoot((root) => { const { l, f2 } = feedChain(root); const a = l.append(f2, new Date(t0.getTime() + 120_000)); assert.equal(a.payload.feeds.length, 2); }));
test('same sequence with different digest is rejected', () => withRoot((root) => { const { x, l, f2 } = feedChain(root); const p: any = structuredClone(f2.payload); p.feedVersion = 'conflict'; const conflict = resignFeed({ payload: p }, x.publisher); assert.throws(() => l.append(conflict, new Date(t0.getTime() + 120_000)), /signature_feed_sequence_conflict/); }));
test('wrong publisher signature is rejected', () => withRoot((root) => { const x = ids(); const l = ledger(root, x); const f = createGenesisSignatureFeedV33_25({ signer: x.attacker, publisherOrganizationId: 'publisher-org', now: t0 }); assert.throws(() => l.append(f, t0), /signature_feed_signature_invalid/); }));
test('stale feed is rejected', () => withRoot((root) => { const x = ids(); const l = ledger(root, x, t0); const old = new Date(t0.getTime() - 3 * 24 * 60 * 60_000); const f = createGenesisSignatureFeedV33_25({ signer: x.publisher, publisherOrganizationId: 'publisher-org', now: old, expiresInMs: 7 * 24 * 60 * 60_000 }); assert.throws(() => l.append(f, t0), /signature_feed_stale/); }));
test('future feed is rejected', () => withRoot((root) => { const x = ids(); const l = ledger(root, x, t0); const f = createGenesisSignatureFeedV33_25({ signer: x.publisher, publisherOrganizationId: 'publisher-org', now: new Date(t0.getTime() + 120_000) }); assert.throws(() => l.append(f, t0), /signature_feed_from_future/); }));
test('feed chain digest mismatch is rejected', () => withRoot((root) => { const x = ids(); const l = ledger(root, x); const f1 = createGenesisSignatureFeedV33_25({ signer: x.publisher, publisherOrganizationId: 'publisher-org', now: t0 }); l.append(f1, t0); const f2 = createSignatureFeedUpdateV33_25({ previous: f1, signer: x.publisher, publisherOrganizationId: 'publisher-org', now: new Date(t0.getTime() + 60_000) }); const p: any = structuredClone(f2.payload); p.previousFeedDigest = 'f'.repeat(64); const bad = resignFeed({ payload: p }, x.publisher); assert.throws(() => l.append(bad, new Date(t0.getTime() + 60_000)), /signature_feed_chain_invalid/); }));
test('publisher continuity is enforced', () => withRoot((root) => { const x = ids(); const l = ledger(root, x); const f1 = createGenesisSignatureFeedV33_25({ signer: x.publisher, publisherOrganizationId: 'publisher-org', now: t0 }); l.append(f1, t0); const p = createSignatureFeedUpdateV33_25({ previous: f1, signer: x.publisher, publisherOrganizationId: 'other-org', now: new Date(t0.getTime() + 60_000) }); assert.throws(() => l.append(p, new Date(t0.getTime() + 60_000)), /signature_feed_publisher_continuity_invalid/); }));
test('critical rule removal is detected even after re-signing', () => withRoot((root) => { const { x, l, f1 } = feedChain(root); const f3 = createSignatureFeedUpdateV33_25({ previous: f1, signer: x.publisher, publisherOrganizationId: 'publisher-org', now: new Date(t0.getTime() + 180_000) }); const p: any = structuredClone(f3.payload); p.sequence = 3; p.previousFeedDigest = l.snapshot().payload.latestFeedDigest; p.feedId = f1.payload.feedId; p.rules = p.rules.filter((r: any) => r.ruleId !== 'EICAR_TEST_FILE'); p.ruleSetDigest = sha256(p.rules); const poisoned = resignFeed({ payload: p }, x.publisher); assert.throws(() => l.append(poisoned, new Date(t0.getTime() + 180_000)), /signature_feed_critical_rule_poisoning/); }));
test('critical rule pattern poisoning is detected', () => withRoot((root) => { const { x, l, f2 } = feedChain(root); const f3 = createSignatureFeedUpdateV33_25({ previous: f2, signer: x.publisher, publisherOrganizationId: 'publisher-org', now: new Date(t0.getTime() + 120_000) }); const p: any = structuredClone(f3.payload); const rule = p.rules.find((r: any) => r.ruleId === 'EICAR_TEST_FILE'); rule.pattern = 'harmless'; const rm = { ruleId: rule.ruleId, category: rule.category, encoding: rule.encoding, engineScope: rule.engineScope, pattern: rule.pattern, critical: rule.critical }; rule.ruleDigest = sha256(rm); p.ruleSetDigest = sha256(p.rules); const poisoned = resignFeed({ payload: p }, x.publisher); assert.throws(() => l.append(poisoned, new Date(t0.getTime() + 120_000)), /signature_feed_critical_rule_poisoning/); }));
test('rule digest tampering is rejected', () => withRoot((root) => { const { x, l, f2 } = feedChain(root); const f3 = createSignatureFeedUpdateV33_25({ previous: f2, signer: x.publisher, publisherOrganizationId: 'publisher-org', now: new Date(t0.getTime() + 120_000) }); const p: any = structuredClone(f3.payload); p.rules[0].ruleDigest = 'a'.repeat(64); p.ruleSetDigest = sha256(p.rules); const bad = resignFeed({ payload: p }, x.publisher); assert.throws(() => l.append(bad, new Date(t0.getTime() + 120_000)), /signature_feed_rule_digest_invalid/); }));
test('snapshot tampering is rejected on reopen', () => withRoot((root) => { const { x } = feedChain(root); const path = join(root, 'signature-feed-ledger.json'); const value: any = JSON.parse(readFileSync(path, 'utf8')); value.payload.highestSequence = 99; writeFileSync(path, JSON.stringify(value)); assert.throws(() => ledger(root, x, new Date(t0.getTime() + 120_000)), /signature_feed_snapshot_signature_invalid/); }));
test('witness tampering is rejected on reopen', () => withRoot((root) => { const { x } = feedChain(root); const path = join(root, 'signature-feed-witness.json'); const value: any = JSON.parse(readFileSync(path, 'utf8')); value.payload.highestSequence = 0; writeFileSync(path, JSON.stringify(value)); assert.throws(() => ledger(root, x, new Date(t0.getTime() + 120_000)), /signature_feed_witness_signature_invalid/); }));
test('signed ledger rollback is rejected by the independent witness', () => withRoot((root) => { const x = ids(); const l = ledger(root, x); const f1 = createGenesisSignatureFeedV33_25({ signer: x.publisher, publisherOrganizationId: 'publisher-org', now: t0 }); l.append(f1, t0); const oldSnapshot = readFileSync(join(root, 'signature-feed-ledger.json')); const f2 = createSignatureFeedUpdateV33_25({ previous: f1, signer: x.publisher, publisherOrganizationId: 'publisher-org', now: new Date(t0.getTime() + 60_000) }); l.append(f2, new Date(t0.getTime() + 60_000)); writeFileSync(join(root, 'signature-feed-ledger.json'), oldSnapshot); assert.throws(() => ledger(root, x, new Date(t0.getTime() + 120_000)), /signature_feed_rollback_detected/); }));
test('revoked latest feed cannot be used', () => withRoot((root) => { const { x, l, f2 } = feedChain(root); l.revoke(createSignatureFeedRevocationV33_25({ feed: f2, signer: x.revoker, reason: 'POISONED_FEED', effectiveAt: new Date(t0.getTime() + 90_000) }), new Date(t0.getTime() + 90_000)); assert.throws(() => l.assertUsable(f2, new Date(t0.getTime() + 120_000)), /signature_feed_revoked/); }));
test('old feed cannot be used after an update', () => withRoot((root) => { const { l, f1 } = feedChain(root); assert.throws(() => l.assertUsable(f1, new Date(t0.getTime() + 120_000)), /signature_feed_not_latest/); }));
test('clean package passes both independent engines', () => withRoot((root) => { const { result } = scan(root, 'clean'); assert.equal(result.alpha.payload.status, 'PASSED'); assert.equal(result.beta.payload.status, 'PASSED'); assert.equal(result.verdict.payload.status, 'FEDERATION_PASSED'); assert.equal(result.verdict.payload.distinctImplementations, true); }));
test('malware rejected by both engines yields federation rejection', () => withRoot((root) => { const { result } = scan(root, 'malicious'); assert.equal(result.alpha.payload.status, 'REJECTED'); assert.equal(result.beta.payload.status, 'REJECTED'); assert.equal(result.verdict.payload.status, 'FEDERATION_REJECTED'); }));
test('engine disagreement fails closed into quarantine', () => withRoot((root) => { const { result } = scan(root, 'alpha-only'); assert.equal(result.alpha.payload.status, 'REJECTED'); assert.equal(result.beta.payload.status, 'PASSED'); assert.equal(result.verdict.payload.status, 'FEDERATION_QUARANTINED'); assert.equal(result.verdict.payload.disagreementCount, 1); }));
test('workers are separate processes with distinct implementations', () => withRoot((root) => { const { result } = scan(root); assert.notEqual(result.alpha.payload.workerPid, process.pid); assert.notEqual(result.beta.payload.workerPid, process.pid); assert.notEqual(result.alpha.payload.workerPid, result.beta.payload.workerPid); assert.notEqual(result.alpha.payload.implementationDigest, result.beta.payload.implementationDigest); }));
test('same signing identity cannot fill scanner and federation roles', () => withRoot((root) => { const { x, l, f2 } = feedChain(root); assert.throws(() => runFederatedScannerV33_25({ package: pkg(x.packageSigner), packageRegistry: registry(x.packageSigner), trustedPackageSignerIds: [x.packageSigner.keyId], feed: f2, ledger: l, alphaIdentity: x.alpha, betaIdentity: x.beta, federationIdentity: x.alpha, now: new Date(t0.getTime() + 180_000) }), /scanner_federation_role_separation_invalid/); }));
test('same implementation path is rejected', () => withRoot((root) => { const { x, l, f2 } = feedChain(root); const path = 'scripts/scanner-engine-alpha-worker-v33_25.mjs'; assert.throws(() => runFederatedScannerV33_25({ package: pkg(x.packageSigner), packageRegistry: registry(x.packageSigner), trustedPackageSignerIds: [x.packageSigner.keyId], feed: f2, ledger: l, alphaIdentity: x.alpha, betaIdentity: x.beta, federationIdentity: x.federation, alphaWorkerPath: path, betaWorkerPath: path, now: new Date(t0.getTime() + 180_000) }), /scanner_federation_implementation_not_independent/); }));
test('missing worker fails closed', () => withRoot((root) => { const { x, l, f2 } = feedChain(root); assert.throws(() => runFederatedScannerV33_25({ package: pkg(x.packageSigner), packageRegistry: registry(x.packageSigner), trustedPackageSignerIds: [x.packageSigner.keyId], feed: f2, ledger: l, alphaIdentity: x.alpha, betaIdentity: x.beta, federationIdentity: x.federation, alphaWorkerPath: 'missing-worker.mjs', now: new Date(t0.getTime() + 180_000) }), /scanner_worker_missing/); }));
test('artifact bytes tampering is rejected before scanning', () => withRoot((root) => { const { x, l, f2 } = feedChain(root); const p: any = pkg(x.packageSigner); p.artifactBytesByPath['evidence/result.json'] = Buffer.from('tampered'); assert.throws(() => runFederatedScannerV33_25({ package: p, packageRegistry: registry(x.packageSigner), trustedPackageSignerIds: [x.packageSigner.keyId], feed: f2, ledger: l, alphaIdentity: x.alpha, betaIdentity: x.beta, federationIdentity: x.federation, now: new Date(t0.getTime() + 180_000) }), /federated_package_bytes_invalid/); }));
test('untrusted package signer is rejected', () => withRoot((root) => { const { x, l, f2 } = feedChain(root); assert.throws(() => runFederatedScannerV33_25({ package: pkg(x.attacker), packageRegistry: registry(x.packageSigner), trustedPackageSignerIds: [x.packageSigner.keyId], feed: f2, ledger: l, alphaIdentity: x.alpha, betaIdentity: x.beta, federationIdentity: x.federation, now: new Date(t0.getTime() + 180_000) }), /federated_package_signature_invalid/); }));
test('unsafe artifact path is rejected', () => { const x = ids(); assert.throws(() => createFederatedArtifactPackageV33_25({ signer: x.packageSigner, artifacts: { '../escape': { mediaType: 'text/plain', bytes: Buffer.from('x') } }, now: t0 }), /artifact_path_invalid/); });
test('empty artifact package is rejected', () => { const x = ids(); assert.throws(() => createFederatedArtifactPackageV33_25({ signer: x.packageSigner, artifacts: {}, now: t0 }), /federated_package_artifact_count_invalid/); });
test('synthetic external observations cannot qualify', () => { const x = ids(); const a = observation(x.operator1, x.verifier, { evidenceClass: 'SYNTHETIC_CONTRACT_TEST' }); const b = observation(x.operator2, x.verifier, { evidenceClass: 'SYNTHETIC_CONTRACT_TEST' }); const v = evaluateExternalScannerFederationQualificationV33_25({ observations: [a, b], observationRegistry: registry(x.operator1, x.operator2), trustedOperatorSignerIds: [x.operator1.keyId, x.operator2.keyId], verifierIdentity: x.verifier, now: t0 }); assert.equal(v.payload.status, 'EXTERNAL_SCANNER_FEDERATION_QUALIFICATION_REQUIRED'); assert.equal(v.payload.syntheticObservationCount, 2); });
test('operator cannot also be the verifier', () => { const x = ids(); const a = observation(x.operator1, x.operator1); assert.throws(() => evaluateExternalScannerFederationQualificationV33_25({ observations: [a], observationRegistry: registry(x.operator1), trustedOperatorSignerIds: [x.operator1.keyId], verifierIdentity: x.verifier, now: t0 }), /scanner_federation_observation_role_boundary_invalid/); });
test('invalid external artifact digest is rejected', () => { const x = ids(); const a = observation(x.operator1, x.verifier, { artifactDigests: { clamavReceipt: 'bad', yaraReceipt: '2'.repeat(64), feedChain: '3'.repeat(64), feedWitness: '4'.repeat(64), federationVerdict: '5'.repeat(64) } }); assert.throws(() => evaluateExternalScannerFederationQualificationV33_25({ observations: [a], observationRegistry: registry(x.operator1), trustedOperatorSignerIds: [x.operator1.keyId], verifierIdentity: x.verifier, now: t0 }), /scanner_federation_observation_artifact_digest_invalid/); });
test('same scanner organization remains unqualified', () => { const x = ids(); const a = observation(x.operator1, x.verifier, { clamavOrganizationId: 'same', yaraOrganizationId: 'same' }); const b = observation(x.operator2, x.verifier, { clamavOrganizationId: 'same', yaraOrganizationId: 'same' }); const v = evaluateExternalScannerFederationQualificationV33_25({ observations: [a, b], observationRegistry: registry(x.operator1, x.operator2), trustedOperatorSignerIds: [x.operator1.keyId, x.operator2.keyId], verifierIdentity: x.verifier, now: t0 }); assert.equal(v.payload.status, 'EXTERNAL_SCANNER_FEDERATION_QUALIFICATION_REQUIRED'); });
test('stale external feed evidence remains unqualified', () => { const x = ids(); const a = observation(x.operator1, x.verifier, { feedFresh: false }); const b = observation(x.operator2, x.verifier, { feedFresh: false }); const v = evaluateExternalScannerFederationQualificationV33_25({ observations: [a, b], observationRegistry: registry(x.operator1, x.operator2), trustedOperatorSignerIds: [x.operator1.keyId, x.operator2.keyId], verifierIdentity: x.verifier, now: t0 }); assert.equal(v.payload.acceptedObservationCount, 0); });
test('two separated live observations can qualify the external subgate but never production', () => { const x = ids(); const a = observation(x.operator1, x.verifier); const b = observation(x.operator2, x.verifier); const v = evaluateExternalScannerFederationQualificationV33_25({ observations: [a, b], observationRegistry: registry(x.operator1, x.operator2), trustedOperatorSignerIds: [x.operator1.keyId, x.operator2.keyId], verifierIdentity: x.verifier, now: t0 }); assert.equal(v.payload.status, 'EXTERNAL_SCANNER_FEDERATION_QUALIFIED'); assert.equal(v.payload.eligibleForProductionPromotion, false); assert.equal(v.payload.productionAuthority, 'NONE'); });
test('local federation evidence never claims external eligibility or effects', () => withRoot((root) => { const { result } = scan(root); assert.equal(result.verdict.payload.externalScannerFederationEligible, false); assert.equal(result.verdict.payload.externalEffectsExecuted, 0); assert.equal(result.verdict.payload.productionAuthority, 'NONE'); }));
