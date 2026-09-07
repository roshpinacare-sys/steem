import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { generateSigningIdentity, KeyRegistry, sha256 } from '../src/contracts/crypto.js';
import { FileGovernedAutomationStore, GovernedAutomationEngine, InMemoryGovernedAutomationStore } from '../src/operations/governed-automation.js';
const now = new Date('2026-07-17T15:00:00Z');

test('eight processes persist the same signed automation run without divergence', async () => {
  const signer = generateSigningIdentity('automation-concurrency'); const registry = new KeyRegistry(); registry.register(signer.keyId, signer.publicKey);
  const engine = new GovernedAutomationEngine(registry, signer, new InMemoryGovernedAutomationStore());
  engine.activate({ ruleId: 'r', tenantId: 't', name: 'route', triggerType: 'MANUAL_REVIEW', condition: {}, actions: [{ kind: 'OPEN_OPERATIONAL_ACTION', title: 'review', owner: 'ops' }], maxActions: 1, createdBy: 'owner', reviewerIds: ['a', 'b'] }, now);
  const event = { eventId: 'event', tenantId: 't', subjectId: 'subject', triggerType: 'MANUAL_REVIEW' as const, severity: 'medium' as const, occurredAt: now.toISOString(), evidenceRoot: sha256('e'), attributes: {} };
  const signedRun = engine.evaluate(event, now); const root = mkdtempSync(join(tmpdir(), 'automation-concurrency-v29-')); const input = join(root, 'input.json'); const storeRoot = join(root, 'store');
  writeFileSync(input, JSON.stringify({ root: storeRoot, eventDigest: sha256(event), signedRun }));
  const results = await Promise.all(Array.from({ length: 8 }, () => worker(input)));
  assert.equal(new Set(results.map((result) => result.digest)).size, 1); assert.ok(results.every((result) => result.eventId === 'event'));
  const persisted = new FileGovernedAutomationStore(storeRoot).getRun('event'); assert.equal(persisted?.eventDigest, sha256(event));
});
function worker(input: string): Promise<{ eventId: string; digest: string }> { return new Promise((resolve, reject) => { const child = spawn(process.execPath, ['dist/src/cli/automation-store-worker.js', input], { stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = ''; const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('automation_worker_timeout')); }, 15_000); child.stdout.on('data', (chunk) => { stdout += String(chunk); }); child.stderr.on('data', (chunk) => { stderr += String(chunk); }); child.on('error', reject); child.on('close', (code) => { clearTimeout(timer); if (code !== 0) reject(new Error(`automation_worker_failed:${code}:${stderr}`)); else resolve(JSON.parse(stdout.trim()) as { eventId: string; digest: string }); }); }); }

test('automation worker fails closed without an input contract', async () => {
  await assert.rejects(workerMissingInput(), /automation_worker_failed/);
});
function workerMissingInput(): Promise<void> { return new Promise((resolve, reject) => { const child = spawn(process.execPath, ['dist/src/cli/automation-store-worker.js'], { stdio: ['ignore','pipe','pipe'] }); let stderr=''; child.stderr.on('data',(chunk)=>{stderr+=String(chunk);}); child.on('error',reject); child.on('close',(code)=>{ if(code===0) resolve(); else reject(new Error(`automation_worker_failed:${code}:${stderr}`)); }); }); }
