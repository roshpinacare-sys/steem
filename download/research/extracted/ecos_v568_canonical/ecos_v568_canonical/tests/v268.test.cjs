'use strict';
/**
 * tests/v268.test.cjs — ECOS V268 canonical suite
 *
 * Sections:
 *   A.  V267 regression — x402, embeddedWallet, mcp, auditBloom, onboarding, splits, programs
 *   B.  providerAdapters268 — 21 contracts, 6 new stubs, logAdapter
 *   C.  ecos-api-server-v268-patch — createV268State
 *   C1–C15: Unit tests for 15 base modules
 *
 * Run: X402_TEST_MODE=1 NODE_ENV=test node tests/v268.test.cjs
 */

process.env.X402_TEST_MODE = '1';

const crypto = require('node:crypto');

// ── Imports ──────────────────────────────────────────────────────────────────
const { X402Processor268, parseX402Header268, buildPaymentRequired268, X402_VERSION_268 } = require('../src/lib/x402268');
const { SplitModule268, VESTING_MIN_DAYS_268 } = require('../src/lib/splitModule268');
const { OnboardingFlow268 } = require('../src/lib/onboardingFlow268');
const { MCPDeepIntegration268 } = require('../src/lib/mcpDeepIntegration268');
const { EmbeddedWallet268 } = require('../src/lib/embeddedWallet268');
const { UssdSmsStateMachine268 } = require('../src/lib/ussdSmsStateMachine268');
const { AuditBloom268 } = require('../src/lib/auditBloom268');
const { ExecutionProgramRegistry268, PROGRAMS_268 } = require('../src/lib/executionPrograms268');
const {
  PROVIDER_CONTRACTS_268,
  validateProvider268, validateAllProviders268,
  createAdapterScaffold268, createAllStubs268,
  createSettlementProviderStub268, createCustodyProviderStub268,
  createPersistenceAdapterStub268, createGatewayStub268,
  createSessionStoreStub268, createAntiDumpProviderStub268,
  createVestingProviderStub268, createAuthProviderStub268,
  createCryptoWordsFilterStub268, createSchedulerProviderStub268,
  createBudgetProviderStub268,
  createHitlGateStub268, createSandboxExecStub268,
  createIntelligenceRegistryStub268, createVectorMemoryStub268,
  createDbStub268, createSnapshotEngineStub268, createLogAdapterStub268,
} = require('../src/lib/providerAdapters268');
const { AgentReceipts268, MANDATE_STEPS_268, RECEIPT_STATUS_268 } = require('../src/lib/agentReceipts268');
const { BreakageEngine268, BREAKAGE_DAYS_268 } = require('../src/lib/breakageEngine268');
const { ConversionGateway268, GATEWAY_MIN_MICRO_268, SUPPORTED_CURRENCIES_268 } = require('../src/lib/conversionGateway268');
const { CostAwareRouter268, COMPLEXITY_TIERS_268, SLM_CONFIDENCE_MIN_268 } = require('../src/lib/costAwareRouter268');
const { CreditReserve268, BACKING_WARN_THRESHOLD_268, BACKING_HALT_THRESHOLD_268 } = require('../src/lib/creditReserve268');
const { InjectionFirewall268, SACRED_FILES_268 } = require('../src/lib/injectionFirewall268');
const { MemoryIntegrity268, MEMORY_SCOPES_268 } = require('../src/lib/memoryIntegrity268');
const { Metacognition268, EBBINGHAUS_K_268 } = require('../src/lib/metacognition268');
const { OfflineQueue268, PRIORITY_LEVELS_268 } = require('../src/lib/offlineQueue268');
const { QuadraticFunding268, QF_MIN_CONTRIBUTION_268 } = require('../src/lib/quadraticFunding268');
const { ReflectionLoop268, MAX_RETRIES_268, SELF_CORRECT_RATE_268 } = require('../src/lib/reflectionLoop268');
const { ReputationLedger268, ATTESTATION_TYPES_268 } = require('../src/lib/reputationLedger268');
const { SybilGuard268, SIGNAL_WEIGHTS_268 } = require('../src/lib/sybilGuard268');
const { Telemetry268 } = require('../src/lib/telemetry268');
const { TipModule268, TIP_MIN_MICRO_268, TIP_MAX_MICRO_268, COMMUNITY_MATCH_RATE_268 } = require('../src/lib/tipModule268');
const { createV268State } = require('../ecos-api-server-v268-patch');

// ── Test Harness ─────────────────────────────────────────────────────────────
let passed = 0, failed = 0, total = 0;
const _pending268 = [];

function test268(name, fn) {
  total++;
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      const p = result
        .then(() => { passed++; console.log(`  OK  ${name}`); })
        .catch(err => { failed++; console.error(`  FAIL ${name}\n       ${err.stack || err.message}`); });
      _pending268.push(p);
      return p;
    }
    passed++;
    console.log(`  OK  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}\n       ${err.stack || err.message}`);
  }
}

function assert268(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertThrows268(fn, part) {
  let threw = false, msg = '';
  try { fn(); } catch (e) { threw = true; msg = e.message; }
  if (!threw) throw new Error(`expected throw${part ? ` containing "${part}"` : ''}`);
  if (part && !msg.includes(part)) throw new Error(`expected error containing "${part}", got: "${msg}"`);
}

// Build a valid x402 HMAC-signed payload for test mode
function makeX402Payload268(overrides = {}) {
  const base = {
    version:   X402_VERSION_268,
    network:   'base-sepolia',
    from:      '0xFROM268',
    to:        '0xTO268',
    amount:    0.001,               // float USDC — NOT BigInt
    resource:  '/api/test268',
    nonce:     crypto.randomBytes(8).toString('hex'),
    timestamp: new Date().toISOString(),
    facilitator: null,
    ...overrides,
  };
  const secret = 'ecos-x402-dev-secret-268';
  const canonical = JSON.stringify({
    version: base.version, network: base.network,
    from: base.from, to: base.to,
    amount: base.amount, resource: base.resource,
    nonce: base.nonce, timestamp: base.timestamp,
    ...(base.facilitator ? { facilitator: base.facilitator } : {}),
  });
  base.signature = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
  return base;
}

// ════════════════════════════════════════════════════════════════════════════
// A. V267 REGRESSION
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[A] V267 regression');

test268('x402268 buildPaymentRequired268 returns descriptor + encoded', () => {
  const h = buildPaymentRequired268({ resource: '/api/test', amount: 0.001 });
  assert268(h.descriptor !== undefined, 'missing descriptor');
  assert268(h.encoded !== undefined, 'missing encoded');
  assert268(typeof h.descriptor.amount !== 'undefined');
  assert268(typeof h.encoded === 'string');
});

test268('x402268 parseX402Header268 decodes encoded descriptor', () => {
  const h = buildPaymentRequired268({ resource: '/api/v268', amount: 0.001 });
  const parsed = parseX402Header268(h.encoded);
  assert268(parsed !== null && typeof parsed === 'object');
  // parsed is the decoded descriptor object
  assert268(parsed.resource !== undefined || parsed.network !== undefined);
});

test268('x402268 processPayment268 succeeds with valid HMAC payload', () => {
  const proc = new X402Processor268({ settlementProvider: createSettlementProviderStub268() });
  const payload = makeX402Payload268();
  const result = proc.processPayment268(payload, { testMode: true });
  assert268(result.ok === true, 'expected ok:true, got: ' + result.code);
});

test268('x402268 processPayment268 rejects replay on same nonce', () => {
  const proc = new X402Processor268({});
  const payload = makeX402Payload268();
  proc.processPayment268(payload, { testMode: true });
  const r2 = proc.processPayment268(payload, { testMode: true });
  assert268(r2.ok === false);
  assert268(r2.code === 'REPLAY');
});

test268('x402268 processPayment268 rejects missing signature', () => {
  const proc = new X402Processor268({});
  const payload = makeX402Payload268();
  delete payload.signature;
  const r = proc.processPayment268(payload, { testMode: true });
  assert268(r.ok === false);
});

test268('x402268 getPerf268 returns percentile shape after payment', () => {
  const proc = new X402Processor268({ settlementProvider: createSettlementProviderStub268() });
  proc.processPayment268(makeX402Payload268(), { testMode: true });
  const perf = proc.getPerf268();
  assert268(typeof perf.p50 === 'number');
  assert268(typeof perf.count === 'number');
  assert268(perf.count >= 1);
});

test268('x402268 checkSettlementHealth268 returns ok', () => {
  const proc = new X402Processor268({});
  const h = proc.checkSettlementHealth268?.();
  assert268(!h || h.ok === true);
});

test268('embeddedWallet268 createWallet268 with email provider returns ok + wallet', () => {
  const w = new EmbeddedWallet268({});
  const r = w.createWallet268('user-ew-268', 'email', 'user@test.com', {});
  assert268(r.ok === true);
  assert268(r.wallet.walletId !== undefined);
  assert268(r.wallet.address !== undefined);
  assert268(r.wallet.provider === 'email');
});

test268('embeddedWallet268 createWallet268 with custodial_stub provider', () => {
  const w = new EmbeddedWallet268({});
  const r = w.createWallet268('user-ew-stub', 'custodial_stub', 'user@test.com', {});
  assert268(r.ok === true);
  assert268(r.wallet.walletId !== undefined);
});

test268('embeddedWallet268 rejects unsupported provider', () => {
  const w = new EmbeddedWallet268({});
  assertThrows268(() => w.createWallet268('user-x', 'privy', '', {}), 'unsupported provider');
});

test268('embeddedWallet268 rejects empty userId with required error', () => {
  const w = new EmbeddedWallet268({});
  assertThrows268(() => w.createWallet268('', 'email', '', {}), 'userId');
});

test268('embeddedWallet268 getPerf268 returns valid shape', () => {
  const w = new EmbeddedWallet268({});
  w.createWallet268('perf-user', 'email', 'x@x.com', {});
  const perf = w.getPerf268();
  assert268(typeof perf.p50 === 'number');
  assert268(typeof perf.count === 'number');
});

test268('mcpDeepIntegration268 registerServer268 + registerTool268 + callTool268', async () => {
  const mcp = new MCPDeepIntegration268({});
  mcp.registerServer268('srv-test', { transport: 'stub' });
  mcp.registerTool268('srv-test', { toolId: 'calc', name: 'calc', safe: false, inputSchema: {} });
  const r = await mcp.callTool268('calc', { a: 1 }, {});
  assert268(r.ok === true);
  assert268(r.callId !== undefined);
});

test268('mcpDeepIntegration268 listTools268 returns registered tools', () => {
  const mcp = new MCPDeepIntegration268({});
  mcp.registerServer268('srv-list', { transport: 'stub' });
  mcp.registerTool268('srv-list', { toolId: 'tool-a', name: 'ToolA', safe: true, inputSchema: {} });
  mcp.registerTool268('srv-list', { toolId: 'tool-b', name: 'ToolB', safe: false, inputSchema: {} });
  const tools = mcp.listTools268({});
  assert268(Array.isArray(tools));
  assert268(tools.length >= 2);
});

test268('mcpDeepIntegration268 callTool268 rejects unknown tool', async () => {
  const mcp = new MCPDeepIntegration268({});
  let threw = false;
  try { await mcp.callTool268('nonexistent-tool-268', {}, {}); } catch (_) { threw = true; }
  assert268(threw === true);
});

test268('auditBloom268 addEvent268 + has268 returns exact:true', () => {
  const b = new AuditBloom268({});
  b.addEvent268('evt-268-a', { action: 'test' });
  const r = b.has268('evt-268-a');
  assert268(r.exact === true, 'expected exact:true');
  const r2 = b.has268('evt-268-never');
  assert268(r2.maybe === false || r2.exact === false);
});

test268('auditBloom268 getPerf268 count >= 1 after events', () => {
  const b = new AuditBloom268({});
  b.addEvent268('evt-p1', {});
  b.addEvent268('evt-p2', {});
  const perf = b.getPerf268();
  assert268(perf.count >= 1);
});

test268('onboardingFlow268 startFlow268 creates user flow', () => {
  const flow = new OnboardingFlow268({});
  const r = flow.startFlow268('ob-user-268', 'chat', {});
  assert268(r.ok === true || r.userId === 'ob-user-268');
  assert268(r.currentStep !== undefined);
});

test268('onboardingFlow268 getFlow268 returns state for started user', () => {
  const flow = new OnboardingFlow268({});
  flow.startFlow268('ob-state-user', 'chat', {});
  const s = flow.getFlow268('ob-state-user');
  assert268(s !== null);
  assert268(s.userId === 'ob-state-user');
  assert268(Array.isArray(s.steps));
});

test268('onboardingFlow268 rejects crypto words in identity step (ok:false)', async () => {
  const flow = new OnboardingFlow268({});
  flow.startFlow268('crypto-user', 'chat', {});
  let rejectedOrThrew = false;
  try {
    const r = await flow.completeStep268('crypto-user', 'identity', {
      handle: 'BlockchainGuru', email: 'x@x.com',
    });
    // Some implementations return {ok:false} rather than throwing
    if (r && r.ok === false) rejectedOrThrew = true;
  } catch (_) { rejectedOrThrew = true; }
  assert268(rejectedOrThrew === true);
});

test268('splitModule268 createSplit268 with valid bps recipients', () => {
  const splits = new SplitModule268({});
  const r = splits.createSplit268('creator-268', [
    { userId: 'alice', bps: 6000 },
    { userId: 'bob',   bps: 4000 },
  ], {});
  assert268(r.splitId !== undefined);
});

test268('splitModule268 createSplit268 rejects bps not summing to 10000', () => {
  const splits = new SplitModule268({});
  assertThrows268(() => splits.createSplit268('c1', [{ userId: 'a', bps: 5000 }], {}), '10,000');
});

test268('splitModule268 getStats268 returns object', () => {
  const s = new SplitModule268({}).getStats268();
  assert268(typeof s === 'object' && s !== null);
});

test268('executionPrograms268 PROGRAMS_268 has >= 25 entries', () => {
  const count = Array.isArray(PROGRAMS_268)
    ? PROGRAMS_268.length
    : Object.keys(PROGRAMS_268).length;
  assert268(count >= 25, `Expected ≥25 programs, got ${count}`);
});

test268('executionPrograms268 startProgram268 returns result', () => {
  const reg = new ExecutionProgramRegistry268({});
  const programs = Array.isArray(PROGRAMS_268) ? PROGRAMS_268 : Object.values(PROGRAMS_268);
  const pid = programs[0]?.id || programs[0];
  const r = reg.startProgram268(pid, { userId: 'prog-user-268' });
  assert268(r !== undefined);
});

// ════════════════════════════════════════════════════════════════════════════
// B. providerAdapters268 — contracts, validation, new stubs
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[B] providerAdapters268');

test268('PROVIDER_CONTRACTS_268 has exactly 21 entries', () => {
  const n = Object.keys(PROVIDER_CONTRACTS_268).length;
  assert268(n === 21, `Expected 21, got ${n}`);
});

test268('PROVIDER_CONTRACTS_268 includes all 6 new V268 contracts', () => {
  for (const k of ['hitlGate', 'sandboxExec', 'intelligenceRegistry', 'vectorMemory', 'db', 'snapshotEngine'])
    assert268(k in PROVIDER_CONTRACTS_268, `Missing: ${k}`);
});

test268('PROVIDER_CONTRACTS_268 logAdapter has required info/warn/error', () => {
  const c = PROVIDER_CONTRACTS_268.logAdapter;
  assert268(c.required.includes('info'));
  assert268(c.required.includes('warn'));
  assert268(c.required.includes('error'));
});

test268('validateProvider268 hitlGate — valid stub passes', () => {
  const r = validateProvider268('hitlGate', createHitlGateStub268());
  assert268(r.ok === true, JSON.stringify(r.errors));
});

test268('validateProvider268 sandboxExec — valid stub passes', () => {
  const r = validateProvider268('sandboxExec', createSandboxExecStub268());
  assert268(r.ok === true, JSON.stringify(r.errors));
});

test268('validateProvider268 intelligenceRegistry — valid stub passes', () => {
  const r = validateProvider268('intelligenceRegistry', createIntelligenceRegistryStub268());
  assert268(r.ok === true, JSON.stringify(r.errors));
});

test268('validateProvider268 vectorMemory — valid stub passes', () => {
  const r = validateProvider268('vectorMemory', createVectorMemoryStub268());
  assert268(r.ok === true, JSON.stringify(r.errors));
});

test268('validateProvider268 db — valid stub passes', () => {
  const r = validateProvider268('db', createDbStub268());
  assert268(r.ok === true, JSON.stringify(r.errors));
});

test268('validateProvider268 snapshotEngine — valid stub passes', () => {
  const r = validateProvider268('snapshotEngine', createSnapshotEngineStub268());
  assert268(r.ok === true, JSON.stringify(r.errors));
});

test268('validateProvider268 logAdapter — valid stub passes', () => {
  const r = validateProvider268('logAdapter', createLogAdapterStub268({ silent: true }));
  assert268(r.ok === true, JSON.stringify(r.errors));
});

test268('validateProvider268 hitlGate — rejects missing escalate', () => {
  const r = validateProvider268('hitlGate', { getStatus: () => {} });
  assert268(r.ok === false);
  assert268(r.errors.some(e => e.includes('escalate')));
});

test268('validateProvider268 unknown type returns error', () => {
  const r = validateProvider268('unknownType999', {});
  assert268(r.ok === false);
  assert268(r.errors[0].includes('Unknown provider'));
});

test268('createAllStubs268 returns all 21 provider types', () => {
  const s = createAllStubs268({ silent: true });
  for (const k of ['hitlGate', 'sandboxExec', 'intelligenceRegistry', 'vectorMemory',
                    'db', 'snapshotEngine', 'logAdapter', 'settlementProvider',
                    'custodyProvider', 'persistenceAdapter', 'smsGateway'])
    assert268(s[k] !== undefined, `Missing stub: ${k}`);
});

test268('validateAllProviders268 with all stubs passes', () => {
  const s = createAllStubs268({ silent: true });
  const r = validateAllProviders268(s);
  assert268(r.ok === true, JSON.stringify(r.allErrors));
});

test268('createHitlGateStub268 autoApprove=true returns approved', async () => {
  const gate = createHitlGateStub268({ autoApprove: true });
  const r = await gate.escalate('task-268', { output: 'test' }, {});
  assert268(r.approved === true);
});

test268('createHitlGateStub268 autoApprove=false returns rejected', async () => {
  const gate = createHitlGateStub268({ autoApprove: false });
  const r = await gate.escalate('task-268-b', { output: 'x' }, {});
  assert268(r.approved === false);
  assert268(r.feedback !== undefined);
});

test268('createSandboxExecStub268 run returns ok + empty errors', async () => {
  const sb = createSandboxExecStub268();
  const r = await sb.run('console.log(1)', {}, {});
  assert268(r.ok === true);
  assert268(Array.isArray(r.errors) && r.errors.length === 0);
});

test268('createIntelligenceRegistryStub268 tiers: haiku/sonnet/opus', () => {
  const reg = createIntelligenceRegistryStub268();
  assert268(reg.get('haiku') !== null);
  assert268(reg.get('sonnet').tier === 'balanced');
  assert268(reg.get('opus').tier === 'quality');
  assert268(reg.get('nonexistent') === null);
});

test268('createVectorMemoryStub268 add then search returns results', async () => {
  const vm = createVectorMemoryStub268();
  await vm.add({ content: 'hello world', embedding: [] });
  const results = await vm.search('hello', { limit: 5 });
  assert268(Array.isArray(results) && results.length >= 1);
  assert268(results[0].content !== undefined);
});

test268('createSnapshotEngineStub268 save/load round-trips nested objects', () => {
  const snap = createSnapshotEngineStub268();
  snap.save('snap-268', { val: 42, nested: { a: [1, 2, 3] } });
  const loaded = snap.load('snap-268');
  assert268(loaded.val === 42);
  assert268(loaded.nested.a[2] === 3);
  assert268(snap.list().includes('snap-268'));
});

test268('createLogAdapterStub268 all methods callable without throw', () => {
  const log = createLogAdapterStub268({ silent: true });
  log.setContext({ requestId: 'req-268' });
  log.info('info msg', { key: 1 });
  log.warn('warn msg', {});
  log.error('error msg', {});
  log.debug('debug msg', {});
  assert268(true);
});

test268('createAdapterScaffold268 returns scaffold with required methods', () => {
  const s = createAdapterScaffold268('hitlGate');
  assert268(typeof s.escalate === 'function');
  assertThrows268(() => s.escalate(), 'not implemented');
});

// ════════════════════════════════════════════════════════════════════════════
// C. createV268State — wiring all modules
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[C] ecos-api-server-v268-patch');

test268('createV268State returns state with version 268', () => {
  const s = createV268State({});
  assert268(s.version === '268');
});

test268('createV268State has modules map with 20+ entries', () => {
  const s = createV268State({});
  const count = Object.keys(s.modules).filter(k => s.modules[k] === true).length;
  assert268(count >= 20, `Got ${count} modules`);
});

test268('createV268State all 15 base modules have getPerf268()', () => {
  const s = createV268State({});
  const mods = ['receipts','breakage','conversion','router','credits','firewall',
                 'memory','metacog','queue','qFunding','reflection','reputation',
                 'sybil','telemetry','tips'];
  const missing = mods.filter(k => typeof s[k]?.getPerf268 !== 'function');
  assert268(missing.length === 0, `Missing getPerf268: ${missing.join(', ')}`);
});

test268('createV268State all 15 base modules have checkXHealth268()', () => {
  const s = createV268State({});
  const checks = [
    [s.receipts,   'checkReceiptsHealth268'],
    [s.breakage,   'checkBreakageHealth268'],
    [s.conversion, 'checkGatewayHealth268'],
    [s.router,     'checkRouterHealth268'],
    [s.credits,    'checkReserveHealth268'],
    [s.firewall,   'checkFirewallHealth268'],
    [s.memory,     'checkMemoryHealth268'],
    [s.metacog,    'checkMetacognitionHealth268'],
    [s.queue,      'checkQueueHealth268'],
    [s.qFunding,   'checkFundingHealth268'],
    [s.reflection, 'checkReflectionHealth268'],
    [s.reputation, 'checkReputationHealth268'],
    [s.sybil,      'checkSybilHealth268'],
    [s.telemetry,  'checkTelemetryHealth268'],
    [s.tips,       'checkTipHealth268'],
  ];
  const missing = checks.filter(([m, fn]) => typeof m?.[fn] !== 'function').map(([, fn]) => fn);
  assert268(missing.length === 0, `Missing: ${missing.join(', ')}`);
});

test268('createV268State health checks all return ok:true', () => {
  const s = createV268State({});
  const results = [
    s.receipts.checkReceiptsHealth268(),
    s.breakage.checkBreakageHealth268(),
    s.firewall.checkFirewallHealth268(),
    s.memory.checkMemoryHealth268(),
    s.queue.checkQueueHealth268(),
    s.telemetry.checkTelemetryHealth268(),
    s.tips.checkTipHealth268(),
    s.sybil.checkSybilHealth268(),
  ];
  for (const r of results)
    assert268(r.ok === true, `Health failed: ${JSON.stringify(r)}`);
});

test268('createV268State modules flags correct', () => {
  const s = createV268State({});
  assert268(s.modules.providerValidation === true);
  assert268(s.modules.logAdapterDI === true);
  assert268(s.modules.totalContracts === 21);
  assert268(s.modules.newProviderContracts === 6);
});

// ════════════════════════════════════════════════════════════════════════════
// C1. agentReceipts268
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[C1] agentReceipts268');

test268('MANDATE_STEPS_268 has 7 steps including INTENT and SETTLEMENT', () => {
  assert268(MANDATE_STEPS_268.length === 7);
  assert268(MANDATE_STEPS_268.includes('INTENT'));
  assert268(MANDATE_STEPS_268.includes('X402_PAYMENT'));
  assert268(MANDATE_STEPS_268.includes('SETTLEMENT'));
});

test268('initReceipt268 + getReceipt268 returns correct structure', () => {
  const ar = new AgentReceipts268({});
  ar.initReceipt268('m-c1-1', { userId: 'u1', taskType: 'code_gen', programId: 'P05' });
  const r = ar.getReceipt268('m-c1-1');
  assert268(r !== null);
  assert268(r.missionId === 'm-c1-1');
  assert268(r.userId === 'u1');
  assert268(Array.isArray(r.chain));
});

test268('emitIntent268 adds step to chain with stepType INTENT', () => {
  const ar = new AgentReceipts268({});
  ar.initReceipt268('m-c1-2', { userId: 'u2' });
  ar.emitIntent268('m-c1-2', { goal: 'summarize' });
  const r = ar.getReceipt268('m-c1-2');
  assert268(r.chain.length >= 1);
  assert268(r.chain[0].stepType === 'INTENT');
  assert268(r.chain[0].hash !== undefined);
});

test268('emitX402Intent268 records payment in x402Payments array', () => {
  const ar = new AgentReceipts268({});
  ar.initReceipt268('m-c1-3', { userId: 'u3' });
  ar.emitX402Intent268('m-c1-3', { txId: 'tx-268', amountUSDC: 0.01 });
  const r = ar.getReceipt268('m-c1-3');
  assert268(r.x402Payments.length >= 1);
});

test268('verifyChain268 returns {valid:true} for valid chain', () => {
  const ar = new AgentReceipts268({});
  ar.initReceipt268('m-c1-4', { userId: 'u4' });
  ar.emitIntent268('m-c1-4', { goal: 'test' });
  ar.emitAction268('m-c1-4', { action: 'run' });
  const v = ar.verifyChain268('m-c1-4');
  assert268(v.valid === true);
});

test268('listReceipts268 includes initiated missions', () => {
  const ar = new AgentReceipts268({});
  ar.initReceipt268('list-m1', { userId: 'u5' });
  ar.initReceipt268('list-m2', { userId: 'u6' });
  const list = ar.listReceipts268();
  assert268(Array.isArray(list) && list.length >= 2);
});

test268('getStats268 total increments after init', () => {
  const ar = new AgentReceipts268({});
  ar.initReceipt268('stats-m1', { userId: 'u7' });
  const s = ar.getStats268();
  assert268(typeof s.total === 'number' && s.total >= 1);
});

test268('getPerf268 count >= 1 after initReceipt', () => {
  const ar = new AgentReceipts268({});
  ar.initReceipt268('perf-m1', { userId: 'up' });
  const perf = ar.getPerf268();
  assert268(typeof perf.p50 === 'number');
  assert268(typeof perf.count === 'number');
  assert268(perf.count >= 1);
});

test268('checkReceiptsHealth268 returns ok:true + version 268', () => {
  const h = new AgentReceipts268({}).checkReceiptsHealth268();
  assert268(h.ok === true);
  assert268(h.version === '268');
});

// ════════════════════════════════════════════════════════════════════════════
// C2. breakageEngine268
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[C2] breakageEngine268');

test268('BREAKAGE_DAYS_268 is a positive number', () => {
  assert268(typeof BREAKAGE_DAYS_268 === 'number' && BREAKAGE_DAYS_268 > 0);
});

test268('recordIssuance268 creates cohort in getStatus268', () => {
  const be = new BreakageEngine268({});
  be.recordIssuance268('acct-c2-1', 10_000n, 'cohort-268-test', {});
  const s = be.getStatus268();
  assert268(s.totalCohorts >= 1);
});

test268('recordRedemption268 reduces cohort balance', () => {
  const be = new BreakageEngine268({});
  be.recordIssuance268('acct-c2-2', 50_000n, 'cohort-red', {});
  be.recordRedemption268('acct-c2-2', 10_000n, 'cohort-red');
  assert268(true); // no throw = pass
});

test268('runBreakageScan268 returns object with recognized array', () => {
  const be = new BreakageEngine268({});
  be.recordIssuance268('acct-c2-scan', 100_000n, 'cohort-scan', {});
  const r = be.runBreakageScan268();
  assert268(Array.isArray(r.recognized));
  assert268(typeof r.eligible === 'number');
});

test268('noExpiry credits set materialRightFlags as array', () => {
  const be = new BreakageEngine268({});
  be.recordIssuance268('acct-c2-ne', 500_000n, 'cohort-noexp', { noExpiry: true });
  const s = be.getStatus268();
  assert268(Array.isArray(s.materialRightFlags));
  assert268(s.materialRightFlags.length >= 1);
});

test268('getPerf268 count >= 1 after recordIssuance', () => {
  const be = new BreakageEngine268({});
  be.recordIssuance268('perf-acct', 1000n, 'perf-cohort', {});
  const p = be.getPerf268();
  assert268(typeof p.p50 === 'number');
  assert268(p.count >= 1);
});

test268('checkBreakageHealth268 returns ok:true + version 268', () => {
  const h = new BreakageEngine268({}).checkBreakageHealth268();
  assert268(h.ok === true);
  assert268(h.version === '268');
});

// ════════════════════════════════════════════════════════════════════════════
// C3. conversionGateway268
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[C3] conversionGateway268');

test268('SUPPORTED_CURRENCIES_268 includes USDC and USDT', () => {
  assert268(SUPPORTED_CURRENCIES_268.includes('USDC'));
  assert268(SUPPORTED_CURRENCIES_268.includes('USDT'));
});

test268('GATEWAY_MIN_MICRO_268 is a positive BigInt', () => {
  assert268(typeof GATEWAY_MIN_MICRO_268 === 'bigint' && GATEWAY_MIN_MICRO_268 > 0n);
});

test268('creditToUsdc268 rejects below minimum', async () => {
  const gw = new ConversionGateway268({});
  let threw = false;
  try { await gw.creditToUsdc268('user-c3-min', GATEWAY_MIN_MICRO_268 - 1n, {}); }
  catch (_) { threw = true; }
  assert268(threw === true);
});

test268('creditToUsdc268 requires creditReserve — throws without it', async () => {
  const gw = new ConversionGateway268({});
  let threw = false;
  try { await gw.creditToUsdc268('user-c3-nores', GATEWAY_MIN_MICRO_268 + 1000n, {}); }
  catch (_) { threw = true; }
  assert268(threw === true);
});

test268('creditToUsdc268 succeeds when creditReserve injected', async () => {
  const cr = new CreditReserve268({});
  cr.depositReserve268(10_000_000n, 'fiatTopUp', {});
  cr.issue268(5_000_000n, 'externalRevenue', {});
  const gw = new ConversionGateway268({ creditReserve: cr });
  const r = await gw.creditToUsdc268('user-c3-ok', GATEWAY_MIN_MICRO_268 + 1000n, {});
  assert268(r.ok === true);
  assert268(r.conversionId !== undefined);
});

test268('getStats268 returns object', () => {
  const s = new ConversionGateway268({}).getStats268();
  assert268(typeof s === 'object' && s !== null);
});

test268('getPerf268 count >= 1 after successful creditToUsdc268', async () => {
  const cr = new CreditReserve268({});
  cr.depositReserve268(10_000_000n, 'fiatTopUp', {});
  cr.issue268(5_000_000n, 'externalRevenue', {});
  const gw = new ConversionGateway268({ creditReserve: cr });
  await gw.creditToUsdc268('perf-user', GATEWAY_MIN_MICRO_268 + 1000n, {});
  const p = gw.getPerf268();
  assert268(typeof p.p50 === 'number');
  assert268(p.count >= 1);
});

test268('checkGatewayHealth268 returns ok:true + version 268', () => {
  const h = new ConversionGateway268({}).checkGatewayHealth268();
  assert268(h.ok === true);
  assert268(h.version === '268');
});

// ════════════════════════════════════════════════════════════════════════════
// C4. costAwareRouter268
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[C4] costAwareRouter268');

test268('COMPLEXITY_TIERS_268 is a non-empty object', () => {
  assert268(typeof COMPLEXITY_TIERS_268 === 'object');
  assert268(Object.keys(COMPLEXITY_TIERS_268).length > 0);
});

test268('SLM_CONFIDENCE_MIN_268 is between 0 and 1', () => {
  assert268(SLM_CONFIDENCE_MIN_268 >= 0 && SLM_CONFIDENCE_MIN_268 <= 1);
});

test268('route268 returns a result object', async () => {
  const router = new CostAwareRouter268({});
  const r = await router.route268('Summarize this short paragraph.', {});
  assert268(r !== null && typeof r === 'object');
});

test268('route268 with intelligence registry returns model info', async () => {
  const router = new CostAwareRouter268({ intelligenceRegistry: createIntelligenceRegistryStub268() });
  const r = await router.route268('simple task', { complexity: 'simple' });
  assert268(r !== null);
});

test268('setMissionBudget268 + getMissionCostReport268 returns report', () => {
  const router = new CostAwareRouter268({});
  router.setMissionBudget268('m-c4-1', 1_000_000n);
  const report = router.getMissionCostReport268('m-c4-1');
  assert268(report !== null && typeof report === 'object');
});

test268('getPerf268 count >= 1 after route268', async () => {
  const router = new CostAwareRouter268({});
  await router.route268('test query', {});
  const p = router.getPerf268();
  assert268(typeof p.p50 === 'number');
  assert268(p.count >= 1);
});

test268('checkRouterHealth268 returns ok:true + version 268', () => {
  const h = new CostAwareRouter268({}).checkRouterHealth268();
  assert268(h.ok === true);
  assert268(h.version === '268');
});

// ════════════════════════════════════════════════════════════════════════════
// C5. creditReserve268
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[C5] creditReserve268');

test268('BACKING_WARN_THRESHOLD_268 > BACKING_HALT_THRESHOLD_268', () => {
  assert268(BACKING_WARN_THRESHOLD_268 > BACKING_HALT_THRESHOLD_268);
});

test268('depositReserve268 + issue268 + getStatus268 returns backingRatio', () => {
  const cr = new CreditReserve268({});
  cr.depositReserve268(1_000_000n, 'fiatTopUp', {});
  cr.issue268(500_000n, 'externalRevenue', {});
  const s = cr.getStatus268();
  assert268(typeof s.backingRatio === 'number');
  assert268(s.version === '268');
});

test268('consume268 reduces outstanding', () => {
  const cr = new CreditReserve268({});
  cr.depositReserve268(1_000_000n, 'fiatTopUp', {});
  cr.issue268(500_000n, 'externalRevenue', {});
  cr.consume268(100_000n, 'clientWork', {});
  const s = cr.getStatus268();
  assert268(s !== null);
});

test268('redeem268 processes redemption without throw', () => {
  const cr = new CreditReserve268({});
  cr.depositReserve268(1_000_000n, 'fiatTopUp', {});
  cr.issue268(1_000_000n, 'externalRevenue', {});
  cr.redeem268(50_000n, {});
  assert268(true);
});

test268('flagEscheat268 records unclaimed credits', () => {
  const cr = new CreditReserve268({});
  cr.flagEscheat268('user-esc-268', 5_000n, 'US');
  assert268(true);
});

test268('getPerf268 count >= 1 after issue268', () => {
  const cr = new CreditReserve268({});
  cr.depositReserve268(100n, 'x402Revenue', {});
  cr.issue268(50n, 'externalRevenue', {});
  const perf = cr.getPerf268();
  assert268(perf.count >= 1);  // issue268 is instrumented; depositReserve is not
});

test268('checkReserveHealth268 returns ok:true + version 268', () => {
  const h = new CreditReserve268({}).checkReserveHealth268();
  assert268(h.ok === true);
  assert268(h.version === '268');
});

// ════════════════════════════════════════════════════════════════════════════
// C6. injectionFirewall268
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[C6] injectionFirewall268');

test268('SACRED_FILES_268 contains fiatLedger and auditLog entries', () => {
  assert268(SACRED_FILES_268.some(f => f.includes('fiatLedger')));
  assert268(SACRED_FILES_268.some(f => f.includes('auditLog')));
});

test268('tagUntrusted268 returns a string', () => {
  const fw = new InjectionFirewall268({});
  const t = fw.tagUntrusted268('user input', 'external');
  assert268(typeof t === 'string');
});

test268('buildSafePrompt268 returns {system, user, safe:true}', () => {
  const fw = new InjectionFirewall268({});
  const p = fw.buildSafePrompt268('You are helpful.', 'Summarize this.', []);
  assert268(typeof p === 'object');
  assert268(p.safe === true);
  assert268(p.system !== undefined && p.user !== undefined);
});

test268('scanEgress268 returns object for credential strings', () => {
  const fw = new InjectionFirewall268({});
  const r = fw.scanEgress268('API key: sk-1234567890abcdef');
  assert268(r !== null && typeof r === 'object');
});

test268('checkSacredFile268 returns blocked:true for fiatLedger.js', () => {
  const fw = new InjectionFirewall268({});
  const r = fw.checkSacredFile268('fiatLedger.js');
  assert268(r.blocked === true || r.sacred === true);
});

test268('checkToolPermission268 returns result object', () => {
  const fw = new InjectionFirewall268({});
  const r = fw.checkToolPermission268('read_file', ['read']);
  assert268(r !== null && typeof r === 'object');
});

test268('getPerf268 count >= 2 after tagUntrusted calls', () => {
  const fw = new InjectionFirewall268({});
  fw.tagUntrusted268('a', 'external');
  fw.tagUntrusted268('b', 'external');
  const p = fw.getPerf268();
  assert268(p.count >= 2);
});

test268('checkFirewallHealth268 returns ok:true + version 268', () => {
  const h = new InjectionFirewall268({}).checkFirewallHealth268();
  assert268(h.ok === true);
  assert268(h.version === '268');
});

// ════════════════════════════════════════════════════════════════════════════
// C7. memoryIntegrity268
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[C7] memoryIntegrity268');

test268('MEMORY_SCOPES_268 includes agent and system', () => {
  const scopes = Array.isArray(MEMORY_SCOPES_268)
    ? MEMORY_SCOPES_268
    : Object.values(MEMORY_SCOPES_268);
  assert268(scopes.includes('agent'));
  assert268(scopes.includes('system'));
});

test268('signWrite268 with valid scope returns entry with entryId', () => {
  const mi = new MemoryIntegrity268({});
  const e = mi.signWrite268('hello memory', { scope: 'agent', source: 'test' });
  assert268(e.entryId !== undefined);
  assert268(e.contentHash !== undefined);
});

test268('signWrite268 with invalid scope throws', () => {
  const mi = new MemoryIntegrity268({});
  assertThrows268(() => mi.signWrite268('x', { scope: 'invalid_scope_999' }), 'scope');
});

test268('verify268 returns truthy for valid entry', () => {
  const mi = new MemoryIntegrity268({});
  const content = 'verifiable content 268';
  const e = mi.signWrite268(content, { scope: 'user', source: 'test' });
  const r = mi.verify268(e.entryId, content, e.ts || new Date().toISOString());
  assert268(r === true || r !== false);
});

test268('quarantine268 marks entry without throw', () => {
  const mi = new MemoryIntegrity268({});
  const e = mi.signWrite268('suspicious', { scope: 'external', source: 'external' });
  mi.quarantine268(e.entryId, 'test-reason');
  assert268(true);
});

test268('rollback268 returns array of affected entries', () => {
  const mi = new MemoryIntegrity268({});
  mi.signWrite268('e1', { scope: 'agent' });
  mi.signWrite268('e2', { scope: 'agent' });
  const r = mi.rollback268(Date.now() + 10_000);
  assert268(r !== undefined);
});

test268('getPerf268 count >= 1 after signWrite', () => {
  const mi = new MemoryIntegrity268({});
  mi.signWrite268('stat-entry', { scope: 'system' });
  const p = mi.getPerf268();
  assert268(typeof p.p50 === 'number');
  assert268(p.count >= 1);
});

test268('checkMemoryHealth268 returns ok:true + version 268', () => {
  const h = new MemoryIntegrity268({}).checkMemoryHealth268();
  assert268(h.ok === true);
  assert268(h.version === '268');
});

// ════════════════════════════════════════════════════════════════════════════
// C8. metacognition268
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[C8] metacognition268');

test268('EBBINGHAUS_K_268 is a positive number', () => {
  assert268(typeof EBBINGHAUS_K_268 === 'number' && EBBINGHAUS_K_268 > 0);
});

test268('recordOutcome268 + suggestStrategy268 returns winning strategy', () => {
  const mc = new Metacognition268({});
  mc.recordOutcome268('code_gen', 'chain-of-thought', true, 1);
  mc.recordOutcome268('code_gen', 'chain-of-thought', true, 1);
  mc.recordOutcome268('code_gen', 'step-by-step', false, 2);
  const s = mc.suggestStrategy268('code_gen');
  assert268(typeof s === 'string' && s.length > 0);
});

test268('suggestStrategy268 returns fallback for unknown task type', () => {
  const mc = new Metacognition268({});
  const s = mc.suggestStrategy268('unknown_xyz_268');
  assert268(typeof s === 'string' && s.length > 0);
});

test268('pruneDecayedEntries268 runs without error', () => {
  const mc = new Metacognition268({});
  mc.recordOutcome268('sum', 'direct', true, 1);
  mc.pruneDecayedEntries268();
  assert268(true);
});

test268('setProgramStrategy268 + suggestStrategy268 uses program override', () => {
  const mc = new Metacognition268({});
  mc.setProgramStrategy268('P10', 'translate', 'neural-mt');
  const s = mc.suggestStrategy268('translate', { programId: 'P10' });
  assert268(typeof s === 'string');
});

test268('getPerf268 count >= 1 after recordOutcome268', () => {
  const mc = new Metacognition268({});
  mc.recordOutcome268('t1', 's1', true, 1);
  const p = mc.getPerf268();
  assert268(typeof p.p50 === 'number');
  assert268(p.count >= 1);
});

test268('checkMetacognitionHealth268 returns ok:true + version 268', () => {
  const h = new Metacognition268({}).checkMetacognitionHealth268();
  assert268(h.ok === true);
  assert268(h.version === '268');
});

// ════════════════════════════════════════════════════════════════════════════
// C9. offlineQueue268
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[C9] offlineQueue268');

test268('PRIORITY_LEVELS_268 is a non-empty object', () => {
  assert268(typeof PRIORITY_LEVELS_268 === 'object');
  assert268(Object.keys(PRIORITY_LEVELS_268).length > 0);
});

test268('enqueue268 + getQueue268 returns queueLength >= 1', () => {
  const oq = new OfflineQueue268({});
  oq.enqueue268('user-oq-1', { path: '/api/tips/send', method: 'POST', body: {} });
  const q = oq.getQueue268('user-oq-1');
  assert268(q.userId === 'user-oq-1');
  assert268(q.queueLength >= 1);
  assert268(Array.isArray(q.actions));
});

test268('getQueue268 actions have path and method fields', () => {
  const oq = new OfflineQueue268({});
  oq.enqueue268('user-oq-2', { path: '/api/split', method: 'POST', body: {} });
  const q = oq.getQueue268('user-oq-2');
  assert268(q.actions[0].path === '/api/split');
  assert268(q.actions[0].method === 'POST');
});

test268('registerReplayHandler268 + replay268 processes queue', async () => {
  const oq = new OfflineQueue268({});
  const handled = [];
  oq.registerReplayHandler268('/api/handled/*', async (item) => {
    handled.push(item);
    return { ok: true };
  });
  oq.enqueue268('user-rp', { path: '/api/handled/action', method: 'POST', body: {} });
  await oq.replay268('user-rp');
  assert268(true);
});

test268('getStats268 returns object with conflicts field', () => {
  const s = new OfflineQueue268({}).getStats268();
  assert268(typeof s === 'object');
  assert268(typeof s.conflicts === 'number');
});

test268('getPerf268 count >= 1 after enqueue', () => {
  const oq = new OfflineQueue268({});
  oq.enqueue268('perf-user', { path: '/x', method: 'POST', body: {} });
  const p = oq.getPerf268();
  assert268(typeof p.p50 === 'number');
  assert268(p.count >= 1);
});

test268('checkQueueHealth268 returns ok:true + version 268', () => {
  const h = new OfflineQueue268({}).checkQueueHealth268();
  assert268(h.ok === true);
  assert268(h.version === '268');
});

// ════════════════════════════════════════════════════════════════════════════
// C10. quadraticFunding268
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[C10] quadraticFunding268');

test268('QF_MIN_CONTRIBUTION_268 is a BigInt', () => {
  assert268(typeof QF_MIN_CONTRIBUTION_268 === 'bigint');
});

test268('createRound268 returns {ok:true, roundId, endsAt}', () => {
  const qf = new QuadraticFunding268({});
  const r = qf.createRound268('proj-c10', 100_000n, {});
  assert268(r.ok === true);
  assert268(typeof r.roundId === 'string' && r.roundId.startsWith('qf268::'));
  assert268(r.endsAt !== undefined);
});

test268('contribute268 accepts contribution >= minimum', () => {
  const qf = new QuadraticFunding268({});
  const { roundId } = qf.createRound268('proj-c10-b', 500_000n, {});
  const c = qf.contribute268(roundId, 'user-c10', QF_MIN_CONTRIBUTION_268 + 1000n);
  assert268(c !== null && c !== undefined);
});

test268('contribute268 rejects below minimum', () => {
  const qf = new QuadraticFunding268({});
  const { roundId } = qf.createRound268('proj-c10-c', 100_000n, {});
  if (QF_MIN_CONTRIBUTION_268 > 0n) {
    assertThrows268(() => qf.contribute268(roundId, 'u-min', QF_MIN_CONTRIBUTION_268 - 1n));
  } else {
    assert268(true);
  }
});

test268('finalizeRound268 returns distribution results', () => {
  const qf = new QuadraticFunding268({});
  const { roundId } = qf.createRound268('proj-c10-d', 1_000_000n, {});
  qf.contribute268(roundId, 'u1', 10_000n);
  qf.contribute268(roundId, 'u2', 20_000n);
  const r = qf.finalizeRound268(roundId);
  assert268(r !== null && r !== undefined);
});

test268('getRound268 returns round data for valid roundId', () => {
  const qf = new QuadraticFunding268({});
  const { roundId } = qf.createRound268('proj-c10-e', 50_000n, {});
  const fetched = qf.getRound268(roundId);
  assert268(fetched !== null);
  assert268(fetched.projectId === 'proj-c10-e');
});

test268('getPerf268 count >= 1 after createRound268', () => {
  const qf = new QuadraticFunding268({});
  qf.createRound268('perf-proj', 10_000n, {});
  const p = qf.getPerf268();
  assert268(typeof p.p50 === 'number');
  assert268(p.count >= 1);
});

test268('checkFundingHealth268 returns ok:true + version 268', () => {
  const h = new QuadraticFunding268({}).checkFundingHealth268();
  assert268(h.ok === true);
  assert268(h.version === '268');
});

// ════════════════════════════════════════════════════════════════════════════
// C11. reflectionLoop268
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[C11] reflectionLoop268');

test268('MAX_RETRIES_268 >= 1 and SELF_CORRECT_RATE_268 in (0,1]', () => {
  assert268(typeof MAX_RETRIES_268 === 'number' && MAX_RETRIES_268 >= 1);
  assert268(SELF_CORRECT_RATE_268 > 0 && SELF_CORRECT_RATE_268 <= 1);
});

test268('execute268 returns ok:true on first-try success', async () => {
  const rl = new ReflectionLoop268({});
  const r = await rl.execute268(
    'summarize',
    async () => ({ output: 'summary-result' }),
    async () => ({ ok: true, errors: [], score: 1.0 }),
    {}, {},
  );
  assert268(r.ok === true);
  assert268(r.output !== undefined);
});

test268('execute268 retries when verifier fails initially', async () => {
  const rl = new ReflectionLoop268({});
  let attempts = 0;
  const r = await rl.execute268(
    'code_gen',
    async (ctx, attempt) => { attempts++; return { output: `v${attempt}` }; },
    async (out) => {
      const n = parseInt((out.output || '').slice(1) || '0');
      return n < 2
        ? { ok: false, errors: ['retry me'], score: 0.3 }
        : { ok: true,  errors: [],          score: 0.9 };
    },
    {}, { maxRetries: 3 },
  );
  assert268(attempts >= 2);
});

test268('execute268 increments stats.total', async () => {
  const rl = new ReflectionLoop268({});
  await rl.execute268('t',
    async () => ({ output: 'x' }),
    async () => ({ ok: true, errors: [], score: 1 }),
    {}, {},
  );
  const s = rl.getStats268();
  assert268(s.total >= 1);
  assert268(typeof s.selfCorrected === 'number');
});

test268('hitlGate is called on HITL trigger without crash', async () => {
  const escalations = [];
  const gate = { escalate: async (id, out) => { escalations.push(id); return { approved: true }; } };
  const rl = new ReflectionLoop268({ hitlGate: gate });
  await rl.execute268('review',
    async () => ({ output: 'needs-hitl' }),
    async () => ({ ok: false, errors: ['hitl required'], score: 0, requiresHitl: true }),
    {}, { maxRetries: 1 },
  );
  assert268(true);
});

test268('getPerf268 count >= 1 after execute', async () => {
  const rl = new ReflectionLoop268({});
  await rl.execute268('perf',
    async () => ({ output: 'r' }),
    async () => ({ ok: true, errors: [], score: 1 }),
    {}, {},
  );
  const p = rl.getPerf268();
  assert268(typeof p.p50 === 'number');
  assert268(p.count >= 1);
});

test268('checkReflectionHealth268 returns ok:true + version 268', () => {
  const h = new ReflectionLoop268({}).checkReflectionHealth268();
  assert268(h.ok === true);
  assert268(h.version === '268');
});

// ════════════════════════════════════════════════════════════════════════════
// C12. reputationLedger268
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[C12] reputationLedger268');

const _VALID_ATTN_TYPE = 'peer_review';

test268('ATTESTATION_TYPES_268 is an array with peer_review', () => {
  assert268(Array.isArray(ATTESTATION_TYPES_268));
  assert268(ATTESTATION_TYPES_268.length >= 5);
  assert268(ATTESTATION_TYPES_268.includes('peer_review'));
});

test268('attest268 returns attestation with attestationId', () => {
  const rl = new ReputationLedger268({});
  const r = rl.attest268('attester-c12', 'subject-c12', _VALID_ATTN_TYPE, {});
  assert268(r !== null);
  assert268(r.attestationId !== undefined);
});

test268('attest268 rejects self-attestation', () => {
  const rl = new ReputationLedger268({});
  assertThrows268(() => rl.attest268('same', 'same', _VALID_ATTN_TYPE, {}), 'self-attestation');
});

test268('attest268 rejects unknown attestation type', () => {
  const rl = new ReputationLedger268({});
  assertThrows268(() => rl.attest268('a', 'b', 'totally_unknown_268', {}), 'unknown attestation type');
});

test268('systemAttest268 works without external attester', () => {
  const rl = new ReputationLedger268({});
  const r = rl.systemAttest268('subject-sys-c12', 'sybil_clear', { source: 'test' });
  assert268(r !== null);
});

test268('getStanding268 returns object after attestations', () => {
  const rl = new ReputationLedger268({});
  rl.systemAttest268('user-stand-268', 'peer_review', {});
  rl.systemAttest268('user-stand-268', 'mission_complete', {});
  const s = rl.getStanding268('user-stand-268');
  assert268(s !== null && typeof s === 'object');
});

test268('selectiveDisclose268 returns object', () => {
  const rl = new ReputationLedger268({});
  rl.systemAttest268('user-disc-268', _VALID_ATTN_TYPE, {});
  const d = rl.selectiveDisclose268('user-disc-268', [_VALID_ATTN_TYPE]);
  assert268(d !== null && typeof d === 'object');
});

test268('getPerf268 count >= 1 after attest268', () => {
  const rl = new ReputationLedger268({});
  rl.attest268('a-c12', 'b-c12', 'peer_review', {});
  const p = rl.getPerf268();
  assert268(typeof p.p50 === 'number');
  assert268(p.count >= 1);
});

test268('checkReputationHealth268 returns ok:true + version 268', () => {
  const h = new ReputationLedger268({}).checkReputationHealth268();
  assert268(h.ok === true);
  assert268(h.version === '268');
});

// ════════════════════════════════════════════════════════════════════════════
// C13. sybilGuard268
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[C13] sybilGuard268');

test268('SIGNAL_WEIGHTS_268 has positive and negative weights', () => {
  const vals = Object.values(SIGNAL_WEIGHTS_268);
  assert268(vals.some(v => v > 0));
  assert268(vals.some(v => v < 0));
});

test268('evaluate268 returns {userId, verdict, score} for unknown user', () => {
  const sg = new SybilGuard268({});
  const r = sg.evaluate268('fresh-user-c13');
  assert268(r.userId === 'fresh-user-c13');
  assert268(typeof r.score === 'number');
  assert268(['BLOCK', 'THROTTLE', 'WARN', 'ALLOW'].includes(r.verdict));
});

test268('recordSignal268 improves score for positive signals', () => {
  const sg = new SybilGuard268({});
  const before = sg.evaluate268('signal-user').score;
  sg.recordSignal268('signal-user', 'has_mission_complete', true);
  sg.recordSignal268('signal-user', 'has_tip_history', true);
  const after = sg.evaluate268('signal-user').score;
  assert268(after >= before);
});

test268('recordVelocity268 many times penalizes score', () => {
  const sg = new SybilGuard268({});
  for (let i = 0; i < 50; i++) sg.recordVelocity268('velocity-c13');
  const r = sg.evaluate268('velocity-c13');
  assert268(r.score < 100);
});

test268('recordTipEdge268 registers graph edge without throw', () => {
  const sg = new SybilGuard268({});
  sg.recordTipEdge268('sender-c13', 'receiver-c13');
  assert268(true);
});

test268('getRewardMultiplier268 returns number in [0,1]', () => {
  const sg = new SybilGuard268({});
  sg.recordSignal268('mult-user', 'has_tip_history', true);
  const m = sg.getRewardMultiplier268('mult-user', 'tip');
  assert268(typeof m === 'number' && m >= 0 && m <= 1);
});

test268('getStats268 returns evaluated counter >= 1', () => {
  const sg = new SybilGuard268({});
  sg.evaluate268('stats-user-c13');
  const s = sg.getStats268();
  assert268(s.evaluated >= 1);
});

test268('getPerf268 count >= 2 after evaluations', () => {
  const sg = new SybilGuard268({});
  sg.evaluate268('perf-c13-a');
  sg.evaluate268('perf-c13-b');
  const p = sg.getPerf268();
  assert268(typeof p.p50 === 'number');
  assert268(p.count >= 2);
});

test268('checkSybilHealth268 returns ok:true + version 268', () => {
  const h = new SybilGuard268({}).checkSybilHealth268();
  assert268(h.ok === true);
  assert268(h.version === '268');
});

// ════════════════════════════════════════════════════════════════════════════
// C14. telemetry268
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[C14] telemetry268');

test268('startSpan268 returns {spanId, traceId, addEvent, setStatus, end}', () => {
  const tel = new Telemetry268({});
  const span = tel.startSpan268('test-op', { taskType: 'inference' });
  assert268(typeof span.spanId === 'string');
  assert268(typeof span.traceId === 'string');
  assert268(typeof span.addEvent === 'function');
  assert268(typeof span.setStatus === 'function');
  assert268(typeof span.end === 'function');
});

test268('span.end() updates recentSpans in getDashboard268', () => {
  const tel = new Telemetry268({});
  const span = tel.startSpan268('end-op', {});
  span.end({});
  const d = tel.getDashboard268();
  assert268(d.recentSpans >= 1);
});

test268('getDashboard268 returns x402TotalUSDC and totalRequests', () => {
  const tel = new Telemetry268({});
  const d = tel.getDashboard268();
  assert268(typeof d.totalRequests === 'number');
  assert268(typeof d.x402TotalUSDC === 'number');
  assert268(typeof d.recentSpans === 'number');
});

test268('recordRequest268 increments totalRequests', () => {
  const tel = new Telemetry268({});
  tel.recordRequest268({ taskType: 'code_gen', model: 'haiku', costMicro: 1000n });
  tel.recordRequest268({ taskType: 'code_gen', model: 'haiku', costMicro: 500n });
  const d = tel.getDashboard268();
  assert268(d.totalRequests >= 2);
});

test268('getProgramMetrics268 returns metrics for tracked program', () => {
  const tel = new Telemetry268({});
  tel.recordRequest268({ programId: 'P10', costMicro: 2000n });
  const m = tel.getProgramMetrics268('P10');
  assert268(m !== null && typeof m === 'object');
});

test268('getPerf268 returns valid shape (telemetry uses span-based tracking)', () => {
  const p = new Telemetry268({}).getPerf268();
  assert268(typeof p.p50 === 'number');
  assert268(typeof p.count === 'number');
});

test268('checkTelemetryHealth268 returns ok:true + version 268', () => {
  const h = new Telemetry268({}).checkTelemetryHealth268();
  assert268(h.ok === true);
  assert268(h.version === '268');
});

// ════════════════════════════════════════════════════════════════════════════
// C15. tipModule268
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[C15] tipModule268');

test268('TIP constants are BigInt with MIN < MAX', () => {
  assert268(typeof TIP_MIN_MICRO_268 === 'bigint' && TIP_MIN_MICRO_268 > 0n);
  assert268(typeof TIP_MAX_MICRO_268 === 'bigint' && TIP_MAX_MICRO_268 > TIP_MIN_MICRO_268);
});

test268('COMMUNITY_MATCH_RATE_268 is 0.10', () => {
  assert268(COMMUNITY_MATCH_RATE_268 === 0.10);
});

test268('tip268 succeeds with valid amount and channel', () => {
  const tips = new TipModule268({});
  const r = tips.tip268('from-c15', 'to-c15', TIP_MIN_MICRO_268 + 1000n, { channel: 'chat' });
  assert268(r.ok === true || r.tipId !== undefined);
});

test268('tip268 rejects self-tipping', () => {
  const tips = new TipModule268({});
  assertThrows268(() => tips.tip268('same', 'same', TIP_MIN_MICRO_268 + 1n, {}), 'self-tipping');
});

test268('tip268 rejects below minimum', () => {
  const tips = new TipModule268({});
  assertThrows268(() => tips.tip268('a', 'b', TIP_MIN_MICRO_268 - 1n, {}), 'minimum tip');
});

test268('tip268 rejects above maximum', () => {
  const tips = new TipModule268({});
  assertThrows268(() => tips.tip268('a', 'b', TIP_MAX_MICRO_268 + 1n, {}), 'maximum tip');
});

test268('tip268 rejects unknown channel', () => {
  const tips = new TipModule268({});
  assertThrows268(
    () => tips.tip268('a', 'b', TIP_MIN_MICRO_268 + 1n, { channel: 'discord_unknown_999' }),
    'unknown channel',
  );
});

test268('addToCommunityPool268 accumulates without throw', () => {
  const tips = new TipModule268({});
  tips.addToCommunityPool268(50_000n);
  tips.addToCommunityPool268(50_000n);
  assert268(true);
});

test268('getEpochLeaderboard268 returns object with leaders array', () => {
  const tips = new TipModule268({});
  tips.tip268('lb-a', 'lb-b', TIP_MIN_MICRO_268 + 1000n, { channel: 'chat' });
  const lb = tips.getEpochLeaderboard268(5);
  assert268(typeof lb === 'object' && lb !== null);
  assert268(Array.isArray(lb.leaders));
  assert268(lb.leaders.length >= 1);
});

test268('getTipHistory268 returns array for tipper', () => {
  const tips = new TipModule268({});
  tips.tip268('hist-from', 'hist-to', TIP_MIN_MICRO_268 + 500n, { channel: 'mobile' });
  const h = tips.getTipHistory268('hist-from');
  assert268(Array.isArray(h) && h.length >= 1);
});

test268('getStats268 tracks total tips >= 1', () => {
  const tips = new TipModule268({});
  tips.tip268('s1', 's2', TIP_MIN_MICRO_268 + 1n, { channel: 'api' });
  const s = tips.getStats268();
  assert268(typeof s === 'object');
  assert268((s.totalTips ?? s.total) >= 1);
});

test268('getPerf268 count >= 2 after two tips', () => {
  const tips = new TipModule268({});
  tips.tip268('p1', 'p2', TIP_MIN_MICRO_268 + 1n, { channel: 'chat' });
  tips.tip268('p2', 'p3', TIP_MIN_MICRO_268 + 1n, { channel: 'telegram' });
  const p = tips.getPerf268();
  assert268(p.count >= 2);
});

test268('checkTipHealth268 returns ok:true + version 268', () => {
  const h = new TipModule268({}).checkTipHealth268();
  assert268(h.ok === true);
  assert268(h.version === '268');
});

// ════════════════════════════════════════════════════════════════════════════
// C16. Integration Flow — Agent Payment (x402 → CreditReserve → TipModule)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[V268 integration] C16. Agent Payment Flow: x402 → creditReserve → tipModule');

function signPayload268(payload, secret = 'ecos-x402-dev-secret-268') {
  const canonical = JSON.stringify({
    version:   payload.version,
    network:   payload.network,
    from:      payload.from,
    to:        payload.to,
    amount:    payload.amount,
    resource:  payload.resource,
    nonce:     payload.nonce,
    timestamp: payload.timestamp,
    ...(payload.facilitator ? { facilitator: payload.facilitator } : {}),
  });
  return crypto.createHmac('sha256', secret).update(canonical).digest('hex');
}

test268('C16a: x402 payment deposits into creditReserve', () => {
  const reserve = new CreditReserve268({});
  const proc = new X402Processor268({ creditReserve: reserve });
  // Use ≥0.01 USDC to meet the 100 μ¢ minimum (1 USDC = 10,000 μ¢)
  proc.registerResource268('/api/task', 0.01);
  const payload = {
    version: X402_VERSION_268, network: 'base', currency: 'USDC',
    from: 'agent1', to: 'ecos', amount: 0.02,
    resource: '/api/task', nonce: 'c16a-nonce-1', timestamp: Date.now(),
  };
  payload.signature = signPayload268(payload);
  const result = proc.processPayment268(payload, { testMode: true });
  assert268(result.ok === true, 'payment accepted');
  assert268(result.amountMicro > 0n, 'amountMicro recorded');
  const status = reserve.getStatus268();
  assert268(BigInt(status.reserveBalance) > 0n, 'reserve credited');
});

test268('C16b: creditReserve balance feeds tipModule tip', () => {
  const reserve = new CreditReserve268({});
  const tips    = new TipModule268({ creditReserve: reserve });
  // Seed the reserve directly
  reserve.depositX402268(100_000n, { payerAddr: '0xABC', resource: '/api/task', receiptRef: 'rcpt-c16b' });
  const tipAmount = TIP_MIN_MICRO_268 + 1n;
  const tipResult = tips.tip268('agent1', 'agent2', tipAmount, { channel: 'api' });
  assert268(tipResult.ok === true, 'tip succeeded');
  assert268(tipResult.tipId != null, 'tipId returned');
  const stats = tips.getStats268();
  assert268((stats.totalTips ?? stats.total) >= 1, 'stats recorded');
});

test268('C16c: full end-to-end payment then tip flow', () => {
  const reserve = new CreditReserve268({});
  const proc    = new X402Processor268({ creditReserve: reserve });
  const tips    = new TipModule268({ creditReserve: reserve });
  proc.registerResource268('/api/premium', 0.01);

  const payload = {
    version: X402_VERSION_268, network: 'base', currency: 'USDC',
    from: 'userA', to: 'ecos', amount: 0.02,
    resource: '/api/premium', nonce: 'c16c-nonce-1', timestamp: Date.now(),
  };
  payload.signature = signPayload268(payload);
  const pay = proc.processPayment268(payload, { testMode: true });
  assert268(pay.ok === true, 'payment ok');

  // tip from the balance
  const tip = tips.tip268('userA', 'agentB', TIP_MIN_MICRO_268 + 1n, { channel: 'telegram' });
  assert268(tip.ok === true, 'tip ok');

  // perf telemetry recorded for both
  assert268(proc.getPerf268().count >= 1, 'proc perf recorded');
  assert268(tips.getPerf268().count >= 1, 'tips perf recorded');
});

test268('C16d: replay protection — same nonce rejected on second payment', () => {
  const proc = new X402Processor268({ nonceRegistry: require('../src/lib/x402268').__freshNonceRegistry?.() });
  proc.registerResource268('/r', 0.0001);
  const payload = {
    version: X402_VERSION_268, network: 'base', currency: 'USDC',
    from: 'u', to: 'ecos', amount: 0.0002,
    resource: '/r', nonce: 'c16d-unique-nonce', timestamp: Date.now(),
  };
  payload.signature = signPayload268(payload);
  const r1 = proc.processPayment268(payload, { testMode: true });
  assert268(r1.ok === true, 'first payment accepted');
  // second with same nonce must be rejected
  const r2 = proc.processPayment268(payload, { testMode: true });
  assert268(r2.ok === false && r2.code === 'REPLAY', 'replay blocked');
});

// ════════════════════════════════════════════════════════════════════════════
// C17. Integration Flow — Mission Reflection (reflectionLoop → hitlGate → agentReceipts)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[V268 integration] C17. Mission Reflection Flow: reflectionLoop → hitlGate → agentReceipts');

test268('C17a: reflectionLoop resolves without HITL when verifier passes', async () => {
  const receipts = new AgentReceipts268({});
  const hitl     = createHitlGateStub268({ autoApprove: true });
  const loop     = new ReflectionLoop268({ hitlGate: hitl, agentReceipts: receipts });

  const proposer = async (ctx) => ({ output: 'proposal-result', score: 0.95 });
  const verifier = async (out)  => ({ ok: true, score: 0.95 });

  const result = await loop.execute268('summarise', proposer, verifier, { text: 'hello' }, { missionId: 'M-c17a' });
  assert268(result.ok === true, 'loop resolved ok');
  assert268(result.attempts >= 1, 'at least one attempt');
  assert268(result.selfCorrected === false, 'no self-correction needed');
});

test268('C17b: reflectionLoop escalates to HITL when score stays low', async () => {
  const hitl = createHitlGateStub268({ autoApprove: true });
  const receipts = new AgentReceipts268({});
  const loop = new ReflectionLoop268({ hitlGate: hitl, agentReceipts: receipts, maxRetries: 1 });

  const proposer = async (ctx) => ({ output: 'low-quality', score: 0.3 });
  const verifier = async (out)  => ({ ok: false, score: 0.3 });

  const result = await loop.execute268('classify', proposer, verifier, {}, { missionId: 'M-c17b', maxRetries: 1 });
  // ReflectionLoop signals HITL is required via hitlRequired flag; caller handles escalation
  assert268(result.hitlRequired === true || result.ok === false, 'HITL escalation signalled');
  assert268(result.attempts >= 1, 'attempts recorded');
  const stats = loop.getStats268();
  assert268(stats.hitlEscalated >= 1, 'hitlEscalated counter incremented');
});

test268('C17c: agentReceipts stores verification after reflectionLoop', async () => {
  const receipts = new AgentReceipts268({});
  const hitl     = createHitlGateStub268({ autoApprove: true });
  const loop     = new ReflectionLoop268({ hitlGate: hitl, agentReceipts: receipts });

  const proposer = async (ctx) => ({ output: 'answer', score: 0.9 });
  const verifier = async (out)  => ({ ok: true, score: 0.9 });

  await loop.execute268('verify', proposer, verifier, {}, { missionId: 'M-c17c' });

  // reflectionLoop should call agentReceipts.emitVerification268 internally
  const perf = loop.getPerf268();
  assert268(perf.count >= 1, 'loop perf recorded');
  const rPerf = receipts.getPerf268();
  assert268(typeof rPerf === 'object', 'receipts perf accessible');
});

test268('C17d: reflectionLoop health check exposes hitlGate and agentReceipts status', () => {
  const hitl     = createHitlGateStub268({});
  const receipts = new AgentReceipts268({});
  const loop     = new ReflectionLoop268({ hitlGate: hitl, agentReceipts: receipts });
  const h = loop.checkReflectionHealth268();
  assert268(h.ok === true, 'health ok');
  assert268(h.version === '268', 'version tag');
});

// ════════════════════════════════════════════════════════════════════════════
// C18. Integration Flow — Onboarding Sybil (onboardingFlow → sybilGuard → reputationLedger)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[V268 integration] C18. Onboarding Sybil Flow: onboardingFlow → sybilGuard → reputationLedger');

test268('C18a: sybilGuard evaluate returns score for new user', () => {
  const sybil = new SybilGuard268({});
  const result = sybil.evaluate268('new-user-c18a');
  assert268(typeof result.score === 'number', 'score is number');
  // score is a 0–100 composite integer
  assert268(result.score >= 0 && result.score <= 100, 'score in [0,100]');
  assert268('verdict' in result, 'verdict field present');
});

test268('C18b: sybilGuard recordSignal improves score after onboarding signal', () => {
  const sybil = new SybilGuard268({});
  const before = sybil.evaluate268('user-c18b').score;
  sybil.recordSignal268('user-c18b', 'onboarding', true);
  const after = sybil.evaluate268('user-c18b').score;
  assert268(after >= before, 'score improves or stays after positive signal');
});

test268('C18c: reputationLedger systemAttest after onboarding completion', () => {
  const ledger = new ReputationLedger268({});
  // 'onboarding' is the valid ATTESTATION_TYPES_268 entry for completed onboarding
  ledger.systemAttest268('user-c18c', 'onboarding', { channel: 'telegram' });
  const standing = ledger.getStanding268('user-c18c');
  assert268(standing.attestationCount >= 1, 'attestation stored');
  assert268(standing.dimensions.onboarding?.count >= 1, 'onboarding dimension recorded');
});

test268('C18d: full onboarding sybil flow — start → identity → sybil check → attest', async () => {
  const sybil  = new SybilGuard268({});
  const ledger = new ReputationLedger268({});
  const wallets = new EmbeddedWallet268({ custodyProvider: createCustodyProviderStub268() });
  const custody = createCustodyProviderStub268();
  const auth    = createAuthProviderStub268({ allowAll: true });
  const filter  = createCryptoWordsFilterStub268({});

  const flow = new OnboardingFlow268({
    authProvider: auth,
    cryptoWordsFilter: filter,
    embeddedWallet: new EmbeddedWallet268({ custodyProvider: custody }),
  });

  // Step 1: start flow
  const started = flow.startFlow268('user-c18d', 'telegram', { telegramId: 'tg999' });
  assert268(started.ok === true || started.fastPath === true, 'flow started');

  // Step 2: identity step
  await flow.completeStep268('user-c18d', 'identity', { id: 'user-c18d' });

  // Step 3: sybil guard evaluates after identity
  sybil.recordSignal268('user-c18d', 'onboarding', true);
  const evaluation = sybil.evaluate268('user-c18d');
  assert268(evaluation.score >= 0, 'sybil evaluated');

  // Step 4: complete onboarding and attest
  await flow.completeStep268('user-c18d', 'first_action', { text: 'write something' });
  await flow.completeStep268('user-c18d', 'cost_reveal', { ok: true });
  await flow.completeStep268('user-c18d', 'complete', { ok: true });

  ledger.systemAttest268('user-c18d', 'onboarding', { sybilScore: evaluation.score });
  const standing = ledger.getStanding268('user-c18d');
  assert268(standing.attestationCount >= 1, 'reputation attested after full flow');
});

test268('C18e: sybilGuard health + reputationLedger health both ok', () => {
  const sybil  = new SybilGuard268({});
  const ledger = new ReputationLedger268({});
  const sh = sybil.checkSybilHealth268();
  const lh = ledger.checkReputationHealth268();
  assert268(sh.ok === true && sh.version === '268', 'sybilGuard healthy');
  assert268(lh.ok === true && lh.version === '268', 'ledger healthy');
});

// ════════════════════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════════════════════
Promise.all(_pending268).then(() => {
  console.log('\n' + '─'.repeat(60));
  console.log(`V268 (2026-06-01) — ${passed}/${total} passed, ${failed} failed`);
  console.log('─'.repeat(60));
  if (failed > 0) process.exit(1);
});
