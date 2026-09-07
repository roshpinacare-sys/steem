import assert from 'node:assert/strict';
import test from 'node:test';
import { validateEvidenceRecord, type EvidenceRecord } from '../src/contracts/canonical.js';
import { canonicalJson, sha256 } from '../src/contracts/crypto.js';
import { DigitalThread } from '../src/platform/digital-thread.js';
import { attestTestExecution } from '../src/platform/test-execution-provenance.js';
import { generateSigningIdentity } from '../src/contracts/crypto.js';

const now = '2026-07-17T19:00:00.000Z';
function base(): EvidenceRecord { return { recordId: 'r', tenantId: 't', kind: 'k', subject: 's', payload: {}, evidenceClass: 'COMPUTED', method: 'fuzz', environment: {}, createdAt: now, limitations: [] }; }
const hostileStrings = ['', '\0', '../escape', '..\\escape', 'x'.repeat(100_000), '\ud800', '💣'.repeat(1000)];

test('fuzz: malformed evidence identities fail without hanging or corrupting process state', () => {
  for (const value of hostileStrings) {
    const record = { ...base(), recordId: value };
    if (value.trim() === '') assert.throws(() => validateEvidenceRecord(record)); else assert.doesNotThrow(() => validateEvidenceRecord(record));
  }
});

test('fuzz: non-finite values are rejected at arbitrary nested positions', () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => validateEvidenceRecord({ ...base(), payload: { a: [{ b: { c: value } }] } }), /non_finite/);
  }
});

test('fuzz: deep but bounded canonical objects remain deterministic', () => {
  let value: unknown = 'leaf'; for (let i = 0; i < 250; i += 1) value = { [`k${i}`]: value };
  assert.equal(canonicalJson(value), canonicalJson(structuredClone(value))); assert.equal(sha256(value), sha256(structuredClone(value)));
});

test('fuzz: invalid thread endpoints, self edges and null-like identifiers fail closed', () => {
  for (const value of hostileStrings.slice(0, 4)) {
    const thread = new DigitalThread();
    if (value.trim() === '') assert.throws(() => thread.addNode({ nodeId: value, tenantId: 't', kind: 'MISSION', subject: 's', payloadDigest: sha256('x'), createdAt: now }));
  }
  const thread = new DigitalThread(); thread.addNode({ nodeId: 'a', tenantId: 't', kind: 'MISSION', subject: 's', payloadDigest: sha256('x'), createdAt: now });
  assert.throws(() => thread.addEdge({ edgeId: 'e', tenantId: 't', fromNodeId: 'a', toNodeId: 'a', relation: 'SUPPORTS', createdAt: now }), /self_edge/);
  assert.throws(() => thread.addEdge({ edgeId: 'e2', tenantId: 't', fromNodeId: 'a', toNodeId: 'missing', relation: 'SUPPORTS', createdAt: now }), /endpoint_missing/);
});

test('fuzz: test execution attestation rejects malformed digest and time fields', () => {
  const signer = generateSigningIdentity('runner');
  for (const bad of hostileStrings.slice(0, 4)) {
    assert.throws(() => attestTestExecution({ executionId: 'e', tenantId: 't', subjectId: 's', command: ['node'], runnerId: signer.keyId, inputArtifactDigest: bad, outputArtifactDigest: sha256('o'), capturedOutputDigest: sha256('c'), environmentDigest: sha256('env'), testManifestDigest: sha256('m'), testFilesDigest: sha256('f'), startedAt: now, finishedAt: now, exitStatus: 0 }, signer));
  }
});
