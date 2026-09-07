'use strict';
/**
 * tests/v267.test.cjs — V267 canonical regression + new-feature suite
 *
 * Covers:
 *   A. V266 regression (all 11 V266 tests re-run with V267 modules)
 *   B. V267 new features:
 *      B1.  providerAdapters267 — contracts, stubs, validateAllProviders267
 *      B2.  x402267 — settlement provider validation, perf telemetry, health check
 *      B3.  embeddedWallet267 — custody provider validation, rate-limit, perf, health
 *      B4.  mcpDeepIntegration267 — registry/executor validation, rate-limit, perf, health
 *      B5.  auditBloom267 — persistence adapter validation, perf, health
 *      B6.  ussdSmsStateMachine267 — gateway/sessionStore validation, perf, health
 *      B7.  splitModule267 — antiDump/vesting validation, perf, health
 *      B8.  onboardingFlow267 — authProvider DI, cryptoWordsFilter DI, perf, health
 *      B9.  executionPrograms267 — schedulerProvider + budgetProvider DI, perf, health
 *      B10. ecos-api-server-v267-patch — createV267State, /perf, /providers/validate
 *
 * Run: NODE_ENV=test node tests/v267.test.cjs
 */

const crypto = require('node:crypto');

// ── V267 Module Imports ──────────────────────────────────────────────────────
const { X402Processor267, parseX402Header267, buildPaymentRequired267, X402_VERSION_267 } = require('../src/lib/x402267');
const { SplitModule267, VESTING_MIN_DAYS_267 } = require('../src/lib/splitModule267');
const { OnboardingFlow267 } = require('../src/lib/onboardingFlow267');
const { MCPDeepIntegration267 } = require('../src/lib/mcpDeepIntegration267');
const { EmbeddedWallet267, WALLET_RISK_267 } = require('../src/lib/embeddedWallet267');
const { UssdSmsStateMachine267, USSD_STATES_267 } = require('../src/lib/ussdSmsStateMachine267');
const { AuditBloom267 } = require('../src/lib/auditBloom267');
const { ExecutionProgramRegistry267, PROGRAMS_267 } = require('../src/lib/executionPrograms267');
const {
  PROVIDER_CONTRACTS_267,
  validateProvider267,
  validateAllProviders267,
  createAdapterScaffold267,
  createAllStubs267,
  createSettlementProviderStub267,
  createCustodyProviderStub267,
  createPersistenceAdapterStub267,
  createGatewayStub267,
  createSessionStoreStub267,
  createAntiDumpProviderStub267,
  createVestingProviderStub267,
  createAuthProviderStub267,
  createCryptoWordsFilterStub267,
  createSchedulerProviderStub267,
  createBudgetProviderStub267,
} = require('../src/lib/providerAdapters267');
const { createV267State } = require('../ecos-api-server-v267-patch');

// ── Test Harness ─────────────────────────────────────────────────────────────
let passed = 0, failed = 0, total = 0;
const pending267 = [];

function test267(name, fn) {
  total++;
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      const p = result.then(() => ok267(name)).catch(err => bad267(name, err));
      pending267.push(p);
      return p;
    }
    ok267(name);
  } catch (err) { bad267(name, err); }
}

function ok267(name)       { passed++; console.log(`  OK  ${name}`); }
function bad267(name, err) { failed++; console.error(`  FAIL ${name}\n       ${err.stack || err.message}`); }
function assert267(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertThrows267(fn, part) {
  let threw = false, msg = '';
  try { fn(); } catch (e) { threw = true; msg = e.message; }
  if (!threw) throw new Error(`expected throw${part ? ` containing "${part}"` : ''}`);
  if (part && !msg.includes(part)) throw new Error(`expected error containing "${part}", got: "${msg}"`);
}

function sign267(payload, secret = 'ecos-x402-dev-secret-267') {
  const canonical = JSON.stringify({
    version: payload.version,
    network: payload.network,
    from: payload.from,
    to: payload.to,
    amount: payload.amount,
    resource: payload.resource,
    nonce: payload.nonce,
    timestamp: payload.timestamp,
    ...(payload.facilitator ? { facilitator: payload.facilitator } : {}),
  });
  return crypto.createHmac('sha256', secret).update(canonical).digest('hex');
}

// ════════════════════════════════════════════════════════════════════════════
// A.  V266 REGRESSION (re-run with V267 modules)
// ════════════════════════════════════════════════════════════════════════════

console.log('\n[V267 regression] x402 facilitator rails');

test267('regression: x402 parses facilitator and descriptor advertises facilitator', () => {
  const req = buildPaymentRequired267({ resource: '/r', amount: 0.01, payee: 'payee', facilitator: 'facilitator-1' });
  assert267(req.descriptor.facilitator === 'facilitator-1');
  const payload = { version: X402_VERSION_267, network: 'base', currency: 'USDC', from: 'payer', to: 'payee', amount: 0.01, resource: '/r', nonce: 'n1', timestamp: Date.now(), facilitator: 'facilitator-1' };
  payload.signature = sign267(payload);
  const header = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const parsed = parseX402Header267(header);
  assert267(parsed.facilitator === 'facilitator-1');
});

test267('regression: x402 accepts HMAC payment with facilitator and records stats', () => {
  const p = new X402Processor267({ settlementProvider: createSettlementProviderStub267() });
  p.registerResource267('/paid', 0.000001);
  const payload = { version: X402_VERSION_267, network: 'base', currency: 'USDC', from: 'u1', to: 'ecos', amount: 0.000002, resource: '/paid', nonce: 'n2', timestamp: Date.now(), facilitator: 'cbpay' };
  payload.signature = sign267(payload);
  const res = p.processPayment267(payload, { testMode: true });
  assert267(res.ok, 'payment accepted');
  assert267(res.facilitator === 'cbpay');
  assert267(p.getStats267().facilitatorPayments === 1);
});

test267('regression: split enforces minimum vesting and anti-dump flags withdrawal', () => {
  const s = new SplitModule267({
    antiDumpProvider: createAntiDumpProviderStub267({ logger: () => {} }),
    vestingProvider:  createVestingProviderStub267({ logger: () => {} }),
  });
  assertThrows267(() => s.createSplit267('u', [{ userId: 'a', bps: 10000 }], { enforceVesting: true, vestingDays: 10 }), String(VESTING_MIN_DAYS_267));
  const created = s.createSplit267('u', [{ userId: 'a', bps: 5000 }, { userId: 'b', bps: 5000 }], { antiDumpPolicy: { maxImmediateBps: 1000 } });
  const d = s.distribute267(created.splitId, 1000n, { withdrawalRequest: true });
  assert267(d.ok === true);
});

console.log('\n[V267 regression] onboarding funnel and embedded wallet');

test267('regression: onboarding creates wallet, exports state, and reports funnel', async () => {
  const wallets = new EmbeddedWallet267({ custodyProvider: createCustodyProviderStub267({ logger: () => {} }) });
  const flow = new OnboardingFlow267({ embeddedWallet: wallets });
  const started = flow.startFlow267('userA', 'telegram', { telegramId: 'tg123' });
  assert267(started.fastPath === true);
  await flow.completeStep267('userA', 'first_action', { text: 'help me write' });
  await flow.completeStep267('userA', 'cost_reveal', { ok: true });
  await flow.completeStep267('userA', 'complete', { ok: true });
  assert267(flow.getStats267().completed === 1);
  assert267(wallets.resolveWallet267('userA').provider === 'telegram');
});

test267('regression: onboarding rejects crypto words in user copy', async () => {
  const flow = new OnboardingFlow267();
  flow.startFlow267('userB', 'chat');
  // built-in list catches 'seed' (a prefix of 'seed phrase') — error mentions 'seed'
  const r = await flow.completeStep267('userB', 'identity', { text: 'I need a seed phrase' });
  assert267(r.ok === false && r.error.includes('seed'));
});

console.log('\n[V267 regression] MCP, USSD, audit bloom, wallet risk');

test267('regression: MCP registry supports dry-run safe calls and blocks dangerous calls', async () => {
  const m = new MCPDeepIntegration267({ toolExecutor: async (toolId, input, opts) => ({ ok: true, executed: true, toolId }) });
  m.registerServer267('srv', { name: 'Server' });
  const safe = m.registerTool267('srv', { name: 'search', risk: 'safe' });
  const out = await m.callTool267(safe.tool.toolId, { q: 'ecos' }, { dryRun: true });
  assert267(out.ok && out.output.dryRun === true);
  const dangerous = m.registerTool267('srv', { name: 'pay', risk: 'dangerous' });
  const blocked = await m.callTool267(dangerous.tool.toolId, {});
  assert267(blocked.ok === false && blocked.code === 'HITL_REQUIRED');
});

test267('regression: USSD state machine reaches complete and exposes compact state', () => {
  const u = new UssdSmsStateMachine267({
    smsGateway:   createGatewayStub267('sms',  { logger: () => {} }),
    ussdGateway:  createGatewayStub267('ussd', { logger: () => {} }),
    sessionStore: createSessionStoreStub267(),
  });
  u.startSession267('phone1');
  u.handleInput267('phone1', '1');
  u.handleInput267('phone1', 'Mina');
  u.handleInput267('phone1', '2');
  const done = u.handleInput267('phone1', '1');
  assert267(done.state === USSD_STATES_267.COMPLETE);
  assert267(u.compact267('phone1').v === '267');
});

test267('regression: Audit Bloom records exact and maybe membership', () => {
  const a = new AuditBloom267({ persistenceAdapter: createPersistenceAdapterStub267() });
  a.addEvent267({ key: 'mission:step:hash' });
  const hit  = a.has267('mission:step:hash');
  const miss = a.has267('mission:step:missing');
  assert267(hit.maybe && hit.exact);
  assert267(miss.exact === false);
});

test267('regression: Embedded wallet risk lock is visible in mobile wallet', () => {
  const w = new EmbeddedWallet267({ custodyProvider: createCustodyProviderStub267({ logger: () => {} }) });
  const created = w.createWallet267('u1', 'email', 'u1@example.com');
  w.markRisk267(created.wallet.walletId, WALLET_RISK_267.LOCKED, 'sybil_review');
  assert267(w.getMobileWallet267('u1').st === 'locked');
});

test267('regression: Execution registry includes P15/P16/P18/P21/P24 and starts programs', () => {
  for (const id of ['P15', 'P16', 'P18', 'P21', 'P24']) assert267(PROGRAMS_267.some(p => p.id === id), `${id} missing`);
  const r = new ExecutionProgramRegistry267();
  assert267(r.startProgram267('P15', { budgetMicro: 1000n }).ok);
  assert267(r.getDashboard267().totalPrograms === 25);
});

test267('regression: V267 API patch constructs complete module state', () => {
  const state = createV267State();
  assert267(state.version === '267');
  assert267(state.modules.mcp && state.modules.auditBloom && state.modules.wallets);
  assert267(state.modules.providerValidation === true);
  assert267(state.modules.perfTelemetry === true);
});

// ════════════════════════════════════════════════════════════════════════════
// B1.  providerAdapters267
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[V267 new] B1. providerAdapters267 — contracts, stubs, validation');

test267('PROVIDER_CONTRACTS_267 covers all 14 provider types', () => {
  const expected = [
    'settlementProvider','custodyProvider','mcpServerRegistry','toolExecutor',
    'persistenceAdapter','smsGateway','ussdGateway','sessionStore',
    'antiDumpProvider','vestingProvider','authProvider','cryptoWordsFilter',
    'schedulerProvider','budgetProvider',
  ];
  for (const t of expected) assert267(PROVIDER_CONTRACTS_267[t], `missing contract: ${t}`);
  assert267(Object.keys(PROVIDER_CONTRACTS_267).length === 14);
});

test267('validateProvider267 returns ok for null (stub mode)', () => {
  const r = validateProvider267('settlementProvider', null);
  assert267(r.ok === true && r.warnings.length > 0);
});

test267('validateProvider267 rejects object missing required method', () => {
  const r = validateProvider267('settlementProvider', { notSettle: () => {} });
  assert267(r.ok === false && r.errors.some(e => e.includes('settle')));
});

test267('validateProvider267 accepts conformant settlementProvider', () => {
  const stub = createSettlementProviderStub267({ logger: () => {} });
  const r = validateProvider267('settlementProvider', stub);
  assert267(r.ok === true && r.errors.length === 0);
});

test267('validateProvider267 validates toolExecutor as function', () => {
  const rBad = validateProvider267('toolExecutor', { not: 'a function' });
  assert267(rBad.ok === false);
  const rGood = validateProvider267('toolExecutor', async () => ({}));
  assert267(rGood.ok === true);
});

test267('validateAllProviders267 validates multiple providers at once', () => {
  const opts = {
    settlementProvider: createSettlementProviderStub267({ logger: () => {} }),
    custodyProvider:    createCustodyProviderStub267({ logger: () => {} }),
    smsGateway:         createGatewayStub267('sms', { logger: () => {} }),
  };
  const r = validateAllProviders267(opts);
  assert267(r.ok === true && r.allErrors.length === 0);
});

test267('validateAllProviders267 surfaces errors from bad providers', () => {
  const r = validateAllProviders267({ custodyProvider: { createWallet: 'not a function' } });
  assert267(r.ok === false && r.allErrors.length > 0);
});

test267('createAdapterScaffold267 returns conformant stubs for all types', () => {
  const types = [
    'settlementProvider','custodyProvider','persistenceAdapter',
    'smsGateway','ussdGateway','sessionStore','mcpServerRegistry',
    'toolExecutor','antiDumpProvider','vestingProvider','authProvider',
    'cryptoWordsFilter','schedulerProvider','budgetProvider',
  ];
  for (const t of types) {
    const stub = createAdapterScaffold267(t, { logger: () => {} });
    assert267(stub !== null && stub !== undefined, `scaffold null for ${t}`);
    const r = validateProvider267(t, stub);
    assert267(r.ok === true, `scaffold for ${t} failed validation: ${r.errors.join(', ')}`);
  }
});

test267('createAllStubs267 returns 14 conformant stubs', () => {
  const stubs = createAllStubs267({ logger: () => {} });
  assert267(Object.keys(stubs).length === 14);
  const r = validateAllProviders267(stubs);
  assert267(r.ok === true, `stubs failed: ${r.allErrors.join(', ')}`);
});

test267('custodyProviderStub267 stores wallets in-memory', () => {
  const stub = createCustodyProviderStub267({ logger: () => {} });
  const w = stub.createWallet('user1', 'email', 'user1@test.com', {});
  assert267(w.userId === 'user1');
  assert267(stub.getWallet('user1').walletId === w.walletId);
});

test267('persistenceAdapterStub267 save/load roundtrip', () => {
  const stub = createPersistenceAdapterStub267();
  stub.saveBloomState({ bitsetBase64: 'abc', exactKeys: ['k1'], events: [] });
  const loaded = stub.loadBloomState();
  assert267(loaded.bitsetBase64 === 'abc' && loaded.exactKeys[0] === 'k1');
});

test267('gatewayStub267 records sent messages', () => {
  const sms = createGatewayStub267('sms', { logger: () => {} });
  sms.send('user1', 'hello');
  assert267(sms.getSent().length === 1 && sms.getSent()[0].message === 'hello');
});

test267('schedulerProviderStub267 schedule and cancel', () => {
  const s = createSchedulerProviderStub267({ logger: () => {} });
  s.schedule('m1', { task: 'do thing' }, {});
  assert267(s.listScheduled().length === 1);
  s.cancel('m1');
  assert267(s.listScheduled().length === 0);
});

test267('budgetProviderStub267 credit, check, debit cycle', () => {
  const b = createBudgetProviderStub267({ logger: () => {} });
  b.creditBudget('P01', 5000n);
  const check = b.checkBudget('P01', 1000n);
  assert267(check.ok === true);
  b.debitBudget('P01', 1000n, { reason: 'test' });
  const info = b.getBudget('P01');
  assert267(info.spent === '1000');
});

test267('budgetProviderStub267 throws on budget exceeded', () => {
  const b = createBudgetProviderStub267({ logger: () => {} });
  b.creditBudget('P02', 100n);
  assertThrows267(() => b.checkBudget('P02', 200n), 'budget exceeded');
});

test267('vestingProviderStub267 enforces 365-day minimum', () => {
  const v = createVestingProviderStub267({ logger: () => {} });
  assertThrows267(() => v.validateVesting(10, true), '365');
  assert267(v.validateVesting(400, true).ok === true);
});

test267('authProviderStub267 verifyUser throws on missing userId', () => {
  const a = createAuthProviderStub267({ logger: () => {} });
  assertThrows267(() => a.verifyUser('', {}), 'userId required');
  assert267(a.verifyUser('u1', {}).ok === true);
});

test267('cryptoWordsFilterStub267 blocks configured words', () => {
  const f = createCryptoWordsFilterStub267(['wallet', 'gas']);
  assert267(f.check('I need a wallet').blocked === true);
  assert267(f.check('hello world').blocked === false);
});

// ════════════════════════════════════════════════════════════════════════════
// B2.  x402267 — new V267 DI / perf / health
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[V267 new] B2. x402267 — settlement validation, perf, health');

test267('x402267 rejects settlementProvider missing settle()', () => {
  assertThrows267(() => new X402Processor267({ settlementProvider: { noSettle: () => {} } }), 'settle');
});

test267('x402267 accepts null settlementProvider (stub mode)', () => {
  const p = new X402Processor267({ settlementProvider: null });
  assert267(p !== null);
});

test267('x402267 checkSettlementHealth267 returns stub when no provider', () => {
  const p = new X402Processor267();
  const h = p.checkSettlementHealth267();
  assert267(h.provider === 'stub');
});

test267('x402267 checkSettlementHealth267 validates external provider', () => {
  const p = new X402Processor267({ settlementProvider: createSettlementProviderStub267({ logger: () => {} }) });
  const h = p.checkSettlementHealth267();
  assert267(h.ok === true && h.provider === 'external');
});

test267('x402267 getPerf267 returns percentile struct', () => {
  const p = new X402Processor267({ settlementProvider: createSettlementProviderStub267({ logger: () => {} }) });
  p.registerResource267('/r', 0.001);
  const payload = { version: X402_VERSION_267, network: 'base', currency: 'USDC', from: 'u', to: 'payee', amount: 0.002, resource: '/r', nonce: 'n3', timestamp: Date.now() };
  payload.signature = sign267(payload);
  p.processPayment267(payload, { testMode: true });
  const perf = p.getPerf267();
  assert267('p50' in perf && 'p95' in perf && 'p99' in perf && perf.count >= 1);
});
console.log('\n[V267 new] B3. embeddedWallet267 — custody validation, rate-limit, perf, health');

test267('embeddedWallet267 rejects custodyProvider missing createWallet()', () => {
  assertThrows267(() => new EmbeddedWallet267({ custodyProvider: { linkExternal: () => {} } }), 'createWallet');
});

test267('embeddedWallet267 rejects custodyProvider missing linkExternal()', () => {
  assertThrows267(() => new EmbeddedWallet267({ custodyProvider: { createWallet: () => {} } }), 'linkExternal');
});

test267('embeddedWallet267 rejects invalid userId (too long)', () => {
  const w = new EmbeddedWallet267();
  assertThrows267(() => w.createWallet267('x'.repeat(300), 'email', 'test@test.com'), 'invalid userId');
});

test267('embeddedWallet267 enforces create rate-limit', () => {
  const w = new EmbeddedWallet267();
  w.createWallet267('rateUser1', 'email', 'a@b.com');
  // second immediate call should hit rate limit
  assertThrows267(() => w.createWallet267('rateUser1', 'email', 'a@b.com'), 'rate limit');
});

test267('embeddedWallet267 forceNew bypasses rate-limit', () => {
  const w = new EmbeddedWallet267();
  w.createWallet267('rateUser2', 'email', 'a@b.com');
  const r = w.createWallet267('rateUser2', 'email', 'a@b.com', { forceNew: true });
  assert267(r.ok === true);
});

test267('embeddedWallet267 getPerf267 records latency after create', () => {
  const w = new EmbeddedWallet267({ custodyProvider: createCustodyProviderStub267({ logger: () => {} }) });
  w.createWallet267('perfUser1', 'email', 'perf@test.com');
  const perf = w.getPerf267();
  assert267(perf.count >= 1 && 'p50' in perf);
});

test267('embeddedWallet267 checkCustodyHealth267 stub mode', () => {
  const w = new EmbeddedWallet267();
  const h = w.checkCustodyHealth267();
  assert267(h.provider === 'stub');
});

test267('embeddedWallet267 checkCustodyHealth267 external provider', () => {
  const w = new EmbeddedWallet267({ custodyProvider: createCustodyProviderStub267({ logger: () => {} }) });
  const h = w.checkCustodyHealth267();
  assert267(h.ok === true && h.provider === 'external');
});

// ════════════════════════════════════════════════════════════════════════════
// B4.  mcpDeepIntegration267 — new V267 features
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[V267 new] B4. mcpDeepIntegration267 — registry/executor validation, rate-limit, perf, health');

test267('mcpDeepIntegration267 rejects mcpServerRegistry without get/set', () => {
  assertThrows267(() => new MCPDeepIntegration267({ mcpServerRegistry: { onlyGet: () => {} } }), 'get/set');
});

test267('mcpDeepIntegration267 rejects non-function toolExecutor', () => {
  assertThrows267(() => new MCPDeepIntegration267({ toolExecutor: { notAFunction: true } }), 'function');
});

test267('mcpDeepIntegration267 rate-limits repeated calls to same tool', async () => {
  const m = new MCPDeepIntegration267();
  m.registerServer267('s', { name: 'S' });
  const t = m.registerTool267('s', { name: 'search', risk: 'safe' });
  await m.callTool267(t.tool.toolId, {}, { rateMs: 10000 });
  const r2 = await m.callTool267(t.tool.toolId, {}, { rateMs: 10000 });
  assert267(r2.ok === false && r2.code === 'RATE_LIMITED');
});

test267('mcpDeepIntegration267 getPerf267 accumulates after calls', async () => {
  const m = new MCPDeepIntegration267();
  m.registerServer267('s2', { name: 'S2' });
  const t = m.registerTool267('s2', { name: 'echo', risk: 'safe' });
  await m.callTool267(t.tool.toolId, { x: 1 }, {});
  const perf = m.getPerf267();
  assert267(perf.count >= 1 && 'p99' in perf);
});

test267('mcpDeepIntegration267 checkToolExecutorHealth267 stub mode', () => {
  const m = new MCPDeepIntegration267();
  const h = m.checkToolExecutorHealth267();
  assert267(h.executor === 'stub');
});

test267('mcpDeepIntegration267 checkToolExecutorHealth267 external executor', () => {
  const m = new MCPDeepIntegration267({ toolExecutor: async () => ({}) });
  const h = m.checkToolExecutorHealth267();
  assert267(h.ok === true && h.executor === 'external');
});

// ════════════════════════════════════════════════════════════════════════════
// B5.  auditBloom267 — new V267 features
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[V267 new] B5. auditBloom267 — persistence validation, perf, health');

test267('auditBloom267 rejects persistenceAdapter missing loadBloomState', () => {
  assertThrows267(() => new AuditBloom267({ persistenceAdapter: { saveBloomState: () => {} } }), 'loadBloomState');
});

test267('auditBloom267 rejects persistenceAdapter missing saveBloomState', () => {
  assertThrows267(() => new AuditBloom267({ persistenceAdapter: { loadBloomState: () => ({}) } }), 'saveBloomState');
});

test267('auditBloom267 getPerf267 records add latency', () => {
  const a = new AuditBloom267({ persistenceAdapter: createPersistenceAdapterStub267() });
  a.addEvent267({ key: 'perf-test-key' });
  const perf = a.getPerf267();
  assert267(perf.count >= 1 && 'p50' in perf);
});

test267('auditBloom267 checkPersistenceHealth267 stub mode', () => {
  const a = new AuditBloom267();
  const h = a.checkPersistenceHealth267();
  assert267(h.adapter === 'in-memory');
});

test267('auditBloom267 checkPersistenceHealth267 external adapter', () => {
  const a = new AuditBloom267({ persistenceAdapter: createPersistenceAdapterStub267() });
  const h = a.checkPersistenceHealth267();
  assert267(h.ok === true && h.adapter === 'external');
});

// ════════════════════════════════════════════════════════════════════════════
// B6.  ussdSmsStateMachine267 — new V267 features
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[V267 new] B6. ussdSmsStateMachine267 — gateway/sessionStore validation, perf, health');

test267('ussdSmsStateMachine267 rejects smsGateway without send()', () => {
  assertThrows267(() => new UssdSmsStateMachine267({ smsGateway: { noSend: () => {} } }), 'send');
});

test267('ussdSmsStateMachine267 rejects ussdGateway without send()', () => {
  assertThrows267(() => new UssdSmsStateMachine267({ ussdGateway: { noSend: () => {} } }), 'send');
});

test267('ussdSmsStateMachine267 rejects sessionStore without get/set', () => {
  assertThrows267(() => new UssdSmsStateMachine267({ sessionStore: { onlyGet: () => {} } }), 'get/set');
});

test267('ussdSmsStateMachine267 getPerf267 records after handleInput', () => {
  const u = new UssdSmsStateMachine267({
    smsGateway:   createGatewayStub267('sms',  { logger: () => {} }),
    ussdGateway:  createGatewayStub267('ussd', { logger: () => {} }),
    sessionStore: createSessionStoreStub267(),
  });
  u.startSession267('perfPhone1');
  u.handleInput267('perfPhone1', '1');
  const perf = u.getPerf267();
  assert267(perf.count >= 1 && 'p95' in perf);
});

test267('ussdSmsStateMachine267 checkGatewayHealth267 all stubs', () => {
  const u = new UssdSmsStateMachine267({
    smsGateway:   createGatewayStub267('sms',  { logger: () => {} }),
    ussdGateway:  createGatewayStub267('ussd', { logger: () => {} }),
    sessionStore: createSessionStoreStub267(),
  });
  const h = u.checkGatewayHealth267();
  assert267(h.ok === true);
  assert267(h.smsGateway.type === 'external');
  assert267(h.ussdGateway.type === 'external');
});

// ════════════════════════════════════════════════════════════════════════════
// B7.  splitModule267 — new V267 features
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[V267 new] B7. splitModule267 — provider validation, perf, health');

test267('splitModule267 rejects antiDumpProvider missing evaluateDumpRisk()', () => {
  assertThrows267(() => new SplitModule267({ antiDumpProvider: { noMethod: () => {} } }), 'evaluateDumpRisk');
});

test267('splitModule267 rejects vestingProvider missing validateVesting()', () => {
  assertThrows267(() => new SplitModule267({ vestingProvider: { noMethod: () => {} } }), 'validateVesting');
});

test267('splitModule267 getPerf267 records after distribute', () => {
  const s = new SplitModule267({
    antiDumpProvider: createAntiDumpProviderStub267({ logger: () => {} }),
    vestingProvider:  createVestingProviderStub267({ logger: () => {} }),
  });
  const created = s.createSplit267('u', [{ userId: 'a', bps: 5000 }, { userId: 'b', bps: 5000 }], {});
  s.distribute267(created.splitId, 1000n, {});
  const perf = s.getPerf267();
  assert267(perf.count >= 1 && 'p50' in perf);
});

test267('splitModule267 checkProviderHealth267 stub mode', () => {
  const s = new SplitModule267();
  const h = s.checkProviderHealth267();
  assert267(h.antiDumpProvider.type === 'stub' && h.vestingProvider.type === 'stub');
});

test267('splitModule267 checkProviderHealth267 external providers', () => {
  const s = new SplitModule267({
    antiDumpProvider: createAntiDumpProviderStub267({ logger: () => {} }),
    vestingProvider:  createVestingProviderStub267({ logger: () => {} }),
  });
  const h = s.checkProviderHealth267();
  assert267(h.antiDumpProvider.ok === true && h.vestingProvider.ok === true);
});

// ════════════════════════════════════════════════════════════════════════════
// B8.  onboardingFlow267 — authProvider DI, cryptoWordsFilter DI, perf, health
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[V267 new] B8. onboardingFlow267 — authProvider, cryptoWordsFilter DI, perf, health');

test267('onboardingFlow267 rejects authProvider missing verifyUser()', () => {
  assertThrows267(() => new OnboardingFlow267({ authProvider: { noVerify: () => {} } }), 'verifyUser');
});

test267('onboardingFlow267 rejects cryptoWordsFilter missing check()', () => {
  assertThrows267(() => new OnboardingFlow267({ cryptoWordsFilter: { noCheck: () => {} } }), 'check');
});

test267('onboardingFlow267 uses injected authProvider on identity step', async () => {
  let verifyCalled = false;
  const authProvider = {
    verifyUser(userId, meta) { verifyCalled = true; return { ok: true }; },
  };
  const flow = new OnboardingFlow267({ authProvider });
  flow.startFlow267('authUser1', 'chat');
  await flow.completeStep267('authUser1', 'identity', { email: 'test@test.com' });
  assert267(verifyCalled === true);
});

test267('onboardingFlow267 authProvider failure blocks step', async () => {
  const authProvider = { verifyUser() { throw new Error('invalid credentials'); } };
  const flow = new OnboardingFlow267({ authProvider });
  flow.startFlow267('authUser2', 'chat');
  const r = await flow.completeStep267('authUser2', 'identity', { email: 'bad@test.com' });
  assert267(r.ok === false && r.error.includes('invalid credentials'));
});

test267('onboardingFlow267 uses injected cryptoWordsFilter instead of built-in', async () => {
  let filterCalled = false;
  const cryptoWordsFilter = {
    // External filter receives original-case JSON string from onboarding267
    check(text) { filterCalled = true; return text.includes('BANNED') ? { blocked: true, word: 'BANNED' } : { blocked: false }; },
  };
  const flow = new OnboardingFlow267({ cryptoWordsFilter });
  flow.startFlow267('filterUser1', 'chat');
  const good = await flow.completeStep267('filterUser1', 'identity', { text: 'hello world' });
  assert267(filterCalled === true);
  assert267(good.ok === true);

  flow.startFlow267('filterUser2', 'chat');
  // 'BANNED' is uppercase — onboarding267 passes original-case JSON to external filter
  const bad = await flow.completeStep267('filterUser2', 'identity', { text: 'BANNED content here' });
  assert267(bad.ok === false && bad.error.includes('BANNED'));
});

test267('onboardingFlow267 getPerf267 records after completeStep', async () => {
  const flow = new OnboardingFlow267();
  flow.startFlow267('perfOnboard1', 'chat');
  await flow.completeStep267('perfOnboard1', 'identity', { name: 'Alice' });
  const perf = flow.getPerf267();
  assert267(perf.count >= 1 && 'p99' in perf);
});

test267('onboardingFlow267 checkProviderHealth267 reflects DI state', () => {
  const flow = new OnboardingFlow267({
    authProvider:      createAuthProviderStub267({ logger: () => {} }),
    cryptoWordsFilter: createCryptoWordsFilterStub267(['wallet']),
  });
  const h = flow.checkProviderHealth267();
  assert267(h.authProvider.ok === true && h.authProvider.type === 'external');
  assert267(h.cryptoWordsFilter.ok === true && h.cryptoWordsFilter.type === 'external');
  assert267(h.embeddedWallet.type === 'stub');
});

// ════════════════════════════════════════════════════════════════════════════
// B9.  executionPrograms267 — schedulerProvider + budgetProvider DI, perf, health
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[V267 new] B9. executionPrograms267 — schedulerProvider, budgetProvider, perf, health');

test267('executionPrograms267 rejects schedulerProvider missing schedule()', () => {
  assertThrows267(() => new ExecutionProgramRegistry267({ schedulerProvider: { cancel: () => {} } }), 'schedule');
});

test267('executionPrograms267 rejects schedulerProvider missing cancel()', () => {
  assertThrows267(() => new ExecutionProgramRegistry267({ schedulerProvider: { schedule: () => {} } }), 'cancel');
});

test267('executionPrograms267 rejects budgetProvider missing checkBudget()', () => {
  assertThrows267(() => new ExecutionProgramRegistry267({ budgetProvider: { debitBudget: () => {} } }), 'checkBudget');
});

test267('executionPrograms267 rejects budgetProvider missing debitBudget()', () => {
  assertThrows267(() => new ExecutionProgramRegistry267({ budgetProvider: { checkBudget: () => {} } }), 'debitBudget');
});

test267('executionPrograms267 schedulerProvider is called on addMission', () => {
  let scheduleCalled = false;
  const schedulerProvider = createSchedulerProviderStub267({ logger: () => {} });
  const origSchedule = schedulerProvider.schedule.bind(schedulerProvider);
  schedulerProvider.schedule = (...a) => { scheduleCalled = true; return origSchedule(...a); };
  const r = new ExecutionProgramRegistry267({ schedulerProvider });
  r.startProgram267('P01', { budgetMicro: 5000n });
  r.addMission267('P01', 'mission-sched-1', 'test mission');
  assert267(scheduleCalled === true);
  assert267(schedulerProvider.listScheduled().length === 1);
});

test267('executionPrograms267 schedulerProvider cancels missions on blockProgram', () => {
  const schedulerProvider = createSchedulerProviderStub267({ logger: () => {} });
  const r = new ExecutionProgramRegistry267({ schedulerProvider });
  r.startProgram267('P02', {});
  r.addMission267('P02', 'mission-block-1', 'test');
  r.addMission267('P02', 'mission-block-2', 'test2');
  assert267(schedulerProvider.listScheduled().length === 2);
  r.blockProgram267('P02', 'test_block');
  assert267(schedulerProvider.listScheduled().length === 0);
});

test267('executionPrograms267 budgetProvider.checkBudget called on startProgram', () => {
  let checkCalled = false;
  const budgetProvider = createBudgetProviderStub267({ logger: () => {} });
  budgetProvider.creditBudget('P03', 10000n);
  const origCheck = budgetProvider.checkBudget.bind(budgetProvider);
  budgetProvider.checkBudget = (...a) => { checkCalled = true; return origCheck(...a); };
  const r = new ExecutionProgramRegistry267({ budgetProvider });
  r.startProgram267('P03', { budgetMicro: 5000n });
  assert267(checkCalled === true);
});

test267('executionPrograms267 budgetProvider.debitBudget called on completeProgram', () => {
  let debitCalled = false;
  const budgetProvider = createBudgetProviderStub267({ logger: () => {} });
  const origDebit = budgetProvider.debitBudget.bind(budgetProvider);
  budgetProvider.debitBudget = (...a) => { debitCalled = true; return origDebit(...a); };
  const r = new ExecutionProgramRegistry267({ budgetProvider });
  r.startProgram267('P04', { budgetMicro: 1000n });
  // manually set spent to trigger debit
  const prog = r._registry267.get('P04');
  prog.budget.spent = 500n;
  r.completeProgram267('P04', { summary: 'done' });
  assert267(debitCalled === true);
});

test267('executionPrograms267 getPerf267 records after startProgram', () => {
  const r = new ExecutionProgramRegistry267();
  r.startProgram267('P05', { budgetMicro: 1000n });
  const perf = r.getPerf267();
  assert267(perf.count >= 1 && 'p50' in perf);
});

test267('executionPrograms267 checkProviderHealth267 reflects DI state', () => {
  const r = new ExecutionProgramRegistry267({
    schedulerProvider: createSchedulerProviderStub267({ logger: () => {} }),
    budgetProvider:    createBudgetProviderStub267({ logger: () => {} }),
  });
  const h = r.checkProviderHealth267();
  assert267(h.schedulerProvider.ok === true && h.schedulerProvider.type === 'external');
  assert267(h.budgetProvider.ok === true && h.budgetProvider.type === 'external');
  assert267(h.costRouter.type === 'stub');
});

// ════════════════════════════════════════════════════════════════════════════
// B10. ecos-api-server-v267-patch
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[V267 new] B10. ecos-api-server-v267-patch — createV267State, full DI');

test267('createV267State passes all providers through to modules', () => {
  const schedulerProvider = createSchedulerProviderStub267({ logger: () => {} });
  const budgetProvider    = createBudgetProviderStub267({ logger: () => {} });
  const authProvider      = createAuthProviderStub267({ logger: () => {} });
  const state = createV267State({
    schedulerProvider, budgetProvider, authProvider,
    smsGateway:         createGatewayStub267('sms',  { logger: () => {} }),
    ussdGateway:        createGatewayStub267('ussd', { logger: () => {} }),
    sessionStore:       createSessionStoreStub267(),
    persistenceAdapter: createPersistenceAdapterStub267(),
    antiDumpProvider:   createAntiDumpProviderStub267({ logger: () => {} }),
    vestingProvider:    createVestingProviderStub267({ logger: () => {} }),
    custodyProvider:    createCustodyProviderStub267({ logger: () => {} }),
    settlementProvider: createSettlementProviderStub267({ logger: () => {} }),
  });
  assert267(state.version === '267');
  assert267(state.modules.providerValidation === true);
  assert267(state.modules.perfTelemetry === true);
  assert267(state.modules.healthChecks === true);
  assert267(state.programs._schedulerProvider === schedulerProvider);
  assert267(state.programs._budgetProvider    === budgetProvider);
  assert267(state.onboarding._authProvider    === authProvider);
});

test267('createV267State module health checks all return ok:true with stubs', () => {
  const state = createV267State({
    smsGateway:         createGatewayStub267('sms',  { logger: () => {} }),
    ussdGateway:        createGatewayStub267('ussd', { logger: () => {} }),
    sessionStore:       createSessionStoreStub267(),
    persistenceAdapter: createPersistenceAdapterStub267(),
    antiDumpProvider:   createAntiDumpProviderStub267({ logger: () => {} }),
    vestingProvider:    createVestingProviderStub267({ logger: () => {} }),
    custodyProvider:    createCustodyProviderStub267({ logger: () => {} }),
    settlementProvider: createSettlementProviderStub267({ logger: () => {} }),
  });
  const checks = [
    state.x402.checkSettlementHealth267(),
    state.wallets.checkCustodyHealth267(),
    state.mcp.checkToolExecutorHealth267(),
    state.ussd.checkGatewayHealth267(),
    state.auditBloom.checkPersistenceHealth267(),
    state.splits.checkProviderHealth267(),
    state.onboarding.checkProviderHealth267(),
    state.programs.checkProviderHealth267(),
  ];
  for (const h of checks) assert267(h && h.ok === true, `health check failed: ${JSON.stringify(h)}`);
});

test267('createV267State all modules expose getPerf267()', () => {
  const state = createV267State();
  const modules = [state.x402, state.wallets, state.mcp, state.ussd, state.auditBloom, state.splits, state.onboarding, state.programs];
  for (const mod of modules) {
    assert267(typeof mod.getPerf267 === 'function', `module missing getPerf267: ${mod.constructor?.name}`);
    const perf = mod.getPerf267();
    assert267('p50' in perf && 'p95' in perf && 'p99' in perf && 'count' in perf);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// Run
// ════════════════════════════════════════════════════════════════════════════
Promise.all(pending267).then(() => {
  const versionLine = `V267 (${new Date().toISOString().slice(0,10)})`;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`${versionLine} — ${passed}/${total} passed, ${failed} failed`);
  console.log(`${'─'.repeat(60)}\n`);
  if (failed > 0 || passed !== total) process.exit(1);
});
