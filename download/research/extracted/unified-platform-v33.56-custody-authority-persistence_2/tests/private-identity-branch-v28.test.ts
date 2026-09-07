import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { canonicalJson, sha256 } from '../src/contracts/crypto.js';
import { PILOT_ROLES, PrivateIdentityStore, SlidingWindowRateLimiter } from '../src/security/private-identity.js';

const secret = 'v28-private-identity-secret-0123456789abcdef';
const now = new Date('2026-07-17T00:00:00.000Z');

type MutableState = {
  version: number;
  users: Array<Record<string, unknown>>;
  tenants: Array<Record<string, unknown>>;
  memberships: Array<Record<string, unknown>>;
  sessions: Array<Record<string, unknown>>;
  audits: Array<Record<string, unknown>>;
};

function pathFor(label: string): string {
  return join(mkdtempSync(join(tmpdir(), `identity-v28-${label}-`)), 'identity.json');
}
function seed(path: string, options: { userStatus?: 'ACTIVE'|'REVOKED'; tenantStatus?: 'ACTIVE'|'SUSPENDED'; membershipStatus?: 'ACTIVE'|'REVOKED'; roles?: Array<'admin'|'operator'|'reviewer'|'auditor'> } = {}): PrivateIdentityStore {
  const store = new PrivateIdentityStore(path);
  store.bootstrap({
    tenant: { tenantId: 'tenant-1', displayName: 'Tenant', status: options.tenantStatus ?? 'ACTIVE', createdAt: now.toISOString() },
    users: [{ userId: 'user-1', displayName: 'User', status: options.userStatus ?? 'ACTIVE', createdAt: now.toISOString() }],
    memberships: [{ tenantId: 'tenant-1', userId: 'user-1', roles: options.roles ?? ['operator'], status: options.membershipStatus ?? 'ACTIVE' }],
  }, now);
  return store;
}
function readState(path: string): MutableState { return JSON.parse(readFileSync(path, 'utf8')) as MutableState; }
function saveState(path: string, state: MutableState): void { writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`); }
function signedToken(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(canonicalJson(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    sessionId: 'custom-session',
    userId: 'user-1',
    tenantId: 'tenant-1',
    roles: ['operator'],
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    nonce: 'nonce-1',
    ...overrides,
  };
}

test('identity state and bootstrap reject malformed, conflicting and unauthorized records', () => {
  const invalidVersion = pathFor('version');
  saveState(invalidVersion, { version: 2, users: [], tenants: [], memberships: [], sessions: [], audits: [] });
  assert.throws(() => new PrivateIdentityStore(invalidVersion), /identity_state_version_unsupported/);

  const invalidArrays = pathFor('arrays');
  saveState(invalidArrays, { version: 1, users: [] as never[], tenants: [] as never[], memberships: [] as never[], sessions: [] as never[], audits: null as never });
  assert.throws(() => new PrivateIdentityStore(invalidArrays), /invalid_identity_state/);

  const path = pathFor('bootstrap');
  const store = seed(path, { roles: ['operator', 'operator'] });
  const state = readState(path);
  assert.deepEqual(state.memberships[0]?.roles, ['operator']);
  assert.throws(() => store.bootstrap({ tenant: { tenantId: 'tenant-1', displayName: 'Changed', status: 'ACTIVE', createdAt: now.toISOString() }, users: [], memberships: [] }, now), /identity_bootstrap_conflict/);
  assert.throws(() => store.bootstrap({ tenant: { tenantId: 'tenant-1', displayName: 'Tenant', status: 'ACTIVE', createdAt: now.toISOString() }, users: [{ userId: 'user-1', displayName: 'Changed', status: 'ACTIVE', createdAt: now.toISOString() }], memberships: [] }, now), /identity_bootstrap_conflict/);
  assert.throws(() => store.bootstrap({ tenant: { tenantId: 'tenant-1', displayName: 'Tenant', status: 'ACTIVE', createdAt: now.toISOString() }, users: [], memberships: [{ tenantId: 'tenant-1', userId: 'user-1', roles: [], status: 'ACTIVE' }] }, now), /invalid_membership_roles/);
  assert.throws(() => store.bootstrap({ tenant: { tenantId: 'tenant-1', displayName: 'Tenant', status: 'ACTIVE', createdAt: now.toISOString() }, users: [], memberships: [{ tenantId: 'tenant-1', userId: 'user-1', roles: ['admin'], status: 'ACTIVE' }] }, now), /membership_bootstrap_conflict/);
});

test('session issue validates secret, TTL and each authority layer independently', () => {
  const active = seed(pathFor('issue-active'));
  assert.throws(() => active.issueSession({ userId: 'user-1', tenantId: 'tenant-1', signingSecret: 'short', ttlMs: 60_000 }, now), /session_signing_secret_too_short/);
  for (const ttlMs of [59_999, 86_400_001, 60_000.5]) assert.throws(() => active.issueSession({ userId: 'user-1', tenantId: 'tenant-1', signingSecret: secret, ttlMs }, now), /invalid_session_ttl/);
  assert.throws(() => seed(pathFor('issue-user'), { userStatus: 'REVOKED' }).issueSession({ userId: 'user-1', tenantId: 'tenant-1', signingSecret: secret, ttlMs: 60_000 }, now), /user_not_active/);
  assert.throws(() => seed(pathFor('issue-tenant'), { tenantStatus: 'SUSPENDED' }).issueSession({ userId: 'user-1', tenantId: 'tenant-1', signingSecret: secret, ttlMs: 60_000 }, now), /tenant_not_active/);
  assert.throws(() => seed(pathFor('issue-member'), { membershipStatus: 'REVOKED' }).issueSession({ userId: 'user-1', tenantId: 'tenant-1', signingSecret: secret, ttlMs: 60_000 }, now), /membership_not_active/);
});

test('token parser rejects malformed shape, signatures, claims and roles', () => {
  const store = seed(pathFor('token-parser'));
  assert.throws(() => store.authenticate('one-part', secret, now), /invalid_session_token/);
  assert.throws(() => store.authenticate('a.b.c', secret, now), /invalid_session_token/);
  const valid = signedToken(validClaims());
  const [encoded] = valid.split('.');
  assert.throws(() => store.authenticate(`${encoded}.AA`, secret, now), /invalid_session_signature/);
  assert.throws(() => store.authenticate(signedToken(validClaims({ version: 2 })), secret, now), /invalid_session_claims/);
  assert.throws(() => store.authenticate(signedToken(validClaims({ sessionId: ' ' })), secret, now), /invalid_session_claims/);
  assert.throws(() => store.authenticate(signedToken(validClaims({ issuedAt: 'bad-time' })), secret, now), /invalid_session_claims/);
  assert.throws(() => store.authenticate(signedToken(validClaims({ expiresAt: 'bad-time' })), secret, now), /invalid_session_claims/);
  assert.throws(() => store.authenticate(signedToken(validClaims({ roles: ['root'] })), secret, now), /invalid_session_roles/);
});

test('authentication detects stored-token substitution, claim mismatch and stale roles', () => {
  const path = pathFor('stored-claims');
  const store = seed(path);
  const issued = store.issueSession({ userId: 'user-1', tenantId: 'tenant-1', signingSecret: secret, ttlMs: 60_000 }, now);
  const original = readState(path);

  const missing = structuredClone(original); missing.sessions = [];
  saveState(path, missing);
  assert.throws(() => new PrivateIdentityStore(path).authenticate(issued.token, secret, now), /session_not_found/);

  const digestMismatch = structuredClone(original); digestMismatch.sessions[0]!.tokenDigest = '0'.repeat(64);
  saveState(path, digestMismatch);
  assert.throws(() => new PrivateIdentityStore(path).authenticate(issued.token, secret, now), /session_not_found/);

  const claimsMismatch = structuredClone(original); claimsMismatch.sessions[0]!.userId = 'different-user';
  saveState(path, claimsMismatch);
  assert.throws(() => new PrivateIdentityStore(path).authenticate(issued.token, secret, now), /session_claim_mismatch/);

  const stale = structuredClone(original); stale.memberships[0]!.roles = ['reviewer'];
  saveState(path, stale);
  assert.throws(() => new PrivateIdentityStore(path).authenticate(issued.token, secret, now), /session_role_stale/);
});

test('authentication detects revoked authority from user, tenant and missing membership', () => {
  for (const [label, mutate] of [
    ['user', (state: MutableState) => { state.users[0]!.status = 'REVOKED'; }],
    ['tenant', (state: MutableState) => { state.tenants[0]!.status = 'SUSPENDED'; }],
    ['membership', (state: MutableState) => { state.memberships = []; }],
  ] as const) {
    const path = pathFor(`authority-${label}`);
    const store = seed(path);
    const issued = store.issueSession({ userId: 'user-1', tenantId: 'tenant-1', signingSecret: secret, ttlMs: 60_000 }, now);
    const state = readState(path); mutate(state); saveState(path, state);
    assert.throws(() => new PrivateIdentityStore(path).authenticate(issued.token, secret, now), /session_authority_revoked/);
  }
});

test('CSRF, revocation and audit branches fail closed under missing and tampered state', () => {
  const path = pathFor('csrf-audit');
  const store = seed(path);
  const issued = store.issueSession({ userId: 'user-1', tenantId: 'tenant-1', signingSecret: secret, ttlMs: 60_000 }, now);
  assert.equal(store.verifyCsrf('missing', issued.csrfToken), false);
  store.revokeSession(issued.principal.sessionId, 'admin-1', now);
  assert.equal(store.verifyCsrf(issued.principal.sessionId, issued.csrfToken), false);
  assert.throws(() => store.revokeSession('missing', 'admin-1', now), /session_not_found/);
  assert.throws(() => store.revokeMembership('tenant-1', 'missing', 'admin-1', now), /membership_not_found/);
  assert.equal(store.listAudit('tenant-other').length, 0);

  const tamperedDigest = readState(path); tamperedDigest.audits[0]!.digest = '0'.repeat(64); saveState(path, tamperedDigest);
  assert.equal(new PrivateIdentityStore(path).verifyAuditChain(), false);
  const tamperedPrevious = readState(path); tamperedPrevious.audits[0]!.digest = sha256(Object.fromEntries(Object.entries(tamperedPrevious.audits[0]!).filter(([key]) => key !== 'digest'))); tamperedPrevious.audits[0]!.previousDigest = 'not-null'; saveState(path, tamperedPrevious);
  assert.equal(new PrivateIdentityStore(path).verifyAuditChain(), false);
});

test('rate limiter rejects invalid configuration and isolates keys while pruning the window', () => {
  for (const [limit, windowMs] of ([[0, 1], [1.5, 1], [1, 0], [1, 1.5]] as Array<[number, number]>)) assert.throws(() => new SlidingWindowRateLimiter(limit, windowMs), /invalid_rate_limit/);
  assert.deepEqual(PILOT_ROLES, ['admin', 'operator', 'reviewer', 'auditor']);
  const limiter = new SlidingWindowRateLimiter(1, 100);
  limiter.consume('a', 1000);
  limiter.consume('b', 1000);
  assert.throws(() => limiter.consume('a', 1050), /rate_limit_exceeded/);
  limiter.consume('a', 1101);
});
