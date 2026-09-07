import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PrivateIdentityStore, SlidingWindowRateLimiter } from '../src/security/private-identity.js';

const secret = 'v20-private-pilot-session-secret-0123456789';
const now = new Date('2026-07-17T00:00:00Z');

function bootstrap(path: string) {
  const store = new PrivateIdentityStore(path);
  store.bootstrap({
    tenant: { tenantId: 'tenant-1', displayName: 'Pilot Tenant', status: 'ACTIVE', createdAt: now.toISOString() },
    users: [
      { userId: 'operator-1', displayName: 'Operator', status: 'ACTIVE', createdAt: now.toISOString() },
      { userId: 'reviewer-1', displayName: 'Reviewer', status: 'ACTIVE', createdAt: now.toISOString() },
    ],
    memberships: [
      { tenantId: 'tenant-1', userId: 'operator-1', roles: ['operator'], status: 'ACTIVE' },
      { tenantId: 'tenant-1', userId: 'reviewer-1', roles: ['reviewer'], status: 'ACTIVE' },
    ],
  }, now);
  return store;
}

test('session survives restart, preserves roles and validates CSRF', () => {
  const root = mkdtempSync(join(tmpdir(), 'v20-identity-'));
  const path = join(root, 'identity.json');
  const store = bootstrap(path);
  const issued = store.issueSession({ userId: 'operator-1', tenantId: 'tenant-1', signingSecret: secret, ttlMs: 3_600_000 }, now);
  assert.equal(issued.principal.roles.includes('operator'), true);
  assert.equal(store.verifyCsrf(issued.principal.sessionId, issued.csrfToken), true);
  assert.equal(store.verifyCsrf(issued.principal.sessionId, 'wrong-csrf'), false);
  const reopened = new PrivateIdentityStore(path);
  const principal = reopened.authenticate(issued.token, secret, new Date(now.getTime() + 1000));
  assert.equal(principal.userId, 'operator-1');
  reopened.requireRole(principal, ['operator']);
  assert.throws(() => reopened.requireRole(principal, ['reviewer']), /role_not_authorized/);
  assert.equal(reopened.verifyAuditChain(), true);
});

test('session tampering, expiry and revocation fail closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'v20-identity-policy-'));
  const path = join(root, 'identity.json');
  const store = bootstrap(path);
  const issued = store.issueSession({ userId: 'operator-1', tenantId: 'tenant-1', signingSecret: secret, ttlMs: 60_000 }, now);
  assert.throws(() => store.authenticate(`${issued.token}x`, secret, now), /invalid_session_signature|invalid_session_token/);
  assert.throws(() => store.authenticate(issued.token, secret, new Date(now.getTime() + 60_000)), /session_expired/);
  store.revokeSession(issued.principal.sessionId, 'admin-1', new Date(now.getTime() + 1000));
  assert.throws(() => store.authenticate(issued.token, secret, new Date(now.getTime() + 2000)), /session_revoked/);
});

test('membership revocation invalidates an otherwise valid session after restart', () => {
  const root = mkdtempSync(join(tmpdir(), 'v20-identity-membership-'));
  const path = join(root, 'identity.json');
  const store = bootstrap(path);
  const issued = store.issueSession({ userId: 'reviewer-1', tenantId: 'tenant-1', signingSecret: secret, ttlMs: 3_600_000 }, now);
  store.revokeMembership('tenant-1', 'reviewer-1', 'admin-1', new Date(now.getTime() + 1000));
  const reopened = new PrivateIdentityStore(path);
  assert.throws(() => reopened.authenticate(issued.token, secret, new Date(now.getTime() + 2000)), /session_authority_revoked/);
});

test('cross-tenant and inactive membership cannot create sessions', () => {
  const root = mkdtempSync(join(tmpdir(), 'v20-identity-tenant-'));
  const store = bootstrap(join(root, 'identity.json'));
  assert.throws(() => store.issueSession({ userId: 'operator-1', tenantId: 'tenant-2', signingSecret: secret, ttlMs: 60_000 }, now), /tenant_not_active/);
  assert.throws(() => store.issueSession({ userId: 'unknown', tenantId: 'tenant-1', signingSecret: secret, ttlMs: 60_000 }, now), /user_not_active/);
});

test('sliding-window rate limiter blocks excess requests and resets after the window', () => {
  const limiter = new SlidingWindowRateLimiter(2, 1000);
  limiter.consume('127.0.0.1', 1000);
  limiter.consume('127.0.0.1', 1100);
  assert.throws(() => limiter.consume('127.0.0.1', 1200), /rate_limit_exceeded/);
  limiter.consume('127.0.0.1', 2101);
});
