import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { loadGovernanceBundle, validateGovernanceBundle, type GovernanceBundleV28 } from '../src/governance/consistency.js';

const root = resolve('governance-state');

test('canonical v33.56 governance snapshot is internally consistent from a clean repository state', () => {
  const bundle = loadGovernanceBundle(root);
  const result = validateGovernanceBundle(bundle, resolve('.'));
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  assert.equal(result.version, '33.56');
});

test('stale phase and version drift fail closed', () => {
  const source = loadGovernanceBundle(root);
  const broken = {
    ...source,
    programState: { ...source.programState, phase: 'Phase 0 — Immutable Intake and Reproducibility' as never },
    nextAction: { ...source.nextAction, version: '23.0' },
  } satisfies GovernanceBundleV28;
  const codes = validateGovernanceBundle(broken).findings.map((finding) => finding.code);
  assert.equal(codes.includes('GOV_PHASE_STALE'), true);
  assert.equal(codes.includes('GOV_VERSION_DRIFT'), true);
  const staleFamily = {
    ...source,
    programState: { ...source.programState, version: '31.9' },
    nextAction: { ...source.nextAction, version: '31.9' },
    openDecisions: { ...source.openDecisions, version: '31.9' },
  } satisfies GovernanceBundleV28;
  assert.ok(validateGovernanceBundle(staleFamily).findings.some((finding) => finding.code === 'GOV_PROGRAM_VERSION_STALE'));
});

test('untrusted execution and production overclaim fail closed', () => {
  const source = loadGovernanceBundle(root);
  const broken = {
    ...source,
    programState: {
      ...source.programState,
      readiness: 'Production Candidate' as const,
      executionBoundary: { ...source.programState.executionBoundary, untrustedRepository: 'allowed' as never, productionPromotion: 'allowed' as never },
    },
    nextAction: { ...source.nextAction, allowedActions: ['execute untrusted repository'] },
  } satisfies GovernanceBundleV28;
  const codes = validateGovernanceBundle(broken).findings.map((finding) => finding.code);
  for (const code of ['GOV_READINESS_OVERCLAIM', 'GOV_UNTRUSTED_EXECUTION', 'GOV_PRODUCTION_PROMOTION', 'GOV_STALE_AUTHORIZATION']) assert.equal(codes.includes(code), true);
});

test('missing evidence path and duplicate decisions are detected', () => {
  const source = loadGovernanceBundle(root);
  const temporary = mkdtempSync(join(tmpdir(), 'v24-governance-'));
  writeFileSync(join(temporary, 'present.txt'), 'ok');
  const broken = {
    ...source,
    programState: { ...source.programState, evidencePaths: ['present.txt', 'missing.txt'] },
    openDecisions: { ...source.openDecisions, decisions: [{ id: 'duplicate' }, { id: 'duplicate' }] },
  } satisfies GovernanceBundleV28;
  const codes = validateGovernanceBundle(broken, temporary).findings.map((finding) => finding.code);
  assert.equal(codes.includes('GOV_EVIDENCE_MISSING'), true);
  assert.equal(codes.includes('GOV_DECISION_ID_INVALID'), true);
});

test('pre-execution governance cannot depend on generated validation evidence', () => {
  const source = loadGovernanceBundle(root);
  const broken = {
    ...source,
    programState: { ...source.programState, evidencePaths: ['evidence/generated/V29_FINAL_VALIDATION.json'] },
  } satisfies GovernanceBundleV28;
  const codes = validateGovernanceBundle(broken).findings.map((finding) => finding.code);
  assert.equal(codes.includes('GOV_CIRCULAR_GENERATED_EVIDENCE'), true);
});

test('qualification target, status and current evidence must bind the exact release', () => {
  const source = loadGovernanceBundle(root);
  const broken = {
    ...source,
    programState: { ...source.programState, status: 'v32.10-stale', evidencePaths: ['docs/V32_9_CLAIM_TO_EXECUTION_CLOSURE.md'] },
    nextAction: { ...source.nextAction, qualificationTargetVersion: '32.10' },
  } satisfies GovernanceBundleV28;
  const codes = validateGovernanceBundle(broken).findings.map((finding) => finding.code);
  assert.ok(codes.includes('GOV_QUALIFICATION_TARGET_DRIFT'));
  assert.ok(codes.includes('GOV_STATUS_VERSION_DRIFT'));
  assert.ok(codes.includes('GOV_CURRENT_EVIDENCE_MISSING'));
});
