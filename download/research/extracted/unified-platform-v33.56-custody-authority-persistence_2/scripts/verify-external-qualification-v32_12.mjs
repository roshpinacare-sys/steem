#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { sha256 } from '../dist/src/contracts/crypto.js';
import { evaluateExternalQualificationIntegrityV32_12 } from '../dist/src/qualification/external-qualification-integrity-v32_12.js';
import { verifyExternalQualificationTrustBundleV32_12 } from '../dist/src/qualification/external-qualification-trust-v32_12.js';
import { parseStrictJsonV32_12 } from '../dist/src/validation/strict-json-v32_12.js';

const [inputPath, trustAnchorPath, trustBundlePath, evidenceRootPath, statePath, outputPath] = process.argv.slice(2);
if (!inputPath || !trustAnchorPath || !trustBundlePath || !evidenceRootPath || !statePath) {
  console.error('usage: verify-external-qualification-v32_12.mjs <verification.json> <trust-anchor.json> <signed-trust-bundle.json> <evidence-root> <replay-state.json> [output.json]');
  process.exit(64);
}

let lockPath;
let lockFd;
let lockOwned = false;
function fail(error) {
  const report = { version: '32.12', status: 'BLOCKED', productionPromotion: 'blocked', failures: [`verifier_error:${error instanceof Error ? error.message : String(error)}`] };
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) writeFileSync(resolve(outputPath), text);
  process.stdout.write(text);
  process.exitCode = 2;
}

try {
  const evaluatedAt = new Date().toISOString();
  const document = parseObjectFile(inputPath, 'verification_document');
  validateVerificationDocumentShape(document);
  if (document.schemaVersion !== '32.12' || !identifier(document.documentId) || !Array.isArray(document.bundles) || document.bundles.length === 0) throw new Error('verification_document_invalid');
  const anchor = parseObjectFile(trustAnchorPath, 'trust_anchor');
  validateTrustAnchorShape(anchor);
  const trustBundle = parseObjectFile(trustBundlePath, 'trust_bundle');
  validateTrustBundleShape(trustBundle);
  const trust = verifyExternalQualificationTrustBundleV32_12(anchor, trustBundle, evaluatedAt);

  const evidenceRoot = realpathSync(resolve(evidenceRootPath));
  const observations = document.bundles.map((bundle) => observeRawEvidence(evidenceRoot, bundle));
  const replayStatePath = resolve(statePath);
  mkdirSync(dirname(replayStatePath), { recursive: true });
  lockPath = `${replayStatePath}.lock`;
  lockFd = openSync(lockPath, 'wx', 0o600);
  lockOwned = true;
  const state = loadReplayState(replayStatePath);
  const report = evaluateExternalQualificationIntegrityV32_12({
    purpose: trust.purpose,
    policy: trust.policy,
    evaluatedAt,
    keyRegistry: trust.keyRegistry,
    authorizations: trust.authorizations,
    bundles: document.bundles,
    observations,
    previouslyConsumedNonces: state.consumedNonces,
    previousWitnessCheckpoints: state.witnessCheckpoints,
  });

  let stateGeneration = state.generation;
  if (report.status === 'QUALIFIED') {
    const nextState = buildNextState(state, report.stateDelta.consumedNonces, report.stateDelta.witnessCheckpoints, evaluatedAt);
    atomicWriteJson(replayStatePath, nextState);
    stateGeneration = nextState.generation;
  }
  const material = {
    ...report,
    verifierContext: {
      evaluatedAt,
      trustAnchorId: trust.trustAnchorId,
      trustBundleId: trust.trustBundleId,
      trustBundleDigest: trust.trustBundleDigest,
      trustBundleSignerKeyId: trust.trustBundleSignerKeyId,
      trustBundleSignerFingerprint: trust.trustBundleSignerFingerprint,
      evidenceRoot,
      replayStateGeneration: stateGeneration,
      observationsSource: 'verifier-filesystem',
      evaluationTimeSource: 'verifier-system-clock',
      trustKeysSource: 'out-of-band-signed-trust-bundle',
    },
  };
  const finalReport = { ...material, verifierReportDigest: sha256(material) };
  const text = `${JSON.stringify(finalReport, null, 2)}\n`;
  if (outputPath) writeFileSync(resolve(outputPath), text);
  process.stdout.write(text);
  process.exitCode = report.status === 'QUALIFIED' && report.productionPromotion === 'eligible-for-authorized-decision' ? 0 : 2;
} catch (error) {
  fail(error);
} finally {
  if (lockFd !== undefined) closeSync(lockFd);
  if (lockOwned && lockPath !== undefined) rmSync(lockPath, { force: true });
}

function parseObjectFile(path, label) {
  const value = parseStrictJsonV32_12(readFileSync(resolve(path), 'utf8'));
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}_invalid`);
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(required)) throw new Error(`${label}_unexpected_fields`);
}


function validateVerificationDocumentShape(document) {
  exactKeys(document, ['schemaVersion', 'documentId', 'bundles'], 'verification_document');
  requireArray(document.bundles, 'verification_document.bundles').forEach((bundle, index) => {
    const value = requireObject(bundle, `verification_document.bundles[${index}]`);
    exactKeys(value, ['collector', 'reviewer', 'witness'], `verification_document.bundles[${index}]`);
    validateSignedEnvelopeShape(value.collector, `verification_document.bundles[${index}].collector`, validateCollectorShape);
    validateSignedEnvelopeShape(value.reviewer, `verification_document.bundles[${index}].reviewer`, validateReviewerShape);
    validateSignedEnvelopeShape(value.witness, `verification_document.bundles[${index}].witness`, validateWitnessShape);
  });
}

function validateTrustAnchorShape(anchor) {
  exactKeys(anchor, ['schemaVersion', 'trustAnchorId', 'rootKeys', 'allowedTrustBundleSignerKeyIds'], 'trust_anchor');
  requireArray(anchor.rootKeys, 'trust_anchor.rootKeys').forEach((record, index) => validatePublicKeyShape(record, `trust_anchor.rootKeys[${index}]`));
  requireArray(anchor.allowedTrustBundleSignerKeyIds, 'trust_anchor.allowedTrustBundleSignerKeyIds');
}

function validateTrustBundleShape(bundle) {
  validateSignedEnvelopeShape(bundle, 'trust_bundle', (payload, label) => {
    exactKeys(payload, ['schemaVersion', 'trustBundleId', 'purpose', 'issuedAt', 'expiresAt', 'policy', 'authorizedKeys'], label);
    const policy = requireObject(payload.policy, `${label}.policy`);
    exactKeys(policy, ['schemaVersion', 'policyId', 'policyDigest', 'expectedRunId', 'expectedSourceDigest', 'expectedArtifactDigest', 'expectedToolchainDigest', 'maximumEvidenceAgeMs', 'maximumClockSkewMs', 'minimumExecutionMode', 'requireWitness', 'requiredGateIds'], `${label}.policy`);
    requireArray(policy.requiredGateIds, `${label}.policy.requiredGateIds`);
    requireArray(payload.authorizedKeys, `${label}.authorizedKeys`).forEach((authorization, index) => {
      const value = requireObject(authorization, `${label}.authorizedKeys[${index}]`);
      exactKeys(value, ['role', 'actorId', 'keyId', 'keyFingerprint', 'organizationId', 'allowedGateIds', 'credentialValidFrom', 'credentialValidUntil', 'publicKey'], `${label}.authorizedKeys[${index}]`);
      requireArray(value.allowedGateIds, `${label}.authorizedKeys[${index}].allowedGateIds`);
      validatePublicKeyShape(value.publicKey, `${label}.authorizedKeys[${index}].publicKey`);
    });
  });
}

function validateSignedEnvelopeShape(envelope, label, payloadValidator) {
  const value = requireObject(envelope, label);
  exactKeys(value, ['payload', 'issuerKeyId', 'algorithm', 'signature'], label);
  payloadValidator(requireObject(value.payload, `${label}.payload`), `${label}.payload`);
}

function validateCollectorShape(payload, label) {
  exactKeys(payload, ['identity', 'executionMode', 'evidenceClass', 'synthetic', 'state', 'challengeNonce', 'startedAt', 'completedAt', 'collectedAt', 'collector', 'rawEvidence'], label);
  validateIdentityShape(payload.identity, `${label}.identity`);
  validateActorShape(payload.collector, `${label}.collector`);
  const raw = requireObject(payload.rawEvidence, `${label}.rawEvidence`);
  exactKeys(raw, ['path', 'sha256', 'bytes', 'externalResponseIds'], `${label}.rawEvidence`);
  requireArray(raw.externalResponseIds, `${label}.rawEvidence.externalResponseIds`);
}

function validateReviewerShape(payload, label) {
  exactKeys(payload, ['identity', 'challengeNonce', 'collectorStatementDigest', 'rawEvidenceDigest', 'reviewedAt', 'reviewer', 'verdict', 'rationale'], label);
  validateIdentityShape(payload.identity, `${label}.identity`);
  validateActorShape(payload.reviewer, `${label}.reviewer`);
}

function validateWitnessShape(payload, label) {
  exactKeys(payload, ['identity', 'challengeNonce', 'collectorStatementDigest', 'reviewerStatementDigest', 'witnessedAt', 'witness', 'checkpointSequence', 'previousCheckpointDigest'], label);
  validateIdentityShape(payload.identity, `${label}.identity`);
  validateActorShape(payload.witness, `${label}.witness`);
}

function validateIdentityShape(value, label) {
  const identity = requireObject(value, label);
  exactKeys(identity, ['schemaVersion', 'runId', 'qualificationId', 'gateId', 'sourceDigest', 'artifactDigest', 'toolchainDigest', 'environmentFingerprint', 'policyDigest', 'adapterVersion'], label);
}

function validateActorShape(value, label) {
  const actor = requireObject(value, label);
  exactKeys(actor, ['actorId', 'keyId', 'keyFingerprint', 'processId', 'hostId', 'organizationId', 'credentialValidFrom', 'credentialValidUntil'], label);
}

function validatePublicKeyShape(value, label) {
  const record = requireObject(value, label);
  allowedKeys(record, ['keyId', 'spkiDerBase64', 'fingerprint', 'revoked'], ['revokedAt'], label);
}

function requireObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}_invalid`);
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label}_invalid`);
  return value;
}

function allowedKeys(value, required, optional, label) {
  const actual = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !actual.includes(key)) || actual.some((key) => !allowed.has(key))) throw new Error(`${label}_unexpected_fields`);
}

function observeRawEvidence(root, bundle) {
  const raw = bundle?.collector?.payload?.rawEvidence;
  if (raw === null || typeof raw !== 'object' || typeof raw.path !== 'string') throw new Error('raw_evidence_reference_invalid');
  if (isAbsolute(raw.path) || raw.path.includes('\\') || raw.path.includes('\0')) throw new Error('raw_evidence_path_unsafe');
  const segments = raw.path.split('/');
  if (segments[0] !== 'external-qualification' || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) throw new Error('raw_evidence_path_unsafe');
  let cursor = root;
  for (const segment of segments) {
    cursor = resolve(cursor, segment);
    const info = lstatSync(cursor);
    if (info.isSymbolicLink()) throw new Error('raw_evidence_symlink_forbidden');
  }
  const actual = realpathSync(cursor);
  const rel = relative(root, actual);
  if (rel === '' || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) throw new Error('raw_evidence_root_escape');
  const info = statSync(actual);
  if (!info.isFile()) throw new Error('raw_evidence_not_regular_file');
  if (info.nlink !== 1) throw new Error('raw_evidence_hardlink_forbidden');
  const bytes = readFileSync(actual);
  if (bytes.length === 0) throw new Error('raw_evidence_empty');
  return { path: raw.path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, modifiedAt: info.mtime.toISOString() };
}

function loadReplayState(path) {
  if (!existsSync(path)) return { schemaVersion: '32.12', stateId: 'external-qualification-replay-state', generation: 0, updatedAt: null, previousStateDigest: null, consumedNonces: [], witnessCheckpoints: [], stateDigest: null };
  const state = parseObjectFile(path, 'replay_state');
  exactKeys(state, ['schemaVersion', 'stateId', 'generation', 'updatedAt', 'previousStateDigest', 'consumedNonces', 'witnessCheckpoints', 'stateDigest'], 'replay_state');
  const { stateDigest, ...material } = state;
  if (state.schemaVersion !== '32.12' || !identifier(state.stateId) || !Number.isInteger(state.generation) || state.generation < 1 || !Array.isArray(state.consumedNonces) || !Array.isArray(state.witnessCheckpoints) || !digest(stateDigest) || sha256(material) !== stateDigest) throw new Error('replay_state_invalid');
  return state;
}

function buildNextState(prior, newNonces, checkpoints, updatedAt) {
  const material = {
    schemaVersion: '32.12',
    stateId: prior.stateId,
    generation: prior.generation + 1,
    updatedAt,
    previousStateDigest: prior.stateDigest,
    consumedNonces: [...new Set([...prior.consumedNonces, ...newNonces])].sort(),
    witnessCheckpoints: [...checkpoints].sort((a, b) => a.witnessKeyId.localeCompare(b.witnessKeyId)),
  };
  return { ...material, stateDigest: sha256(material) };
}

function atomicWriteJson(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, path);
}
function identifier(value) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/.test(value); }
function digest(value) { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value); }
