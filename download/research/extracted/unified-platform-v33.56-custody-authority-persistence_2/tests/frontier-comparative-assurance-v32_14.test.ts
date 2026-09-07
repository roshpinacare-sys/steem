import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '../src/contracts/crypto.js';
import { defaultFrontierRequirementsV32_14, evaluateFrontierSystemV32_14, type FrontierCapabilityEvidenceV32_14 } from '../src/validation/frontier-comparative-assurance-v32_14.js';

const d = sha256('evidence');
function evidence(dimension: FrontierCapabilityEvidenceV32_14['dimension'], score: number, evidenceClass: FrontierCapabilityEvidenceV32_14['evidenceClass']): FrontierCapabilityEvidenceV32_14 {
  return { dimension, score, evidenceClass, evidenceRef: `evidence/${dimension}.json`, artifactDigest: d, limitations: [] };
}

test('frontier comparison refuses best-in-world claims from official marketing or synthetic evidence', () => {
  const requirements = defaultFrontierRequirementsV32_14();
  const report = evaluateFrontierSystemV32_14({ systemId: 'provider-model', profileVersion: '1', evidence: requirements.map((item) => evidence(item.dimension, 1, 'OFFICIAL_PROVIDER_CLAIM')) }, requirements);
  assert.equal(report.status, 'NOT_FRONTIER');
  assert.equal(report.criticalPassed, 0);
  assert.ok(report.dimensions.every((item) => item.status === 'UNPROVEN'));
  assert.match(report.honestClaim, /does not support/);
});

test('local proof can establish engineering strengths but external critical gates remain blocking', () => {
  const requirements = defaultFrontierRequirementsV32_14();
  const report = evaluateFrontierSystemV32_14({ systemId: 'upp-v32.14', profileVersion: '32.14', evidence: requirements.map((item) => evidence(item.dimension, 0.98, 'OBSERVED_CURRENT_EXECUTION')) }, requirements);
  assert.equal(report.status, 'STRONG_BUT_UNQUALIFIED');
  assert.ok(report.uniqueStrengths.includes('BINARY_ARTIFACT_INTELLIGENCE'));
  assert.ok(report.blockingGaps.includes('EXTERNAL_PRODUCTION_QUALIFICATION'));
  assert.ok(report.blockingGaps.includes('INDEPENDENT_VERIFICATION'));
});

test('frontier candidate requires every critical dimension with permitted observed evidence', () => {
  const requirements = defaultFrontierRequirementsV32_14();
  const report = evaluateFrontierSystemV32_14({ systemId: 'qualified', profileVersion: '1', evidence: requirements.map((item) => evidence(item.dimension, 1, item.requiredEvidenceClasses.includes('OBSERVED_EXTERNAL') ? 'OBSERVED_EXTERNAL' : 'OBSERVED_CURRENT_EXECUTION')) }, requirements);
  assert.equal(report.status, 'FRONTIER_CANDIDATE');
  assert.equal(report.blockingGaps.length, 0);
  assert.equal(report.criticalPassed, report.criticalTotal);
  assert.match(report.reportDigest, /^[a-f0-9]{64}$/);
});

test('comparative assurance validates evidence and requirement identity', () => {
  const requirements = defaultFrontierRequirementsV32_14();
  assert.throws(() => evaluateFrontierSystemV32_14({ systemId: '', profileVersion: '1', evidence: [] }, requirements), /frontier_profile_identity_invalid/);
  const below = evaluateFrontierSystemV32_14({ systemId: 'x', profileVersion: '1', evidence: [evidence('CODING_AND_REPAIR', 0.1, 'OBSERVED_CURRENT_EXECUTION')] }, requirements);
  assert.equal(below.dimensions.find((item) => item.dimension === 'CODING_AND_REPAIR')?.status, 'FAIL');
  assert.throws(() => evaluateFrontierSystemV32_14({ systemId: 'x', profileVersion: '1', evidence: [evidence('CODING_AND_REPAIR', 2, 'OBSERVED_CURRENT_EXECUTION')] }, requirements), /frontier_profile_score_invalid/);
  assert.throws(() => evaluateFrontierSystemV32_14({ systemId: 'x', profileVersion: '1', evidence: [] }, []), /frontier_requirements_invalid/);
});
