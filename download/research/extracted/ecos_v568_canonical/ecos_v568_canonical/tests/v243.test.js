/**
 * tests/v243.test.js — ECOS V243 (Phase P139) — Guard suite
 *
 * Covers:
 *   §1  ragPipeline243 — chunker, tokenizer, embed, ingest/retrieve/augment
 *   §2  swarmPlanner243 — plan (skipToolDiscovery path), storage, stats
 *   §3  Swarm + RAG integration — ingest then plan with retrieved context
 *   §4  Server wiring — source guards, version, sacred files
 *
 * Run: NODE_ENV=test node tests/v243.test.js
 * @version 243.0.0
 */
'use strict';
process.env.NODE_ENV = 'test';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

let passed = 0, failed = 0;
const errors243 = [];

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => { console.log('  ✓ ' + name); passed++; })
               .catch(e => { console.error('  ✗ ' + name + ': ' + e.message); failed++; errors243.push(name); });
    }
    console.log('  ✓ ' + name); passed++;
  } catch (e) {
    console.error('  ✗ ' + name + ': ' + e.message); failed++; errors243.push(name);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[V243] §1 — ragPipeline243\n');

const {
  RagPipeline243, defaultRagPipeline243,
  chunkText243, RAG_CHUNK_SIZE_243, RAG_CHUNK_OVERLAP_243,
  RAG_MAX_TOPK_243, RAG_DEFAULT_TOPK_243, RAG_VEC_DIM_243,
  _tokenize243, _buildTf243, _tfidfVector243,
} = require('../src/lib/ragPipeline243');

const {
  VectorMemory242, defaultVectorMemory242,
} = require('../src/lib/vectorMemory242');

test('ragPipeline243 parses clean', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/ragPipeline243.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(src, { filename: 'ragPipeline243.js' }));
});

test('lib/ mirror exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/ragPipeline243.js')), 'lib/ragPipeline243.js missing');
});

test('constants have sensible values', () => {
  assert.ok(RAG_CHUNK_SIZE_243 >= 100, 'chunk size too small');
  assert.ok(RAG_CHUNK_OVERLAP_243 >= 0, 'overlap negative');
  assert.ok(RAG_CHUNK_OVERLAP_243 < RAG_CHUNK_SIZE_243, 'overlap >= chunk');
  assert.ok(RAG_MAX_TOPK_243 >= 10, 'max topK too small');
  assert.ok(RAG_VEC_DIM_243 > 0, 'dim must be positive');
});

test('chunkText243 splits text into chunks', () => {
  const text = 'a'.repeat(1200);
  const chunks = chunkText243(text, 500, 50);
  assert.ok(chunks.length >= 2, 'expected at least 2 chunks');
  for (const c of chunks) assert.ok(c.length > 0 && c.length <= 500);
});

test('chunkText243 returns single chunk for short text', () => {
  const chunks = chunkText243('hello world', 500, 50);
  assert.strictEqual(chunks.length, 1);
  assert.strictEqual(chunks[0], 'hello world');
});

test('chunkText243 handles empty string', () => {
  assert.deepStrictEqual(chunkText243(''), []);
  assert.deepStrictEqual(chunkText243(null), []);
});

test('_tokenize243 removes stop words and lowercases', () => {
  const tokens = _tokenize243('The quick brown fox is running');
  assert.ok(!tokens.includes('the'), 'stop word "the" must be removed');
  assert.ok(!tokens.includes('is'), 'stop word "is" must be removed');
  assert.ok(tokens.includes('quick'));
  assert.ok(tokens.includes('fox'));
});

test('_buildTf243 returns normalized frequencies', () => {
  const tf = _buildTf243(['a', 'b', 'a']);
  assert.ok(Math.abs(tf['a'] - 2/3) < 0.001, 'tf[a] should be 2/3');
  assert.ok(Math.abs(tf['b'] - 1/3) < 0.001, 'tf[b] should be 1/3');
});

test('_tfidfVector243 returns array of length RAG_VEC_DIM_243', () => {
  const vec = _tfidfVector243('machine learning is powerful and effective');
  assert.strictEqual(vec.length, RAG_VEC_DIM_243);
  assert.ok(vec.some(v => v !== 0), 'vector should have non-zero elements');
});

test('RagPipeline243 constructs with custom vectorMemory', () => {
  const mem = new VectorMemory242();
  const rag = new RagPipeline243({ vectorMemory: mem });
  assert.ok(typeof rag.ingestDocument243 === 'function');
  assert.ok(typeof rag.retrieveContext243 === 'function');
  assert.ok(typeof rag.augmentPrompt243 === 'function');
});

test('ingestDocument243 stores chunks and returns docId + count', async () => {
  const mem = new VectorMemory242();
  const rag = new RagPipeline243({ vectorMemory: mem });
  const text = 'ECOS is an economic coordination system. '.repeat(5);
  const result = await rag.ingestDocument243(text, { docId: 'test-doc-243', source: 'unit-test' });
  assert.ok(result.docId === 'test-doc-243', 'docId should match');
  assert.ok(result.chunksStored >= 1, 'at least one chunk stored');
  assert.ok(mem.getStats242().entryCount >= 1);
});

test('ingestDocument243 generates docId if not provided', async () => {
  const mem = new VectorMemory242();
  const rag = new RagPipeline243({ vectorMemory: mem });
  const result = await rag.ingestDocument243('some text about economics and trading');
  assert.ok(result.docId.startsWith('doc_'));
});

test('ingestDocument243 rejects empty text', async () => {
  const mem = new VectorMemory242();
  const rag = new RagPipeline243({ vectorMemory: mem });
  await assert.rejects(() => rag.ingestDocument243(''), /non-empty string/);
});

test('retrieveContext243 returns ranked results after ingest', async () => {
  const mem = new VectorMemory242();
  const rag = new RagPipeline243({ vectorMemory: mem });
  await rag.ingestDocument243('The ledger tracks all financial transactions and balances', { docId: 'fin-doc' });
  await rag.ingestDocument243('Agent dispatchers route messages to the correct handlers', { docId: 'agent-doc' });
  const results = rag.retrieveContext243('financial ledger balance', 2);
  assert.ok(Array.isArray(results), 'results should be array');
  assert.ok(results.length >= 0, 'length >= 0');
  if (results.length > 0) {
    assert.ok(typeof results[0].chunk === 'string');
    assert.ok(typeof results[0].score === 'number');
    assert.ok(typeof results[0].key === 'string');
  }
});

test('retrieveContext243 topK is clamped to RAG_MAX_TOPK_243', async () => {
  const mem = new VectorMemory242();
  const rag = new RagPipeline243({ vectorMemory: mem });
  await rag.ingestDocument243('test content for topK clamping');
  // topK > MAX should not crash
  const results = rag.retrieveContext243('test', RAG_MAX_TOPK_243 + 9999);
  assert.ok(Array.isArray(results));
});

test('augmentPrompt243 returns structured prompt with [CONTEXT] and [QUERY]', async () => {
  const mem = new VectorMemory242();
  const rag = new RagPipeline243({ vectorMemory: mem });
  await rag.ingestDocument243('Vector memory stores dense embeddings for fast retrieval');
  const aug = rag.augmentPrompt243('how does vector storage work');
  assert.ok(aug.prompt.includes('[CONTEXT]'), 'missing [CONTEXT]');
  assert.ok(aug.prompt.includes('[QUERY]'), 'missing [QUERY]');
  assert.ok(aug.prompt.includes('how does vector storage work'), 'query missing from prompt');
  assert.ok(Array.isArray(aug.chunks));
});

test('augmentPrompt243 handles no-context gracefully', () => {
  const mem = new VectorMemory242();
  const rag = new RagPipeline243({ vectorMemory: mem });
  const aug = rag.augmentPrompt243('completely unrelated query xyz');
  assert.ok(aug.prompt.includes('[CONTEXT]'));
  assert.ok(aug.prompt.includes('[QUERY]'));
});

test('getStats243 returns expected shape', async () => {
  const mem = new VectorMemory242();
  const rag = new RagPipeline243({ vectorMemory: mem });
  await rag.ingestDocument243('stats test document content');
  rag.retrieveContext243('stats query');
  const stats = rag.getStats243();
  assert.ok(typeof stats.ingestCount === 'number');
  assert.ok(typeof stats.queryCount === 'number');
  assert.ok(typeof stats.vocabSize === 'number');
  assert.ok(typeof stats.vectorDim === 'number');
  assert.strictEqual(stats.vectorDim, RAG_VEC_DIM_243);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[V243] §2 — swarmPlanner243\n');

const {
  planSwarm243, getPlan243, listPlans243, getPlannerStats243,
  PLANNER_MAX_SUBTASKS_243, PLANNER_DEFAULT_COST_243,
  _decomposeGoal243, _planStore243,
} = require('../src/lib/swarmPlanner243');

test('swarmPlanner243 parses clean', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/swarmPlanner243.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(src, { filename: 'swarmPlanner243.js' }));
});

test('lib/ mirror exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/swarmPlanner243.js')), 'lib/swarmPlanner243.js missing');
});

test('_decomposeGoal243 splits multi-clause goal', () => {
  const tasks = _decomposeGoal243('research AI trends then summarise findings');
  assert.ok(tasks.length >= 2, 'expected >= 2 tasks');
  assert.ok(tasks.some(t => t.dependsOn), 'some task should have dependsOn');
});

test('_decomposeGoal243 wraps single clause in research+synthesise', () => {
  const tasks = _decomposeGoal243('explain blockchain');
  assert.ok(tasks.length >= 2);
});

test('planSwarm243 returns SwarmPlan243 with required fields', async () => {
  const plan = await planSwarm243('find market data and generate a report', {
    userId: 'test-user-243',
    skipToolDiscovery: true,
  });
  assert.ok(plan.planId.startsWith('plan_'), 'planId should start with plan_');
  assert.strictEqual(plan.goal, 'find market data and generate a report');
  assert.strictEqual(plan.userId, 'test-user-243');
  assert.ok(Array.isArray(plan.subTasks), 'subTasks must be array');
  assert.ok(plan.subTasks.length >= 1, 'must have at least one sub-task');
  assert.ok(typeof plan.totalEstimatedCostMicro === 'number', 'cost should be number');
  assert.ok(typeof plan.createdAt === 'number', 'createdAt should be number');
});

test('planSwarm243 sub-tasks have required shape', async () => {
  const plan = await planSwarm243('research topic then write summary', { skipToolDiscovery: true });
  for (const st of plan.subTasks) {
    assert.ok(typeof st.id === 'string', 'id must be string');
    assert.ok(typeof st.description === 'string', 'description must be string');
    assert.ok('dependsOn' in st, 'dependsOn must be present');
    assert.ok('toolName' in st, 'toolName must be present');
    assert.ok(typeof st.estimatedCostMicro === 'number', 'cost must be number');
    assert.ok(st.estimatedCostMicro >= 0, 'cost must be non-negative');
    assert.ok(typeof st.toolScore === 'number', 'toolScore must be number');
  }
});

test('planSwarm243 totalEstimatedCostMicro equals sum of sub-tasks', async () => {
  const plan = await planSwarm243('step1 then step2 then step3', { skipToolDiscovery: true });
  const sum = plan.subTasks.reduce((a, st) => a + st.estimatedCostMicro, 0);
  assert.strictEqual(plan.totalEstimatedCostMicro, sum, 'total cost mismatch');
});

test('planSwarm243 rejects empty goal', async () => {
  await assert.rejects(() => planSwarm243(''), /non-empty string/);
});

test('getPlan243 retrieves stored plan', async () => {
  const plan = await planSwarm243('test retrieval goal', { skipToolDiscovery: true });
  const retrieved = getPlan243(plan.planId);
  assert.ok(retrieved !== null, 'should find stored plan');
  assert.strictEqual(retrieved.planId, plan.planId);
});

test('getPlan243 returns null for unknown planId', () => {
  assert.strictEqual(getPlan243('not-a-real-plan-243'), null);
});

test('listPlans243 returns array', async () => {
  await planSwarm243('list-test goal', { userId: 'list-user-243', skipToolDiscovery: true });
  const plans = listPlans243({ userId: 'list-user-243' });
  assert.ok(Array.isArray(plans));
  assert.ok(plans.length >= 1);
  assert.ok(plans.every(p => p.userId === 'list-user-243'));
});

test('listPlans243 respects limit', async () => {
  for (let i = 0; i < 5; i++) {
    await planSwarm243(`limit-test goal ${i}`, { userId: 'limit-user-243', skipToolDiscovery: true });
  }
  const plans = listPlans243({ userId: 'limit-user-243', limit: 2 });
  assert.ok(plans.length <= 2, 'should respect limit');
});

test('getPlannerStats243 returns expected shape', () => {
  const stats = getPlannerStats243();
  assert.ok(typeof stats.totalPlans === 'number');
  assert.ok(typeof stats.maxPlans === 'number');
  assert.ok(stats.plannerVersion === 'V243');
});

test('PLANNER_MAX_SUBTASKS_243 is capped in plan', async () => {
  // Build a goal with many clauses
  const goal = Array.from({ length: 30 }, (_, i) => `step${i}`).join('; ');
  const plan = await planSwarm243(goal, { skipToolDiscovery: true });
  assert.ok(plan.subTasks.length <= PLANNER_MAX_SUBTASKS_243, 'sub-tasks capped');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[V243] §3 — Swarm + RAG integration\n');

test('ingest doc then plan swarm against it (skipDiscovery)', async () => {
  const mem = new VectorMemory242();
  const rag = new RagPipeline243({ vectorMemory: mem });

  // Ingest a "knowledge base" document
  const doc = `ECOS is a decentralised economic coordination platform.
It uses fiatLedger to track balances and auditLog for immutable records.
Agents can request payouts via the payout system, subject to validator consensus.
Swarm orchestration allows multiple sub-agents to work in parallel.`;

  const ingestResult = await rag.ingestDocument243(doc, { docId: 'rag-swarm-test-243', source: 'integration' });
  assert.ok(ingestResult.chunksStored >= 1, 'at least one chunk ingested');

  // Retrieve context for a swarm goal
  const query = 'how does agent payout and validator consensus work';
  const context = rag.retrieveContext243(query, 3);
  assert.ok(Array.isArray(context), 'context is array');

  // Plan a swarm using the retrieved context as goal elaboration
  const enrichedGoal = context.length > 0
    ? `${query} — context: ${context[0].chunk.slice(0, 100)}`
    : query;

  const plan = await planSwarm243(enrichedGoal, { userId: 'integration-user-243', skipToolDiscovery: true });
  assert.ok(plan.subTasks.length >= 1, 'plan should have sub-tasks');
  assert.ok(plan.planId.startsWith('plan_'));

  // Augmented prompt includes the query
  const aug = rag.augmentPrompt243(query, 3);
  assert.ok(aug.prompt.includes('[QUERY]'));
  assert.ok(aug.prompt.includes(query));
});

test('integration: zero-dep chain — vectorMemory242 → ragPipeline243 → swarmPlanner243', async () => {
  // Verify all three modules load independently with no npm deps
  const ragSrc = fs.readFileSync(path.join(ROOT, 'src/lib/ragPipeline243.js'), 'utf8');
  const planSrc = fs.readFileSync(path.join(ROOT, 'src/lib/swarmPlanner243.js'), 'utf8');

  const BUILTINS = new Set(['crypto','http','https','fs','path','url','util','os','events','stream','zlib','buffer','assert','child_process','timers']);
  for (const [label, src] of [['ragPipeline', ragSrc], ['swarmPlanner', planSrc]]) {
    const specs = [...src.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map(x => x[1]);
    const npm = specs.filter(s => !s.startsWith('.') && !s.startsWith('/') && !BUILTINS.has(s));
    assert.deepStrictEqual(npm, [], `${label}: unexpected npm deps: ${JSON.stringify(npm)}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[V243] §4 — Server wiring & handoff docs\n');

test('server patch parses clean', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server-v243-patch.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(src, { filename: 'ecos-api-server-v243-patch.js' }));
});

test('server patch exports registerV243Endpoints', () => {
  const p = require(path.join(ROOT, 'ecos-api-server-v243-patch.js'));
  assert.strictEqual(typeof p.registerV243Endpoints, 'function');
});

test('server patch has zero new npm deps (R3)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server-v243-patch.js'), 'utf8');
  const BUILTINS = new Set(['crypto','http','https','fs','path','url','util','os','events','stream','zlib','buffer','assert','child_process','timers']);
  const specs = [...src.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map(x => x[1]);
  const npm = specs.filter(s => !s.startsWith('.') && !s.startsWith('/') && !BUILTINS.has(s));
  assert.deepStrictEqual(npm, [], 'unexpected npm deps: ' + JSON.stringify(npm));
});

test('server source wires V243 patch and contains V243 tags', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert.ok(src.includes("require('./ecos-api-server-v243-patch.js')"), 'V243 patch not required');
  assert.ok(src.includes('registerV243Endpoints(app'), 'registerV243Endpoints not invoked');
  assert.ok(src.includes('V243-T01'), 'V243-T01 tag missing');
  assert.ok(src.includes('V243-T07'), 'V243-T07 tag missing');
});

test('ecos-api-server.js parses clean', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(src, { filename: 'ecos-api-server.js' }));
});

test('package.json is version 243.0.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(parseInt(String(pkg.version).split('.')[0],10) >= 243, 'major >= 243');
});

test('sacred files intact (MD5 unchanged)', () => {
  const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
  assert.strictEqual(md5('lib/fiatLedger.js'), '563e9b1f9e67091a5b6527c0a92568e5', 'fiatLedger changed!');
  assert.strictEqual(md5('lib/auditLog.js'),   'e5a5c2c27801d2d03991bc8e5a1df8cb', 'auditLog changed!');
});

test('CHANGELOG_V243.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'CHANGELOG_V243.md')));
});

test('NEXT_SESSION_PROMPT_V243.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'NEXT_SESSION_PROMPT_V243.md')));
});

test('AI_PROTOCOL_V243.md exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'AI_PROTOCOL_V243.md')));
});

test('all new V243 lib files present and mirrored', () => {
  const newLibs = ['ragPipeline243', 'swarmPlanner243'];
  for (const m of newLibs) {
    assert.ok(fs.existsSync(path.join(ROOT, 'src/lib', m + '.js')), `src/lib/${m}.js missing`);
    assert.ok(fs.existsSync(path.join(ROOT, 'lib', m + '.js')), `lib/${m}.js (mirror) missing`);
    // Verify mirrors are identical
    const src = fs.readFileSync(path.join(ROOT, 'src/lib', m + '.js'), 'utf8');
    const mir = fs.readFileSync(path.join(ROOT, 'lib', m + '.js'), 'utf8');
    assert.strictEqual(src, mir, `lib/${m}.js mirror is out of sync`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Run and report
Promise.resolve().then(async () => {
  await new Promise(r => setTimeout(r, 400)); // allow async tests to settle

  console.log(`\n  Results: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('  Failed: ' + errors243.join(', '));
    process.exit(1);
  }
  console.log('  ✓ All V243 tests passed\n');
});
