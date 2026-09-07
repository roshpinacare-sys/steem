import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDecisionBrief } from '../src/product/decision-brief.js';

const base = {
  status: 'AWAITING_REVIEW', objective: 'Correct bounded defect', changedFiles: ['src/a.ts'],
  findings: [{ kind: 'PROMPT_INJECTION' as const, severity: 'high' as const, file: 'README.md', ruleId: 'PI-1', summary: 'Instruction override detected.' }],
  testPassed: true, evidenceRoot: 'a'.repeat(64), unsupportedClaims: ['not-production-ready'], rollbackAvailable: true,
  passportAvailable: false, repositoryTrust: 'trusted-fixture', testExecutionBoundary: 'trusted-local-process',
};

test('decision brief presents risk-first review information without fake confidence', () => {
  const brief = buildDecisionBrief(base);
  assert.equal(brief.recommendation, 'READY_FOR_REVIEW');
  assert.equal(brief.topRisks[0]?.severity, 'high');
  assert.equal(brief.evidenceChecks.find((item) => item.label === 'Rollback')?.status, 'present');
  assert.match(brief.reviewDataProxy.limitation, /not measured human review-time/);
  assert.equal(JSON.stringify(brief).includes('confidence'), false);
});

test('critical finding blocks and missing evidence is explained', () => {
  const brief = buildDecisionBrief({ ...base, testPassed: false, evidenceRoot: undefined as never, findings: [{ kind: 'SECRET_CANDIDATE', severity: 'critical', file: '.env', ruleId: 'SEC', summary: 'Secret candidate.' }], rollbackAvailable: false });
  assert.equal(brief.recommendation, 'BLOCK');
  assert.ok(brief.evidenceChecks.some((item) => item.status === 'missing'));
});

test('approved and rolled-back states communicate the decision boundary', () => {
  assert.equal(buildDecisionBrief({ ...base, status: 'APPROVED_SHADOW', reviewerId: 'reviewer-1', passportAvailable: true }).recommendation, 'APPROVED_SHADOW');
  assert.equal(buildDecisionBrief({ ...base, status: 'ROLLED_BACK' }).recommendation, 'RECOVERY_COMPLETE');
});
