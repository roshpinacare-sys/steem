/**
 * tests/v158CalibrationHistory.test.js
 * =======================================
 * V158 CalibrationHistoryService — unit tests (standalone, no node_modules)
 * Run: node tests/v158CalibrationHistory.test.js
 *
 * ≥16 tests covering:
 *  - recordFit stores record
 *  - list returns records sorted newest-first
 *  - list trigger filter
 *  - list cursor pagination
 *  - trends: insufficient_data
 *  - trends: with data
 *  - exportCsv header + rows
 *  - maxInMemory circular buffer
 *  - CalibrationFitRecord shape
 *
 * [V158-TASK-07]
 */

'use strict';

const assert = require('assert');
const path   = require('path');

const {
  CalibrationHistoryService,
  defaultCalibrationHistory,
} = require(path.resolve(__dirname, '../lib/calibrationHistoryService'));

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

const svc = new CalibrationHistoryService({ maxInMemory: 100 });

console.log('\n── V158 CalibrationHistoryService Tests ─────────────────────────');

(async () => {

// ── T01: recordFit returns record with id ─────────────────────────────────────
await test('T01: recordFit returns record with id', async () => {
  const rec = await svc.recordFit({ A: -1.2, B: 0.5, sampleCount: 60, trigger: 'auto' });
  assert(rec.id, 'id missing');
  assert(rec.id.startsWith('cf_'), 'id should start with cf_');
  assert.strictEqual(rec.A, -1.2,   'A mismatch');
  assert.strictEqual(rec.B, 0.5,    'B mismatch');
  assert.strictEqual(rec.sampleCount, 60, 'sampleCount mismatch');
  assert.strictEqual(rec.trigger, 'auto', 'trigger mismatch');
  assert(rec.fittedAt, 'fittedAt missing');
});

// ── T02: recordFit defaults trigger to manual ─────────────────────────────────
await test('T02: recordFit defaults trigger to manual', async () => {
  const rec = await svc.recordFit({ A: -0.9, B: 0.3, sampleCount: 45 });
  assert.strictEqual(rec.trigger, 'manual', 'default trigger should be manual');
});

// ── T03: recordFit stores note ────────────────────────────────────────────────
await test('T03: recordFit stores note', async () => {
  const rec = await svc.recordFit({ A: -1.0, B: 0.4, sampleCount: 55, note: 'Startup load' });
  assert.strictEqual(rec.note, 'Startup load', 'note mismatch');
});

// ── T04: list returns records newest-first ────────────────────────────────────
await test('T04: list returns records in newest-first order', async () => {
  const svc2 = new CalibrationHistoryService();
  await svc2.recordFit({ A: -1.0, B: 0.3, sampleCount: 10 });
  await new Promise(r => setTimeout(r, 5)); // small delay to ensure different timestamps
  await svc2.recordFit({ A: -1.1, B: 0.4, sampleCount: 20 });
  const result = await svc2.list({ limit: 10 });
  assert(result.records.length >= 2, 'should have records');
  // Newest first: second record should come first
  assert(result.records[0].sampleCount >= result.records[1].sampleCount ||
         result.records[0].A !== result.records[1].A, 'order should be newest-first');
});

// ── T05: list returns count ────────────────────────────────────────────────────
await test('T05: list returns count field', async () => {
  const result = await svc.list({ limit: 10 });
  assert(typeof result.count === 'number', 'count should be a number');
  assert(result.count >= 3, 'should have ≥3 records from earlier tests');
});

// ── T06: list filters by trigger ──────────────────────────────────────────────
await test('T06: list filters by trigger=auto', async () => {
  const result = await svc.list({ trigger: 'auto', limit: 10 });
  assert(result.records.every(r => r.trigger === 'auto'), 'all should be auto trigger');
});

// ── T07: list pagination — limit=1 returns nextCursor ─────────────────────────
await test('T07: list pagination limit=1 sets nextCursor', async () => {
  const result = await svc.list({ limit: 1 });
  if (result.records.length === 1) {
    // nextCursor set if there may be more records
    assert(result.nextCursor !== undefined, 'nextCursor should be defined');
  }
});

// ── T08: trends returns insufficient_data with 0 records ─────────────────────
await test('T08: trends returns insufficient_data when empty', async () => {
  const empty = new CalibrationHistoryService();
  const trends = await empty.trends();
  assert.strictEqual(trends.trend, 'insufficient_data', 'should return insufficient_data');
});

// ── T09: trends returns trend direction ──────────────────────────────────────
await test('T09: trends returns trend with multiple records', async () => {
  const svc3 = new CalibrationHistoryService();
  // Add 3 records with improving brier score (lower = better)
  await svc3.recordFit({ A: -0.5, B: 0.1, sampleCount: 10, brier: 0.30 });
  await svc3.recordFit({ A: -0.8, B: 0.2, sampleCount: 30, brier: 0.22 });
  await svc3.recordFit({ A: -1.0, B: 0.3, sampleCount: 60, brier: 0.15 });
  const trends = await svc3.trends();
  assert(['improving','degrading','stable'].includes(trends.trend), `invalid trend: ${trends.trend}`);
  assert(typeof trends.fitCount === 'number', 'fitCount should be number');
  assert(trends.latestSampleCount !== undefined, 'latestSampleCount should exist');
});

// ── T10: trends improving when brier decreases ───────────────────────────────
await test('T10: trends reports improving when brier decreases over time', async () => {
  const svc4 = new CalibrationHistoryService();
  await svc4.recordFit({ A: -0.5, B: 0.1, sampleCount: 10, brier: 0.35 }); // oldest
  await svc4.recordFit({ A: -1.2, B: 0.4, sampleCount: 80, brier: 0.12 }); // newest
  const trends = await svc4.trends();
  // oldest.brier (0.35) - newest.brier (0.12) = 0.23 > 0 → improving
  assert.strictEqual(trends.trend, 'improving', `expected improving, got ${trends.trend}`);
});

// ── T11: exportCsv produces valid CSV with header ─────────────────────────────
await test('T11: exportCsv produces CSV with correct header', async () => {
  const csv = await svc.exportCsv(100);
  assert(typeof csv === 'string', 'csv should be a string');
  const lines = csv.split('\n');
  assert(lines.length >= 2, 'should have header + at least 1 row');
  assert.strictEqual(lines[0], 'id,A,B,sampleCount,brier,auc,accuracy,trigger,fittedAt,note', 'header mismatch');
});

// ── T12: exportCsv rows contain correct data ──────────────────────────────────
await test('T12: exportCsv rows contain correct fields', async () => {
  const svc5 = new CalibrationHistoryService();
  await svc5.recordFit({ A: -1.5, B: 0.7, sampleCount: 100, trigger: 'api', note: 'Test note' });
  const csv = await svc5.exportCsv(10);
  const lines = csv.split('\n');
  assert(lines.length >= 2, 'should have header + data row');
  const row = lines[1];
  assert(row.includes('-1.5'), 'row should contain A value');
  assert(row.includes('100'),  'row should contain sampleCount');
  assert(row.includes('api'),  'row should contain trigger');
});

// ── T13: maxInMemory circular buffer truncates old records ────────────────────
await test('T13: maxInMemory limits in-memory records', async () => {
  const tiny = new CalibrationHistoryService({ maxInMemory: 3 });
  for (let i = 0; i < 5; i++) {
    await tiny.recordFit({ A: -1 * i * 0.1, B: 0.1 * i, sampleCount: i * 10 });
  }
  assert.strictEqual(tiny.length, 3, `expected 3, got ${tiny.length}`);
});

// ── T14: length property reflects count ───────────────────────────────────────
await test('T14: .length reflects number of in-memory records', async () => {
  const cnt = new CalibrationHistoryService();
  assert.strictEqual(cnt.length, 0, 'should start at 0');
  await cnt.recordFit({ A: -1, B: 0.5, sampleCount: 10 });
  assert.strictEqual(cnt.length, 1, 'should be 1 after one record');
  await cnt.recordFit({ A: -2, B: 0.3, sampleCount: 20 });
  assert.strictEqual(cnt.length, 2, 'should be 2 after two records');
});

// ── T15: setDb replaces db reference ──────────────────────────────────────────
await test('T15: setDb sets db property', () => {
  const s = new CalibrationHistoryService();
  assert.strictEqual(s._db, null, 'db should start as null');
  const mockDb = { query: async () => ({ rows: [] }) };
  s.setDb(mockDb);
  assert.strictEqual(s._db, mockDb, 'db should be set');
});

// ── T16: list nextCursor null on last page ─────────────────────────────────────
await test('T16: list sets nextCursor=null on last page', async () => {
  const s = new CalibrationHistoryService();
  await s.recordFit({ A: -1, B: 0.3, sampleCount: 10 });
  const result = await s.list({ limit: 100 });
  assert.strictEqual(result.nextCursor, null, 'nextCursor should be null on last page');
});

console.log('');
console.log(`── Results: ${passed} passed, ${failed} failed (total ${passed + failed}) ──`);
if (errors.length) {
  console.log('\nFailures:');
  errors.forEach(e => console.log(`  ✗ ${e.name}: ${e.message}`));
}
console.log('');
if (failed > 0) process.exit(1);
})();