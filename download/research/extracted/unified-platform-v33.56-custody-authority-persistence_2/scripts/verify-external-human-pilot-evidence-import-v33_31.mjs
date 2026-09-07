import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  KeyRegistry,
  sha256,
  sha256Bytes,
} from '../dist/src/contracts/crypto.js';
import { verifyExternalHumanPilotQualificationVerdictV33_31 } from '../dist/src/app/external-human-pilot-evidence-import-v33_31.js';

const root = resolve('.');
const out = resolve(root, 'release-evidence/v33.31');
const read = (name) => JSON.parse(readFileSync(resolve(out, name), 'utf8'));
const keys = read('V33_31_PROOF_PUBLIC_KEYS.json');
const registry = new KeyRegistry();
for (const row of keys) {
  const { role: _role, ...record } = row;
  registry.registerExported(record);
}
const byRole = new Map(keys.map((row) => [row.role, row]));
const requireRole = (role) => {
  const row = byRole.get(role);
  if (!row) throw new Error(`v33_31_public_key_role_missing:${role}`);
  return row;
};
const verifyEnvelope = (envelope, role, at, digestField) => {
  const expected = requireRole(role);
  if (envelope.issuerKeyId !== expected.keyId) throw new Error(`v33_31_${role}_issuer_invalid`);
  if (!registry.verifyAt(envelope, at)) throw new Error(`v33_31_${role}_signature_invalid`);
  if (digestField) {
    const { [digestField]: digest, ...material } = envelope.payload;
    if (digest !== sha256(material)) throw new Error(`v33_31_${role}_${digestField}_invalid`);
  }
  return envelope.payload;
};

const protocolEnvelope = read('V33_31_SYNTHETIC_PROTOCOL.json');
const protocol = verifyEnvelope(protocolEnvelope, 'researcher', protocolEnvelope.payload.issuedAt, 'protocolDigest');
const challengeEnvelope = read('V33_31_SYNTHETIC_EXPORT_CHALLENGE.json');
const challenge = verifyEnvelope(challengeEnvelope, 'importer', challengeEnvelope.payload.issuedAt, 'challengeDigest');
const manifestEnvelope = read('V33_31_SYNTHETIC_PACKAGE_MANIFEST.json');
const manifest = verifyEnvelope(manifestEnvelope, 'exporter', manifestEnvelope.payload.exportedAt, 'packageDigest');
const receiptEnvelope = read('V33_31_SYNTHETIC_IMPORT_RECEIPT.json');
const receipt = verifyEnvelope(receiptEnvelope, 'importer', receiptEnvelope.payload.importedAt, 'receiptDigest');
const checkpointEnvelope = read('V33_31_SYNTHETIC_IMPORT_CHECKPOINT.json');
const checkpoint = verifyEnvelope(checkpointEnvelope, 'importer', checkpointEnvelope.payload.generatedAt, 'checkpointDigest');
const continuityEnvelope = read('V33_31_METRIC_CONTINUITY_RECEIPT.json');
const continuity = verifyEnvelope(continuityEnvelope, 'continuity', continuityEnvelope.payload.generatedAt, 'continuityDigest');
const proofEnvelope = read('V33_31_EXTERNAL_HUMAN_PILOT_IMPORT_PROOF.json');
const proof = verifyEnvelope(proofEnvelope, 'proof', '2026-07-22T11:00:00.000Z', 'proofDigest');
const verdictEnvelope = read('V33_31_SYNTHETIC_QUALIFICATION_VERDICT.json');
const verdict = verifyExternalHumanPilotQualificationVerdictV33_31({
  verdict: verdictEnvelope,
  verifierRegistry: registry,
  trustedVerifierIds: [requireRole('verifier').keyId],
  expectedProtocolDigest: protocol.protocolDigest,
  expectedPackageDigest: manifest.packageDigest,
});

if (challenge.protocolDigest !== protocol.protocolDigest || manifest.protocolDigest !== protocol.protocolDigest) throw new Error('v33_31_protocol_binding_invalid');
if (manifest.challengeDigest !== challenge.challengeDigest || receipt.challengeDigest !== challenge.challengeDigest) throw new Error('v33_31_challenge_binding_invalid');
if (receipt.packageDigest !== manifest.packageDigest || verdict.packageDigest !== manifest.packageDigest) throw new Error('v33_31_package_binding_invalid');
if (verdict.importReceiptDigest !== receipt.receiptDigest) throw new Error('v33_31_receipt_binding_invalid');
if (!checkpoint.consumedChallengeDigests.includes(challenge.challengeDigest) || !checkpoint.consumedPackageDigests.includes(manifest.packageDigest)) throw new Error('v33_31_checkpoint_consumption_invalid');
if (checkpoint.sequence !== 1 || receipt.checkpointSequence !== 1) throw new Error('v33_31_checkpoint_sequence_invalid');

let totalBytes = 0;
for (const artifact of manifest.artifactManifest) {
  const full = resolve(out, artifact.path);
  if (!full.startsWith(resolve(out, 'observation-artifacts') + '/')) throw new Error('v33_31_artifact_path_invalid');
  const bytes = readFileSync(full);
  totalBytes += bytes.byteLength;
  if (bytes.byteLength !== artifact.sizeBytes || sha256Bytes(bytes) !== artifact.sha256) throw new Error(`v33_31_artifact_integrity_invalid:${artifact.path}`);
  const parsed = JSON.parse(bytes.toString('utf8'));
  if (parsed.version !== '33.31' || parsed.studyId !== manifest.studyId || parsed.protocolDigest !== manifest.protocolDigest) throw new Error(`v33_31_artifact_binding_invalid:${artifact.path}`);
  if (parsed.participantId !== artifact.participantId || parsed.sessionDigest !== artifact.sessionDigest || parsed.flow !== artifact.flow) throw new Error(`v33_31_artifact_record_mismatch:${artifact.path}`);
}
if (manifest.artifactManifest.length !== 10 || receipt.artifactCount !== 10 || totalBytes > challenge.maximumTotalBytes) throw new Error('v33_31_artifact_inventory_invalid');
if (receipt.participantCount !== 5 || manifest.participantCount !== 5 || proof.syntheticReferenceParticipants !== 5) throw new Error('v33_31_synthetic_participant_count_invalid');
if (receipt.externalHumanParticipants !== 0 || proof.externalHumanParticipants !== 0) throw new Error('v33_31_external_human_count_false_claim');
if (manifest.evidenceClass !== 'SYNTHETIC_REFERENCE' || receipt.status !== 'SYNTHETIC_REFERENCE_NOT_EXTERNAL') throw new Error('v33_31_synthetic_classification_invalid');
if (verdict.humanPilotPassed || proof.humanPilotPassed || verdict.status !== 'HUMAN_UX_PILOT_REQUIRED') throw new Error('v33_31_false_human_pilot_pass');
if (verdict.externalProvenanceVerified) throw new Error('v33_31_false_external_provenance');
if (proof.productionAuthority !== 'NONE' || proof.externalEffectsExecuted !== 0 || proof.productionPromotion !== 'blocked') throw new Error('v33_31_production_boundary_invalid');
if (receipt.productionAuthority !== 'NONE' || receipt.externalEffectsExecuted !== 0 || verdict.productionAuthority !== 'NONE' || verdict.externalEffectsExecuted !== 0) throw new Error('v33_31_receipt_verdict_boundary_invalid');
if (proof.roleProofCount !== 10 || proof.observationArtifactCount !== 10 || proof.attackCount !== 4) throw new Error('v33_31_proof_counts_invalid');
if (Object.values(proof.attacks).some((value) => value === 'SURVIVED')) throw new Error('v33_31_attack_survived');
if (continuity.metricInventoryCount !== 54 || continuity.parameterCount !== 14 || proof.metricInventoryCount !== 54 || proof.parameterCount !== 14) throw new Error('v33_31_metric_continuity_invalid');
if (continuity.externalProgress.humanPilotParticipants !== 0) throw new Error('v33_31_continuity_external_human_false_claim');

console.log(JSON.stringify({
  status: 'passed',
  signaturesVerified: 7,
  qualificationVerdictVerified: true,
  artifactFilesVerified: manifest.artifactManifest.length,
  artifactBytesVerified: totalBytes,
  syntheticReferenceParticipants: receipt.participantCount,
  externalHumanParticipants: receipt.externalHumanParticipants,
  humanPilotPassed: verdict.humanPilotPassed,
  replayCheckpointSequence: checkpoint.sequence,
  attacksKilled: Object.keys(proof.attacks),
  metricInventoryCount: continuity.metricInventoryCount,
  parameterCount: continuity.parameterCount,
  productionPromotion: 'blocked',
}, null, 2));
