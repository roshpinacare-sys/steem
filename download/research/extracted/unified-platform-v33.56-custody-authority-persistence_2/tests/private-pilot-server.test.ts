import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { generateSigningIdentity } from '../src/contracts/crypto.js';
import { KeyLifecycleRegistry } from '../src/security/key-lifecycle.js';
import { PrivateIdentityStore } from '../src/security/private-identity.js';
import { createPrivatePilotServer } from '../src/web/private-pilot-server.js';

const now = new Date('2026-07-17T00:00:00Z');
const sessionSecret = 'v20-private-pilot-session-signing-secret-123456';
const bootstrapToken = 'v20-bootstrap-token-should-be-private';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'v20-private-server-'));
  const identityStore = new PrivateIdentityStore(join(root, 'identity.json'));
  identityStore.bootstrap({
    tenant: { tenantId: 'tenant-1', displayName: 'Pilot', status: 'ACTIVE', createdAt: now.toISOString() },
    users: [
      { userId: 'operator-1', displayName: 'Operator', status: 'ACTIVE', createdAt: now.toISOString() },
      { userId: 'reviewer-1', displayName: 'Reviewer', status: 'ACTIVE', createdAt: now.toISOString() },
      { userId: 'auditor-1', displayName: 'Auditor', status: 'ACTIVE', createdAt: now.toISOString() },
    ],
    memberships: [
      { tenantId: 'tenant-1', userId: 'operator-1', roles: ['operator'], status: 'ACTIVE' },
      { tenantId: 'tenant-1', userId: 'reviewer-1', roles: ['reviewer'], status: 'ACTIVE' },
      { tenantId: 'tenant-1', userId: 'auditor-1', roles: ['auditor'], status: 'ACTIVE' },
    ],
  }, now);
  const signer = generateSigningIdentity('v20-tenant-1-passport');
  const registry = new KeyLifecycleRegistry();
  registry.register(signer, {
    keyId: signer.keyId, familyId: 'v20-passport-family', purpose: 'action-passport', environment: 'test', tenantId: 'tenant-1',
    notBefore: new Date(now.getTime() - 1000).toISOString(), notAfter: new Date(now.getTime() + 86_400_000).toISOString(),
  });
  const server = createPrivatePilotServer({
    dataRoot: join(root, 'data'), identityStore, sessionSigningSecret: sessionSecret, bootstrapToken,
    passportSignerByTenant: new Map([['tenant-1', signer]]), keyRegistryByTenant: new Map([['tenant-1', registry]]),
    allowedOrigin: 'https://pilot.local', now: () => now,
  });
  return { root, identityStore, server };
}

async function login(base: string, userId: string) {
  const response = await fetch(`${base}/api/v20/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://pilot.local' },
    body: JSON.stringify({ userId, tenantId: 'tenant-1', bootstrapToken }),
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { csrfToken: string; principal: { sessionId: string } };
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  return { cookie, csrf: body.csrfToken, principal: body.principal };
}

function headers(auth: { cookie: string; csrf: string }, withCsrf = true) {
  return {
    'content-type': 'application/json', origin: 'https://pilot.local', cookie: auth.cookie,
    ...(withCsrf ? { 'x-csrf-token': auth.csrf } : {}),
  };
}

test('authenticated operator and independent reviewer complete a shadow workflow', async () => {
  const { server } = setup();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const operator = await login(base, 'operator-1');
    const reviewer = await login(base, 'reviewer-1');
    const operationsResponse = await fetch(`${base}/api/v20/operations`, { headers: headers(operator, false) });
    assert.equal(operationsResponse.status, 200);
    const operations = await operationsResponse.json() as { overallState: string; blockedDependencies: string[] };
    assert.equal(operations.overallState, 'blocked');
    assert.ok(operations.blockedDependencies.includes('postgres-primary-standby'));
    const fixtureResponse = await fetch(`${base}/api/v20/fixture`, { headers: headers(operator, false) });
    assert.equal(fixtureResponse.status, 200);
    const fixture = await fixtureResponse.json() as Record<string, unknown>;
    const intakeResponse = await fetch(`${base}/api/v20/sessions/intake`, {
      method: 'POST', headers: headers(operator), body: JSON.stringify({
        sourceRepository: fixture.repositoryPath, objective: fixture.objective, targetFile: fixture.targetFile,
        allowedFiles: fixture.allowedFiles, exactBefore: fixture.exactBefore, exactAfter: fixture.exactAfter,
        testCommand: fixture.testCommand, planId: 'v20-web-plan', idempotencyKey: 'v20-web-idem',
      }),
    });
    assert.equal(intakeResponse.status, 201);
    const intake = await intakeResponse.json() as { sessionId: string; status: string };
    assert.equal(intake.status, 'INTAKE_COMPLETE');
    const executionResponse = await fetch(`${base}/api/v20/sessions/${intake.sessionId}/execute`, { method: 'POST', headers: headers(operator), body: '{}' });
    assert.equal(executionResponse.status, 200);
    assert.equal((await executionResponse.json() as { status: string }).status, 'AWAITING_REVIEW');
    const reviewResponse = await fetch(`${base}/api/v20/sessions/${intake.sessionId}/review`, { method: 'POST', headers: headers(reviewer), body: '{}' });
    assert.equal(reviewResponse.status, 200);
    const approved = await reviewResponse.json() as { status: string; passport: unknown };
    assert.equal(approved.status, 'APPROVED_SHADOW');
    assert.equal(typeof approved.passport, 'object');
    const rollbackResponse = await fetch(`${base}/api/v20/sessions/${intake.sessionId}/rollback`, { method: 'POST', headers: headers(operator), body: '{}' });
    assert.equal(rollbackResponse.status, 200);
    assert.equal((await rollbackResponse.json() as { status: string }).status, 'ROLLED_BACK');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('server enforces authentication, CSRF, origin and role separation', async () => {
  const { server } = setup();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/api/v20/me`)).status, 401);
    const wrongOrigin = await fetch(`${base}/api/v20/login`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.invalid' },
      body: JSON.stringify({ userId: 'operator-1', tenantId: 'tenant-1', bootstrapToken }),
    });
    assert.equal(wrongOrigin.status, 403);
    const operator = await login(base, 'operator-1');
    const noCsrf = await fetch(`${base}/api/v20/sessions/intake`, { method: 'POST', headers: headers(operator, false), body: '{}' });
    assert.equal(noCsrf.status, 403);
    const audit = await fetch(`${base}/api/v20/audit`, { headers: headers(operator, false) });
    assert.equal(audit.status, 403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('logout revokes the persisted session', async () => {
  const { server } = setup();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const operator = await login(base, 'operator-1');
    const logout = await fetch(`${base}/api/v20/logout`, { method: 'POST', headers: headers(operator), body: '{}' });
    assert.equal(logout.status, 200);
    const me = await fetch(`${base}/api/v20/me`, { headers: headers(operator, false) });
    assert.equal(me.status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
