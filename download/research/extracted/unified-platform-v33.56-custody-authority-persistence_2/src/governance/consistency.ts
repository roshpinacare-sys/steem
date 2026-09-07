import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  READINESS_LEVELS,
  V32_PHASE,
  V33_PHASE,
  type GovernanceBundleV28,
  type GovernanceFinding,
  type GovernanceValidationResult,
  type NextActionV28,
  type OpenDecisionsV28,
  type ProgramStateV28,
} from './contracts.js';

export { READINESS_LEVELS, V32_PHASE, V33_PHASE } from './contracts.js';
export type {
  GovernanceBundleV28, GovernanceFinding, GovernanceValidationResult, NextActionV28, OpenDecisionsV28, ProgramStateV28, ReadinessLevel,
} from './contracts.js';
export type {
  GovernanceBundleV20, GovernanceBundleV21, GovernanceBundleV22, GovernanceBundleV23, GovernanceBundleV24,
  NextActionV20, NextActionV21, NextActionV22, NextActionV23, NextActionV24,
  OpenDecisionsV20, OpenDecisionsV21, OpenDecisionsV22, OpenDecisionsV23, OpenDecisionsV24,
  ProgramStateV20, ProgramStateV21, ProgramStateV22, ProgramStateV23, ProgramStateV24,
} from './compatibility-v20-v24.js';
export { V28_PHASE, V29_PHASE, V30_PHASE, V31_PHASE } from './compatibility-v25-v31.js';
export type {
  GovernanceBundleV25, GovernanceBundleV26, GovernanceBundleV27, GovernanceBundleV29,
  NextActionV25, NextActionV26, NextActionV27, NextActionV29,
  OpenDecisionsV25, OpenDecisionsV26, OpenDecisionsV27, OpenDecisionsV29,
  ProgramStateV25, ProgramStateV26, ProgramStateV27, ProgramStateV29,
} from './compatibility-v25-v31.js';

export function validateGovernanceBundle(bundle: GovernanceBundleV28, artifactRoot?: string): GovernanceValidationResult {
  const findings: GovernanceFinding[] = [];
  const { programState, nextAction, openDecisions } = bundle;
  const version = programState.version;

  if (programState.schemaVersion !== '2.0.0' || nextAction.schemaVersion !== '2.0.0') {
    findings.push(error('GOV_SCHEMA_VERSION', 'Program state and next action must use governance schema 2.0.0.'));
  }
  const expectedPhase = version === '33.56' ? V33_PHASE : version === '32.18' ? V32_PHASE : undefined;
  if (expectedPhase === undefined || programState.phase !== expectedPhase) {
    findings.push(error('GOV_PHASE_STALE', 'Program phase is stale or inconsistent with the exact canonical version family.'));
  }
  if (!version.startsWith('32.') && !version.startsWith('33.')) {
    findings.push(error('GOV_PROGRAM_VERSION_STALE', 'The canonical governance version must be in the v32 or v33 family.'));
  }
  const readinessIndex = READINESS_LEVELS.indexOf(programState.readiness);
  if (readinessIndex < 0) findings.push(error('GOV_READINESS_INVALID', 'Readiness must use the canonical readiness model.'));
  if (readinessIndex > READINESS_LEVELS.indexOf('Integrated Pilot')) {
    findings.push(error('GOV_READINESS_OVERCLAIM', 'The current program may not exceed Integrated Pilot without external and operational qualification.'));
  }
  if (programState.executionBoundary.untrustedRepository !== 'blocked-until-independent-isolation-qualification') {
    findings.push(error('GOV_UNTRUSTED_EXECUTION', 'Untrusted repository execution must remain blocked.'));
  }
  if (programState.executionBoundary.externalMutation !== 'not-authorized') {
    findings.push(error('GOV_EXTERNAL_MUTATION', 'External mutation is not authorized.'));
  }
  if (programState.executionBoundary.productionPromotion !== 'blocked') {
    findings.push(error('GOV_PRODUCTION_PROMOTION', 'Production promotion must remain blocked.'));
  }
  if (version !== nextAction.version || version !== openDecisions.version) {
    findings.push(error('GOV_VERSION_DRIFT', 'Program state, next action and open decisions must share one version.'));
  }
  if (nextAction.qualificationTargetVersion !== version) {
    findings.push(error('GOV_QUALIFICATION_TARGET_DRIFT', 'External qualification must bind the exact current program version.'));
  }
  if (!programState.status.toLowerCase().startsWith(`v${version.toLowerCase()}`)) {
    findings.push(error('GOV_STATUS_VERSION_DRIFT', 'Program status must identify the exact current program version.'));
  }
  const currentEvidenceTokens = [`v${version.toLowerCase()}`, `v${version.replace('.', '_').toLowerCase()}`];
  if (!programState.evidencePaths.some((path) => currentEvidenceTokens.some((token) => path.toLowerCase().includes(token)))) {
    findings.push(error('GOV_CURRENT_EVIDENCE_MISSING', 'Canonical evidence paths must include at least one artifact from the current program version.'));
  }
  if (!validInstant(programState.updatedAt) || !validInstant(nextAction.updatedAt) || !validInstant(openDecisions.updatedAt)) {
    findings.push(error('GOV_TIMESTAMP_INVALID', 'Governance timestamps must be valid ISO instants.'));
  } else if (Date.parse(nextAction.updatedAt) < Date.parse(programState.updatedAt)) {
    findings.push(error('GOV_NEXT_ACTION_STALE', 'Next action predates the current program state.'));
  }
  const allowedText = nextAction.allowedActions.join(' ').toLowerCase();
  if (allowedText.includes('untrusted') && allowedText.includes('execute')) {
    findings.push(error('GOV_STALE_AUTHORIZATION', 'Next action authorizes untrusted execution despite the blocked boundary.'));
  }
  const forbiddenText = nextAction.forbiddenActions.join(' | ').toLowerCase();
  const requiredForbidden: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['external mutation', ['external git mutation', 'external mutation']],
    ['production promotion', ['production promotion']],
    ['untrusted host execution', ['untrusted repository host execution', 'untrusted host execution']],
  ];
  for (const [label, alternatives] of requiredForbidden) {
    if (!alternatives.some((value) => forbiddenText.includes(value))) {
      findings.push(error('GOV_FORBIDDEN_ACTION_MISSING', `Missing forbidden action: ${label}.`));
    }
  }
  const requiredBlocked = new Set(nextAction.requiredBlockedGates);
  for (const gate of programState.blockedGates) {
    if (!requiredBlocked.has(gate)) findings.push(error('GOV_BLOCKED_GATE_DRIFT', `Blocked gate is absent from next action: ${gate}.`));
  }
  if (programState.nextAllowedAction.trim() === '' || nextAction.title.trim() === '') {
    findings.push(error('GOV_NEXT_ACTION_EMPTY', 'Next action must be explicit.'));
  }
  const decisionIds = new Set<string>();
  for (const decision of openDecisions.decisions) {
    if (decision.id.trim() === '' || decisionIds.has(decision.id)) findings.push(error('GOV_DECISION_ID_INVALID', 'Decision identifiers must be unique and non-empty.'));
    decisionIds.add(decision.id);
  }
  for (const path of programState.evidencePaths) {
    if (path.startsWith('evidence/generated')) {
      findings.push(error('GOV_CIRCULAR_GENERATED_EVIDENCE', `Pre-execution governance may not depend on generated validation evidence: ${path}.`));
    }
    if (path.startsWith('/') || path.includes('..')) {
      findings.push(error('GOV_EVIDENCE_PATH_UNSAFE', `Evidence path must be repository-relative: ${path}.`));
    }
    if (artifactRoot !== undefined && !existsSync(resolve(artifactRoot, path))) {
      findings.push(error('GOV_EVIDENCE_MISSING', `Evidence path does not exist: ${path}.`));
    }
  }
  return { ok: findings.every((finding) => finding.severity !== 'error'), findings, version, readinessIndex };
}

export function loadGovernanceBundle(root: string): GovernanceBundleV28 {
  return {
    programState: readJson<ProgramStateV28>(resolve(root, 'PROGRAM_STATE.json')),
    nextAction: readJson<NextActionV28>(resolve(root, 'NEXT_ACTION.json')),
    openDecisions: readJson<OpenDecisionsV28>(resolve(root, 'OPEN_DECISIONS.json')),
  };
}

export function assertGovernanceConsistent(bundle: GovernanceBundleV28, artifactRoot?: string): void {
  const result = validateGovernanceBundle(bundle, artifactRoot);
  if (!result.ok) throw new Error(`governance_inconsistent:${result.findings.map((finding) => finding.code).join(',')}`);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function error(code: string, message: string): GovernanceFinding {
  return { code, severity: 'error', message };
}

function validInstant(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}
