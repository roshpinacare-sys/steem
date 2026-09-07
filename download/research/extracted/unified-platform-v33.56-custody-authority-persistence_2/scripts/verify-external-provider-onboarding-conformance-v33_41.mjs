import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { KeyRegistry, sha256 } from '../dist/src/contracts/crypto.js';
import { verifyExternalProviderOnboardingQualificationV33_41 } from '../dist/src/app/external-provider-onboarding-conformance-v33_41.js';

const input = resolve(process.argv[2] ?? 'release-evidence/v33.41/V33_41_PROVIDER_ONBOARDING_CONFORMANCE_PROOF.json');
const output = resolve(process.argv[3] ?? 'release-evidence/v33.41/V33_41_INDEPENDENT_VERIFICATION.json');
const priorProofPath = resolve(process.argv[4] ?? 'release-evidence/v33.40/V33_40_HSM_INTEROPERABILITY_PROOF.json');
const priorVerificationPath = resolve('release-evidence/v33.40/V33_40_INDEPENDENT_VERIFICATION.json');
const priorRun = spawnSync(process.execPath, ['scripts/verify-hsm-interoperability-remote-attestation-v33_40.mjs', priorProofPath, priorVerificationPath], { encoding: 'utf8' });
if (priorRun.status !== 0) throw new Error(`v33_41_prior_verification_failed:${priorRun.stderr}`);
const priorVerification = JSON.parse(readFileSync(priorVerificationPath, 'utf8'));
if (priorVerification.status !== 'PASS') throw new Error('v33_41_prior_verification_not_pass');

const p = JSON.parse(readFileSync(input, 'utf8'));
const all = new KeyRegistry(); for (const k of p.publicKeys) all.registerExported(k);
const subset = (ids) => { const r = new KeyRegistry(); for (const id of ids) r.registerExported(p.publicKeys.find((k) => k.keyId === id)); return r; };
const trust = {
  adapterSignerRegistry: subset(p.trustedIds.adapterSigners), trustedAdapterSignerIds: p.trustedIds.adapterSigners,
  attestationAuthorityRegistry: subset(p.trustedIds.attestationAuthorities), trustedAttestationAuthorityIds: p.trustedIds.attestationAuthorities,
  rootRegistrarRegistry: subset(p.trustedIds.rootRegistrars), trustedRootRegistrarIds: p.trustedIds.rootRegistrars,
  conformanceLaboratoryRegistry: subset(p.trustedIds.laboratories), trustedConformanceLaboratoryIds: p.trustedIds.laboratories,
  revocationAuthorityRegistry: subset(p.trustedIds.revocationAuthorities), trustedRevocationAuthorityIds: p.trustedIds.revocationAuthorities,
  custodianRegistry: subset(p.trustedIds.custodians), trustedCustodianIds: p.trustedIds.custodians,
  replacementAuthorityRegistry: subset(p.trustedIds.replacementAuthorities), trustedReplacementAuthorityIds: p.trustedIds.replacementAuthorities,
  publicationAuthorityRegistry: subset(p.trustedIds.publicationAuthorities), trustedPublicationAuthorityIds: p.trustedIds.publicationAuthorities,
  monitorRegistry: subset(p.trustedIds.monitors), trustedMonitorIds: p.trustedIds.monitors,
  recoveryVerifierRegistry: subset(p.trustedIds.recoveryVerifiers), trustedRecoveryVerifierIds: p.trustedIds.recoveryVerifiers,
};
const rootBytes = p.rootCertificateBytesBase64.map((x) => Buffer.from(x, 'base64'));
const rootMap = new Map(p.roots.map((r, i) => [r.payload.rootManifestDigest, rootBytes[i]]));
const moduleBytes = p.moduleBytesBase64.map((x) => Buffer.from(x, 'base64'));
const moduleMap = new Map(p.manifests.map((m, i) => [m.payload.manifestDigest, moduleBytes[i]]));
const nonces = p.sessionNoncesBase64.map((x) => Buffer.from(x, 'base64'));
const nonceMap = new Map(p.conformance.map((r, i) => [r.payload.receiptDigest, nonces[i]]));
const checkpointBytes = Buffer.from(p.checkpointBytesBase64, 'base64');
const now = new Date('2026-07-23T10:00:00.000Z');
const verdict = verifyExternalProviderOnboardingQualificationV33_41({
  priorV33_40Verdict: p.priorV33_40Verdict, roots: p.roots, rootCertificateBytesByManifestDigest: rootMap, manifests: p.manifests,
  moduleBytesByManifestDigest: moduleMap, attestations: p.attestations, conformanceReceipts: p.conformance,
  sessionNoncesByReceiptDigest: nonceMap, revocationSnapshot: p.revocation, replacementCertificate: p.replacement,
  replacementApprovals: p.replacementApprovals, oldAttestation: p.attestations.find((a) => a.payload.providerId === p.replacement.payload.oldProviderId).payload,
  newTrustRoot: p.roots.find((r) => r.payload.providerId === p.replacement.payload.newProviderId).payload,
  newConformanceReceipt: p.conformance.find((r) => r.payload.providerId === p.replacement.payload.newProviderId).payload,
  checkpointAnchor: p.checkpointAnchor, checkpointBytes, monitorReceipts: p.monitorReceipts, siteRecoveryReceipt: p.siteRecovery,
  restoredBytes: checkpointBytes, trust, verifiedAt: now,
});
const envelopes = [...p.manifests, ...p.attestations, ...p.roots, ...p.conformance, p.revocation, ...p.replacementApprovals, p.replacement, p.checkpointAnchor, ...p.monitorReceipts, p.siteRecovery];
const signaturesValid = envelopes.every((e) => all.verifyAt(e, now));
const priorProof = JSON.parse(readFileSync(priorProofPath, 'utf8'));
const checks = {
  version: p.version === '33.41', priorV33_40Verified: true, priorProofDigestBound: p.priorV33_40ProofDigest === sha256(priorProof),
  signaturesValid, signatureCount: envelopes.length === 26, newSignatureCount: p.summary.newSignatureCount === 20,
  trustRootCount: p.roots.length === 4, conformanceReceiptCount: p.conformance.length === 4, monitorQuorum: p.monitorReceipts.length === 3,
  finalVerdictRecomputed: verdict.verdictDigest === p.finalVerdict.verdictDigest,
  attacksVerified: Object.values(p.attacks).every(Boolean),
  truthBoundary: p.truthBoundary.productionAuthority === 'NONE' && p.truthBoundary.externalEffectsExecuted === 0 && p.truthBoundary.externalTrustRootsObserved === false && p.truthBoundary.externalHardwareSessionsObserved === false,
  productionBlocked: verdict.productionAuthority === 'NONE' && verdict.externalEffectsExecuted === 0 && verdict.externalHumanParticipants === 0,
};
const status = Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL';
const result = { version: '33.41', generatedAt: new Date().toISOString(), status, signatureCount: envelopes.length, newSignatureCount: p.summary.newSignatureCount, providerCount: verdict.trustRootCount, finalStatus: verdict.status, externalTrustRootsObserved: verdict.externalTrustRootsObserved, externalHardwareSessionsObserved: verdict.externalHardwareSessionsObserved, publicCheckpointObserved: verdict.publicCheckpointObserved, externalHumanParticipants: verdict.externalHumanParticipants, productionAuthority: verdict.productionAuthority, checks };
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result, null, 2)); if (status !== 'PASS') process.exit(1);
