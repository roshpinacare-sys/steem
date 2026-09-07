import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApplicationServer } from '../src/web/server.js';
import { WorkflowService } from '../src/web/workflow-service.js';

test('web server exposes real health, security headers, static product and bounded error handling', async () => {
  const root = mkdtempSync(join(tmpdir(), 'v19-web-server-'));
  const server = createApplicationServer(new WorkflowService(root));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.match(health.headers.get('content-security-policy') ?? '', /default-src 'self'/);
    assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
    const healthBody = await health.json() as { promotionBoundary: string; version: string };
    assert.equal(healthBody.promotionBoundary, 'shadow-only');
    assert.equal(healthBody.version, 'v32');

    const operations = await fetch(`${base}/api/operations`);
    assert.equal(operations.status, 200);
    const operationsBody = await operations.json() as { overallState: string; blockedDependencies: string[]; actions: unknown[] };
    assert.equal(operationsBody.overallState, 'blocked');
    assert.deepEqual(operationsBody.blockedDependencies, ['kms-hsm', 'postgres-primary-standby', 'untrusted-code-isolation']);
    assert.ok(operationsBody.actions.length >= 5);

    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Governed Engineering and Change Assurance/);

    const invalid = await fetch(`${base}/api/sessions/intake`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '[]',
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: 'intake_body_must_be_object' });

    const oversized = await fetch(`${base}/api/sessions/intake`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'x'.repeat(260_000) }),
    });
    assert.equal(oversized.status, 400);
    assert.deepEqual(await oversized.json(), { error: 'request_too_large' });

    assert.equal((await fetch(`${base}/../package.json`)).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
