import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertGovernanceConsistent, loadGovernanceBundle, validateGovernanceBundle,
  type GovernanceBundleV26,
} from '../src/governance/consistency.js';
import {
  commitmentDigest, requirementDigest, validateDomainPackManifest, validateEngineeringCommitment, validateRequirement,
  type DomainPackManifest, type EngineeringCommitment, type RequirementContract,
} from '../src/contracts/system.js';
import { buildDecisionBrief } from '../src/product/decision-brief.js';

const now = new Date('2026-07-17T12:00:00.000Z');
const requirement: RequirementContract = {
  requirementId: 'req-1', tenantId: 'tenant-1', statement: 'Bounded behavior is verified', criticality: 'HIGH',
  requiredEvidenceClasses: ['ATTESTED'], verificationModes: ['TEST'], acceptanceCriteria: { passed: true }, version: '1.0.0',
};
const commitment: EngineeringCommitment = {
  commitmentId: 'commitment-1', tenantId: 'tenant-1', subjectId: 'subject-1', builderId: 'builder-1', domainPackId: 'pack-1',
  goal: 'Validate bounded architecture', authorityGrantDigest: 'a'.repeat(64), requirementIds: ['req-1'], promotionCeiling: 'shadow',
  createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(),
};
const manifest: DomainPackManifest = {
  packId: 'pack-1', version: '1.0.0', kernelContractVersion: '1.0.0', ontologyVersion: '1.0.0', workflows: ['review'],
  requiredCapabilities: ['analysis'], emittedEvidenceClasses: ['COMPUTED'], requiredScopes: ['repository.read'], uiSurfaces: ['review'],
  risks: ['model-error'], authorityModel: 'canonical-kernel-only',
};

function governance(): GovernanceBundleV26 { return loadGovernanceBundle('governance-state'); }
function codes(bundle: GovernanceBundleV26, root?: string): string[] { return validateGovernanceBundle(bundle, root).findings.map((item) => item.code); }

test('governance matrix detects every version, boundary, action and evidence contradiction', () => {
  const source = governance();
  const temp = mkdtempSync(join(tmpdir(), 'gov-v27-'));
  writeFileSync(join(temp, 'present.txt'), 'ok');
  const broken = {
    programState: {
      ...source.programState,
      schemaVersion: '1.0.0' as never,
      version: '25.9',
      phase: 'stale' as never,
      readiness: 'invalid' as never,
      updatedAt: 'not-a-time',
      executionBoundary: {
        trustedRepository: 'allowlisted-local-authority' as const,
        untrustedRepository: 'allowed' as never,
        externalMutation: 'authorized' as never,
        productionPromotion: 'allowed' as never,
      },
      blockedGates: ['gate-a'],
      nextAllowedAction: ' ',
      evidencePaths: ['evidence/generated/result.json', '/absolute/path', '../escape', 'missing.txt'],
    },
    nextAction: {
      ...source.nextAction,
      schemaVersion: '1.0.0' as never,
      version: '26.1',
      updatedAt: 'also-invalid',
      title: ' ',
      allowedActions: ['execute untrusted repository'],
      forbiddenActions: [],
      requiredBlockedGates: [],
    },
    openDecisions: {
      ...source.openDecisions,
      version: '26.2',
      updatedAt: 'bad',
      decisions: [{ id: '' }, { id: 'duplicate' }, { id: 'duplicate' }],
    },
  } satisfies GovernanceBundleV26;
  const found = new Set(codes(broken, temp));
  for (const code of [
    'GOV_SCHEMA_VERSION','GOV_PHASE_STALE','GOV_PROGRAM_VERSION_STALE','GOV_READINESS_INVALID','GOV_UNTRUSTED_EXECUTION',
    'GOV_EXTERNAL_MUTATION','GOV_PRODUCTION_PROMOTION','GOV_VERSION_DRIFT','GOV_TIMESTAMP_INVALID','GOV_STALE_AUTHORIZATION',
    'GOV_FORBIDDEN_ACTION_MISSING','GOV_BLOCKED_GATE_DRIFT','GOV_NEXT_ACTION_EMPTY','GOV_DECISION_ID_INVALID',
    'GOV_CIRCULAR_GENERATED_EVIDENCE','GOV_EVIDENCE_PATH_UNSAFE','GOV_EVIDENCE_MISSING',
  ]) assert.equal(found.has(code), true, `missing ${code}`);
  assert.throws(() => assertGovernanceConsistent(broken, temp), /governance_inconsistent/);
});

test('governance detects stale next action and overclaim while a complete temporary bundle loads', () => {
  const source = governance();
  const stale = {
    ...source,
    programState: { ...source.programState, updatedAt: '2026-07-17T12:00:00.000Z', readiness: 'Qualified Production Release' as const },
    nextAction: { ...source.nextAction, updatedAt: '2026-07-17T11:00:00.000Z' },
  } satisfies GovernanceBundleV26;
  const found = codes(stale);
  assert.ok(found.includes('GOV_NEXT_ACTION_STALE'));
  assert.ok(found.includes('GOV_READINESS_OVERCLAIM'));

  const root = mkdtempSync(join(tmpdir(), 'gov-load-v27-'));
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'PROGRAM_STATE.json'), JSON.stringify(source.programState));
  writeFileSync(join(root, 'NEXT_ACTION.json'), JSON.stringify(source.nextAction));
  writeFileSync(join(root, 'OPEN_DECISIONS.json'), JSON.stringify(source.openDecisions));
  assert.deepEqual(loadGovernanceBundle(root), source);
  assert.doesNotThrow(() => assertGovernanceConsistent(source));
});

test('requirement validation covers empty, duplicate and invalid evidence and verification contracts', () => {
  assert.doesNotThrow(() => validateRequirement(requirement));
  for (const [patch, pattern] of [
    [{ requirementId: '' }, /requirement_id_required/], [{ tenantId: '' }, /tenant_id_required/], [{ statement: '' }, /requirement_statement_required/], [{ version: '' }, /requirement_version_required/],
    [{ requiredEvidenceClasses: [] }, /required_evidence_class_required/], [{ requiredEvidenceClasses: ['ATTESTED','ATTESTED'] }, /duplicate_required_evidence_class/],
    [{ requiredEvidenceClasses: ['INVALID'] }, /invalid_required_evidence_class/], [{ verificationModes: [] }, /verification_mode_required/],
    [{ verificationModes: ['TEST','TEST'] }, /duplicate_verification_mode/],
  ] as const) assert.throws(() => validateRequirement({ ...requirement, ...patch } as RequirementContract), pattern);
  assert.match(requirementDigest(requirement), /^[a-f0-9]{64}$/);
});

test('engineering commitment validation covers identity, requirements, time and promotion boundaries', () => {
  assert.doesNotThrow(() => validateEngineeringCommitment(commitment, now));
  for (const [patch, pattern] of [
    [{ commitmentId: '' }, /commitment_id_required/], [{ tenantId: '' }, /tenant_id_required/], [{ subjectId: '' }, /subject_id_required/],
    [{ builderId: '' }, /builder_id_required/], [{ domainPackId: '' }, /domain_pack_id_required/], [{ goal: '' }, /commitment_goal_required/],
    [{ authorityGrantDigest: '' }, /authority_grant_digest_required/], [{ requirementIds: [] }, /commitment_requirement_required/],
    [{ requirementIds: ['req-1','req-1'] }, /duplicate_commitment_requirement/], [{ promotionCeiling: 'production' }, /invalid_promotion_ceiling/],
    [{ createdAt: 'bad' }, /invalid_commitment_created_at/], [{ expiresAt: 'bad' }, /invalid_commitment_expires_at/],
    [{ expiresAt: commitment.createdAt }, /invalid_commitment_expiry/],
  ] as const) assert.throws(() => validateEngineeringCommitment({ ...commitment, ...patch } as EngineeringCommitment, now), pattern);
  assert.throws(() => validateEngineeringCommitment(commitment, new Date(commitment.expiresAt)), /commitment_expired/);
  assert.match(commitmentDigest(commitment), /^[a-f0-9]{64}$/);
});

test('domain pack manifest validation covers authority, workflow, scope and evidence boundaries', () => {
  assert.doesNotThrow(() => validateDomainPackManifest(manifest));
  for (const [patch, pattern] of [
    [{ packId: '' }, /pack_id_required/], [{ version: '' }, /pack_version_required/], [{ kernelContractVersion: '' }, /kernel_contract_version_required/],
    [{ ontologyVersion: '' }, /ontology_version_required/], [{ authorityModel: 'pack-owned' }, /domain_pack_authority_forbidden/],
    [{ workflows: [] }, /domain_pack_workflow_required/], [{ requiredScopes: ['repository.read','repository.read'] }, /duplicate_domain_scope/],
    [{ requiredScopes: ['*'] }, /domain_pack_wildcard_scope_forbidden/], [{ requiredScopes: ['repository.*'] }, /domain_pack_wildcard_scope_forbidden/],
    [{ requiredScopes: ['kernel.write'] }, /domain_pack_kernel_scope_forbidden/], [{ emittedEvidenceClasses: ['INVALID'] }, /domain_pack_invalid_evidence_class/],
  ] as const) assert.throws(() => validateDomainPackManifest({ ...manifest, ...patch } as DomainPackManifest), pattern);
});

test('decision brief covers all recommendation, risk and recursive fact-count branches', () => {
  const base = {
    status: 'RUNNING', objective: 'Broad governed analysis', changedFiles: [] as string[],
    findings: [
      { kind: 'PROMPT_INJECTION' as const, severity: 'low' as const, file: 'z', ruleId: 'z', summary: 'low' },
      { kind: 'PROMPT_INJECTION' as const, severity: 'medium' as const, file: 'b', ruleId: 'b', summary: 'medium' },
      { kind: 'PROMPT_INJECTION' as const, severity: 'high' as const, file: 'a', ruleId: 'a', summary: 'high' },
      { kind: 'SECRET_CANDIDATE' as const, severity: 'critical' as const, file: 'c', ruleId: 'c', summary: 'critical' },
    ],
    testPassed: false, unsupportedClaims: [], rollbackAvailable: false,
    passportAvailable: false, repositoryTrust: 'trusted', testExecutionBoundary: 'bounded',
  };
  const blocked = buildDecisionBrief(base);
  assert.equal(blocked.recommendation, 'BLOCK');
  assert.equal(blocked.topRisks.map((risk) => risk.severity).join(','), 'critical,high,medium,low');
  assert.match(blocked.changeSummary, /No file change/);
  assert.equal(blocked.reviewDataProxy.reductionPercent >= 0, true);
  assert.equal(buildDecisionBrief({ ...base, findings: [], status: 'FAILED' }).recommendation, 'BLOCK');
  assert.equal(buildDecisionBrief({ ...base, findings: [], status: 'AWAITING_REVIEW', testPassed: true }).recommendation, 'READY_FOR_REVIEW');
  assert.equal(buildDecisionBrief({ ...base, findings: [], status: 'APPROVED_SHADOW' }).recommendation, 'APPROVED_SHADOW');
  assert.equal(buildDecisionBrief({ ...base, findings: [], status: 'ROLLED_BACK' }).recommendation, 'RECOVERY_COMPLETE');
  assert.equal(buildDecisionBrief({ ...base, findings: [], changedFiles: ['a','b'], rollbackAvailable: true }).changeSummary.includes('2 approved'), true);
});
