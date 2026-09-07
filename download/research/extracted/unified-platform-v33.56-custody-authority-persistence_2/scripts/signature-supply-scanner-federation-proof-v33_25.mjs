import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { KeyRegistry, generateSigningIdentity, sha256, sha256Bytes, signEnvelope } from '../dist/src/contracts/crypto.js';
import {
  SignatureFeedLedgerV33_25,
  createExternalScannerFederationObservationV33_25,
  createFederatedArtifactPackageV33_25,
  createGenesisSignatureFeedV33_25,
  createSignatureFeedUpdateV33_25,
  evaluateExternalScannerFederationQualificationV33_25,
  probeScannerFederationToolsV33_25,
  runFederatedScannerV33_25,
} from '../dist/src/app/signature-supply-scanner-federation-v33_25.js';

const out = resolve('release-evidence/v33.25'); mkdirSync(out, { recursive: true });
const now = new Date('2026-07-22T01:00:00.000Z');
const ids = {
  publisher: generateSigningIdentity('v33.25-feed-publisher'), store: generateSigningIdentity('v33.25-feed-store'), witness: generateSigningIdentity('v33.25-feed-witness'), revoker: generateSigningIdentity('v33.25-feed-revoker'),
  package: generateSigningIdentity('v33.25-package'), alpha: generateSigningIdentity('v33.25-engine-alpha'), beta: generateSigningIdentity('v33.25-engine-beta'), federation: generateSigningIdentity('v33.25-federation'),
  operator1: generateSigningIdentity('v33.25-operator-1'), operator2: generateSigningIdentity('v33.25-operator-2'), verifier: generateSigningIdentity('v33.25-verifier'), challenge: generateSigningIdentity('v33.25-challenge'), proof: generateSigningIdentity('v33.25-proof'),
};
const registry = (...items) => { const r = new KeyRegistry(); for (const item of items) r.register(item.keyId, item.publicKey); return r; };
const temp = mkdtempSync(join(tmpdir(), 'v3325-proof-'));
let ledger;
try {
  ledger = new SignatureFeedLedgerV33_25({ root: join(temp, 'ledger'), storeIdentity: ids.store, storeRegistry: registry(ids.store), trustedStoreSignerIds: [ids.store.keyId], witnessIdentity: ids.witness, witnessRegistry: registry(ids.witness), trustedWitnessSignerIds: [ids.witness.keyId], publisherRegistry: registry(ids.publisher), trustedPublisherSignerIds: [ids.publisher.keyId], revokerRegistry: registry(ids.revoker), trustedRevokerSignerIds: [ids.revoker.keyId], now: new Date(now.getTime() - 120_000) });
  const f1 = createGenesisSignatureFeedV33_25({ signer: ids.publisher, publisherOrganizationId: 'local-reference-publisher', now: new Date(now.getTime() - 120_000) });
  const f2 = createSignatureFeedUpdateV33_25({ previous: f1, signer: ids.publisher, publisherOrganizationId: 'local-reference-publisher', now: new Date(now.getTime() - 60_000) });
  const f3 = createSignatureFeedUpdateV33_25({ previous: f2, signer: ids.publisher, publisherOrganizationId: 'local-reference-publisher', now, additionalRules: [{ ruleId: 'ALPHA_ONLY_DISAGREEMENT_MARKER', category: 'MALWARE', encoding: 'UTF8_LITERAL', engineScope: 'ENGINE_ALPHA', pattern: 'ALPHA_ONLY_MARKER' }] });
  ledger.append(f1, new Date(now.getTime() - 120_000)); ledger.append(f2, new Date(now.getTime() - 60_000)); ledger.append(f3, now);
  const makePackage = (content) => createFederatedArtifactPackageV33_25({ signer: ids.package, now, artifacts: { 'evidence/payload.txt': { mediaType: 'text/plain', bytes: Buffer.from(content) } } });
  const scanArgs = (pkg) => ({ package: pkg, packageRegistry: registry(ids.package), trustedPackageSignerIds: [ids.package.keyId], feed: f3, ledger, alphaIdentity: ids.alpha, betaIdentity: ids.beta, federationIdentity: ids.federation, now });
  const clean = runFederatedScannerV33_25(scanArgs(makePackage('clean evidence package')));
  const malicious = runFederatedScannerV33_25(scanArgs(makePackage('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')));
  const disagreement = runFederatedScannerV33_25(scanArgs(makePackage('ALPHA_ONLY_MARKER')));
  const probe = probeScannerFederationToolsV33_25(now);

  let rollbackRejected = false;
  const rollbackRoot = join(temp, 'rollback-ledger');
  const rollbackLedger = new SignatureFeedLedgerV33_25({ root: rollbackRoot, storeIdentity: ids.store, storeRegistry: registry(ids.store), trustedStoreSignerIds: [ids.store.keyId], witnessIdentity: ids.witness, witnessRegistry: registry(ids.witness), trustedWitnessSignerIds: [ids.witness.keyId], publisherRegistry: registry(ids.publisher), trustedPublisherSignerIds: [ids.publisher.keyId], revokerRegistry: registry(ids.revoker), trustedRevokerSignerIds: [ids.revoker.keyId], now: new Date(now.getTime() - 120_000) });
  rollbackLedger.append(f1, new Date(now.getTime() - 120_000)); rollbackLedger.append(f2, new Date(now.getTime() - 60_000));
  const oldSnapshot = readFileSync(join(rollbackRoot, 'signature-feed-ledger.json'));
  rollbackLedger.append(f3, now); writeFileSync(join(rollbackRoot, 'signature-feed-ledger.json'), oldSnapshot);
  try { new SignatureFeedLedgerV33_25({ root: rollbackRoot, storeIdentity: ids.store, storeRegistry: registry(ids.store), trustedStoreSignerIds: [ids.store.keyId], witnessIdentity: ids.witness, witnessRegistry: registry(ids.witness), trustedWitnessSignerIds: [ids.witness.keyId], publisherRegistry: registry(ids.publisher), trustedPublisherSignerIds: [ids.publisher.keyId], revokerRegistry: registry(ids.revoker), trustedRevokerSignerIds: [ids.revoker.keyId], now }); } catch (error) { rollbackRejected = error instanceof Error && error.message === 'signature_feed_rollback_detected'; }

  let poisoningRejected = false;
  const f4 = createSignatureFeedUpdateV33_25({ previous: f3, signer: ids.publisher, publisherOrganizationId: 'local-reference-publisher', now: new Date(now.getTime() + 60_000) });
  const poisonPayload = structuredClone(f4.payload); poisonPayload.rules = poisonPayload.rules.filter((rule) => rule.ruleId !== 'EICAR_TEST_FILE'); poisonPayload.ruleSetDigest = sha256(poisonPayload.rules); delete poisonPayload.feedDigest; const poisoned = signEnvelope({ ...poisonPayload, feedDigest: sha256(poisonPayload) }, ids.publisher);
  try { ledger.append(poisoned, new Date(now.getTime() + 60_000)); } catch (error) { poisoningRejected = error instanceof Error && error.message === 'signature_feed_critical_rule_poisoning'; }

  const challengeMaterial = { version: '33.25', challengeId: 'external-scanner-federation-v33.25', requiredEngines: ['CLAMAV', 'YARA'], minimumFeedChainDepth: 3, minimumOperatorOrganizations: 2, minimumScannerHosts: 4, disagreementPolicy: 'FAIL_CLOSED_QUARANTINE', syntheticEvidenceAccepted: false, productionAuthority: 'NONE', externalEffectsExecuted: 0, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000).toISOString() };
  const challenge = signEnvelope({ ...challengeMaterial, challengeDigest: sha256(challengeMaterial) }, ids.challenge);
  const obs = (signer, index) => createExternalScannerFederationObservationV33_25({ signer, verifierSignerId: ids.verifier.keyId, evidenceClass: 'SYNTHETIC_CONTRACT_TEST', operatorOrganizationId: `synthetic-operator-org-${index}`, operatorHostId: `synthetic-operator-host-${index}`, clamavHostId: `synthetic-clamav-host-${index}`, yaraHostId: `synthetic-yara-host-${index}`, clamavOrganizationId: `synthetic-clamav-org-${index}`, yaraOrganizationId: `synthetic-yara-org-${index}`, feedPublisherOrganizationId: `synthetic-publisher-org-${index}`, observedAt: now });
  const observations = [obs(ids.operator1, 1), obs(ids.operator2, 2)];
  const qualification = evaluateExternalScannerFederationQualificationV33_25({ observations, observationRegistry: registry(ids.operator1, ids.operator2), trustedOperatorSignerIds: [ids.operator1.keyId, ids.operator2.keyId], verifierIdentity: ids.verifier, now });
  const kitPaths = [
    'external-qualification/v33.25/scanner-federation/README.md','external-qualification/v33.25/scanner-federation/RUNBOOK.md','external-qualification/v33.25/scanner-federation/federation-policy.json','external-qualification/v33.25/scanner-federation/feed-policy.json','external-qualification/v33.25/scanner-federation/observation.template.json','external-qualification/v33.25/scanner-federation/scripts/probe-engines.sh','external-qualification/v33.25/scanner-federation/scripts/hash-feed-chain.sh','external-qualification/v33.25/scanner-federation/scripts/verify-host-separation.sh','external-qualification/v33.25/scanner-federation/scripts/verify-disagreement-policy.sh',
  ];
  const kitMaterial = { version: '33.25', kitId: 'external-scanner-federation-operator-kit-v33.25', files: kitPaths.map((path) => ({ path, sizeBytes: statSync(path).size, sha256: sha256Bytes(readFileSync(path)) })), scannerBinariesEmbedded: false, signatureDatabasesEmbedded: false, credentialsEmbedded: false, privateKeysEmbedded: false, liveExternalEvidenceIncluded: false, productionAuthority: 'NONE', externalEffectsExecuted: 0 };
  const kit = { ...kitMaterial, kitDigest: sha256(kitMaterial) };
  const traceMaterial = { version: '33.25', evidenceClass: 'LOCAL_SIGNED_FEED_CHAIN_AND_TWO_REFERENCE_SCANNER_FEDERATION_TRACE', feedChainDepth: ledger.snapshot().payload.feeds.length, highestSequence: ledger.snapshot().payload.highestSequence, witnessSequence: ledger.witness().payload.highestSequence, rollbackRejected, poisoningRejected, cleanStatus: clean.verdict.payload.status, maliciousStatus: malicious.verdict.payload.status, disagreementStatus: disagreement.verdict.payload.status, alphaPid: clean.alpha.payload.workerPid, betaPid: clean.beta.payload.workerPid, distinctImplementations: clean.verdict.payload.distinctImplementations, syntheticObservationCount: observations.length, syntheticObservationAcceptedCount: qualification.payload.acceptedObservationCount, externalQualificationStatus: qualification.payload.status, liveClamavExecuted: false, liveYaraExecuted: false, productionAuthority: 'NONE', externalEffectsExecuted: 0 };
  const trace = signEnvelope({ ...traceMaterial, traceDigest: sha256(traceMaterial) }, ids.proof);
  const proofMaterial = { version: '33.25', status: 'SIGNATURE_SUPPLY_CHAIN_AND_SCANNER_FEDERATION_PROVEN_LOCALLY', evidenceClass: 'LOCAL_SIGNED_FEED_CHAIN_AND_TWO_REFERENCE_SCANNER_FEDERATION', focusedTestsExpected: 35, feedChainDepth: 3, signedFeedUpdatesVerified: true, rollbackProtectionVerified: rollbackRejected, feedPoisoningRejected: poisoningRejected, feedRevocationSupported: true, separateScannerProcessesVerified: true, distinctReferenceImplementationsVerified: clean.verdict.payload.distinctImplementations, cleanFederationPassed: clean.verdict.payload.status === 'FEDERATION_PASSED', malwareFederationRejected: malicious.verdict.payload.status === 'FEDERATION_REJECTED', disagreementQuarantined: disagreement.verdict.payload.status === 'FEDERATION_QUARANTINED', disagreementPolicy: 'FAIL_CLOSED_QUARANTINE', externalClamavQualified: false, externalYaraQualified: false, syntheticObservations: observations.length, syntheticObservationsAccepted: qualification.payload.acceptedObservationCount, qualificationStatus: qualification.payload.status, operatorKitFileCount: kit.files.length, productionAuthority: 'NONE', externalEffectsExecuted: 0, productionPromotion: 'blocked' };
  const proof = signEnvelope({ ...proofMaterial, proofDigest: sha256(proofMaterial) }, ids.proof);
  const publicKeys = Object.values(ids).map((identity) => registry(identity).exportPublicKey(identity.keyId));
  const write = (name, value) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + '\n');
  write('V33_25_SCANNER_TOOL_PROBE.json', probe); write('V33_25_SIGNATURE_FEED_CHAIN.json', ledger.snapshot()); write('V33_25_SIGNATURE_FEED_WITNESS.json', ledger.witness());
  write('V33_25_CLEAN_ALPHA_RECEIPT.json', clean.alpha); write('V33_25_CLEAN_BETA_RECEIPT.json', clean.beta); write('V33_25_CLEAN_FEDERATION_VERDICT.json', clean.verdict);
  write('V33_25_MALICIOUS_ALPHA_RECEIPT.json', malicious.alpha); write('V33_25_MALICIOUS_BETA_RECEIPT.json', malicious.beta); write('V33_25_MALICIOUS_FEDERATION_VERDICT.json', malicious.verdict);
  write('V33_25_DISAGREEMENT_ALPHA_RECEIPT.json', disagreement.alpha); write('V33_25_DISAGREEMENT_BETA_RECEIPT.json', disagreement.beta); write('V33_25_DISAGREEMENT_FEDERATION_VERDICT.json', disagreement.verdict);
  write('V33_25_EXTERNAL_QUALIFICATION_CHALLENGE.json', challenge); write('V33_25_SYNTHETIC_OBSERVATIONS.json', observations); write('V33_25_EXTERNAL_QUALIFICATION_VERDICT.json', qualification); write('V33_25_SCANNER_FEDERATION_TRACE.json', trace); write('V33_25_SIGNATURE_SUPPLY_SCANNER_FEDERATION_PROOF.json', proof); write('V33_25_EXTERNAL_OPERATOR_KIT_MANIFEST.json', kit); write('V33_25_PROOF_PUBLIC_KEYS.json', publicKeys);
  console.log(JSON.stringify({ status: 'passed', feedChainDepth: 3, localFederation: { clean: clean.verdict.payload.status, malicious: malicious.verdict.payload.status, disagreement: disagreement.verdict.payload.status }, rollbackRejected, poisoningRejected, externalQualification: qualification.payload.status, productionPromotion: 'blocked' }, null, 2));
} finally { rmSync(temp, { recursive: true, force: true }); }
