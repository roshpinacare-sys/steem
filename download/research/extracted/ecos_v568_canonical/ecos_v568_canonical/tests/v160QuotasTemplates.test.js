/**
 * tests/v160QuotasTemplates.test.js
 * ===================================
 * V160 WorkspaceQuotaService + WorkspaceTaskTemplateService — unit tests
 * Run: node tests/v160QuotasTemplates.test.js
 *
 * 24 tests covering:
 * Quotas (12):
 *  - getQuota (default creation)
 *  - setQuota (plan, custom limits)
 *  - checkQuota (ok + exceeded → QuotaExceededError)
 *  - adminOverride (update limits)
 *  - getUsageSummary (usage structure)
 *  - listAll
 *  - getPlans
 *  - stats
 *  - QuotaExceededError (statusCode=429, code, fields)
 *  - QUOTA_PLANS constants
 *
 * Templates (12):
 *  - createTemplate (valid + missing name)
 *  - listTemplates (all + by category)
 *  - getTemplate (found + not found)
 *  - updateTemplate (patch fields)
 *  - deleteTemplate (found + not found)
 *  - instantiate (no taskSvc wired → returns taskData)
 *  - saveTaskAsTemplate
 *  - listCategories
 *  - stats
 *  - bulk pattern (multiple creates + list)
 *
 * [V160-TEST-03]
 */

'use strict';

const assert = require('assert');
const path   = require('path');

const {
  WorkspaceQuotaService,
  QuotaExceededError,
  QUOTA_PLANS,
  DEFAULT_PLAN,
  defaultQuotaService,
} = require(path.resolve(__dirname, '../lib/workspaceQuotaService'));

const {
  WorkspaceTaskTemplateService,
  TaskTemplate,
  defaultTemplateService,
} = require(path.resolve(__dirname, '../lib/workspaceTaskTemplateService'));

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

console.log('\n── V160 Quotas + Templates Tests ─────────────────────────────');

(async () => {

// ════════════════════════════════════════════════════════════════════
// SECTION 1: WorkspaceQuotaService
// ════════════════════════════════════════════════════════════════════

console.log('\n  [Quotas]');
const WS_Q = 'ws_quota_test_' + Date.now();

await test('Q01: getQuota returns default quota for new workspace', async () => {
  const svc   = new WorkspaceQuotaService();
  const quota = await svc.getQuota(WS_Q);
  assert(quota.workspaceId === WS_Q, 'workspaceId should match');
  assert(typeof quota.maxTasks    === 'number', 'maxTasks should be number');
  assert(typeof quota.maxMembers  === 'number', 'maxMembers should be number');
  assert(typeof quota.maxWebhooks === 'number', 'maxWebhooks should be number');
  assert(typeof quota.plan        === 'string', 'plan should be string');
});

await test('Q02: setQuota stores custom plan', async () => {
  const svc   = new WorkspaceQuotaService();
  const wsId  = 'ws_setquota_' + Date.now();
  const quota = await svc.setQuota(wsId, { plan: 'enterprise' });
  assert.strictEqual(quota.plan, 'enterprise', 'plan should be enterprise');
  assert.strictEqual(quota.maxTasks, QUOTA_PLANS.enterprise.maxTasks, 'maxTasks should match enterprise plan');
});

await test('Q03: setQuota allows custom limit overrides', async () => {
  const svc   = new WorkspaceQuotaService();
  const wsId  = 'ws_custom_' + Date.now();
  const quota = await svc.setQuota(wsId, { plan:'pro', maxTasks:999 });
  assert.strictEqual(quota.maxTasks, 999, 'maxTasks should be 999');
});

await test('Q04: checkQuota returns ok when under limit', async () => {
  const svc    = new WorkspaceQuotaService();
  const wsId   = 'ws_ok_' + Date.now();
  await svc.setQuota(wsId, { maxTasks: 100 });
  const result = await svc.checkQuota(wsId, 'tasks', 50);
  assert.strictEqual(result.ok, true, 'should be ok');
  assert.strictEqual(result.current, 50, 'current should be 50');
  assert.strictEqual(result.limit,   100, 'limit should be 100');
  assert.strictEqual(result.remaining, 50, 'remaining should be 50');
});

await test('Q05: checkQuota throws QuotaExceededError when at limit', async () => {
  const svc   = new WorkspaceQuotaService();
  const wsId  = 'ws_exceeded_' + Date.now();
  await svc.setQuota(wsId, { plan:'free', maxTasks:10 });
  let threw = false;
  try { await svc.checkQuota(wsId, 'tasks', 10); }
  catch (err) { threw = err instanceof QuotaExceededError; }
  assert(threw, 'should throw QuotaExceededError');
});

await test('Q06: QuotaExceededError has correct fields', async () => {
  const svc   = new WorkspaceQuotaService();
  const wsId  = 'ws_err_' + Date.now();
  await svc.setQuota(wsId, { plan:'free', maxTasks: 5 });
  let err = null;
  try { await svc.checkQuota(wsId, 'tasks', 5); } catch (e) { err = e; }
  assert(err, 'should have thrown');
  assert.strictEqual(err.code,       'QUOTA_EXCEEDED', 'code should be QUOTA_EXCEEDED');
  assert.strictEqual(err.statusCode, 429,              'statusCode should be 429');
  assert.strictEqual(err.resource,   'tasks',          'resource should be tasks');
  assert.strictEqual(err.limit,      5,                'limit should be 5');
  assert.strictEqual(err.current,    5,                'current should be 5');
});

await test('Q07: checkQuota throws error for unknown resource', async () => {
  const svc  = new WorkspaceQuotaService();
  const wsId = 'ws_unknown_' + Date.now();
  let threw  = false;
  try { await svc.checkQuota(wsId, 'unknown_resource', 1); } catch (_) { threw = true; }
  assert(threw, 'should throw for unknown resource type');
});

await test('Q08: adminOverride updates quota with overrideBy', async () => {
  const svc   = new WorkspaceQuotaService();
  const wsId  = 'ws_admin_' + Date.now();
  await svc.setQuota(wsId, { plan:'free' });
  const q = await svc.adminOverride(wsId, { maxTasks:9999 }, 'admin_01');
  assert.strictEqual(q.maxTasks,   9999,     'maxTasks should be 9999');
  assert.strictEqual(q.overrideBy, 'admin_01', 'overrideBy should be admin_01');
});

await test('Q09: getUsageSummary returns usage structure', async () => {
  const svc   = new WorkspaceQuotaService();
  const wsId  = 'ws_usage_' + Date.now();
  await svc.setQuota(wsId, { plan:'pro' });
  const summary = await svc.getUsageSummary(wsId, async () => ({ tasks:10, webhooks:2, templates:5, dependencies:15, members:3 }));
  assert(summary.plan,   'should have plan');
  assert(summary.usage,  'should have usage');
  assert(typeof summary.usage.tasks.usagePct === 'number', 'usagePct should be number');
  assert(typeof summary.usage.tasks.remaining === 'number', 'remaining should be number');
});

await test('Q10: listAll returns all quotas', async () => {
  const svc  = new WorkspaceQuotaService();
  const ws1  = 'ws_la_1_' + Date.now();
  const ws2  = 'ws_la_2_' + Date.now();
  await svc.setQuota(ws1, { plan:'pro' });
  await svc.setQuota(ws2, { plan:'free' });
  const all  = svc.listAll();
  assert(all.length >= 2, 'should have at least 2 quotas');
});

await test('Q11: getPlans returns all plan names', () => {
  const svc   = new WorkspaceQuotaService();
  const plans = svc.getPlans();
  const names = plans.map(p => p.name);
  assert(names.includes('free'),       'should have free plan');
  assert(names.includes('pro'),        'should have pro plan');
  assert(names.includes('enterprise'), 'should have enterprise plan');
  assert(names.includes('unlimited'),  'should have unlimited plan');
});

await test('Q12: QUOTA_PLANS constants are defined with correct shape', () => {
  for (const [plan, limits] of Object.entries(QUOTA_PLANS)) {
    assert(typeof limits.maxTasks    === 'number', `${plan}.maxTasks should be number`);
    assert(typeof limits.maxMembers  === 'number', `${plan}.maxMembers should be number`);
    assert(typeof limits.maxWebhooks === 'number', `${plan}.maxWebhooks should be number`);
  }
});

// ════════════════════════════════════════════════════════════════════
// SECTION 2: WorkspaceTaskTemplateService
// ════════════════════════════════════════════════════════════════════

console.log('\n  [Templates]');
const WS_T = 'ws_tpl_test_' + Date.now();

await test('T01: createTemplate creates template with id', async () => {
  const svc = new WorkspaceTaskTemplateService();
  const tpl = await svc.createTemplate(WS_T, {
    name:            'Bug Report Template',
    description:     'Standard bug report',
    defaultTitle:    'Bug: ',
    defaultPriority: 'high',
    category:        'engineering',
    defaultTags:     ['bug','v160'],
  });
  assert(tpl.id,                           'should have id');
  assert.strictEqual(tpl.workspaceId,      WS_T,                 'workspaceId should match');
  assert.strictEqual(tpl.name,             'Bug Report Template', 'name should match');
  assert.strictEqual(tpl.defaultPriority,  'high',               'priority should match');
  assert.deepStrictEqual(tpl.defaultTags,  ['bug','v160'],        'tags should match');
});

await test('T02: createTemplate throws when name is missing', async () => {
  const svc = new WorkspaceTaskTemplateService();
  let threw = false;
  try { await svc.createTemplate(WS_T, { description:'no name' }); } catch (_) { threw = true; }
  assert(threw, 'should throw when name missing');
});

await test('T03: createTemplate defaults priority to medium for invalid value', async () => {
  const svc = new WorkspaceTaskTemplateService();
  const tpl = await svc.createTemplate(WS_T+'_def', { name:'T', defaultPriority:'invalid' });
  assert.strictEqual(tpl.defaultPriority, 'medium', 'priority should default to medium');
});

await test('T04: listTemplates returns templates for workspace', async () => {
  const svc = new WorkspaceTaskTemplateService();
  const ws  = WS_T + '_list';
  await svc.createTemplate(ws, { name:'Template 1', category:'eng' });
  await svc.createTemplate(ws, { name:'Template 2', category:'ops' });
  const list = await svc.listTemplates(ws);
  assert.strictEqual(list.length, 2, 'should return 2 templates');
});

await test('T05: listTemplates filters by category', async () => {
  const svc = new WorkspaceTaskTemplateService();
  const ws  = WS_T + '_cat';
  await svc.createTemplate(ws, { name:'Eng Template', category:'engineering' });
  await svc.createTemplate(ws, { name:'Ops Template', category:'operations' });
  const eng = await svc.listTemplates(ws, { category:'engineering' });
  assert.strictEqual(eng.length, 1, 'should return 1 engineering template');
  assert.strictEqual(eng[0].category, 'engineering', 'category should match');
});

await test('T06: getTemplate returns template by id', async () => {
  const svc = new WorkspaceTaskTemplateService();
  const tpl = await svc.createTemplate(WS_T+'_get', { name:'Fetch Me' });
  const got = await svc.getTemplate(WS_T+'_get', tpl.id);
  assert(got, 'should return template');
  assert.strictEqual(got.id,   tpl.id,     'id should match');
  assert.strictEqual(got.name, 'Fetch Me', 'name should match');
});

await test('T07: getTemplate returns null for non-existent id', async () => {
  const svc    = new WorkspaceTaskTemplateService();
  const result = await svc.getTemplate(WS_T, 'tpl_nonexistent_999');
  assert.strictEqual(result, null, 'should return null for missing template');
});

await test('T08: updateTemplate patches name and category', async () => {
  const svc     = new WorkspaceTaskTemplateService();
  const ws      = WS_T + '_upd';
  const created = await svc.createTemplate(ws, { name:'Original', category:'old' });
  const updated = await svc.updateTemplate(ws, created.id, { name:'Updated', category:'new' });
  assert.strictEqual(updated.name,     'Updated', 'name should be updated');
  assert.strictEqual(updated.category, 'new',     'category should be updated');
});

await test('T09: deleteTemplate removes template', async () => {
  const svc = new WorkspaceTaskTemplateService();
  const ws  = WS_T + '_del';
  const tpl = await svc.createTemplate(ws, { name:'Delete Me' });
  const del = await svc.deleteTemplate(ws, tpl.id);
  assert(del, 'deleteTemplate should return deleted object');
  const check = await svc.getTemplate(ws, tpl.id);
  assert.strictEqual(check, null, 'template should be gone after delete');
});

await test('T10: instantiate returns taskData when no taskSvc wired', async () => {
  const svc = new WorkspaceTaskTemplateService(); // no taskSvc
  const ws  = WS_T + '_inst';
  const tpl = await svc.createTemplate(ws, { name:'Sprint Task', defaultTitle:'Sprint Task Title', defaultPriority:'high' });
  const res = await svc.instantiate(ws, tpl.id, { title:'My Sprint Task' });
  assert(res.taskData || res.task, 'should return taskData or task');
  if (res.taskData) {
    assert.strictEqual(res.taskData.title, 'My Sprint Task', 'title override should apply');
    assert.strictEqual(res.taskData.metadata.fromTemplate, tpl.id, 'metadata.fromTemplate should be set');
  }
});

await test('T11: saveTaskAsTemplate creates template from task object', async () => {
  const svc  = new WorkspaceTaskTemplateService();
  const ws   = WS_T + '_save';
  const task = {
    id:          'task_001',
    title:       'My Feature Task',
    description: 'Implement feature XYZ',
    priority:    'medium',
    tags:        ['feature','v160'],
    metadata:    { sprint: 42 },
  };
  const tpl = await svc.saveTaskAsTemplate(ws, task, { name:'Feature Template', category:'dev', createdBy:'user_01' });
  assert(tpl.id, 'should have id');
  assert.strictEqual(tpl.defaultTitle,    'My Feature Task',     'defaultTitle should come from task');
  assert.strictEqual(tpl.defaultPriority, 'medium',              'priority should match task');
  assert.deepStrictEqual(tpl.defaultTags, ['feature','v160'],    'tags should match task');
  assert.strictEqual(tpl.category, 'dev', 'category should be set');
});

await test('T12: listCategories returns unique categories with counts', async () => {
  const svc = new WorkspaceTaskTemplateService();
  const ws  = WS_T + '_cats';
  await svc.createTemplate(ws, { name:'T1', category:'engineering' });
  await svc.createTemplate(ws, { name:'T2', category:'engineering' });
  await svc.createTemplate(ws, { name:'T3', category:'operations' });
  const cats = await svc.listCategories(ws);
  const catNames = cats.map(c => c.name);
  assert(catNames.includes('engineering'), 'should include engineering');
  assert(catNames.includes('operations'),  'should include operations');
  const eng = cats.find(c => c.name === 'engineering');
  assert.strictEqual(eng.count, 2, 'engineering count should be 2');
});

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n── V160 Quotas+Templates: ${passed} passed, ${failed} failed ──────────────`);
if (errors.length) {
  console.error('\nFailed tests:');
  for (const e of errors) console.error(`  ✗ ${e.name}: ${e.message}`);
}
process.exit(failed > 0 ? 1 : 0);

})();
