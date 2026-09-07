import assert from 'node:assert/strict';
import test from 'node:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { validateWorkspaceContinuity } from '../src/governance/workspace-continuity.js';

const repositoryRoot = resolve(process.cwd());

test('canonical workspace continuity is complete and version-aligned', () => {
  const result = validateWorkspaceContinuity(repositoryRoot);
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  assert.equal(result.programVersion, '33.56');
});

test('missing root authority document and stale registry are rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'workspace-continuity-'));
  cpSync(join(repositoryRoot, 'governance-state'), join(root, 'governance-state'), { recursive: true });
  cpSync(join(repositoryRoot, 'MASTER_DIRECTIVE.md'), join(root, 'MASTER_DIRECTIVE.md'));
  cpSync(join(repositoryRoot, 'PROGRAM_CHARTER.md'), join(root, 'PROGRAM_CHARTER.md'));
  cpSync(join(repositoryRoot, 'scripts'), join(root, 'scripts'), { recursive: true });
  const capPath = join(root, 'governance-state', 'CAPABILITY_REGISTRY.json');
  const cap = JSON.parse(readFileSync(capPath, 'utf8'));
  cap.version = '28.0';
  writeFileSync(capPath, JSON.stringify(cap));
  const result = validateWorkspaceContinuity(root);
  assert.ok(result.findings.some((finding) => finding.code === 'ROOT_AUTHORITY_DOCUMENT_MISSING' && finding.path === 'CLAUDE.md'));
  assert.ok(result.findings.some((finding) => finding.code === 'REGISTRY_VERSION_DRIFT' && finding.path.endsWith('CAPABILITY_REGISTRY.json')));
  rmSync(root, { recursive: true, force: true });
});
