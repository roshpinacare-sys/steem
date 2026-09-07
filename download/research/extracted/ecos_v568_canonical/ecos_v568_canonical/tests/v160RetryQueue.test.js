/**
 * tests/v160RetryQueue.test.js
 * ==============================
 * V160 WebhookRetryQueue — unit tests (standalone)
 * Run: node tests/v160RetryQueue.test.js
 *
 * 24 tests covering:
 *  - enqueue (valid + missing url + missing webhookId)
 *  - getQueue (all, by webhookId, by status)
 *  - stats (queueSize, byStatus, counters)
 *  - requeueFailed (resets abandoned records)
 *  - processDue (in-memory delivery — non-reachable url → fails gracefully)
 *  - purgeOld (removes old completed records)
 *  - _nextRetryAt (exponential backoff capping)
 *  - startPolling / stopPolling (timer lifecycle)
 *  - DEFAULT_MAX_RETRIES, DEFAULT_MAX_AGE_HOURS constants
 *
 * [V160-TEST-01]
 */

'use strict';

const assert = require('assert');
const path   = require('path');

const {
  WebhookRetryQueue,
  defaultRetryQueue,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_AGE_HOURS,
} = require(path.resolve(__dirname, '../lib/webhookRetryQueue'));

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

console.log('\n── V160 WebhookRetryQueue Tests ───────────────────────────────');

(async () => {

// ── Constants ─────────────────────────────────────────────────────────────
await test('T01: DEFAULT_MAX_RETRIES is a positive integer', () => {
  assert(typeof DEFAULT_MAX_RETRIES === 'number', 'should be number');
  assert(DEFAULT_MAX_RETRIES > 0, 'should be positive');
});

await test('T02: DEFAULT_MAX_AGE_HOURS is a positive integer', () => {
  assert(typeof DEFAULT_MAX_AGE_HOURS === 'number', 'should be number');
  assert(DEFAULT_MAX_AGE_HOURS > 0, 'should be positive');
});

// ── enqueue ───────────────────────────────────────────────────────────────
await test('T03: enqueue creates a pending record with id', async () => {
  const q = new WebhookRetryQueue();
  const r = await q.enqueue({ webhookId:'wh_001', url:'https://example.com/hook', eventType:'task.created', payload:{ a:1 } });
  assert(r.id,   'should have id');
  assert.strictEqual(r.status, 'pending', 'status should be pending');
  assert.strictEqual(r.attemptNum, 1, 'attemptNum should be 1');
  assert.strictEqual(r.webhookId, 'wh_001', 'webhookId should match');
});

await test('T04: enqueue throws when url is missing', async () => {
  const q = new WebhookRetryQueue();
  let threw = false;
  try { await q.enqueue({ webhookId:'wh_001' }); } catch (_) { threw = true; }
  assert(threw, 'should throw when url missing');
});

await test('T05: enqueue throws when webhookId is missing', async () => {
  const q = new WebhookRetryQueue();
  let threw = false;
  try { await q.enqueue({ url:'https://example.com/hook' }); } catch (_) { threw = true; }
  assert(threw, 'should throw when webhookId missing');
});

await test('T06: enqueue increments totalEnqueued stats', async () => {
  const q = new WebhookRetryQueue();
  await q.enqueue({ webhookId:'wh_001', url:'https://a.com', eventType:'task.updated' });
  await q.enqueue({ webhookId:'wh_001', url:'https://b.com', eventType:'task.done' });
  const s = q.stats();
  assert.strictEqual(s.totalEnqueued, 2, 'totalEnqueued should be 2');
});

// ── getQueue ──────────────────────────────────────────────────────────────
await test('T07: getQueue returns all records when no filter', async () => {
  const q = new WebhookRetryQueue();
  await q.enqueue({ webhookId:'wh_001', url:'https://a.com', eventType:'e1' });
  await q.enqueue({ webhookId:'wh_002', url:'https://b.com', eventType:'e2' });
  const all = q.getQueue();
  assert.strictEqual(all.length, 2, 'should return 2 records');
});

await test('T08: getQueue filters by webhookId', async () => {
  const q = new WebhookRetryQueue();
  await q.enqueue({ webhookId:'wh_A', url:'https://a.com', eventType:'e1' });
  await q.enqueue({ webhookId:'wh_B', url:'https://b.com', eventType:'e2' });
  const filtered = q.getQueue('wh_A');
  assert.strictEqual(filtered.length, 1, 'should return 1 record for wh_A');
  assert.strictEqual(filtered[0].webhookId, 'wh_A', 'webhookId should match');
});

await test('T09: getQueue filters by status', async () => {
  const q = new WebhookRetryQueue();
  await q.enqueue({ webhookId:'wh_001', url:'https://a.com', eventType:'e1' });
  const all = q.getQueue(null, 'pending');
  assert.strictEqual(all.length, 1, 'should return 1 pending record');
  const none = q.getQueue(null, 'success');
  assert.strictEqual(none.length, 0, 'should return 0 success records');
});

// ── stats ─────────────────────────────────────────────────────────────────
await test('T10: stats returns correct structure', async () => {
  const q = new WebhookRetryQueue({ maxRetries: 5, maxAgeHours: 24 });
  const s = q.stats();
  assert(typeof s.queueSize    === 'number', 'queueSize should be number');
  assert(typeof s.byStatus     === 'object', 'byStatus should be object');
  assert(typeof s.totalEnqueued === 'number', 'totalEnqueued should be number');
  assert.strictEqual(s.maxRetries,  5,  'maxRetries should be 5');
  assert.strictEqual(s.maxAgeHours, 24, 'maxAgeHours should be 24');
});

await test('T11: stats.queueSize matches enqueue count', async () => {
  const q = new WebhookRetryQueue();
  await q.enqueue({ webhookId:'wh_001', url:'https://a.com', eventType:'e' });
  await q.enqueue({ webhookId:'wh_001', url:'https://b.com', eventType:'e' });
  const s = q.stats();
  assert.strictEqual(s.queueSize, 2, 'queueSize should be 2');
});

// ── requeueFailed ─────────────────────────────────────────────────────────
await test('T12: requeueFailed resets abandoned records to pending', async () => {
  const q = new WebhookRetryQueue();
  const r = await q.enqueue({ webhookId:'wh_001', url:'https://a.com', eventType:'e' });
  // manually set to abandoned
  const record = q._queue.get(r.id);
  record.status = 'abandoned';
  const count = q.requeueFailed('wh_001');
  assert.strictEqual(count, 1, 'should requeue 1 record');
  assert.strictEqual(record.status, 'pending', 'status should be pending after requeue');
  assert.strictEqual(record.attemptNum, 1, 'attemptNum should reset to 1');
});

await test('T13: requeueFailed returns 0 when no failed records', async () => {
  const q = new WebhookRetryQueue();
  await q.enqueue({ webhookId:'wh_001', url:'https://a.com', eventType:'e' });
  const count = q.requeueFailed('wh_001');
  assert.strictEqual(count, 0, 'pending records should not be requeued');
});

// ── processDue ────────────────────────────────────────────────────────────
await test('T14: processDue returns result object with correct fields', async () => {
  const q = new WebhookRetryQueue();
  const result = await q.processDue();
  assert(typeof result.processed   === 'number', 'processed should be number');
  assert(typeof result.succeeded   === 'number', 'succeeded should be number');
  assert(typeof result.requeued    === 'number', 'requeued should be number');
  assert(typeof result.abandoned   === 'number', 'abandoned should be number');
});

await test('T15: processDue handles non-reachable URL gracefully', async () => {
  const q = new WebhookRetryQueue({ maxRetries: 1 });
  await q.enqueue({
    webhookId: 'wh_001', url: 'http://127.0.0.1:19999/notreal',
    eventType: 'task.created', retryAt: new Date(Date.now()-1000).toISOString()
  });
  const result = await q.processDue();
  assert.strictEqual(result.processed, 1, 'should process 1 record');
  // After 1 attempt failure with maxRetries=1, should be abandoned or requeued
  assert(result.requeued + result.abandoned > 0, 'should requeue or abandon');
});

await test('T16: processDue skips records not yet due', async () => {
  const q = new WebhookRetryQueue();
  await q.enqueue({ webhookId:'wh_001', url:'https://a.com', eventType:'e',
    retryAt: new Date(Date.now() + 3600000).toISOString() // 1 hour from now
  });
  const result = await q.processDue();
  assert.strictEqual(result.processed, 0, 'should not process future-due records');
});

// ── purgeOld ──────────────────────────────────────────────────────────────
await test('T17: purgeOld removes old completed records', async () => {
  const q = new WebhookRetryQueue({ maxAgeHours: 0 }); // 0 = anything old
  const r = await q.enqueue({ webhookId:'wh_001', url:'https://a.com', eventType:'e' });
  // manually set to success and set old createdAt
  const record = q._queue.get(r.id);
  record.status    = 'success';
  record.createdAt = new Date(Date.now() - 100000).toISOString();
  const removed = q.purgeOld();
  assert(removed >= 1, 'should purge at least 1 old record');
});

await test('T18: purgeOld does not remove pending records', async () => {
  const q = new WebhookRetryQueue({ maxAgeHours: 0 });
  await q.enqueue({ webhookId:'wh_001', url:'https://a.com', eventType:'e' });
  const removed = q.purgeOld();
  assert.strictEqual(removed, 0, 'pending records should not be purged');
});

// ── _nextRetryAt (backoff) ────────────────────────────────────────────────
await test('T19: _nextRetryAt returns future timestamp', () => {
  const q   = new WebhookRetryQueue({ backoffBase: 1000, backoffCap: 60000 });
  const next = q._nextRetryAt(1);
  assert(new Date(next) > new Date(), 'retryAt should be in the future');
});

await test('T20: _nextRetryAt exponentially increases', () => {
  const q  = new WebhookRetryQueue({ backoffBase: 1000, backoffCap: 999999 });
  const t1 = new Date(q._nextRetryAt(1)).getTime();
  const t2 = new Date(q._nextRetryAt(2)).getTime();
  assert(t2 > t1, 'later attempt should have larger delay');
});

await test('T21: _nextRetryAt caps at backoffCap', () => {
  const q    = new WebhookRetryQueue({ backoffBase: 1000, backoffCap: 5000 });
  const high = new Date(q._nextRetryAt(20)).getTime() - Date.now();
  assert(high <= 6000, 'delay should be capped (allowing margin for execution time)');
});

// ── polling lifecycle ─────────────────────────────────────────────────────
await test('T22: startPolling sets _pollTimer', () => {
  const q = new WebhookRetryQueue({ pollIntervalMs: 999999 });
  assert(!q._pollTimer, 'should not have timer before start');
  q.startPolling();
  assert(q._pollTimer, 'should have timer after start');
  q.stopPolling();
});

await test('T23: stopPolling clears _pollTimer', () => {
  const q = new WebhookRetryQueue({ pollIntervalMs: 999999 });
  q.startPolling();
  q.stopPolling();
  assert(!q._pollTimer, 'timer should be null after stop');
});

await test('T24: defaultRetryQueue is a WebhookRetryQueue instance', () => {
  assert(defaultRetryQueue instanceof WebhookRetryQueue, 'should be instance of WebhookRetryQueue');
});

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n── V160 RetryQueue: ${passed} passed, ${failed} failed ──────────────────`);
if (errors.length) {
  console.error('\nFailed tests:');
  for (const e of errors) console.error(`  ✗ ${e.name}: ${e.message}`);
}
process.exit(failed > 0 ? 1 : 0);

})();
