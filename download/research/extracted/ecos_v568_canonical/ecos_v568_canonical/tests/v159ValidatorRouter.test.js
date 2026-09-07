/**
 * tests/v159ValidatorRouter.test.js
 * ===================================
 * V159 ValidatorTaskRouter — unit tests (standalone)
 * Run: node tests/v159ValidatorRouter.test.js
 *
 * 22 tests covering:
 *  - registerValidator (valid, missing id)
 *  - updateValidator (partial patch)
 *  - removeValidator
 *  - findBest (no validators, no available, best by score)
 *  - autoAssign (success, dryRun, no pool)
 *  - releaseLoad
 *  - listValidators (all + availableOnly + minConfidence filter)
 *  - routingHistory
 *  - stats
 *  - configure (adjust routing params)
 *  - getConfig
 *
 * [V159-TASK-TESTS]
 */

'use strict';

const assert = require('assert');
const path   = require('path');

const {
  ValidatorTaskRouter,
  defaultValidatorRouter,
} = require(path.resolve(__dirname, '../lib/validatorTaskRouter'));

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

console.log('\n── V159 ValidatorTaskRouter Tests ─────────────────────────────');

(async () => {

// ── T01: registerValidator creates a profile ──────────────────────────────────
await test('T01: registerValidator creates profile with defaults', () => {
  const r  = new ValidatorTaskRouter();
  const p  = r.registerValidator({ validatorId: 'v_001', confidenceScore: 0.8 });
  assert.strictEqual(p.validatorId, 'v_001');
  assert.strictEqual(p.confidenceScore, 0.8);
  assert(Array.isArray(p.specialties), 'specialties should be an array');
  assert.strictEqual(p.available, true, 'should be available by default');
});

// ── T02: registerValidator throws without validatorId ────────────────────────
await test('T02: registerValidator throws when validatorId missing', () => {
  const r = new ValidatorTaskRouter();
  let threw = false;
  try { r.registerValidator({ confidenceScore: 0.5 }); } catch (_) { threw = true; }
  assert(threw, 'should throw when validatorId missing');
});

// ── T03: updateValidator patches fields ──────────────────────────────────────
await test('T03: updateValidator partially patches validator', () => {
  const r = new ValidatorTaskRouter();
  r.registerValidator({ validatorId: 'v_002', confidenceScore: 0.5 });
  const upd = r.updateValidator('v_002', { confidenceScore: 0.9, available: false });
  assert.strictEqual(upd.confidenceScore, 0.9, 'score should update');
  assert.strictEqual(upd.available, false, 'available should update');
});

// ── T04: updateValidator returns null for unknown id ─────────────────────────
await test('T04: updateValidator returns null for unknown validatorId', () => {
  const r = new ValidatorTaskRouter();
  const res = r.updateValidator('unknown', { confidenceScore: 0.9 });
  assert.strictEqual(res, null, 'should return null for unknown validator');
});

// ── T05: removeValidator returns true ────────────────────────────────────────
await test('T05: removeValidator removes validator and returns true', () => {
  const r = new ValidatorTaskRouter();
  r.registerValidator({ validatorId: 'v_003' });
  assert.strictEqual(r.removeValidator('v_003'), true, 'should return true');
  assert.strictEqual(r.listValidators().length, 0, 'pool should be empty');
});

// ── T06: findBest returns null when no validators ────────────────────────────
await test('T06: findBest returns null when validator pool is empty', () => {
  const r = new ValidatorTaskRouter();
  assert.strictEqual(r.findBest([], 'medium'), null, 'should return null for empty pool');
});

// ── T07: findBest returns null when all validators unavailable ────────────────
await test('T07: findBest returns null when all validators are unavailable', () => {
  const r = new ValidatorTaskRouter();
  r.registerValidator({ validatorId: 'v_off', confidenceScore: 0.9, available: false });
  assert.strictEqual(r.findBest([], 'medium'), null, 'should return null when all unavailable');
});

// ── T08: findBest returns the best scoring validator ─────────────────────────
await test('T08: findBest returns validator with highest score', () => {
  const r = new ValidatorTaskRouter();
  r.registerValidator({ validatorId: 'v_low',  confidenceScore: 0.4 });
  r.registerValidator({ validatorId: 'v_high', confidenceScore: 0.9 });
  const result = r.findBest([], 'medium');
  assert(result !== null, 'should find a validator');
  assert.strictEqual(result.validator.validatorId, 'v_high', 'highest confidence should win');
});

// ── T09: findBest prefers specialty match ────────────────────────────────────
await test('T09: findBest prefers validator with matching specialty', () => {
  const r = new ValidatorTaskRouter({ specialtyBonus: 0.5 });
  r.registerValidator({ validatorId: 'v_generic',   confidenceScore: 0.7, specialties: [] });
  r.registerValidator({ validatorId: 'v_specialist', confidenceScore: 0.65, specialties: ['nlp','audit'] });
  const result = r.findBest(['nlp'], 'medium');
  assert.strictEqual(result.validator.validatorId, 'v_specialist', 'specialist should win with matching tag');
});

// ── T10: autoAssign assigns to best validator ────────────────────────────────
await test('T10: autoAssign assigns task to best validator', () => {
  const r = new ValidatorTaskRouter();
  r.registerValidator({ validatorId: 'v_10', confidenceScore: 0.85 });
  const task   = { id: 'wt_10', workspaceId: 'ws_10', tags: [], priority: 'medium' };
  const result = r.autoAssign(task);
  assert.strictEqual(result.ok, true, 'should succeed');
  assert.strictEqual(result.assigned, true, 'should be assigned');
  assert.strictEqual(result.validator.validatorId, 'v_10', 'assigned to v_10');
});

// ── T11: autoAssign dry run does not increment load ──────────────────────────
await test('T11: autoAssign dryRun does not modify validator load', () => {
  const r = new ValidatorTaskRouter();
  r.registerValidator({ validatorId: 'v_11', confidenceScore: 0.8 });
  const task   = { id: 'wt_11', workspaceId: 'ws_11', tags: [], priority: 'medium' };
  r.autoAssign(task, { dryRun: true });
  const v = r._validators.get('v_11');
  assert.strictEqual(v.currentLoad, 0, 'dryRun should not increment load');
});

// ── T12: autoAssign returns not ok when no validators ────────────────────────
await test('T12: autoAssign returns ok=false when pool is empty', () => {
  const r      = new ValidatorTaskRouter();
  const result = r.autoAssign({ id: 'wt_x', tags: [], priority: 'medium' });
  assert.strictEqual(result.ok,       false, 'should not succeed');
  assert.strictEqual(result.assigned, false, 'should not assign');
  assert(result.reason, 'should have reason');
});

// ── T13: autoAssign increments validator load ────────────────────────────────
await test('T13: autoAssign increments currentLoad after real assignment', () => {
  const r = new ValidatorTaskRouter();
  r.registerValidator({ validatorId: 'v_13', confidenceScore: 0.75 });
  const task = { id: 'wt_13', workspaceId: 'ws_13', tags: [], priority: 'low' };
  r.autoAssign(task);
  const v = r._validators.get('v_13');
  assert.strictEqual(v.currentLoad, 1, 'load should be 1 after assignment');
});

// ── T14: releaseLoad decrements currentLoad ──────────────────────────────────
await test('T14: releaseLoad decrements validator currentLoad', () => {
  const r = new ValidatorTaskRouter();
  r.registerValidator({ validatorId: 'v_14', confidenceScore: 0.8, currentLoad: 3 });
  r.releaseLoad('v_14', 2);
  const v = r._validators.get('v_14');
  assert.strictEqual(v.currentLoad, 1, 'load should be 1 after release of 2');
});

// ── T15: releaseLoad does not go below 0 ────────────────────────────────────
await test('T15: releaseLoad clamps to 0', () => {
  const r = new ValidatorTaskRouter();
  r.registerValidator({ validatorId: 'v_15', confidenceScore: 0.8, currentLoad: 1 });
  r.releaseLoad('v_15', 10);
  const v = r._validators.get('v_15');
  assert.strictEqual(v.currentLoad, 0, 'load should clamp at 0');
});

// ── T16: listValidators returns all ──────────────────────────────────────────
await test('T16: listValidators returns all registered validators', () => {
  const r = new ValidatorTaskRouter();
  r.registerValidator({ validatorId: 'v_16a', confidenceScore: 0.6 });
  r.registerValidator({ validatorId: 'v_16b', confidenceScore: 0.8 });
  const all = r.listValidators();
  assert.strictEqual(all.length, 2, 'should return 2 validators');
});

// ── T17: listValidators availableOnly filter ─────────────────────────────────
await test('T17: listValidators availableOnly excludes unavailable', () => {
  const r = new ValidatorTaskRouter();
  r.registerValidator({ validatorId: 'v_17a', confidenceScore: 0.7, available: true  });
  r.registerValidator({ validatorId: 'v_17b', confidenceScore: 0.9, available: false });
  const available = r.listValidators({ availableOnly: true });
  assert.strictEqual(available.length, 1, 'only 1 available');
  assert.strictEqual(available[0].validatorId, 'v_17a', 'should be v_17a');
});

// ── T18: routingHistory records decisions ────────────────────────────────────
await test('T18: routingHistory records assignments', () => {
  const r = new ValidatorTaskRouter();
  r.registerValidator({ validatorId: 'v_18', confidenceScore: 0.8 });
  r.autoAssign({ id: 'wt_18', workspaceId: 'ws_18', tags: [], priority: 'high' });
  const history = r.routingHistory(10);
  assert(history.length > 0, 'history should have entries');
  assert.strictEqual(history[0].taskId, 'wt_18', 'task should be recorded');
});

// ── T19: stats reports totalValidators ───────────────────────────────────────
await test('T19: stats returns totalValidators and available count', () => {
  const r = new ValidatorTaskRouter();
  r.registerValidator({ validatorId: 'v_19a', confidenceScore: 0.7 });
  r.registerValidator({ validatorId: 'v_19b', confidenceScore: 0.9 });
  const s = r.stats();
  assert.strictEqual(s.totalValidators,     2, 'should report 2 total');
  assert.strictEqual(s.availableValidators, 2, 'both should be available');
});

// ── T20: configure updates routing params ────────────────────────────────────
await test('T20: configure updates minConfidence and specialtyBonus', () => {
  const r = new ValidatorTaskRouter({ minConfidence: 0.5, specialtyBonus: 0.2 });
  r.configure({ minConfidence: 0.7, specialtyBonus: 0.4 });
  assert.strictEqual(r.minConfidence,  0.7, 'minConfidence should update');
  assert.strictEqual(r.specialtyBonus, 0.4, 'specialtyBonus should update');
});

// ── T21: getConfig returns current settings ──────────────────────────────────
await test('T21: getConfig returns current router configuration', () => {
  const r = new ValidatorTaskRouter({ minConfidence: 0.6, loadPenalty: 0.25 });
  const c = r.getConfig();
  assert.strictEqual(c.minConfidence, 0.6,  'minConfidence should match');
  assert.strictEqual(c.loadPenalty,   0.25, 'loadPenalty should match');
  assert.strictEqual(c.version, 'V159', 'version should be V159');
});

// ── T22: defaultValidatorRouter is singleton ─────────────────────────────────
await test('T22: defaultValidatorRouter is a ValidatorTaskRouter instance', () => {
  assert(defaultValidatorRouter instanceof ValidatorTaskRouter, 'should be ValidatorTaskRouter');
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
