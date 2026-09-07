/**
 * tests/v158WorkspaceTasks.test.js
 * ==================================
 * V158 Workspace Task Service — unit tests (standalone, no node_modules needed)
 * Run: node tests/v158WorkspaceTasks.test.js
 *
 * ≥24 tests covering:
 *  - WorkspaceTaskService CRUD
 *  - Validation (missing title, invalid status/priority)
 *  - bulkCreate limits
 *  - assignTask
 *  - stats
 *  - overdue tasks
 *  - search
 *  - comments
 *  - getComments
 *  - by-status grouping
 *  - updateTask field validation
 *  - deleteTask
 *  - VALID_STATUSES / VALID_PRIORITIES constants
 *
 * [V158-TASK-06] tests
 */

'use strict';

const assert = require('assert');
const path   = require('path');

// Resolve lib relative to this test file
const {
  WorkspaceTaskService,
  defaultWorkspaceTaskService,
  VALID_STATUSES,
  VALID_PRIORITIES,
} = require(path.resolve(__dirname, '../lib/workspaceTaskService'));

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

// ── Setup ────────────────────────────────────────────────────────────────────
const svc = new WorkspaceTaskService();
const WS  = 'ws_test_001';
const WS2 = 'ws_test_002';

console.log('\n── V158 WorkspaceTaskService Tests ──────────────────────────────');

(async () => {

// ── T01: VALID_STATUSES exported ─────────────────────────────────────────────
await test('T01: VALID_STATUSES contains expected statuses', () => {
  assert(VALID_STATUSES.includes('pending'),     'pending missing');
  assert(VALID_STATUSES.includes('in_progress'), 'in_progress missing');
  assert(VALID_STATUSES.includes('done'),        'done missing');
  assert(VALID_STATUSES.includes('cancelled'),   'cancelled missing');
});

// ── T02: VALID_PRIORITIES exported ───────────────────────────────────────────
await test('T02: VALID_PRIORITIES contains expected priorities', () => {
  assert(VALID_PRIORITIES.includes('critical'), 'critical missing');
  assert(VALID_PRIORITIES.includes('high'),     'high missing');
  assert(VALID_PRIORITIES.includes('medium'),   'medium missing');
  assert(VALID_PRIORITIES.includes('low'),      'low missing');
});

// ── T03: createTask returns task with id ─────────────────────────────────────
await test('T03: createTask returns task with id and workspaceId', async () => {
  const task = await svc.createTask(WS, { title: 'First Task', priority: 'high' });
  assert(task.id,           'id missing');
  assert(task.id.startsWith('wt_'), 'id should start with wt_');
  assert.strictEqual(task.workspaceId, WS,      'workspaceId mismatch');
  assert.strictEqual(task.title, 'First Task',  'title mismatch');
  assert.strictEqual(task.status, 'pending',    'default status should be pending');
  assert.strictEqual(task.priority, 'high',     'priority mismatch');
  assert(task.createdAt, 'createdAt missing');
});

// ── T04: createTask — missing title throws ───────────────────────────────────
await test('T04: createTask throws on empty title', async () => {
  try {
    await svc.createTask(WS, { title: '' });
    assert.fail('should have thrown');
  } catch (err) {
    assert(err.message.includes('title'), `expected title error, got: ${err.message}`);
  }
});

// ── T05: createTask — missing workspaceId throws ─────────────────────────────
await test('T05: createTask throws on missing workspaceId', async () => {
  try {
    await svc.createTask('', { title: 'Test' });
    assert.fail('should have thrown');
  } catch (err) {
    assert(err.message, 'should throw');
  }
});

// ── T06: createTask — invalid status defaults to 'pending' ───────────────────
await test('T06: createTask defaults invalid status to pending', async () => {
  const task = await svc.createTask(WS, { title: 'Status Test', status: 'unknown_status' });
  assert.strictEqual(task.status, 'pending', 'invalid status should default to pending');
});

// ── T07: createTask — invalid priority defaults to 'medium' ──────────────────
await test('T07: createTask defaults invalid priority to medium', async () => {
  const task = await svc.createTask(WS, { title: 'Priority Test', priority: 'extreme' });
  assert.strictEqual(task.priority, 'medium', 'invalid priority should default to medium');
});

// ── T08: listTasks returns created tasks ─────────────────────────────────────
await test('T08: listTasks returns tasks for workspace', async () => {
  await svc.createTask(WS2, { title: 'WS2 Task A' });
  await svc.createTask(WS2, { title: 'WS2 Task B' });
  const result = await svc.listTasks(WS2);
  assert(result.tasks.length >= 2,  'should have at least 2 tasks');
  assert(typeof result.count === 'number', 'count should be number');
});

// ── T09: listTasks filters by status ─────────────────────────────────────────
await test('T09: listTasks filters by status', async () => {
  await svc.createTask(WS, { title: 'Done Task', status: 'done' });
  const result = await svc.listTasks(WS, { status: 'done' });
  assert(result.tasks.length >= 1, 'should find done tasks');
  assert(result.tasks.every(t => t.status === 'done'), 'all should be done');
});

// ── T10: getTask returns correct task ────────────────────────────────────────
await test('T10: getTask returns task by id', async () => {
  const created = await svc.createTask(WS, { title: 'Gettable Task' });
  const found   = await svc.getTask(WS, created.id);
  assert(found,                          'task should be found');
  assert.strictEqual(found.id, created.id, 'id should match');
  assert.strictEqual(found.title, 'Gettable Task', 'title should match');
});

// ── T11: getTask returns null for unknown id ─────────────────────────────────
await test('T11: getTask returns null for unknown id', async () => {
  const found = await svc.getTask(WS, 'wt_nonexistent_xxx');
  assert.strictEqual(found, null, 'should return null');
});

// ── T12: updateTask changes title ────────────────────────────────────────────
await test('T12: updateTask changes title', async () => {
  const t = await svc.createTask(WS, { title: 'Original Title' });
  const updated = await svc.updateTask(WS, t.id, { title: 'Updated Title' });
  assert(updated, 'updated task should be returned');
  assert.strictEqual(updated.title, 'Updated Title', 'title should be updated');
});

// ── T13: updateTask changes status ───────────────────────────────────────────
await test('T13: updateTask changes status to in_progress', async () => {
  const t = await svc.createTask(WS, { title: 'Status Change Task' });
  const updated = await svc.updateTask(WS, t.id, { status: 'in_progress' });
  assert.strictEqual(updated.status, 'in_progress', 'status should be in_progress');
});

// ── T14: updateTask throws on invalid status ─────────────────────────────────
await test('T14: updateTask throws on invalid status', async () => {
  const t = await svc.createTask(WS, { title: 'Invalid Status Test' });
  try {
    await svc.updateTask(WS, t.id, { status: 'flying' });
    assert.fail('should have thrown');
  } catch (err) {
    assert(err.message.includes('Invalid status'), `expected invalid status error, got: ${err.message}`);
  }
});

// ── T15: deleteTask removes task ─────────────────────────────────────────────
await test('T15: deleteTask removes task and returns true', async () => {
  const t  = await svc.createTask(WS, { title: 'Delete Me' });
  const ok = await svc.deleteTask(WS, t.id);
  assert.strictEqual(ok, true, 'delete should return true');
  const found = await svc.getTask(WS, t.id);
  assert.strictEqual(found, null, 'task should be gone after delete');
});

// ── T16: deleteTask returns false for nonexistent ────────────────────────────
await test('T16: deleteTask returns false for nonexistent task', async () => {
  const ok = await svc.deleteTask(WS, 'wt_ghost_xxx');
  assert.strictEqual(ok, false, 'should return false');
});

// ── T17: assignTask sets assigneeId ──────────────────────────────────────────
await test('T17: assignTask sets assigneeId', async () => {
  const t = await svc.createTask(WS, { title: 'Assign Me' });
  const updated = await svc.assignTask(WS, t.id, 'validator::alice');
  assert.strictEqual(updated.assigneeId, 'validator::alice', 'assigneeId should be set');
});

// ── T18: bulkCreate creates multiple tasks ───────────────────────────────────
await test('T18: bulkCreate creates multiple tasks', async () => {
  const tasks = [
    { title: 'Bulk A', priority: 'high' },
    { title: 'Bulk B', priority: 'low'  },
    { title: 'Bulk C', status:   'in_progress' },
  ];
  const result = await svc.bulkCreate(WS, tasks);
  assert.strictEqual(result.created, 3, 'should create 3 tasks');
  assert.strictEqual(result.tasks.length, 3, 'tasks array should have 3');
  assert(result.tasks.every(t => t.id), 'all tasks should have ids');
});

// ── T19: bulkCreate enforces limit of 100 ────────────────────────────────────
await test('T19: bulkCreate throws if more than 100 tasks', async () => {
  const bigList = Array.from({ length: 101 }, (_, i) => ({ title: `Task ${i}` }));
  try {
    await svc.bulkCreate(WS, bigList);
    assert.fail('should have thrown');
  } catch (err) {
    assert(err.message.includes('100'), `expected limit error, got: ${err.message}`);
  }
});

// ── T20: stats returns correct totals ────────────────────────────────────────
await test('T20: stats returns byStatus and byPriority breakdown', async () => {
  const wsStats = 'ws_stats_test';
  await svc.createTask(wsStats, { title: 'S1', status: 'pending',     priority: 'high'   });
  await svc.createTask(wsStats, { title: 'S2', status: 'done',        priority: 'low'    });
  await svc.createTask(wsStats, { title: 'S3', status: 'in_progress', priority: 'medium' });
  const stats = await svc.stats(wsStats);
  assert.strictEqual(stats.total, 3, 'total should be 3');
  assert.strictEqual(stats.byStatus.pending,     1, 'pending count');
  assert.strictEqual(stats.byStatus.done,        1, 'done count');
  assert.strictEqual(stats.byStatus.in_progress, 1, 'in_progress count');
  assert.strictEqual(stats.byPriority.high,   1, 'high count');
  assert.strictEqual(stats.byPriority.low,    1, 'low count');
  assert.strictEqual(stats.byPriority.medium, 1, 'medium count');
});

// ── T21: getOverdueTasks finds overdue tasks ──────────────────────────────────
await test('T21: getOverdueTasks returns tasks past dueAt', async () => {
  const wsOd = 'ws_overdue_test';
  const yesterday = new Date(Date.now() - 86400_000).toISOString();
  const tomorrow  = new Date(Date.now() + 86400_000).toISOString();
  await svc.createTask(wsOd, { title: 'Overdue',   dueAt: yesterday });
  await svc.createTask(wsOd, { title: 'Not Due',   dueAt: tomorrow  });
  await svc.createTask(wsOd, { title: 'Done Old',  dueAt: yesterday, status: 'done' });
  const overdue = svc.getOverdueTasks(wsOd);
  assert.strictEqual(overdue.length, 1, 'should find 1 overdue task');
  assert.strictEqual(overdue[0].title, 'Overdue', 'title should be Overdue');
});

// ── T22: searchTasks finds by title keyword ───────────────────────────────────
await test('T22: searchTasks finds tasks by keyword in title', async () => {
  const wsSearch = 'ws_search_test';
  await svc.createTask(wsSearch, { title: 'Review the contract document' });
  await svc.createTask(wsSearch, { title: 'Fix the broken pipeline'       });
  await svc.createTask(wsSearch, { title: 'Write contract summary'        });
  const results = svc.searchTasks(wsSearch, 'contract');
  assert(results.length >= 2, `expected ≥2 results, got ${results.length}`);
  assert(results.every(t => t.title.toLowerCase().includes('contract')), 'all results should contain contract');
});

// ── T23: addComment and getComments ──────────────────────────────────────────
await test('T23: addComment returns comment; getComments returns it', async () => {
  const t = await svc.createTask(WS, { title: 'Commented Task' });
  const c = svc.addComment(WS, t.id, { text: 'First comment', authorId: 'alice' });
  assert(c.id,                    'comment id missing');
  assert.strictEqual(c.text, 'First comment', 'text mismatch');
  assert.strictEqual(c.authorId, 'alice',      'authorId mismatch');
  const comments = svc.getComments(WS, t.id);
  assert.strictEqual(comments.length, 1, 'should have 1 comment');
  assert.strictEqual(comments[0].id, c.id, 'comment id should match');
});

// ── T24: addComment throws on empty text ─────────────────────────────────────
await test('T24: addComment throws on empty text', async () => {
  const t = await svc.createTask(WS, { title: 'Comment Validation Task' });
  try {
    svc.addComment(WS, t.id, { text: '', authorId: 'alice' });
    assert.fail('should have thrown');
  } catch (err) {
    assert(err.message.includes('text'), `expected text error, got: ${err.message}`);
  }
});

// ── T25: listTasks cursor pagination ─────────────────────────────────────────
await test('T25: listTasks cursor pagination works', async () => {
  const wsPag = 'ws_pagination_test';
  for (let i = 0; i < 5; i++) {
    await svc.createTask(wsPag, { title: `Pag Task ${i}` });
  }
  const page1 = await svc.listTasks(wsPag, { limit: 2 });
  assert.strictEqual(page1.tasks.length, 2, 'page1 should have 2 tasks');
  assert(page1.nextCursor, 'nextCursor should be set');

  const page2 = await svc.listTasks(wsPag, { limit: 2, cursor: page1.nextCursor });
  assert.strictEqual(page2.tasks.length, 2, 'page2 should have 2 tasks');
  // Ensure no overlap
  const ids1 = new Set(page1.tasks.map(t => t.id));
  assert(page2.tasks.every(t => !ids1.has(t.id)), 'pages should not overlap');
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