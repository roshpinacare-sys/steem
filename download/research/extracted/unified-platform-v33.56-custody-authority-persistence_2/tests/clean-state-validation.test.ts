import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CleanValidationWorkspace } from '../src/validation/clean-state.js';

function root(): string { return mkdtempSync(join(tmpdir(), 'clean-validation-v22-')); }
const now = new Date('2026-07-17T16:00:00.000Z');

test('new extraction with no evidence directory prepares a clean run', () => {
  const workspace = new CleanValidationWorkspace(root());
  workspace.acquire('run-new', now); const prepared = workspace.prepare(now);
  assert.equal(prepared.priorFileCount, 0); assert.equal(workspace.inspect().inProgress, true);
  workspace.complete('passed', new Date(now.getTime() + 1)); assert.equal(workspace.inspect().inProgress, false);
});

test('stale generated evidence is quarantined instead of trusted', () => {
  const directory = root(); const generated = join(directory, 'evidence/generated'); mkdirSync(generated, { recursive: true }); writeFileSync(join(generated, 'old.json'), '{}');
  const workspace = new CleanValidationWorkspace(directory); workspace.acquire('run-stale', now); const prepared = workspace.prepare(now);
  assert.equal(prepared.priorFileCount, 1); assert.ok(prepared.quarantinedPath); assert.match(readFileSync(join(prepared.quarantinedPath!, 'old.json'), 'utf8'), /\{\}/);
  workspace.complete('passed');
});

test('parallel validation attempts fail closed', () => {
  const directory = root(); const first = new CleanValidationWorkspace(directory); const second = new CleanValidationWorkspace(directory);
  first.acquire('run-1', now); assert.throws(() => second.acquire('run-2', now), /already_running/); first.release();
});

test('stale or dead-owner lock is recovered and retained as evidence', () => {
  const directory = root(); writeFileSync(join(directory, '.validation-v22.lock'), JSON.stringify({ runId: 'dead', pid: 999999, acquiredAt: new Date(now.getTime() - 3_600_000).toISOString() }));
  const workspace = new CleanValidationWorkspace(directory); const lease = workspace.acquire('recovery', now, 60_000); assert.equal(lease.runId, 'recovery'); workspace.release();
});

test('repeated validation starts fresh and quarantines the previous completed run', () => {
  const directory = root(); const first = new CleanValidationWorkspace(directory); first.acquire('run-1', now); first.prepare(now); writeFileSync(join(directory, 'evidence/generated/result.json'), '{}'); first.complete('passed');
  const second = new CleanValidationWorkspace(directory); second.acquire('run-2', new Date(now.getTime() + 10)); const prepared = second.prepare(new Date(now.getTime() + 10));
  assert.ok(prepared.priorFileCount >= 2); assert.ok(prepared.quarantinedPath); second.complete('passed');
});

test('preparation requires lease ownership', () => assert.throws(() => new CleanValidationWorkspace(root()).prepare(now), /lease_required/));
