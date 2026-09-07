'use strict';
/**
 * tests/v266.test.cjs — V266 canonical regression suite
 * Run: NODE_ENV=test node tests/v266.test.cjs
 */

const crypto = require('node:crypto');
const { X402Processor266, parseX402Header266, buildPaymentRequired266, X402_VERSION_266 } = require('../src/lib/x402266');
const { SplitModule266, VESTING_MIN_DAYS_266 } = require('../src/lib/splitModule266');
const { OnboardingFlow266 } = require('../src/lib/onboardingFlow266');
const { MCPDeepIntegration266 } = require('../src/lib/mcpDeepIntegration266');
const { EmbeddedWallet266, WALLET_RISK_266 } = require('../src/lib/embeddedWallet266');
const { UssdSmsStateMachine266, USSD_STATES_266 } = require('../src/lib/ussdSmsStateMachine266');
const { AuditBloom266 } = require('../src/lib/auditBloom266');
const { ExecutionProgramRegistry266, PROGRAMS_266 } = require('../src/lib/executionPrograms266');
const { createV266State } = require('../ecos-api-server-v266-patch');

let passed = 0, failed = 0, total = 0;
const pending266 = [];
function test266(name, fn) {
  total++;
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      const p = result.then(() => ok(name)).catch(err => bad(name, err));
      pending266.push(p);
      return p;
    }
    ok(name);
  } catch (err) { bad(name, err); }
}
function ok(name) { passed++; console.log(`  OK  ${name}`); }
function bad(name, err) { failed++; console.error(`  FAIL ${name}\n       ${err.stack || err.message}`); }
function assert266(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertThrows266(fn, part) { let threw = false, msg = ''; try { fn(); } catch (e) { threw = true; msg = e.message; } if (!threw) throw new Error('expected throw'); if (part && !msg.includes(part)) throw new Error(`expected ${part}, got ${msg}`); }

function sign266(payload, secret = 'ecos-x402-dev-secret-266') {
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

console.log('\n[V266] x402 facilitator rails');
test266('x402 parses facilitator and descriptor advertises facilitator', () => {
  const req = buildPaymentRequired266({ resource: '/r', amount: 0.01, payee: 'payee', facilitator: 'facilitator-1' });
  assert266(req.descriptor.facilitator === 'facilitator-1');
  const payload = { version: X402_VERSION_266, network: 'base', currency: 'USDC', from: 'payer', to: 'payee', amount: 0.01, resource: '/r', nonce: 'n1', timestamp: Date.now(), facilitator: 'facilitator-1' };
  payload.signature = sign266(payload);
  const header = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const parsed = parseX402Header266(header);
  assert266(parsed.facilitator === 'facilitator-1');
});

test266('x402 accepts HMAC payment with facilitator and records stats', () => {
  const p = new X402Processor266({ settlementProvider: { settleX402: () => ({ success: true, transactionId: 'mock_tx' }) } });
  p.registerResource266('/paid', 0.000001);
  const payload = { version: X402_VERSION_266, network: 'base', currency: 'USDC', from: 'u1', to: 'ecos', amount: 0.000002, resource: '/paid', nonce: 'n2', timestamp: Date.now(), facilitator: 'cbpay' };
  payload.signature = sign266(payload);
  const res = p.processPayment266(payload, { testMode: true });
  assert266(res.ok, 'payment accepted');
  assert266(res.facilitator === 'cbpay');
  assert266(p.getStats266().facilitatorPayments === 1);
});

console.log('\n[V266] split vesting and anti-dump');
test266('split enforces minimum vesting and anti-dump flags withdrawal', () => {
  const s = new SplitModule266({
    antiDumpProvider: { evaluateDumpRisk: (splitId, amountMicro, policy, totalDistributed, meta) => ({ flagged: true, reason: 'mock_high_amount_risk' }) },
    vestingProvider: {
      validateVesting: (vestingDays, enforceVesting) => {
        if (enforceVesting && vestingDays < VESTING_MIN_DAYS_266) {
          throw new Error(`Mock Vesting: vesting period must be >= ${VESTING_MIN_DAYS_266} days`);
        }
      },
      getVestedAmount: (splitId, amountMicro) => ({ vestedAmount: amountMicro / 2n }),
      getVestingStatus: () => ({ vestedPct: 50 })
    }
  });
  assertThrows266(() => s.createSplit266('u', [{ userId: 'a', bps: 10000 }], { enforceVesting: true, vestingDays: 10 }), String(VESTING_MIN_DAYS_266));
  const created = s.createSplit266('u', [{ userId: 'a', bps: 5000 }, { userId: 'b', bps: 5000 }], { antiDumpPolicy: { maxImmediateBps: 1000 } });
  const d = s.distribute266(created.splitId, 1000n, { withdrawalRequest: true });
  assert266(d.antiDump.flagged === true);
  assert266(s.getAntiDumpEvents266(created.splitId).length === 1);
});

console.log('\n[V266] onboarding funnel and embedded wallet');
test266('onboarding creates wallet, exports state, and reports funnel', async () => {
  const wallets = new EmbeddedWallet266({
    custodyProvider: { createWallet: (userId, provider, identity, opts) => ({ walletId: `mock_wallet_${Date.now()}`, walletAddress: `mock_addr_${userId}` }), linkExternal: (userId, externalAddress, opts) => ({ walletId: `mock_linked_wallet_${Date.now()}`, walletAddress: externalAddress }) }
  });
  const flow = new OnboardingFlow266({ embeddedWallet: wallets, cryptoWordsFilter: { check: (text) => text.includes('seed phrase') ? { flagged: true, reason: 'Please avoid crypto terms' } : { flagged: false } } });
  const started = flow.startFlow266('userA', 'telegram', { telegramId: 'tg123' });
  assert266(started.fastPath === true);
  await flow.completeStep266('userA', 'first_action', { text: 'help me write' });
  await flow.completeStep266('userA', 'cost_reveal', { ok: true });
  await flow.completeStep266('userA', 'complete', { ok: true });
  assert266(flow.getFunnel266().completed === 1);
  assert266(wallets.resolveWallet266('userA').provider === 'telegram');
  assert266(flow.exportState266().sessions.length === 1);
});

test266('onboarding rejects crypto words in user copy', async () => {
  const flow = new OnboardingFlow266();
  flow.startFlow266('userB', 'chat');
  const r = await flow.completeStep266('userB', 'identity', { text: 'I need a seed phrase' });
  assert266(r.ok === false && r.error.includes('Please avoid crypto terms'));
});

console.log('\n[V266] MCP, USSD, audit bloom, wallet risk');
test266('MCP registry supports dry-run safe calls and blocks dangerous calls', async () => {
  const m = new MCPDeepIntegration266({
    mcpServerRegistry: new Map(),
    toolExecutor: async (toolId, input, opts) => ({ ok: true, executed: true, toolId, input, opts, dryRun: opts.dryRun })
  });
  m.registerServer266('srv', { name: 'Server' });
  const safe = m.registerTool266('srv', { name: 'search', risk: 'safe' });
  const out = await m.callTool266(safe.tool.toolId, { q: 'ecos' }, { dryRun: true });
  assert266(out.ok && out.output.dryRun === true);
  const dangerous = m.registerTool266('srv', { name: 'pay', risk: 'dangerous' });
  const blocked = await m.callTool266(dangerous.tool.toolId, {});
  assert266(blocked.ok === false && blocked.code === 'HITL_REQUIRED');
});

test266('USSD state machine reaches complete and exposes compact state', () => {
  const u = new UssdSmsStateMachine266({
    smsGateway: { send: () => {} },
    ussdGateway: { send: () => {} },
    sessionStore: new Map()
  });
  u.startSession266('phone1');
  u.handleInput266('phone1', '1');
  u.handleInput266('phone1', 'Mina');
  u.handleInput266('phone1', '2');
  const done = u.handleInput266('phone1', '1');
  assert266(done.state === USSD_STATES_266.COMPLETE);
  assert266(u.compact266('phone1').v === '266');
});

test266('Audit Bloom records exact and maybe membership', () => {
  const a = new AuditBloom266({ persistenceAdapter: { _bloomState: {}, loadBloomState: function() { return this._bloomState; }, saveBloomState: function(state) { this._bloomState = state; } } });
  a.addEvent266({ key: 'mission:step:hash' });
  const hit = a.has266('mission:step:hash');
  const miss = a.has266('mission:step:missing');
  assert266(hit.maybe && hit.exact);
  assert266(miss.exact === false);
});

test266('Embedded wallet risk lock is visible in mobile wallet', () => {
  const w = new EmbeddedWallet266({
    custodyProvider: { createWallet: (userId, provider, identity, opts) => ({ walletId: `mock_wallet_${Date.now()}`, walletAddress: `mock_addr_${userId}` }), linkExternal: (userId, externalAddress, opts) => ({ walletId: `mock_linked_wallet_${Date.now()}`, walletAddress: externalAddress }) }
  });
  const created = w.createWallet266('u1', 'email', 'u1@example.com');
  w.markRisk266(created.wallet.walletId, WALLET_RISK_266.LOCKED, 'sybil_review');
  assert266(w.getMobileWallet266('u1').st === 'locked');
});

console.log('\n[V266] execution programs and API state');
test266('Execution registry includes P15/P16/P18/P21/P24 and starts programs', () => {
  for (const id of ['P15', 'P16', 'P18', 'P21', 'P24']) assert266(PROGRAMS_266.some(p => p.id === id), `${id} missing`);
  const r = new ExecutionProgramRegistry266();
  assert266(r.startProgram266('P15', { budgetMicro: 1000n }).ok);
  assert266(r.getDashboard266().totalPrograms === 25);
});

test266('V266 API patch constructs complete module state', () => {
  const state = createV266State();
  assert266(state.version === '266');
  assert266(state.modules.mcp && state.modules.auditBloom && state.modules.wallets);
});

Promise.all(pending266).then(() => {
  console.log(`\nV266 tests: ${passed}/${total} passed, ${failed} failed`);
  if (failed > 0 || passed !== total) process.exit(1);
});
