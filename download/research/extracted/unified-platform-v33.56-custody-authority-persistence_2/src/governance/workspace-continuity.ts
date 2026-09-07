import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface WorkspaceContinuityFinding {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface WorkspaceContinuityResult {
  readonly ok: boolean;
  readonly programVersion: string;
  readonly findings: readonly WorkspaceContinuityFinding[];
  readonly checkedPaths: readonly string[];
}

const ROOT_DOCUMENTS = ['CLAUDE.md', 'MASTER_DIRECTIVE.md', 'PROGRAM_CHARTER.md'] as const;
const REGISTRIES = [
  'ASSUMPTION_REGISTRY.json',
  'CAPABILITY_REGISTRY.json',
  'CONTRADICTION_REGISTRY.json',
  'EVIDENCE_REGISTRY.json',
  'NEXT_ACTION.json',
  'OPEN_DECISIONS.json',
  'PROGRAM_STATE.json',
  'REQUIREMENT_REGISTRY.json',
  'RISK_REGISTRY.json',
  'SKILL_REGISTRY.json',
  'TRACEABILITY_GRAPH.json',
] as const;

/** Validates canonical continuation material; it does not authorize execution. */
export function validateWorkspaceContinuity(root: string): WorkspaceContinuityResult {
  const findings: WorkspaceContinuityFinding[] = [];
  const checkedPaths: string[] = [];
  const statePath = resolve(root, 'governance-state/PROGRAM_STATE.json');
  checkedPaths.push('governance-state/PROGRAM_STATE.json');
  if (!existsSync(statePath)) return { ok: false, programVersion: 'unknown', findings: [{ code: 'PROGRAM_STATE_MISSING', path: 'governance-state/PROGRAM_STATE.json', message: 'Canonical program state is missing.' }], checkedPaths };
  const state = readJson(statePath);
  const programVersion = stringField(state, 'version');
  if (!/^(?:32|33)\.[0-9]+$/.test(programVersion)) findings.push(finding('PROGRAM_VERSION_INVALID', 'governance-state/PROGRAM_STATE.json', 'Program version must remain in the governed v32 or v33 family.'));

  for (const path of ROOT_DOCUMENTS) {
    checkedPaths.push(path);
    const absolute = resolve(root, path);
    if (!existsSync(absolute)) { findings.push(finding('ROOT_AUTHORITY_DOCUMENT_MISSING', path, 'Required canonical authority document is missing.')); continue; }
    const text = readFileSync(absolute, 'utf8');
    for (const required of ['external mutation', 'production promotion', 'immutable']) {
      if (!text.toLowerCase().includes(required)) findings.push(finding('ROOT_AUTHORITY_INVARIANT_MISSING', path, `Required invariant is not explicit: ${required}.`));
    }
  }

  for (const file of REGISTRIES) {
    const path = `governance-state/${file}`;
    checkedPaths.push(path);
    const absolute = resolve(root, path);
    if (!existsSync(absolute)) { findings.push(finding('REGISTRY_MISSING', path, 'Canonical registry is missing.')); continue; }
    const document = readJson(absolute);
    const version = stringField(document, 'version');
    if (version !== programVersion) findings.push(finding('REGISTRY_VERSION_DRIFT', path, `Registry version ${version || 'missing'} does not match ${programVersion}.`));
    const updated = typeof document.updatedAt === 'string' ? document.updatedAt : typeof document.generatedAt === 'string' ? document.generatedAt : '';
    if (updated === '' || !Number.isFinite(Date.parse(updated))) findings.push(finding('REGISTRY_TIMESTAMP_INVALID', path, 'Registry must include a valid updatedAt or generatedAt timestamp.'));
  }

  const artifactValidator = 'scripts/validate-artifacts.mjs';
  checkedPaths.push(artifactValidator);
  const artifactPath = resolve(root, artifactValidator);
  if (!existsSync(artifactPath)) findings.push(finding('ARTIFACT_VALIDATOR_MISSING', artifactValidator, 'Artifact manifest validator is missing.'));
  else if (!readFileSync(artifactPath, 'utf8').includes(`version: '${programVersion}'`)) findings.push(finding('ARTIFACT_MANIFEST_VERSION_STALE', artifactValidator, 'Artifact manifest version is not bound to the canonical program version.'));

  return { ok: findings.length === 0, programVersion, findings, checkedPaths };
}

function readJson(path: string): Record<string, unknown> { return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>; }
function stringField(input: Record<string, unknown>, key: string): string { return typeof input[key] === 'string' ? input[key] : ''; }
function finding(code: string, path: string, message: string): WorkspaceContinuityFinding { return { code, path, message }; }
