'use strict';
/**
 * ecos-api-server-v265-patch.js — ECOS V265 Canonical API Patch
 *
 * Adds V265 endpoints for x402 facilitator flows, MCP, embedded wallets,
 * USSD/SMS degraded onboarding, audit Bloom lookup, funnel analytics, and
 * vesting/anti-dump controls. Designed as additive middleware for an existing
 * Express-like app. Zero new npm deps.
 */

const { X402Processor265, x402Middleware265, buildPaymentRequired265 } = require('./src/lib/x402265');
const { MCPDeepIntegration265 } = require('./src/lib/mcpDeepIntegration265');
const { EmbeddedWallet265 } = require('./src/lib/embeddedWallet265');
const { UssdSmsStateMachine265 } = require('./src/lib/ussdSmsStateMachine265');
const { AuditBloom265 } = require('./src/lib/auditBloom265');
const { OnboardingFlow265 } = require('./src/lib/onboardingFlow265');
const { SplitModule265 } = require('./src/lib/splitModule265');
const { ExecutionProgramRegistry265, PROGRAMS_265 } = require('./src/lib/executionPrograms265');

function registerEcosV265Routes(app, deps = {}) {
  if (!app || typeof app.get !== 'function' || typeof app.post !== 'function') {
    throw new Error('registerEcosV265Routes: Express-like app with get/post required');
  }

  const state = createV265State(deps);

  app.get('/api/v265/health', (req, res) => res.json({ ok: true, version: '265', modules: Object.keys(state.modules) }));
  app.get('/api/v265/programs', (req, res) => res.json(state.programs.getDashboard265()));
  app.post('/api/v265/programs/:programId/start', jsonHandler265((req) => state.programs.startProgram265(req.params.programId, req.body || {})));

  app.get('/api/v265/x402/required', (req, res) => {
    const { descriptor, encoded } = buildPaymentRequired265({
      resource: req.query.resource || '/api/v265/paid',
      amount: Number(req.query.amount || 0.000001),
      payee: req.query.payee || deps.defaultPayee || 'ecos-payee',
      facilitator: req.query.facilitator || deps.facilitator || null,
    });
    res.json({ ok: true, descriptor, encoded });
  });
  app.post('/api/v265/x402/paid', x402Middleware265({ processor: state.x402, required: true, resource: '/api/v265/x402/paid', price: 0.000001, testMode: true, facilitator: deps.facilitator || null }), (req, res) => res.json({ ok: true, payment: req.x402Payment265 }));

  app.post('/api/v265/mcp/servers', jsonHandler265((req) => state.mcp.registerServer265(req.body.serverId, req.body)));
  app.post('/api/v265/mcp/tools', jsonHandler265((req) => state.mcp.registerTool265(req.body.serverId, req.body.tool || req.body)));
  app.get('/api/v265/mcp/tools', (req, res) => res.json({ ok: true, tools: state.mcp.listTools265(req.query || {}) }));
  app.post('/api/v265/mcp/call/:toolId', asyncHandler265(async (req, res) => res.json(await state.mcp.callTool265(req.params.toolId, req.body?.input || {}, req.body?.opts || {}))));

  app.post('/api/v265/wallets', jsonHandler265((req) => state.wallets.createWallet265(req.body.userId, req.body.provider, req.body.identity, req.body.opts || {})));
  app.get('/api/v265/wallets/:userId', (req, res) => res.json({ ok: true, wallet: state.wallets.resolveWallet265(req.params.userId) }));
  app.post('/api/v265/wallets/:userId/risk', jsonHandler265((req) => state.wallets.markRisk265(req.params.userId, req.body.risk, req.body.reason)));

  app.post('/api/v265/ussd/start', jsonHandler265((req) => state.ussd.startSession265(req.body.userId, req.body.channel || 'ussd', req.body.meta || {})));
  app.post('/api/v265/ussd/input', jsonHandler265((req) => state.ussd.handleInput265(req.body.userId, req.body.input || '')));
  app.get('/api/v265/ussd/:userId', (req, res) => res.json({ ok: true, session: state.ussd.getSession265(req.params.userId) }));

  app.post('/api/v265/onboarding/start', jsonHandler265((req) => state.onboarding.startFlow265(req.body.userId, req.body.channel || 'chat', req.body.meta || {})));
  app.post('/api/v265/onboarding/:userId/step/:stepId', asyncHandler265(async (req, res) => res.json(await state.onboarding.completeStep265(req.params.userId, req.params.stepId, req.body || {}))));
  app.get('/api/v265/onboarding/:userId', (req, res) => res.json({ ok: true, flow: state.onboarding.getFlow265(req.params.userId) }));
  app.get('/api/v265/onboarding-funnel', (req, res) => res.json(state.onboarding.getFunnel265()));

  app.post('/api/v265/audit-bloom/add', jsonHandler265((req) => state.auditBloom.addEvent265(req.body.event || req.body)));
  app.get('/api/v265/audit-bloom/has', (req, res) => res.json(state.auditBloom.has265(req.query.key || '')));
  app.get('/api/v265/audit-bloom/stats', (req, res) => res.json(state.auditBloom.getStats265()));

  app.post('/api/v265/splits', jsonHandler265((req) => state.splits.createSplit265(req.body.creatorId, req.body.recipients || [], req.body.opts || {})));
  app.post('/api/v265/splits/:splitId/distribute', jsonHandler265((req) => state.splits.distribute265(req.params.splitId, BigInt(req.body.amountMicro || 0), req.body.meta || {})));
  app.get('/api/v265/splits/:splitId/vesting', (req, res) => res.json({ ok: true, vesting: state.splits.getVestingStatus265(req.params.splitId), antiDump: state.splits.getAntiDumpEvents265(req.params.splitId) }));

  return state;
}

function createV265State(deps = {}) {
  const wallet = deps.embeddedWallet || new EmbeddedWallet265(deps);
  return {
    version: '265',
    x402: deps.x402 || new X402Processor265(deps),
    mcp: deps.mcp || new MCPDeepIntegration265(deps),
    wallets: wallet,
    ussd: deps.ussd || new UssdSmsStateMachine265(deps),
    auditBloom: deps.auditBloom || new AuditBloom265(deps),
    onboarding: deps.onboarding || new OnboardingFlow265({ ...deps, embeddedWallet: wallet }),
    splits: deps.splits || new SplitModule265(deps),
    programs: deps.programs || new ExecutionProgramRegistry265(deps),
    modules: { x402: true, mcp: true, wallets: true, ussd: true, auditBloom: true, onboarding: true, splits: true, programs: true },
  };
}

function jsonHandler265(fn) {
  return (req, res) => {
    try { res.json(fn(req)); }
    catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  };
}

function asyncHandler265(fn) {
  return (req, res) => Promise.resolve(fn(req, res)).catch(err => res.status(400).json({ ok: false, error: err.message }));
}

module.exports = { registerEcosV265Routes, createV265State, PROGRAMS_265 };
