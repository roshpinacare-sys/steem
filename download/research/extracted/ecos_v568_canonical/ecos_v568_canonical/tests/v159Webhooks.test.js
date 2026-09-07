/**
 * tests/v159Webhooks.test.js
 * ============================
 * V159 WorkspaceWebhookService — unit tests (standalone)
 * Run: node tests/v159Webhooks.test.js
 *
 * 24 tests covering:
 *  - registerWebhook (valid + invalid URL + unknown events)
 *  - updateWebhook (active toggle, URL change)
 *  - deleteWebhook
 *  - listWebhooks
 *  - getDeliveries
 *  - dispatch (no hooks → 0 dispatched)
 *  - testDeliver (to non-reachable URL → fails gracefully)
 *  - HMAC signature verification
 *  - stats
 *  - WEBHOOK_EVENTS enumeration
 *
 * [V159-TASK-TESTS]
 */

'use strict';

const assert = require('assert');
const path   = require('path');

const {
  WorkspaceWebhookService,
  defaultWebhookService,
  WEBHOOK_EVENTS,
} = require(path.resolve(__dirname, '../lib/workspaceWebhookService'));

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

console.log('\n── V159 Webhook Service Tests ─────────────────────────────────');

(async () => {

// ── T01: WEBHOOK_EVENTS is an array with wildcard ─────────────────────────────
await test('T01: WEBHOOK_EVENTS includes wildcard and at least 10 events', () => {
  assert(Array.isArray(WEBHOOK_EVENTS), 'WEBHOOK_EVENTS should be an array');
  assert(WEBHOOK_EVENTS.includes('*'), 'WEBHOOK_EVENTS should include wildcard *');
  assert(WEBHOOK_EVENTS.length >= 10, `Expected ≥10 events, got ${WEBHOOK_EVENTS.length}`);
});

// ── T02: register valid webhook ───────────────────────────────────────────────
await test('T02: registerWebhook creates a hook with id and secret', async () => {
  const svc = new WorkspaceWebhookService();
  const result = await svc.registerWebhook('ws_001', {
    url:    'https://example.com/hook',
    events: ['task.created'],
  });
  assert(result.id,         'should have id');
  assert(result.secret,     'should have secret');
  assert(result.token || result.secret, 'secret returned on creation');
  assert.strictEqual(result.workspaceId, 'ws_001', 'workspaceId should match');
});

// ── T03: register webhook without url throws ─────────────────────────────────
await test('T03: registerWebhook throws when url missing', async () => {
  const svc = new WorkspaceWebhookService();
  let threw = false;
  try { await svc.registerWebhook('ws_001', {}); } catch (_) { threw = true; }
  assert(threw, 'should throw when url missing');
});

// ── T04: register webhook with invalid URL throws ─────────────────────────────
await test('T04: registerWebhook throws on invalid URL', async () => {
  const svc = new WorkspaceWebhookService();
  let threw = false;
  try { await svc.registerWebhook('ws_001', { url: 'not-a-url' }); } catch (_) { threw = true; }
  assert(threw, 'should throw on invalid URL');
});

// ── T05: register webhook with unknown event throws ──────────────────────────
await test('T05: registerWebhook throws on unknown event type', async () => {
  const svc = new WorkspaceWebhookService();
  let threw = false;
  try {
    await svc.registerWebhook('ws_001', { url: 'https://example.com', events: ['unknown.event'] });
  } catch (_) { threw = true; }
  assert(threw, 'should throw on unknown event');
});

// ── T06: list returns registered hooks ────────────────────────────────────────
await test('T06: listWebhooks returns registered hooks', async () => {
  const svc = new WorkspaceWebhookService();
  await svc.registerWebhook('ws_02', { url: 'https://a.com/h1', events: ['*'] });
  await svc.registerWebhook('ws_02', { url: 'https://a.com/h2', events: ['task.created'] });
  const hooks = await svc.listWebhooks('ws_02');
  assert.strictEqual(hooks.length, 2, 'should have 2 hooks');
});

// ── T07: listWebhooks returns empty for unknown workspace ─────────────────────
await test('T07: listWebhooks returns empty for unknown workspace', async () => {
  const svc   = new WorkspaceWebhookService();
  const hooks = await svc.listWebhooks('ws_unknown');
  assert.strictEqual(hooks.length, 0, 'should return empty array');
});

// ── T08: updateWebhook changes active status ─────────────────────────────────
await test('T08: updateWebhook toggles active status', async () => {
  const svc  = new WorkspaceWebhookService();
  const hook = await svc.registerWebhook('ws_03', { url: 'https://b.com/h', events: ['*'] });
  const upd  = await svc.updateWebhook('ws_03', hook.id, { active: false });
  assert.strictEqual(upd.active, false, 'hook should now be inactive');
});

// ── T09: updateWebhook returns null for unknown hook ─────────────────────────
await test('T09: updateWebhook returns null for unknown hookId', async () => {
  const svc = new WorkspaceWebhookService();
  const r   = await svc.updateWebhook('ws_04', 'nonexistent', { active: false });
  assert.strictEqual(r, null, 'should return null for unknown hook');
});

// ── T10: deleteWebhook removes the hook ──────────────────────────────────────
await test('T10: deleteWebhook removes hook from workspace', async () => {
  const svc  = new WorkspaceWebhookService();
  const hook = await svc.registerWebhook('ws_05', { url: 'https://c.com/h', events: ['*'] });
  const del  = await svc.deleteWebhook('ws_05', hook.id);
  assert.strictEqual(del, true, 'should return true on deletion');
  const hooks = await svc.listWebhooks('ws_05');
  assert.strictEqual(hooks.length, 0, 'list should be empty after delete');
});

// ── T11: deleteWebhook returns false for unknown hook ────────────────────────
await test('T11: deleteWebhook returns false for unknown hookId', async () => {
  const svc = new WorkspaceWebhookService();
  const r   = await svc.deleteWebhook('ws_06', 'nonexistent');
  assert.strictEqual(r, false, 'should return false for unknown hook');
});

// ── T12: getDeliveries returns empty initially ────────────────────────────────
await test('T12: getDeliveries returns empty array for new hook', async () => {
  const svc  = new WorkspaceWebhookService();
  const hook = await svc.registerWebhook('ws_07', { url: 'https://d.com/h', events: ['*'] });
  const d    = svc.getDeliveries('ws_07', hook.id);
  assert(Array.isArray(d), 'should return an array');
  assert.strictEqual(d.length, 0, 'should be empty initially');
});

// ── T13: dispatch returns 0 when no hooks registered ────────────────────────
await test('T13: dispatch returns 0 dispatched when no hooks for workspace', async () => {
  const svc = new WorkspaceWebhookService();
  const r   = await svc.dispatch('ws_empty', 'task.created', { id: 'wt_1' });
  assert.strictEqual(r.dispatched, 0, 'should dispatch to 0 hooks');
});

// ── T14: inactive hook is not dispatched ─────────────────────────────────────
await test('T14: inactive hook is skipped during dispatch', async () => {
  const svc  = new WorkspaceWebhookService({ timeoutMs: 100 });
  const hook = await svc.registerWebhook('ws_inactive', { url: 'https://fail.example/h', events: ['*'] });
  await svc.updateWebhook('ws_inactive', hook.id, { active: false });
  const r = await svc.dispatch('ws_inactive', 'task.created', { test: true });
  assert.strictEqual(r.dispatched, 0, 'inactive hook should not be dispatched');
});

// ── T15: hook subscribing to specific event doesn't receive other events ──────
await test('T15: subscribesTo returns false for non-subscribed event', async () => {
  const svc  = new WorkspaceWebhookService();
  const h    = await svc.registerWebhook('ws_15', { url: 'https://e.com/h', events: ['task.done'] });
  const hook = svc._wsStore('ws_15').get(h.id);
  assert.strictEqual(hook.subscribesTo('task.done'),    true,  'should subscribe to task.done');
  assert.strictEqual(hook.subscribesTo('task.created'), false, 'should NOT subscribe to task.created');
});

// ── T16: wildcard hook subscribes to all events ───────────────────────────────
await test('T16: wildcard hook subscribes to all event types', async () => {
  const svc  = new WorkspaceWebhookService();
  const h    = await svc.registerWebhook('ws_16', { url: 'https://f.com/h', events: ['*'] });
  const hook = svc._wsStore('ws_16').get(h.id);
  for (const ev of ['task.created','task.updated','task.deleted','member.added']) {
    assert(hook.subscribesTo(ev), `should subscribe to ${ev} via wildcard`);
  }
});

// ── T17: HMAC signature generation ───────────────────────────────────────────
await test('T17: _sign generates consistent HMAC-SHA256 signature', () => {
  const svc  = new WorkspaceWebhookService();
  const sig1 = svc._sign('secret123', '{"event":"test"}');
  const sig2 = svc._sign('secret123', '{"event":"test"}');
  assert.strictEqual(sig1, sig2, 'same input should produce same signature');
  assert(sig1.startsWith('sha256='), 'signature should start with sha256=');
});

// ── T18: HMAC signature verification ─────────────────────────────────────────
await test('T18: verifySignature returns true for valid signature', () => {
  const svc  = new WorkspaceWebhookService();
  const body = JSON.stringify({ test: true });
  const sig  = svc._sign('my-secret', body);
  assert(svc.verifySignature('my-secret', body, sig), 'valid signature should verify');
});

// ── T19: HMAC signature verification fails for tampered body ─────────────────
await test('T19: verifySignature returns false for tampered body', () => {
  const svc    = new WorkspaceWebhookService();
  const body   = JSON.stringify({ test: true });
  const sig    = svc._sign('my-secret', body);
  const tampered = JSON.stringify({ test: false });
  assert.strictEqual(svc.verifySignature('my-secret', tampered, sig), false, 'tampered body should fail');
});

// ── T20: stats returns correct counts ────────────────────────────────────────
await test('T20: stats returns hookCount and activeHooks', async () => {
  const svc = new WorkspaceWebhookService();
  await svc.registerWebhook('ws_stats', { url: 'https://g.com/h1', events: ['*'] });
  await svc.registerWebhook('ws_stats', { url: 'https://g.com/h2', events: ['task.done'] });
  const s = svc.stats('ws_stats');
  assert.strictEqual(s.hookCount,    2, 'hookCount should be 2');
  assert.strictEqual(s.activeHooks,  2, 'activeHooks should be 2');
  assert.strictEqual(s.totalDeliveries, 0, 'no deliveries yet');
});

// ── T21: testDeliver returns null for missing hook ────────────────────────────
await test('T21: testDeliver returns null for nonexistent hookId', async () => {
  const svc = new WorkspaceWebhookService();
  const r   = await svc.testDeliver('ws_21', 'nonexistent');
  assert.strictEqual(r, null, 'should return null for nonexistent hook');
});

// ── T22: testDeliver fails gracefully for unreachable URL ────────────────────
await test('T22: testDeliver records failed delivery for unreachable URL', async () => {
  const svc  = new WorkspaceWebhookService({ timeoutMs: 200 });
  const hook = await svc.registerWebhook('ws_22', { url: 'http://localhost:19999/hook', events: ['*'] });
  const r    = await svc.testDeliver('ws_22', hook.id);
  assert(r !== null, 'result should not be null');
  assert.strictEqual(r.success, false, 'delivery should fail for unreachable URL');
  assert(r.deliveryId, 'delivery should have an id');
});

// ── T23: delivery recorded in hook after dispatch attempt ────────────────────
await test('T23: failed delivery is recorded in hook deliveries', async () => {
  const svc  = new WorkspaceWebhookService({ timeoutMs: 200 });
  const hook = await svc.registerWebhook('ws_23', { url: 'http://localhost:19998/hook', events: ['*'] });
  await svc.dispatch('ws_23', 'task.created', { id: 'wt_test' });
  const d = svc.getDeliveries('ws_23', hook.id);
  assert(d.length > 0, 'deliveries should be recorded after dispatch attempt');
});

// ── T24: defaultWebhookService is singleton WorkspaceWebhookService ───────────
await test('T24: defaultWebhookService is a WorkspaceWebhookService instance', () => {
  assert(defaultWebhookService instanceof WorkspaceWebhookService, 'should be WorkspaceWebhookService');
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
