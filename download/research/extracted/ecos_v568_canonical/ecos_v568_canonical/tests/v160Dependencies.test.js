/**
 * tests/v160Dependencies.test.js
 * ================================
 * V160 TaskDependencyService — unit tests (standalone)
 * Run: node tests/v160Dependencies.test.js
 *
 * 24 tests covering:
 *  - addDependency (valid, self-reference, duplicate detection)
 *  - cycle detection (direct + transitive)
 *  - removeDependency
 *  - getDependencies (dependsOn + requiredBy)
 *  - getDependencyTree (nested + depth limit)
 *  - topologicalSort (correct order + cycle detection)
 *  - isTaskBlocked (blocked + unblocked cases)
 *  - listAll
 *  - stats
 *  - CyclicDependencyError
 *
 * [V160-TEST-02]
 */

'use strict';

const assert = require('assert');
const path   = require('path');

const {
  TaskDependencyService,
  CyclicDependencyError,
  defaultDependencyService,
} = require(path.resolve(__dirname, '../lib/taskDependencyService'));

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

console.log('\n── V160 TaskDependencyService Tests ───────────────────────────');

(async () => {

const WS = 'ws_dep_test';

// ── addDependency ─────────────────────────────────────────────────────────
await test('T01: addDependency creates a valid dependency', async () => {
  const svc = new TaskDependencyService();
  const { dependency, alreadyExists } = await svc.addDependency(WS, 'task_B', 'task_A');
  assert(dependency.id,               'should have id');
  assert.strictEqual(dependency.taskId,      'task_B', 'taskId should be task_B');
  assert.strictEqual(dependency.dependsOnId, 'task_A', 'dependsOnId should be task_A');
  assert.strictEqual(alreadyExists, false, 'alreadyExists should be false');
});

await test('T02: addDependency throws when taskId is missing', async () => {
  const svc = new TaskDependencyService();
  let threw = false;
  try { await svc.addDependency(WS, null, 'task_A'); } catch (_) { threw = true; }
  assert(threw, 'should throw when taskId missing');
});

await test('T03: addDependency throws when dependsOnId is missing', async () => {
  const svc = new TaskDependencyService();
  let threw = false;
  try { await svc.addDependency(WS, 'task_B', null); } catch (_) { threw = true; }
  assert(threw, 'should throw when dependsOnId missing');
});

await test('T04: addDependency throws CyclicDependencyError for self-reference', async () => {
  const svc = new TaskDependencyService();
  let threw = false;
  try { await svc.addDependency(WS, 'task_A', 'task_A'); }
  catch (err) { threw = err instanceof CyclicDependencyError || err.code === 'CYCLIC_DEPENDENCY'; }
  assert(threw, 'should throw CyclicDependencyError for self-reference');
});

await test('T05: addDependency detects direct cycle (A→B, B→A)', async () => {
  const svc = new TaskDependencyService();
  await svc.addDependency(WS, 'task_A', 'task_B'); // A depends on B
  let threw = false;
  try { await svc.addDependency(WS, 'task_B', 'task_A'); } // B depends on A (cycle)
  catch (err) { threw = err.code === 'CYCLIC_DEPENDENCY'; }
  assert(threw, 'should throw for direct cycle');
});

await test('T06: addDependency detects transitive cycle (A→B, B→C, C→A)', async () => {
  const svc = new TaskDependencyService();
  await svc.addDependency(WS+'_tc', 'task_A', 'task_B');
  await svc.addDependency(WS+'_tc', 'task_B', 'task_C');
  let threw = false;
  try { await svc.addDependency(WS+'_tc', 'task_C', 'task_A'); }
  catch (err) { threw = err.code === 'CYCLIC_DEPENDENCY'; }
  assert(threw, 'should throw for transitive cycle');
});

await test('T07: addDependency returns alreadyExists=true for duplicate', async () => {
  const svc = new TaskDependencyService();
  await svc.addDependency(WS, 'task_B', 'task_A');
  const { alreadyExists } = await svc.addDependency(WS, 'task_B', 'task_A');
  assert.strictEqual(alreadyExists, true, 'alreadyExists should be true for duplicate');
});

// ── removeDependency ──────────────────────────────────────────────────────
await test('T08: removeDependency removes an existing dependency', async () => {
  const svc = new TaskDependencyService();
  await svc.addDependency(WS, 'task_B', 'task_A');
  const removed = await svc.removeDependency(WS, 'task_B', 'task_A');
  assert(removed, 'should return removed dependency');
  const deps = await svc.getDependencies(WS, 'task_B');
  assert.strictEqual(deps.dependsOn.length, 0, 'should have 0 dependencies after removal');
});

await test('T09: removeDependency returns null when dependency not found', async () => {
  const svc = new TaskDependencyService();
  const result = await svc.removeDependency(WS, 'nonexistent_B', 'nonexistent_A');
  assert.strictEqual(result, null, 'should return null for non-existent dependency');
});

// ── getDependencies ───────────────────────────────────────────────────────
await test('T10: getDependencies returns dependsOn and requiredBy', async () => {
  const svc = new TaskDependencyService();
  await svc.addDependency(WS, 'task_B', 'task_A');
  await svc.addDependency(WS, 'task_C', 'task_A');
  const depB = await svc.getDependencies(WS, 'task_B');
  assert.strictEqual(depB.dependsOn.length,  1, 'task_B should depend on 1 task');
  assert.strictEqual(depB.requiredBy.length, 0, 'task_B is not required by anything');
  const depA = await svc.getDependencies(WS, 'task_A');
  assert.strictEqual(depA.dependsOn.length,  0, 'task_A has no dependencies');
  assert.strictEqual(depA.requiredBy.length, 2, 'task_A is required by B and C');
});

// ── getDependencyTree ─────────────────────────────────────────────────────
await test('T11: getDependencyTree returns nested structure', async () => {
  const svc = new TaskDependencyService();
  await svc.addDependency(WS+'_tree', 'task_C', 'task_B');
  await svc.addDependency(WS+'_tree', 'task_B', 'task_A');
  const tree = await svc.getDependencyTree(WS+'_tree', 'task_C');
  assert.strictEqual(tree.taskId, 'task_C', 'root should be task_C');
  assert.strictEqual(tree.dependsOn.length, 1, 'task_C should have 1 direct dependency');
  assert.strictEqual(tree.dependsOn[0].taskId, 'task_B', 'first dep should be task_B');
});

await test('T12: getDependencyTree respects maxDepth', async () => {
  const svc = new TaskDependencyService();
  await svc.addDependency(WS+'_depth', 'task_C', 'task_B');
  await svc.addDependency(WS+'_depth', 'task_B', 'task_A');
  const tree = await svc.getDependencyTree(WS+'_depth', 'task_C', 1);
  assert(tree.dependsOn[0].dependsOn.length === 0, 'should stop at depth 1');
});

// ── topologicalSort ───────────────────────────────────────────────────────
await test('T13: topologicalSort returns task_A before task_B', async () => {
  const svc = new TaskDependencyService();
  await svc.addDependency(WS+'_topo', 'task_B', 'task_A');
  const order = await svc.topologicalSort(WS+'_topo');
  const idxA = order.indexOf('task_A');
  const idxB = order.indexOf('task_B');
  assert(idxA >= 0 && idxB >= 0, 'both tasks should be in order');
  assert(idxA < idxB, 'task_A should come before task_B');
});

await test('T14: topologicalSort returns empty array when no dependencies', async () => {
  const svc = new TaskDependencyService();
  const order = await svc.topologicalSort(WS+'_empty_topo_' + Date.now());
  assert(Array.isArray(order), 'should return array');
  assert.strictEqual(order.length, 0, 'empty workspace should have no order');
});

// ── isTaskBlocked ─────────────────────────────────────────────────────────
await test('T15: isTaskBlocked returns blocked=true when blocker is open', async () => {
  const svc = new TaskDependencyService();
  await svc.addDependency(WS+'_block', 'task_B', 'task_A');
  const resolver = async (id) => id === 'task_A' ? 'pending' : 'done';
  const result   = await svc.isTaskBlocked(WS+'_block', 'task_B', resolver);
  assert.strictEqual(result.blocked,          true,    'should be blocked');
  assert.strictEqual(result.blockers.length,  1,       'should have 1 blocker');
  assert.strictEqual(result.blockers[0].taskId, 'task_A', 'blocker should be task_A');
});

await test('T16: isTaskBlocked returns blocked=false when blocker is done', async () => {
  const svc = new TaskDependencyService();
  await svc.addDependency(WS+'_unblock', 'task_B', 'task_A');
  const resolver = async () => 'done';
  const result   = await svc.isTaskBlocked(WS+'_unblock', 'task_B', resolver);
  assert.strictEqual(result.blocked, false, 'should not be blocked when dependency is done');
});

await test('T17: isTaskBlocked returns blocked=false when no dependencies', async () => {
  const svc    = new TaskDependencyService();
  const result = await svc.isTaskBlocked(WS, 'task_no_deps', () => 'pending');
  assert.strictEqual(result.blocked,          false, 'no deps = not blocked');
  assert.strictEqual(result.blockers.length,  0,     'no blockers');
});

// ── listAll ────────────────────────────────────────────────────────────────
await test('T18: listAll returns all dependencies for workspace', async () => {
  const svc = new TaskDependencyService();
  await svc.addDependency(WS+'_list', 'task_B', 'task_A');
  await svc.addDependency(WS+'_list', 'task_C', 'task_A');
  const all = await svc.listAll(WS+'_list');
  assert.strictEqual(all.length, 2, 'should return 2 dependencies');
});

await test('T19: listAll returns only deps for the given workspace', async () => {
  const svc = new TaskDependencyService();
  await svc.addDependency('ws_X', 'task_B', 'task_A');
  await svc.addDependency('ws_Y', 'task_D', 'task_C');
  const x = await svc.listAll('ws_X');
  assert.strictEqual(x.length, 1, 'ws_X should have 1 dependency');
  const y = await svc.listAll('ws_Y');
  assert.strictEqual(y.length, 1, 'ws_Y should have 1 dependency');
});

// ── stats ─────────────────────────────────────────────────────────────────
await test('T20: stats returns correct structure', async () => {
  const svc = new TaskDependencyService();
  const s   = svc.stats();
  assert(typeof s.totalDependencies === 'number', 'totalDependencies should be number');
  assert(typeof s.byType            === 'object', 'byType should be object');
  assert(typeof s.version           === 'string', 'version should be string');
});

await test('T21: stats.totalDependencies matches after adds', async () => {
  const svc = new TaskDependencyService();
  await svc.addDependency(WS+'_stats', 'task_B', 'task_A');
  await svc.addDependency(WS+'_stats', 'task_C', 'task_B');
  const s = svc.stats(WS+'_stats');
  assert.strictEqual(s.totalDependencies, 2, 'should count 2 dependencies');
});

await test('T22: stats.byType counts dependency types', async () => {
  const svc = new TaskDependencyService();
  await svc.addDependency(WS+'_type', 'task_B', 'task_A', { type:'finish-to-start' });
  await svc.addDependency(WS+'_type', 'task_C', 'task_B', { type:'start-to-start' });
  const s = svc.stats(WS+'_type');
  assert(s.byType['finish-to-start'] >= 1, 'should count finish-to-start');
  assert(s.byType['start-to-start']  >= 1, 'should count start-to-start');
});

// ── CyclicDependencyError ─────────────────────────────────────────────────
await test('T23: CyclicDependencyError has correct code', () => {
  const err = new CyclicDependencyError('test cycle');
  assert.strictEqual(err.code, 'CYCLIC_DEPENDENCY', 'code should be CYCLIC_DEPENDENCY');
  assert.strictEqual(err.name, 'CyclicDependencyError', 'name should be CyclicDependencyError');
});

await test('T24: defaultDependencyService is a TaskDependencyService instance', () => {
  assert(defaultDependencyService instanceof TaskDependencyService, 'should be instance');
});

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n── V160 Dependencies: ${passed} passed, ${failed} failed ──────────────────`);
if (errors.length) {
  console.error('\nFailed tests:');
  for (const e of errors) console.error(`  ✗ ${e.name}: ${e.message}`);
}
process.exit(failed > 0 ? 1 : 0);

})();
