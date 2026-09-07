'use strict';
/**
 * tests/v265.test.cjs — V265 canonical regression suite
 * Run: NODE_ENV=test node tests/v265.test.cjs
 */

const crypto = require('node:crypto');
const { X402Processor265, parseX402Header265, buildPaymentRequired265, X402_VERSION_265 } = require('../src/lib/x402265');
const { SplitModule265, VESTING_MIN_DAYS_265 } = require('../src/lib/splitModule265');
const { OnboardingFlow265 } = require('../src/lib/onboardingFlow265');
const { MCPDeepIntegration265 } = require('../src/lib/mcpDeepIntegration265');
const { EmbeddedWallet265, WALLET_RISK_265 } = require('../src/lib/embeddedWallet265');
const { UssdSmsStateMachine265, USSD_STATES_265 } = require('../src/lib/ussdSmsStateMachine265');
const { AuditBloom265 } = require('../src/lib/auditBloom265');
const { ExecutionProgramRegistry265, PROGRAMS_265 } = require('../src/lib/executionPrograms265');
const { createV265State } = require('../ecos-api-server-v265-patch');

let passed = 0, failed = 0, total = 0;
const pending265 = [];
function test265(name, fn) {
  total++;
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      const p = result.then(() => ok(name)).catch(err => bad(name, err));
      pending265.push(p);
      return p;
    }
    ok(name);
  } catch (err) { bad(name, err); }
}
function ok(name) { passed++; console.log(`  OK  ${name}`); }
function bad(name, err) { failed++; console.error(`  FAIL ${name}\n       ${err.stack || err.message}`); }
function assert265(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertThrows265(fn, part) { let threw = false, msg = ''; try { fn(); } catch (e) { threw = true; msg = e.message; } if (!threw) throw new Error('expected throw'); if (part && !msg.includes(part)) throw new Error(`expected ${part}, got ${msg}`); }

function sign265(payload, secret = 'ecos-x402-dev-secret-265') {
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

console.log('\n[V265] x402 facilitator rails');
test265('x402 parses facilitator and descriptor advertises facilitator', () => {
  const req = buildPaymentRequired265({ resource: '/r', amount: 0.01, payee: 'payee', facilitator: 'facilitator-1' });
  assert265(req.descriptor.facilitator === 'facilitator-1');
  const payload = { version: X402_VERSION_265, network: 'base', currency: 'USDC', from: 'payer', to: 'payee', amount: 0.01, resource: '/r', nonce: 'n1', timestamp: Date.now(), facilitator: 'facilitator-1' };
  payload.signature = sign265(payload);
  const header = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const parsed = parseX402Header265(header);
  assert265(parsed.facilitator === 'facilitator-1');
});

test265('x402 accepts HMAC payment with facilitator and records stats', () => {
  const p = new X402Processor265();
  p.registerResource265('/paid', 0.000001);
  const payload = { version: X402_VERSION_265, network: 'base', currency: 'USDC', from: 'u1', to: 'ecos', amount: 0.000002, resource: '/paid', nonce: 'n2', timestamp: Date.now(), facilitator: 'cbpay' };
  payload.signature = sign265(payload);
  const res = p.processPayment265(payload, { testMode: true });
  assert265(res.ok, 'payment accepted');
  assert265(res.facilitator === 'cbpay');
  assert265(p.getStats265().facilitatorPayments === 1);
});

console.log('\n[V265] split vesting and anti-dump');
test265('split enforces minimum vesting and anti-dump flags withdrawal', () => {
  const s = new SplitModule265();
  assertThrows265(() => s.createSplit265('u', [{ userId: 'a', bps: 10000 }], { enforceVesting: true, vestingDays: 10 }), String(VESTING_MIN_DAYS_265));
  const created = s.createSplit265('u', [{ userId: 'a', bps: 5000 }, { userId: 'b', bps: 5000 }], { antiDumpPolicy: { maxImmediateBps: 1000 } });
  const d = s.distribute265(created.splitId, 1000n, { withdrawalRequest: true });
  assert265(d.antiDump.flagged === true);
  assert265(s.getAntiDumpEvents265(created.splitId).length === 1);
});

console.log('\n[V265] onboarding funnel and embedded wallet');
test265('onboarding creates wallet, exports state, and reports funnel', async () => {
  const wallets = new EmbeddedWallet265();
  const flow = new OnboardingFlow265({ embeddedWallet: wallets });
  const started = flow.startFlow265('userA', 'telegram', { telegramId: 'tg123' });
  assert265(started.fastPath === true);
  await flow.completeStep265('userA', 'first_action', { text: 'help me write' });
  await flow.completeStep265('userA', 'cost_reveal', { ok: true });
  await flow.completeStep265('userA', 'complete', { ok: true });
  assert265(flow.getFunnel265().completed === 1);
  assert265(wallets.resolveWallet265('userA').provider === 'telegram');
  assert265(flow.exportState265().sessions.length === 1);
});

test265('onboarding rejects crypto words in user copy', async () => {
  const flow = new OnboardingFlow265();
  flow.startFlow265('userB', 'chat');
  const r = await flow.completeStep265('userB', 'identity', { text: 'I need a seed phrase' });
  assert265(r.ok === false && r.error.includes('Please avoid crypto terms'));
});

console.log('\n[V265] MCP, USSD, audit bloom, wallet risk');
test265('MCP registry supports dry-run safe calls and blocks dangerous calls', async () => {
  const m = new MCPDeepIntegration265();
  m.registerServer265('srv', { name: 'Server' });
  const safe = m.registerTool265('srv', { name: 'search', risk: 'safe' });
  const out = await m.callTool265(safe.tool.toolId, { q: 'ecos' }, { dryRun: true });
  assert265(out.ok && out.output.dryRun === true);
  const dangerous = m.registerTool265('srv', { name: 'pay', risk: 'dangerous' });
  const blocked = await m.callTool265(dangerous.tool.toolId, {});
  assert265(blocked.ok === false && blocked.code === 'HITL_REQUIRED');
});

test265('USSD state machine reaches complete and exposes compact state', () => {
  const u = new UssdSmsStateMachine265();
  u.startSession265('phone1');
  u.handleInput265('phone1', '1');
  u.handleInput265('phone1', 'Mina');
  u.handleInput265('phone1', '2');
  const done = u.handleInput265('phone1', '1');
  assert265(done.state === USSD_STATES_265.COMPLETE);
  assert265(u.compact265('phone1').v === '265');
});

test265('Audit Bloom records exact and maybe membership', () => {
  const a = new AuditBloom265();
  a.addEvent265({ key: 'mission:step:hash' });
  const hit = a.has265('mission:step:hash');
  const miss = a.has265('mission:step:missing');
  assert265(hit.maybe && hit.exact);
  assert265(miss.exact === false);
});

test265('Embedded wallet risk lock is visible in mobile wallet', () => {
  const w = new EmbeddedWallet265();
  const created = w.createWallet265('u1', 'email', 'u1@example.com');
  w.markRisk265(created.wallet.walletId, WALLET_RISK_265.LOCKED, 'sybil_review');
  assert265(w.getMobileWallet265('u1').st === 'locked');
});

console.log('\n[V265] execution programs and API state');
test265('Execution registry includes P15/P16/P18/P21/P24 and starts programs', () => {
  for (const id of ['P15', 'P16', 'P18', 'P21', 'P24']) assert265(PROGRAMS_265.some(p => p.id === id), `${id} missing`);
  const r = new ExecutionProgramRegistry265();
  assert265(r.startProgram265('P15', { budgetMicro: 1000n }).ok);
  assert265(r.getDashboard265().totalPrograms === 25);
});

test265('V265 API patch constructs complete module state', () => {
  const state = createV265State();
  assert265(state.version === '265');
  assert265(state.modules.mcp && state.modules.auditBloom && state.modules.wallets);
});

Promise.all(pending265).then(() => {
  console.log(`\nV265 tests: ${passed}/${total} passed, ${failed} failed`);
  if (failed > 0 || passed !== total) process.exit(1);
});
