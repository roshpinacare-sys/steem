/**
 * tests/v158DeployCheck.test.js
 * ================================
 * V158 Deploy Check + WorkspaceFeed + WorkspaceAuth — unit tests (standalone)
 * Run: node tests/v158DeployCheck.test.js
 *
 * ≥12 tests covering:
 *  - WorkspaceSSEFeed stats
 *  - WorkspaceSSEFeed broadcast
 *  - WorkspaceFeedHub stats
 *  - workspaceAuth middleware behavior
 *  - requireWorkspaceRole middleware
 *  - VALID_STATUSES + VALID_PRIORITIES (regression)
 *
 * [V158-TASK-08, T26]
 */

'use strict';

const assert = require('assert');
const path   = require('path');

const {
  WorkspaceFeedHub,
  WorkspaceSSEFeed,
  defaultWorkspaceFeedHub,
  defaultWorkspaceSSEFeed,
} = require(path.resolve(__dirname, '../lib/workspaceRealTimeFeed'));

const { workspaceAuth, requireWorkspaceRole } = require(path.resolve(__dirname, '../middleware/workspaceAuth'));

const { VALID_STATUSES, VALID_PRIORITIES } = require(path.resolve(__dirname, '../lib/workspaceTaskService'));

let passed  = 0;
let failed  = 0;
const errors = [];

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

console.log('\n── V158 DeployCheck / WorkspaceFeed / Auth Tests ────────────────');

(async () => {

// ── T01: WorkspaceFeedHub instantiates ────────────────────────────────────────
await test('T01: WorkspaceFeedHub instantiates with zero clients', () => {
  const hub = new WorkspaceFeedHub();
  const stats = hub.stats();
  assert.strictEqual(stats.totalClients, 0, 'should start with 0 clients');
  assert.strictEqual(stats.eventCount,   0, 'eventCount should be 0');
});

// ── T02: WorkspaceFeedHub subscribe/unsubscribe ───────────────────────────────
await test('T02: WorkspaceFeedHub subscribe then unsubscribe', () => {
  const hub = new WorkspaceFeedHub();
  const mockWs = { readyState: 1, send: () => {} };
  hub.subscribe('client1', mockWs, 'ws_abc');
  assert.strictEqual(hub.stats().totalClients, 1, 'should have 1 client');
  hub.unsubscribe('client1');
  assert.strictEqual(hub.stats().totalClients, 0, 'should have 0 clients after unsubscribe');
});

// ── T03: WorkspaceFeedHub broadcast increments eventCount ─────────────────────
await test('T03: WorkspaceFeedHub.broadcast increments eventCount', () => {
  const hub = new WorkspaceFeedHub();
  const messages = [];
  const mockWs = { readyState: 1, send: (msg) => messages.push(msg) };
  hub.subscribe('c1', mockWs, 'ws_xyz');
  hub.broadcast('ws_xyz', 'task.created', { id: 'wt_001', title: 'Test' });
  assert.strictEqual(hub.stats().eventCount, 1, 'eventCount should be 1');
  assert.strictEqual(messages.length, 1, 'client should receive 1 message');
});

// ── T04: WorkspaceFeedHub broadcast only to correct workspace ─────────────────
await test('T04: WorkspaceFeedHub.broadcast only sends to matching workspace', () => {
  const hub = new WorkspaceFeedHub();
  const msgs1 = [];
  const msgs2 = [];
  hub.subscribe('c1', { readyState: 1, send: m => msgs1.push(m) }, 'ws_A');
  hub.subscribe('c2', { readyState: 1, send: m => msgs2.push(m) }, 'ws_B');
  hub.broadcast('ws_A', 'task.created', { id: 'wt_1' });
  assert.strictEqual(msgs1.length, 1, 'ws_A client should get 1 message');
  assert.strictEqual(msgs2.length, 0, 'ws_B client should get 0 messages');
});

// ── T05: WorkspaceFeedHub byWorkspace stats ───────────────────────────────────
await test('T05: WorkspaceFeedHub stats.byWorkspace shows per-workspace counts', () => {
  const hub = new WorkspaceFeedHub();
  hub.subscribe('c1', { readyState: 1, send: () => {} }, 'ws_A');
  hub.subscribe('c2', { readyState: 1, send: () => {} }, 'ws_A');
  hub.subscribe('c3', { readyState: 1, send: () => {} }, 'ws_B');
  const stats = hub.stats();
  assert.strictEqual(stats.byWorkspace['ws_A'], 2, 'ws_A should have 2 clients');
  assert.strictEqual(stats.byWorkspace['ws_B'], 1, 'ws_B should have 1 client');
});

// ── T06: WorkspaceSSEFeed stats ───────────────────────────────────────────────
await test('T06: WorkspaceSSEFeed instantiates with zero clients', () => {
  const feed = new WorkspaceSSEFeed();
  const stats = feed.stats();
  assert.strictEqual(stats.totalClients, 0, 'should start with 0 clients');
});

// ── T07: WorkspaceSSEFeed send returns 0 with no clients ─────────────────────
await test('T07: WorkspaceSSEFeed.send returns 0 when no clients subscribed', () => {
  const feed = new WorkspaceSSEFeed();
  const sent = feed.send('ws_nobody', 'task.created', { id: 'wt_x' });
  assert.strictEqual(sent, 0, 'should send to 0 clients');
});

// ── T08: workspaceAuth passes through in dev mode (no getMembership) ──────────
await test('T08: workspaceAuth passes through when no getMembership configured', async () => {
  const mw = workspaceAuth({ getMembership: null });
  let nextCalled = false;
  const req = { params: { workspaceId: 'ws_dev' }, headers: {}, user: null };
  const res = { status: () => ({ json: () => {} }), json: () => {} };
  await mw(req, res, () => { nextCalled = true; });
  assert(nextCalled, 'next should be called in dev mode');
});

// ── T09: workspaceAuth skips when no workspaceId in params ────────────────────
await test('T09: workspaceAuth skips when no workspaceId in params', async () => {
  const mw = workspaceAuth({ getMembership: async () => null });
  let nextCalled = false;
  const req = { params: {}, headers: {} };
  await mw(req, {}, () => { nextCalled = true; });
  assert(nextCalled, 'next should be called when no workspaceId');
});

// ── T10: workspaceAuth returns 401 when no userId and getMembership set ────────
await test('T10: workspaceAuth returns 401 when userId missing', async () => {
  const mw = workspaceAuth({ getMembership: async () => ({ isMember: true, role: 'member' }) });
  let statusCode = null;
  const req = { params: { workspaceId: 'ws_locked' }, headers: {} };
  const res = {
    status: (code) => { statusCode = code; return { json: () => {} }; },
    json: () => {},
  };
  await mw(req, res, () => {});
  assert.strictEqual(statusCode, 401, `expected 401, got ${statusCode}`);
});

// ── T11: requireWorkspaceRole passes when role matches ────────────────────────
await test('T11: requireWorkspaceRole passes when role in allowed list', () => {
  const mw = requireWorkspaceRole(['admin', 'manager']);
  let nextCalled = false;
  const req = { workspaceMembership: { role: 'admin' } };
  const res = { status: () => ({ json: () => {} }), json: () => {} };
  mw(req, res, () => { nextCalled = true; });
  assert(nextCalled, 'next should be called');
});

// ── T12: requireWorkspaceRole returns 403 for insufficient role ───────────────
await test('T12: requireWorkspaceRole returns 403 for insufficient role', () => {
  const mw = requireWorkspaceRole(['admin']);
  let statusCode = null;
  const req = { workspaceMembership: { role: 'viewer' } };
  const res = {
    status: (code) => { statusCode = code; return { json: () => {} }; },
    json: () => {},
  };
  mw(req, res, () => {});
  assert.strictEqual(statusCode, 403, `expected 403, got ${statusCode}`);
});

// ── T13: requireWorkspaceRole returns 403 when no membership ─────────────────
await test('T13: requireWorkspaceRole returns 403 when no membership on req', () => {
  const mw = requireWorkspaceRole(['admin']);
  let statusCode = null;
  const req = {};
  const res = {
    status: (code) => { statusCode = code; return { json: () => {} }; },
    json: () => {},
  };
  mw(req, res, () => {});
  assert.strictEqual(statusCode, 403, `expected 403, got ${statusCode}`);
});

// ── T14: VALID_STATUSES are exactly 6 ─────────────────────────────────────────
await test('T14: VALID_STATUSES has exactly 6 entries', () => {
  assert.strictEqual(VALID_STATUSES.length, 6, `expected 6 statuses, got ${VALID_STATUSES.length}: ${VALID_STATUSES.join(', ')}`);
});

// ── T15: VALID_PRIORITIES are exactly 4 ──────────────────────────────────────
await test('T15: VALID_PRIORITIES has exactly 4 entries', () => {
  assert.strictEqual(VALID_PRIORITIES.length, 4, `expected 4 priorities, got ${VALID_PRIORITIES.length}`);
});

// ── T16: defaultWorkspaceFeedHub singleton exported ──────────────────────────
await test('T16: defaultWorkspaceFeedHub and defaultWorkspaceSSEFeed are singletons', () => {
  assert(defaultWorkspaceFeedHub instanceof WorkspaceFeedHub, 'defaultWorkspaceFeedHub should be WorkspaceFeedHub');
  assert(defaultWorkspaceSSEFeed instanceof WorkspaceSSEFeed, 'defaultWorkspaceSSEFeed should be WorkspaceSSEFeed');
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
