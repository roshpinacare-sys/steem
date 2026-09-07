'use strict';
/**
 * ecos-api-server-v266-patch.js — ECOS V266 Canonical API Patch
 *
 * Adds V266 endpoints for x402 facilitator flows, MCP, embedded wallets,
 * USSD/SMS degraded onboarding, audit Bloom lookup, funnel analytics, and
 * vesting/anti-dump controls. Designed as additive middleware for an existing
 * Express-like app. Zero new npm deps.
 */

const { X402Processor266, x402Middleware266, buildPaymentRequired266 } = require('./src/lib/x402266');
const { MCPDeepIntegration266 } = require('./src/lib/mcpDeepIntegration266');
const { EmbeddedWallet266 } = require('./src/lib/embeddedWallet266');
const { UssdSmsStateMachine266 } = require('./src/lib/ussdSmsStateMachine266');
const { AuditBloom266 } = require('./src/lib/auditBloom266');
const { OnboardingFlow266 } = require('./src/lib/onboardingFlow266');
const { SplitModule266 } = require('./src/lib/splitModule266');
const { ExecutionProgramRegistry266, PROGRAMS_266 } = require('./src/lib/executionPrograms266');

function registerEcosV266Routes(app, deps = {}) {
  if (!app || typeof app.get !== 'function' || typeof app.post !== 'function') {
    throw new Error('registerEcosV266Routes: Express-like app with get/post required');
  }

  const state = createV266State(deps);

  app.get('/api/v266/health', (req, res) => res.json({ ok: true, version: '266', modules: Object.keys(state.modules) }));
  app.get('/api/v266/programs', (req, res) => res.json(state.programs.getDashboard266()));
  app.post('/api/v266/programs/:programId/start', jsonHandler266((req) => state.programs.startProgram266(req.params.programId, req.body || {})));

  app.get('/api/v266/x402/required', (req, res) => {
    const { descriptor, encoded } = buildPaymentRequired266({
      resource: req.query.resource || '/api/v266/paid',
      amount: Number(req.query.amount || 0.000001),
      payee: req.query.payee || deps.defaultPayee || 'ecos-payee',
      facilitator: req.query.facilitator || deps.facilitator || null,
    });
    res.json({ ok: true, descriptor, encoded });
  });
  app.post('/api/v266/x402/paid', x402Middleware266({ processor: state.x402, required: true, resource: '/api/v266/x402/paid', price: 0.000001, testMode: true, facilitator: deps.facilitator || null }), (req, res) => res.json({ ok: true, payment: req.x402Payment266 }));

  app.post('/api/v266/mcp/servers', jsonHandler266((req) => state.mcp.registerServer266(req.body.serverId, req.body)));
  app.post('/api/v266/mcp/tools', jsonHandler266((req) => state.mcp.registerTool266(req.body.serverId, req.body.tool || req.body)));
  app.get('/api/v266/mcp/tools', (req, res) => res.json({ ok: true, tools: state.mcp.listTools266(req.query || {}) }));
  app.post('/api/v266/mcp/call/:toolId', asyncHandler266(async (req, res) => res.json(await state.mcp.callTool266(req.params.toolId, req.body?.input || {}, req.body?.opts || {}))));

  app.post('/api/v266/wallets', jsonHandler266((req) => state.wallets.createWallet266(req.body.userId, req.body.provider, req.body.identity, req.body.opts || {})));
  app.get('/api/v266/wallets/:userId', (req, res) => res.json({ ok: true, wallet: state.wallets.resolveWallet266(req.params.userId) }));
  app.post('/api/v266/wallets/:userId/risk', jsonHandler266((req) => state.wallets.markRisk266(req.params.userId, req.body.risk, req.body.reason)));

  app.post('/api/v266/ussd/start', jsonHandler266((req) => state.ussd.startSession266(req.body.userId, req.body.channel || 'ussd', req.body.meta || {})));
  app.post('/api/v266/ussd/input', jsonHandler266((req) => state.ussd.handleInput266(req.body.userId, req.body.input || '')));
  app.get('/api/v266/ussd/:userId', (req, res) => res.json({ ok: true, session: state.ussd.getSession266(req.params.userId) }));

  app.post('/api/v266/onboarding/start', jsonHandler266((req) => state.onboarding.startFlow266(req.body.userId, req.body.channel || 'chat', req.body.meta || {})));
  app.post('/api/v266/onboarding/:userId/step/:stepId', asyncHandler266(async (req, res) => res.json(await state.onboarding.completeStep266(req.params.userId, req.params.stepId, req.body || {}))));
  app.get('/api/v266/onboarding/:userId', (req, res) => res.json({ ok: true, flow: state.onboarding.getFlow266(req.params.userId) }));
  app.get('/api/v266/onboarding-funnel', (req, res) => res.json(state.onboarding.getFunnel266()));

  app.post('/api/v266/audit-bloom/add', jsonHandler266((req) => state.auditBloom.addEvent266(req.body.event || req.body)));
  app.get('/api/v266/audit-bloom/has', (req, res) => res.json(state.auditBloom.has266(req.query.key || '')));
  app.get('/api/v266/audit-bloom/stats', (req, res) => res.json(state.auditBloom.getStats266()));

  app.post('/api/v266/splits', jsonHandler266((req) => state.splits.createSplit266(req.body.creatorId, req.body.recipients || [], req.body.opts || {})));
  app.post('/api/v266/splits/:splitId/distribute', jsonHandler266((req) => state.splits.distribute266(req.params.splitId, BigInt(req.body.amountMicro || 0), req.body.meta || {})));
  app.get('/api/v266/splits/:splitId/vesting', (req, res) => res.json({ ok: true, vesting: state.splits.getVestingStatus266(req.params.splitId), antiDump: state.splits.getAntiDumpEvents266(req.params.splitId) }));

  return state;
}

function createV266State(deps = {}) {
  const wallet = deps.embeddedWallet || new EmbeddedWallet266({
    ...deps,
    custodyProvider: deps.custodyProvider || null
  });
  return {
    version: '266',
    x402: deps.x402 || new X402Processor266({
      ...deps,
      settlementProvider: deps.settlementProvider || null
    }),
    mcp: deps.mcp || new MCPDeepIntegration266({
      ...deps,
      mcpServerRegistry: deps.mcpServerRegistry || null,
      toolExecutor: deps.toolExecutor || null
    }),
    wallets: wallet,
    ussd: deps.ussd || new UssdSmsStateMachine266({
      ...deps,
      smsGateway: deps.smsGateway || null,
      ussdGateway: deps.ussdGateway || null,
      sessionStore: deps.sessionStore || null
    }),
    auditBloom: deps.auditBloom || new AuditBloom266({
      ...deps,
      persistenceAdapter: deps.persistenceAdapter || null
    }),
    onboarding: deps.onboarding || new OnboardingFlow266({ ...deps, embeddedWallet: wallet }),
    splits: deps.splits || new SplitModule266({
      ...deps,
      antiDumpProvider: deps.antiDumpProvider || null,
      vestingProvider: deps.vestingProvider || null
    }),
    programs: deps.programs || new ExecutionProgramRegistry266(deps),
    modules: { x402: true, mcp: true, wallets: true, ussd: true, auditBloom: true, onboarding: true, splits: true, programs: true },
  };
}

function jsonHandler266(fn) {
  return (req, res) => {
    try { res.json(fn(req)); }
    catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  };
}

function asyncHandler266(fn) {
  return (req, res) => Promise.resolve(fn(req, res)).catch(err => res.status(400).json({ ok: false, error: err.message }));
}

module.exports = { registerEcosV266Routes, createV266State, PROGRAMS_266 };
