'use strict';
/**
 * ecos-api-server-v269-patch.js — ECOS V269 Canonical API Patch
 *
 * Additive upgrade over V268 patch. V269 endpoints:
 *   - GET  /api/v269/health              — aggregate health for all modules
 *   - GET  /api/v269/perf               — p50/p95/p99 telemetry for all modules
 *   - POST /api/v269/providers/validate — validate provider implementations (22 contracts)
 *   - POST /api/v269/events/publish     — publish event to eventBus
 *   - GET  /api/v269/events/history     — retrieve event history (optional topic filter)
 *   - POST /api/v269/snapshot/save      — save state snapshot via snapshotEngine
 *   - POST /api/v269/snapshot/load      — load state snapshot
 *   - GET  /api/v269/version            — module inventory + version manifest
 *   - All V268 routes preserved (backward compatible)
 *
 * Zero new npm deps. Pass V268/V269 module instances to createV269State().
 */

const {
  PROVIDER_CONTRACTS_269,
  validateAllProviders269,
  createAllStubs269,
} = require('./src/lib/providerAdapters269');

// Re-use V268 imports
const { X402Processor268 }             = require('./src/lib/x402268');
const { MCPDeepIntegration268 }        = require('./src/lib/mcpDeepIntegration268');
const { EmbeddedWallet268 }            = require('./src/lib/embeddedWallet268');
const { UssdSmsStateMachine268 }       = require('./src/lib/ussdSmsStateMachine268');
const { AuditBloom268 }                = require('./src/lib/auditBloom268');
const { OnboardingFlow268 }            = require('./src/lib/onboardingFlow268');
const { SplitModule268 }               = require('./src/lib/splitModule268');
const { ExecutionProgramRegistry268 }  = require('./src/lib/executionPrograms268');
const { AgentReceipts268 }             = require('./src/lib/agentReceipts268');
const { BreakageEngine268 }            = require('./src/lib/breakageEngine268');
const { ConversionGateway268 }         = require('./src/lib/conversionGateway268');
const { CostAwareRouter268 }           = require('./src/lib/costAwareRouter268');
const { CreditReserve268 }             = require('./src/lib/creditReserve268');
const { InjectionFirewall268 }         = require('./src/lib/injectionFirewall268');
const { MemoryIntegrity268 }           = require('./src/lib/memoryIntegrity268');
const { Metacognition268 }             = require('./src/lib/metacognition268');
const { OfflineQueue268 }              = require('./src/lib/offlineQueue268');
const { QuadraticFunding268 }          = require('./src/lib/quadraticFunding268');
const { ReflectionLoop268 }            = require('./src/lib/reflectionLoop268');
const { ReputationLedger268 }          = require('./src/lib/reputationLedger268');
const { SybilGuard268 }                = require('./src/lib/sybilGuard268');
const { Telemetry268 }                 = require('./src/lib/telemetry268');
const { TipModule268 }                 = require('./src/lib/tipModule268');

// ── State factory ─────────────────────────────────────────────────────────────

function createV269State(opts = {}) {
  const stubs = createAllStubs269({ silent: true });

  const eventBus = opts.eventBus || stubs.eventBus;
  const snapshotEngine = opts.snapshotEngine || stubs.snapshotEngine;

  // Build V268-compatible core state (re-use V268 wiring pattern)
  const creditReserve = opts.creditReserve || new CreditReserve268({});
  const receipts      = opts.receipts      || new AgentReceipts268({});
  const sybil         = opts.sybil         || new SybilGuard268({});
  const ledger        = opts.ledger        || new ReputationLedger268({});
  const tips          = opts.tips          || new TipModule268({ creditReserve });
  const x402          = opts.x402          || new X402Processor268({
    creditReserve,
    settlementProvider: opts.settlementProvider || stubs.settlementProvider,
  });
  const mcp           = opts.mcp           || new MCPDeepIntegration268({
    mcpServerRegistry: opts.mcpServerRegistry || stubs.mcpServerRegistry,
    toolExecutor:      opts.toolExecutor      || stubs.toolExecutor,
  });
  const wallets       = opts.wallets       || new EmbeddedWallet268({
    custodyProvider: opts.custodyProvider || stubs.custodyProvider,
  });
  const ussd          = opts.ussd          || new UssdSmsStateMachine268({
    smsGateway:  opts.smsGateway  || stubs.smsGateway,
    ussdGateway: opts.ussdGateway || stubs.ussdGateway,
    sessionStore: opts.sessionStore || stubs.sessionStore,
  });
  const auditBloom    = opts.auditBloom    || new AuditBloom268({
    persistenceAdapter: opts.persistenceAdapter || stubs.persistenceAdapter,
  });
  const onboarding    = opts.onboarding    || new OnboardingFlow268({
    authProvider:      opts.authProvider      || stubs.authProvider,
    cryptoWordsFilter: opts.cryptoWordsFilter || stubs.cryptoWordsFilter,
    embeddedWallet:    wallets,
  });
  const splits        = opts.splits        || new SplitModule268({
    antiDumpProvider: opts.antiDumpProvider || stubs.antiDumpProvider,
    vestingProvider:  opts.vestingProvider  || stubs.vestingProvider,
  });
  const programs      = opts.programs      || new ExecutionProgramRegistry268({
    schedulerProvider: opts.schedulerProvider || stubs.schedulerProvider,
    budgetProvider:    opts.budgetProvider    || stubs.budgetProvider,
  });
  const hitlGate      = opts.hitlGate      || stubs.hitlGate;
  const loop          = opts.loop          || new ReflectionLoop268({
    hitlGate,
    agentReceipts: receipts,
  });
  const breakage      = opts.breakage      || new BreakageEngine268({});
  const conversion    = opts.conversion    || new ConversionGateway268({});
  const router        = opts.router        || new CostAwareRouter268({
    intelligenceRegistry: opts.intelligenceRegistry || stubs.intelligenceRegistry,
  });
  const firewall      = opts.firewall      || new InjectionFirewall268({});
  const memory        = opts.memory        || new MemoryIntegrity268({});
  const meta          = opts.meta          || new Metacognition268({});
  const queue         = opts.queue         || new OfflineQueue268({});
  const qfunding      = opts.qfunding      || new QuadraticFunding268({});
  const telemetry     = opts.telemetry     || new Telemetry268({});

  // Validate all providers
  const providerValidation = validateAllProviders269({
    settlementProvider: opts.settlementProvider || stubs.settlementProvider,
    custodyProvider:    opts.custodyProvider    || stubs.custodyProvider,
    hitlGate,
    snapshotEngine,
    eventBus,
  });

  const modules = {
    x402, mcp, wallets, ussd, auditBloom, onboarding, splits, programs,
    receipts, breakage, conversion, router, creditReserve, firewall,
    memory, meta, queue, qfunding, loop, ledger, sybil, telemetry, tips,
  };

  return {
    version: '269',
    modules,
    providerValidation,
    eventBus,
    snapshotEngine,
    // flat accessors
    x402, mcp, wallets, ussd, auditBloom, onboarding, splits, programs,
    receipts, breakage, conversion, router, creditReserve, firewall,
    memory, meta, queue, qfunding, loop, ledger, sybil, telemetry, tips,
  };
}

// ── Route Registration ────────────────────────────────────────────────────────

function registerEcosV269Routes(app, depsOrState = {}) {
  if (!app || typeof app.get !== 'function') {
    throw new Error('registerEcosV269Routes: Express-like app required');
  }

  const state = depsOrState.version === '269'
    ? depsOrState
    : createV269State(depsOrState);

  // ── Version ──────────────────────────────────────────────────────────────

  app.get('/api/v269/version', (req, res) => {
    res.json({
      ok: true,
      version: '269',
      modules: Object.keys(state.modules),
      contracts: Object.keys(PROVIDER_CONTRACTS_269),
      providerValidation: state.providerValidation,
      ts: new Date().toISOString(),
    });
  });

  // ── Health ───────────────────────────────────────────────────────────────

  app.get('/api/v269/health', (req, res) => {
    const moduleHealth = {};
    for (const [name, mod] of Object.entries(state.modules)) {
      const healthMethod = Object.keys(mod)
        .find(k => k.startsWith('check') && k.endsWith('Health268'));
      moduleHealth[name] = healthMethod
        ? (() => { try { return mod[healthMethod](); } catch (e) { return { ok: false, error: e.message }; } })()
        : { ok: true, version: '269', note: 'no dedicated health method' };
    }
    res.json({ ok: true, version: '269', modules: moduleHealth, ts: new Date().toISOString() });
  });

  // ── Perf ─────────────────────────────────────────────────────────────────

  app.get('/api/v269/perf', (req, res) => {
    const perf = {};
    for (const [name, mod] of Object.entries(state.modules)) {
      if (typeof mod.getPerf268 === 'function') {
        try { perf[name] = mod.getPerf268(); } catch (_) {}
      }
    }
    res.json({ ok: true, version: '269', perf, ts: new Date().toISOString() });
  });

  // ── Provider Validation ───────────────────────────────────────────────────

  app.post('/api/v269/providers/validate', (req, res) => {
    try {
      const result = validateAllProviders269(req.body || {});
      res.json({ ok: result.ok, version: '269', ...result });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  // ── Event Bus ─────────────────────────────────────────────────────────────

  app.post('/api/v269/events/publish', (req, res) => {
    try {
      const { topic, payload } = req.body || {};
      if (!topic) return res.status(400).json({ ok: false, error: 'topic required' });
      const result = state.eventBus.publish(topic, payload || {});
      res.json({ ok: true, version: '269', ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/v269/events/history', (req, res) => {
    try {
      const { topic } = req.query;
      const history = typeof state.eventBus.getHistory === 'function'
        ? state.eventBus.getHistory(topic || undefined)
        : [];
      res.json({ ok: true, version: '269', count: history.length, events: history });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Snapshot ──────────────────────────────────────────────────────────────

  app.post('/api/v269/snapshot/save', (req, res) => {
    try {
      const { snapshotId, metadata } = req.body || {};
      if (!snapshotId) return res.status(400).json({ ok: false, error: 'snapshotId required' });
      const result = state.snapshotEngine.save(snapshotId, { metadata, ts: Date.now() });
      res.json({ ok: true, version: '269', snapshotId, ...(result || {}) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/v269/snapshot/load', (req, res) => {
    try {
      const { snapshotId } = req.body || {};
      if (!snapshotId) return res.status(400).json({ ok: false, error: 'snapshotId required' });
      const result = state.snapshotEngine.load(snapshotId);
      res.json({ ok: true, version: '269', snapshotId, snapshot: result || null });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}

module.exports = { createV269State, registerEcosV269Routes };
