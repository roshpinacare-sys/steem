import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEvidenceFreshness, type EvidenceArtifactObservation } from '../src/platform/evidence-freshness.js';
const digest = 'a'.repeat(64); const artifactDigest = 'b'.repeat(64); const now = '2026-07-18T03:00:00.000Z';
function row(overrides: Partial<EvidenceArtifactObservation> = {}): EvidenceArtifactObservation { return { evidenceId: 'ev-1', path: 'evidence.json', producedAt: '2026-07-18T02:59:00.000Z', sourceDigest: digest, recordedArtifactDigest: artifactDigest, actualArtifactDigest: artifactDigest, maxAgeMs: 120_000, requiredForPromotion: true, ...overrides }; }

test('fresh evidence bound to current source and artifact passes', () => {
  const report = evaluateEvidenceFreshness({ currentSourceDigest: digest, evaluatedAt: now, artifacts: [row()] });
  assert.equal(report.status, 'PASS'); assert.deepEqual(report.totals, { artifacts: 1, current: 1, stale: 0, missing: 0, sourceMismatch: 0, digestMismatch: 0, invalid: 0 });
});

test('stale, missing, digest and source mismatches are distinguished', () => {
  const report = evaluateEvidenceFreshness({ currentSourceDigest: digest, evaluatedAt: now, artifacts: [row({ producedAt: '2026-07-17T00:00:00Z', actualArtifactDigest: undefined, sourceDigest: 'c'.repeat(64) }), row({ evidenceId: 'ev-2', actualArtifactDigest: 'd'.repeat(64) })] });
  assert.equal(report.status, 'BLOCK'); assert.equal(report.totals.stale, 1); assert.equal(report.totals.missing, 1); assert.equal(report.totals.sourceMismatch, 1); assert.equal(report.totals.digestMismatch, 1);
});

test('non-required missing evidence is advisory rather than blocking', () => {
  const report = evaluateEvidenceFreshness({ currentSourceDigest: digest, evaluatedAt: now, artifacts: [row({ actualArtifactDigest: undefined, requiredForPromotion: false })] });
  assert.equal(report.status, 'PASS'); assert.equal(report.findings[0]!.blocking, false);
});

test('evidence freshness rejects invalid identity, clock and digest inputs', () => {
  assert.throws(() => evaluateEvidenceFreshness({ currentSourceDigest: 'x', evaluatedAt: now, artifacts: [] }), /source_digest_invalid/);
  assert.throws(() => evaluateEvidenceFreshness({ currentSourceDigest: digest, evaluatedAt: 'bad', artifacts: [] }), /evaluated_at_invalid/);
  assert.throws(() => evaluateEvidenceFreshness({ currentSourceDigest: digest, evaluatedAt: now, artifacts: [row(), row()] }), /identity_invalid/);
});
