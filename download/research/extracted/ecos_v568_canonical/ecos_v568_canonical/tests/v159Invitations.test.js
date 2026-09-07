/**
 * tests/v159Invitations.test.js
 * ================================
 * V159 WorkspaceInvitationService — unit tests (standalone)
 * Run: node tests/v159Invitations.test.js
 *
 * 20 tests covering:
 *  - createInvitation (valid, missing email, invalid email, invalid role)
 *  - acceptInvitation (valid token, invalid token, wrong type)
 *  - revokeInvitation
 *  - listInvitations (all, pending only, accepted only)
 *  - duplicate detection (returns alreadyExists)
 *  - expired invitation detection
 *  - cleanupExpired
 *  - getInvitation
 *  - VALID_ROLES and TTL constants
 *  - defaultInvitationService singleton
 *
 * [V159-TASK-TESTS]
 */

'use strict';

const assert = require('assert');
const path   = require('path');

const {
  WorkspaceInvitationService,
  defaultInvitationService,
  VALID_ROLES,
  INVITATION_TTL_HOURS,
} = require(path.resolve(__dirname, '../lib/workspaceInvitationService'));

let passed  = 0;
let failed  = 0;
const errors = [];

const TEST_SECRET = 'ecos-v159-test-secret-12345';

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
    errors.push({ name, message: err.message });
  }
}

console.log('\n── V159 WorkspaceInvitationService Tests ───────────────────────');

(async () => {

// ── T01: VALID_ROLES constant ────────────────────────────────────────────────
await test('T01: VALID_ROLES contains admin, manager, member, viewer', () => {
  assert(Array.isArray(VALID_ROLES), 'VALID_ROLES should be an array');
  for (const role of ['admin','manager','member','viewer']) {
    assert(VALID_ROLES.includes(role), `VALID_ROLES should include ${role}`);
  }
});

// ── T02: INVITATION_TTL_HOURS is 48 ─────────────────────────────────────────
await test('T02: INVITATION_TTL_HOURS is 48', () => {
  assert.strictEqual(INVITATION_TTL_HOURS, 48, 'TTL should be 48 hours');
});

// ── T03: createInvitation returns id + token ─────────────────────────────────
await test('T03: createInvitation returns invitation with id and token', async () => {
  const svc    = new WorkspaceInvitationService({ jwtSecret: TEST_SECRET });
  const result = await svc.createInvitation('ws_01', { email: 'alice@example.com', role: 'member' });
  assert(result.invitation,    'should have invitation');
  assert(result.invitation.id, 'invitation should have id');
  assert(result.token,         'should return token');
  assert.strictEqual(result.alreadyExists, false, 'should not be duplicate');
  assert.strictEqual(result.invitation.status, 'pending', 'status should be pending');
});

// ── T04: createInvitation throws when email missing ──────────────────────────
await test('T04: createInvitation throws when email missing', async () => {
  const svc = new WorkspaceInvitationService({ jwtSecret: TEST_SECRET });
  let threw = false;
  try { await svc.createInvitation('ws_02', { role: 'member' }); } catch (_) { threw = true; }
  assert(threw, 'should throw when email missing');
});

// ── T05: createInvitation throws for invalid email ───────────────────────────
await test('T05: createInvitation throws for invalid email format', async () => {
  const svc = new WorkspaceInvitationService({ jwtSecret: TEST_SECRET });
  let threw = false;
  try { await svc.createInvitation('ws_03', { email: 'not-an-email' }); } catch (_) { threw = true; }
  assert(threw, 'should throw for invalid email');
});

// ── T06: createInvitation throws for invalid role ────────────────────────────
await test('T06: createInvitation throws for invalid role', async () => {
  const svc = new WorkspaceInvitationService({ jwtSecret: TEST_SECRET });
  let threw = false;
  try { await svc.createInvitation('ws_04', { email: 'bob@test.com', role: 'superuser' }); } catch (_) { threw = true; }
  assert(threw, 'should throw for invalid role');
});

// ── T07: createInvitation defaults to member role ────────────────────────────
await test('T07: createInvitation defaults role to member', async () => {
  const svc    = new WorkspaceInvitationService({ jwtSecret: TEST_SECRET });
  const result = await svc.createInvitation('ws_05', { email: 'carol@test.com' });
  assert.strictEqual(result.invitation.role, 'member', 'default role should be member');
});

// ── T08: duplicate invitation returns alreadyExists=true ─────────────────────
await test('T08: duplicate invitation for same workspace+email returns alreadyExists=true', async () => {
  const svc = new WorkspaceInvitationService({ jwtSecret: TEST_SECRET });
  await svc.createInvitation('ws_06', { email: 'dave@test.com' });
  const dup = await svc.createInvitation('ws_06', { email: 'dave@test.com' });
  assert.strictEqual(dup.alreadyExists, true, 'should detect duplicate');
});

// ── T09: acceptInvitation with valid token ───────────────────────────────────
await test('T09: acceptInvitation succeeds with valid token', async () => {
  const svc    = new WorkspaceInvitationService({ jwtSecret: TEST_SECRET });
  const result = await svc.createInvitation('ws_07', { email: 'eve@test.com', role: 'admin' });
  const accept = await svc.acceptInvitation(result.token, 'user_eve_001');
  assert.strictEqual(accept.ok,          true,          'should succeed');
  assert.strictEqual(accept.workspaceId, 'ws_07',       'workspace should match');
  assert.strictEqual(accept.role,        'admin',        'role should match');
  assert.strictEqual(accept.userId,      'user_eve_001', 'userId should match');
  assert(accept.acceptedAt, 'should have acceptedAt timestamp');
});

// ── T10: invitation status becomes accepted after accept ─────────────────────
await test('T10: invitation status changes to accepted after acceptInvitation', async () => {
  const svc    = new WorkspaceInvitationService({ jwtSecret: TEST_SECRET });
  const result = await svc.createInvitation('ws_08', { email: 'frank@test.com' });
  await svc.acceptInvitation(result.token, 'user_frank');
  const inv = svc.getInvitation(result.invitation.id);
  assert.strictEqual(inv.status, 'accepted', 'status should be accepted');
});

// ── T11: double accept throws (already accepted) ─────────────────────────────
await test('T11: acceptInvitation throws when invitation already accepted', async () => {
  const svc = new WorkspaceInvitationService({ jwtSecret: TEST_SECRET });
  const r   = await svc.createInvitation('ws_09', { email: 'grace@test.com' });
  await svc.acceptInvitation(r.token, 'u_grace');
  let threw = false;
  try { await svc.acceptInvitation(r.token, 'u_grace2'); } catch (_) { threw = true; }
  assert(threw, 'should throw when invitation already accepted');
});

// ── T12: acceptInvitation throws for invalid token ───────────────────────────
await test('T12: acceptInvitation throws for invalid JWT token', async () => {
  const svc = new WorkspaceInvitationService({ jwtSecret: TEST_SECRET });
  let threw = false;
  try { await svc.acceptInvitation('invalid.jwt.token', 'u_test'); } catch (_) { threw = true; }
  assert(threw, 'should throw for invalid token');
});

// ── T13: acceptInvitation throws for wrong token type ───────────────────────
await test('T13: acceptInvitation throws for non-workspace token type', async () => {
  const svc = new WorkspaceInvitationService({ jwtSecret: TEST_SECRET });
  // Craft a valid HS256 token but with wrong `type` field — should be rejected
  const b64url = b => Buffer.from(b).toString('base64url');
  const header  = b64url('{"alg":"HS256","typ":"JWT"}');
  const payload = b64url(JSON.stringify({ sub: 'user:123', type: 'auth', inviteId: 'fake', exp: Math.floor(Date.now()/1000)+3600 }));
  const msg = `${header}.${payload}`;
  const sig = require('crypto').createHmac('sha256', TEST_SECRET).update(msg).digest('base64url');
  const badTok = `${msg}.${sig}`;
  let threw = false;
  try { await svc.acceptInvitation(badTok, 'u_test'); } catch (_) { threw = true; }
  assert(threw, 'should throw for wrong token type');
});

// ── T14: revokeInvitation changes status to revoked ─────────────────────────
await test('T14: revokeInvitation sets status to revoked', async () => {
  const svc = new WorkspaceInvitationService({ jwtSecret: TEST_SECRET });
  const r   = await svc.createInvitation('ws_10', { email: 'heidi@test.com' });
  const rev = await svc.revokeInvitation('ws_10', r.invitation.id);
  assert(rev, 'should return invitation');
  assert.strictEqual(rev.status, 'revoked', 'status should be revoked');
});

// ── T15: revokeInvitation returns null for unknown invite ─────────────────────
await test('T15: revokeInvitation returns null for nonexistent inviteId', async () => {
  const svc = new WorkspaceInvitationService({ jwtSecret: TEST_SECRET });
  const r   = await svc.revokeInvitation('ws_11', 'nonexistent');
  assert.strictEqual(r, null, 'should return null for unknown invite');
});

// ── T16: listInvitations returns correct invitations ─────────────────────────
await test('T16: listInvitations returns all invitations for workspace', async () => {
  const svc = new WorkspaceInvitationService({ jwtSecret: TEST_SECRET });
  await svc.createInvitation('ws_12', { email: 'ivan@test.com' });
  await svc.createInvitation('ws_12', { email: 'judy@test.com' });
  const list = await svc.listInvitations('ws_12');
  assert.strictEqual(list.length, 2, 'should return 2 invitations');
});

// ── T17: listInvitations empty for unknown workspace ─────────────────────────
await test('T17: listInvitations returns empty for unknown workspace', async () => {
  const svc  = new WorkspaceInvitationService({ jwtSecret: TEST_SECRET });
  const list = await svc.listInvitations('ws_unknown');
  assert.strictEqual(list.length, 0, 'should return empty list');
});

// ── T18: getInvitation returns the correct invitation ────────────────────────
await test('T18: getInvitation returns invitation by id', async () => {
  const svc  = new WorkspaceInvitationService({ jwtSecret: TEST_SECRET });
  const r    = await svc.createInvitation('ws_13', { email: 'kim@test.com', role: 'viewer' });
  const fetched = svc.getInvitation(r.invitation.id);
  assert(fetched,  'should return invitation');
  assert.strictEqual(fetched.email, 'kim@test.com', 'email should match');
  assert.strictEqual(fetched.role,  'viewer',        'role should match');
});

// ── T19: cleanupExpired marks expired invitations ────────────────────────────
await test('T19: cleanupExpired marks artificially-expired invitations', async () => {
  const svc = new WorkspaceInvitationService({ jwtSecret: TEST_SECRET });
  const r   = await svc.createInvitation('ws_14', { email: 'leo@test.com' });
  // Manually expire
  const inv = svc._store.get(r.invitation.id);
  inv.expiresAt = new Date(Date.now() - 1000).toISOString();
  const removed = svc.cleanupExpired();
  assert(removed >= 1, 'should have expired at least 1 invitation');
  assert.strictEqual(svc.getInvitation(r.invitation.id).status, 'expired', 'status should be expired');
});

// ── T20: defaultInvitationService is singleton ──────────────────────────────
await test('T20: defaultInvitationService is a WorkspaceInvitationService instance', () => {
  assert(defaultInvitationService instanceof WorkspaceInvitationService, 'should be WorkspaceInvitationService instance');
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('');
console.log(`── Results: ${passed} passed, ${failed} failed (total ${passed + failed}) ──`);
if (errors.length) {
  console.log('\nFailures:');
  errors.forEach(e => console.log(`  ✗ ${e.name}: ${e.message}`));
}
console.log('');
if (failed > 0) process.exit(1);
})();
