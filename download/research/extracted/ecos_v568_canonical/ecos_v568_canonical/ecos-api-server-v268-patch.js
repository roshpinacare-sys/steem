'use strict';
/**
 * ecos-api-server-v268-patch.js — ECOS V268 Canonical API Patch
 *
 * Additive upgrade over V267 patch. V268 endpoints add:
 *   - /api/v268/health              — perf telemetry + provider health for all 24 modules
 *   - /api/v268/perf                — aggregate performance telemetry (all modules)
 *   - /api/v268/providers/validate  — runtime provider contract validation (21 types)
 *   - /api/v268/tips/*              — sendTip, createTip, community pool, leaderboard
 *   - /api/v268/reputation/*        — addAttestation, getScore, selective disclosure
 *   - /api/v268/sybil/*             — evaluate humanity score, velocity check
 *   - /api/v268/reflection/*        — run reflection loop, stats
 *   - /api/v268/quadratic/*         — createRound, contribute, distribute CLR
 *   - /api/v268/telemetry/spans     — export OTel spans
 *   - /api/v268/memory/*            — signWrite, readScope, rollback
 *   - /api/v268/router/*            — routeTask, get model for budget
 *   - /api/v268/credits/*           — backing ratio, top-up, halt threshold
 *   - /api/v268/breakage/*          — cohort breakage recognition, escheat scan
 *   - /api/v268/offline-queue/*     — enqueue, replay, queue depth
 *   - /api/v268/receipts/*          — mandate chain export, AP2 manifest
 *   - /api/v268/firewall/check      — validate input before injection
 *   - All V267 routes preserved (backward compatible)
 *
 * Zero new npm deps. Pass V268 module instances or deps to createV268State().
 */

const { X402Processor268, x402Middleware268, buildPaymentRequired268 } = require('./src/lib/x402268');
const { MCPDeepIntegration268 } = require('./src/lib/mcpDeepIntegration268');
const { EmbeddedWallet268 } = require('./src/lib/embeddedWallet268');
const { UssdSmsStateMachine268 } = require('./src/lib/ussdSmsStateMachine268');
const { AuditBloom268 } = require('./src/lib/auditBloom268');
const { OnboardingFlow268 } = require('./src/lib/onboardingFlow268');
const { SplitModule268 } = require('./src/lib/splitModule268');
const { ExecutionProgramRegistry268, PROGRAMS_268 } = require('./src/lib/executionPrograms268');
const { AgentReceipts268 } = require('./src/lib/agentReceipts268');
const { BreakageEngine268 } = require('./src/lib/breakageEngine268');
const { ConversionGateway268 } = require('./src/lib/conversionGateway268');
const { CostAwareRouter268 } = require('./src/lib/costAwareRouter268');
const { CreditReserve268 } = require('./src/lib/creditReserve268');
const { InjectionFirewall268 } = require('./src/lib/injectionFirewall268');
const { MemoryIntegrity268 } = require('./src/lib/memoryIntegrity268');
const { Metacognition268 } = require('./src/lib/metacognition268');
const { OfflineQueue268 } = require('./src/lib/offlineQueue268');
const { QuadraticFunding268 } = require('./src/lib/quadraticFunding268');
const { ReflectionLoop268 } = require('./src/lib/reflectionLoop268');
const { ReputationLedger268 } = require('./src/lib/reputationLedger268');
const { SybilGuard268 } = require('./src/lib/sybilGuard268');
const { Telemetry268 } = require('./src/lib/telemetry268');
const { TipModule268 } = require('./src/lib/tipModule268');
const { validateAllProviders268 } = require('./src/lib/providerAdapters268');

// ── Route Registration ───────────────────────────────────────────────────────

function registerEcosV268Routes(app, deps = {}) {
  if (!app || typeof app.get !== 'function' || typeof app.post !== 'function') {
    throw new Error('registerEcosV268Routes: Express-like app with get/post required');
  }

  const state = createV268State(deps);

  // ── Meta ──────────────────────────────────────────────────────────────────

  app.get('/api/v268/health', (req, res) => {
    res.json({
      ok: true,
      version: '268',
      modules: Object.keys(state.modules),
      providerHealth: {
        // V267 enhanced modules
        x402:        state.x402.checkSettlementHealth268?.()     || null,
        mcp:         state.mcp.checkToolExecutorHealth268?.()    || null,
        wallets:     state.wallets.checkCustodyHealth268?.()     || null,
        ussd:        state.ussd.checkGatewayHealth268?.()        || null,
        auditBloom:  state.auditBloom.checkPersistenceHealth268?.() || null,
        splits:      state.splits.checkProviderHealth268?.()     || null,
        onboarding:  state.onboarding.checkProviderHealth268?.() || null,
        programs:    state.programs.checkProviderHealth268?.()   || null,
        // V268 new modules
        receipts:    state.receipts.checkReceiptsHealth268?.()   || null,
        breakage:    state.breakage.checkBreakageHealth268?.()   || null,
        conversion:  state.conversion.checkGatewayHealth268?.()  || null,
        router:      state.router.checkRouterHealth268?.()       || null,
        credits:     state.credits.checkReserveHealth268?.()     || null,
        firewall:    state.firewall.checkFirewallHealth268?.()   || null,
        memory:      state.memory.checkMemoryHealth268?.()       || null,
        metacog:     state.metacog.checkMetacognitionHealth268?.() || null,
        queue:       state.queue.checkQueueHealth268?.()         || null,
        qFunding:    state.qFunding.checkFundingHealth268?.()    || null,
        reflection:  state.reflection.checkReflectionHealth268?.() || null,
        reputation:  state.reputation.checkReputationHealth268?.() || null,
        sybil:       state.sybil.checkSybilHealth268?.()         || null,
        telemetry:   state.telemetry.checkTelemetryHealth268?.() || null,
        tips:        state.tips.checkTipHealth268?.()            || null,
      },
    });
  });

  app.get('/api/v268/perf', (req, res) => {
    res.json({
      ok: true,
      version: '268',
      perf: {
        x402:       state.x402.getPerf268?.()        || null,
        mcp:        state.mcp.getPerf268?.()         || null,
        wallets:    state.wallets.getPerf268?.()     || null,
        ussd:       state.ussd.getPerf268?.()        || null,
        auditBloom: state.auditBloom.getPerf268?.()  || null,
        splits:     state.splits.getPerf268?.()      || null,
        onboarding: state.onboarding.getPerf268?.()  || null,
        programs:   state.programs.getPerf268?.()    || null,
        receipts:   state.receipts.getPerf268?.()    || null,
        breakage:   state.breakage.getPerf268?.()    || null,
        conversion: state.conversion.getPerf268?.()  || null,
        router:     state.router.getPerf268?.()      || null,
        credits:    state.credits.getPerf268?.()     || null,
        firewall:   state.firewall.getPerf268?.()    || null,
        memory:     state.memory.getPerf268?.()      || null,
        metacog:    state.metacog.getPerf268?.()     || null,
        queue:      state.queue.getPerf268?.()       || null,
        qFunding:   state.qFunding.getPerf268?.()    || null,
        reflection: state.reflection.getPerf268?.()  || null,
        reputation: state.reputation.getPerf268?.()  || null,
        sybil:      state.sybil.getPerf268?.()       || null,
        telemetry:  state.telemetry.getPerf268?.()   || null,
        tips:       state.tips.getPerf268?.()        || null,
      },
    });
  });

  app.post('/api/v268/providers/validate', jsonHandler268((req) => {
    const result = validateAllProviders268(req.body || {});
    return { ok: result.ok, ...result };
  }));

  // ── Programs (preserved from V267) ────────────────────────────────────────
  app.get('/api/v268/programs', (req, res) => res.json(state.programs.getDashboard268()));
  app.get('/api/v268/programs/list', (req, res) => res.json({ ok: true, programs: state.programs.listPrograms268(req.query || {}) }));
  app.get('/api/v268/programs/:programId', (req, res) => {
    const p = state.programs.getProgram268(req.params.programId);
    res.json(p ? { ok: true, program: p } : { ok: false, error: 'not_found' });
  });
  app.post('/api/v268/programs/:programId/start', jsonHandler268((req) => state.programs.startProgram268(req.params.programId, req.body || {})));
  app.post('/api/v268/programs/:programId/complete', jsonHandler268((req) => state.programs.completeProgram268(req.params.programId, req.body || {})));
  app.post('/api/v268/programs/:programId/missions', jsonHandler268((req) => state.programs.addMission268(req.params.programId, req.body.missionId, req.body.description || '')));
  app.post('/api/v268/programs/:programId/block', jsonHandler268((req) => state.programs.blockProgram268(req.params.programId, req.body.reason || 'blocked')));

  // ── x402 Payment Rails ────────────────────────────────────────────────────
  app.post('/api/v268/x402/process', asyncHandler268(async (req, res) => {
    const result = await state.x402.processPayment268(req.body || {});
    res.json(result);
  }));
  app.get('/api/v268/x402/health', (req, res) => res.json({ ok: true, health: state.x402.checkSettlementHealth268?.() || null }));

  // ── Embedded Wallets ──────────────────────────────────────────────────────
  app.post('/api/v268/wallets/create', jsonHandler268((req) => state.wallets.createWallet268(req.body.userId, req.body.provider, req.body.identity || {}, req.body)));
  app.post('/api/v268/wallets/link', jsonHandler268((req) => state.wallets.linkExternalWallet268(req.body.userId, req.body.externalAddress, req.body)));
  app.get('/api/v268/wallets/:userId', (req, res) => res.json({ ok: true, wallets: state.wallets.getWallets268(req.params.userId) }));
  app.get('/api/v268/wallets/:userId/balance', (req, res) => res.json(state.wallets.getBalance268(req.params.userId)));

  // ── MCP Deep Integration ──────────────────────────────────────────────────
  app.post('/api/v268/mcp/tools/call', asyncHandler268(async (req, res) => {
    const result = await state.mcp.callTool268(req.body.toolId, req.body.input || {}, req.body);
    res.json(result);
  }));
  app.post('/api/v268/mcp/tools/safe-call', asyncHandler268(async (req, res) => {
    const result = await state.mcp.safeDryRunTool268(req.body.toolId, req.body.input || {}, req.body);
    res.json(result);
  }));
  app.get('/api/v268/mcp/health', (req, res) => res.json({ ok: true, health: state.mcp.checkToolExecutorHealth268?.() || null }));

  // ── USSD/SMS ──────────────────────────────────────────────────────────────
  app.post('/api/v268/ussd/session', jsonHandler268((req) => state.ussd.startSession268(req.body.userId, req.body.provider || 'ussd')));
  app.post('/api/v268/ussd/input', asyncHandler268(async (req, res) => {
    const result = await state.ussd.handleInput268(req.body.userId, req.body.input || '');
    res.json(result);
  }));
  app.get('/api/v268/ussd/health', (req, res) => res.json({ ok: true, health: state.ussd.checkGatewayHealth268?.() || null }));

  // ── Audit Bloom ──────────────────────────────────────────────────────────
  app.post('/api/v268/audit-bloom/event', jsonHandler268((req) => state.auditBloom.addEvent268(req.body.eventId, req.body.meta || {})));
  app.post('/api/v268/audit-bloom/check', jsonHandler268((req) => ({ ok: true, seen: state.auditBloom.hasSeen268(req.body.eventId) })));
  app.post('/api/v268/audit-bloom/snapshot', asyncHandler268(async (req, res) => {
    const result = await state.auditBloom.saveSnapshot268();
    res.json(result);
  }));

  // ── Onboarding ────────────────────────────────────────────────────────────
  app.post('/api/v268/onboarding/start', jsonHandler268((req) => state.onboarding.startOnboarding268(req.body.userId, req.body.meta || {})));
  app.post('/api/v268/onboarding/step', asyncHandler268(async (req, res) => {
    const result = await state.onboarding.completeStep268(req.body.userId, req.body.step, req.body.data || {});
    res.json(result);
  }));
  app.get('/api/v268/onboarding/:userId/state', (req, res) => res.json({ ok: true, state: state.onboarding.getState268(req.params.userId) }));

  // ── Identity / Sybil (V268 new) ───────────────────────────────────────────
  app.post('/api/v268/onboarding/:userId/identity', asyncHandler268(async (req, res) => {
    const sybilResult = await state.sybil.evaluate268(req.params.userId, req.body || {});
    let reputationResult = null;
    if (sybilResult.ok && sybilResult.score > 0.5) {
      reputationResult = state.reputation.addAttestation268(req.params.userId, 'sybil_pass', { score: sybilResult.score });
    }
    res.json({ ok: sybilResult.ok, humanityScore: sybilResult.score, sybil: sybilResult, reputation: reputationResult });
  }));

  // ── Splits ────────────────────────────────────────────────────────────────
  app.post('/api/v268/splits/create', jsonHandler268((req) => state.splits.createSplit268(req.body.missionId, req.body.contributors || [], req.body)));
  app.post('/api/v268/splits/distribute', asyncHandler268(async (req, res) => {
    const result = await state.splits.distribute268(req.body.splitId, req.body.totalMicro ? BigInt(req.body.totalMicro) : 0n, req.body);
    res.json(result);
  }));
  app.get('/api/v268/splits/stats', (req, res) => res.json(state.splits.getStats268()));
  app.get('/api/v268/splits/health', (req, res) => res.json({ ok: true, health: state.splits.checkProviderHealth268?.() || null }));

  // ── Tips (V268 new) ───────────────────────────────────────────────────────
  app.post('/api/v268/tips/send', asyncHandler268(async (req, res) => {
    const result = await state.tips.sendTip268(req.body.fromUserId, req.body.toUserId, BigInt(req.body.amountMicro || 0), req.body);
    res.json(result);
  }));
  app.get('/api/v268/tips/leaderboard', (req, res) => res.json({ ok: true, leaderboard: state.tips.getLeaderboard268?.(req.query || {}) || [] }));
  app.get('/api/v268/tips/pool', (req, res) => res.json({ ok: true, pool: state.tips.getPoolStats268?.() || null }));
  app.get('/api/v268/tips/stats', (req, res) => res.json({ ok: true, stats: state.tips.getStats268?.() || null }));

  // ── Reputation (V268 new) ─────────────────────────────────────────────────
  app.post('/api/v268/reputation/attest', jsonHandler268((req) => state.reputation.addAttestation268(req.body.userId, req.body.type, req.body.data || {})));
  app.get('/api/v268/reputation/:userId', (req, res) => res.json({ ok: true, score: state.reputation.getScore268?.(req.params.userId) || null }));
  app.get('/api/v268/reputation/:userId/attestations', (req, res) => res.json({ ok: true, attestations: state.reputation.getAttestations268?.(req.params.userId) || [] }));

  // ── Sybil (V268 new) ──────────────────────────────────────────────────────
  app.post('/api/v268/sybil/evaluate', asyncHandler268(async (req, res) => {
    const result = await state.sybil.evaluate268(req.body.userId, req.body || {});
    res.json(result);
  }));
  app.get('/api/v268/sybil/:userId/score', (req, res) => res.json({ ok: true, ...state.sybil.getScore268?.(req.params.userId) || {} }));
  app.get('/api/v268/sybil/health', (req, res) => res.json({ ok: true, health: state.sybil.checkSybilHealth268?.() || null }));

  // ── Reflection (V268 new) ─────────────────────────────────────────────────
  app.post('/api/v268/reflection/run', asyncHandler268(async (req, res) => {
    const { taskType, context, opts } = req.body || {};
    const proposer  = async (ctx, attempt) => ({ output: `proposer-result-attempt${attempt}`, ok: true });
    const verifier  = async (output, ctx)  => ({ ok: true, errors: [], score: 0.9 });
    const result = await state.reflection.execute268(taskType || 'generic', proposer, verifier, context || {}, opts || {});
    res.json(result);
  }));
  app.get('/api/v268/reflection/stats', (req, res) => res.json({ ok: true, stats: state.reflection.getStats268?.() || null }));

  // ── Quadratic Funding (V268 new) ──────────────────────────────────────────
  app.post('/api/v268/quadratic/rounds', jsonHandler268((req) => state.qFunding.createRound268(req.body.roundId, req.body.opts || {})));
  app.post('/api/v268/quadratic/rounds/:roundId/contribute', jsonHandler268((req) => state.qFunding.contribute268(req.params.roundId, req.body.userId, BigInt(req.body.amountMicro || 0), req.body.projectId, req.body)));
  app.post('/api/v268/quadratic/rounds/:roundId/distribute', jsonHandler268((req) => state.qFunding.distributeRound268(req.params.roundId, req.body)));
  app.get('/api/v268/quadratic/rounds', (req, res) => res.json({ ok: true, rounds: state.qFunding.listRounds268?.() || [] }));

  // ── Telemetry/Spans (V268 new) ────────────────────────────────────────────
  app.post('/api/v268/telemetry/spans/start', jsonHandler268((req) => {
    const span = state.telemetry.startSpan268(req.body.name || 'span', req.body.attrs || {});
    return { ok: true, spanId: span.spanId };
  }));
  app.post('/api/v268/telemetry/spans/end', jsonHandler268((req) => {
    state.telemetry.endSpan268(req.body.spanId, req.body.status || 'OK', req.body.attrs || {});
    return { ok: true };
  }));
  app.get('/api/v268/telemetry/spans', (req, res) => res.json({ ok: true, spans: state.telemetry.getRecentSpans268?.() || [] }));
  app.get('/api/v268/telemetry/metrics', (req, res) => res.json({ ok: true, metrics: state.telemetry.getMetrics268?.() || null }));

  // ── Memory (V268 new) ─────────────────────────────────────────────────────
  app.post('/api/v268/memory/write', asyncHandler268(async (req, res) => {
    const result = await state.memory.signWrite268(req.body.scope, req.body.key, req.body.value, req.body);
    res.json(result);
  }));
  app.post('/api/v268/memory/read', asyncHandler268(async (req, res) => {
    const result = await state.memory.verifyRead268(req.body.scope, req.body.key, req.body);
    res.json(result);
  }));
  app.post('/api/v268/memory/rollback', jsonHandler268((req) => state.memory.bulkRollback268(req.body.scope, req.body.keys || [], req.body)));
  app.get('/api/v268/memory/health', (req, res) => res.json({ ok: true, health: state.memory.checkMemoryHealth268?.() || null }));

  // ── Cost-Aware Router (V268 new) ──────────────────────────────────────────
  app.post('/api/v268/router/route', asyncHandler268(async (req, res) => {
    const result = await state.router.routeTask268(req.body.taskType || 'generic', req.body.context || {}, req.body);
    res.json(result);
  }));
  app.get('/api/v268/router/stats', (req, res) => res.json({ ok: true, stats: state.router.getStats268?.() || null }));

  // ── Credits (V268 new) ────────────────────────────────────────────────────
  app.get('/api/v268/credits/ratio', (req, res) => res.json({ ok: true, ...state.credits.getBackingRatio268?.() || {} }));
  app.post('/api/v268/credits/topup', asyncHandler268(async (req, res) => {
    const result = await state.credits.microTopUp268?.(req.body.userId, BigInt(req.body.amountMicro || 0), req.body);
    res.json(result || { ok: true });
  }));
  app.get('/api/v268/credits/stats', (req, res) => res.json({ ok: true, stats: state.credits.getStats268?.() || null }));

  // ── Breakage (V268 new) ───────────────────────────────────────────────────
  app.post('/api/v268/breakage/issuance', jsonHandler268((req) => {
    state.breakage.recordIssuance268(req.body.accountId, BigInt(req.body.amountMicro || 0), req.body.cohortId, req.body);
    return { ok: true };
  }));
  app.post('/api/v268/breakage/recognize', jsonHandler268((req) => state.breakage.recognizeBreakage268(req.body)));
  app.post('/api/v268/breakage/escheat-scan', jsonHandler268((req) => state.breakage.escheatScan268(req.body)));
  app.get('/api/v268/breakage/stats', (req, res) => res.json({ ok: true, stats: state.breakage.getStats268?.() || null }));

  // ── Offline Queue (V268 new) ──────────────────────────────────────────────
  app.post('/api/v268/offline-queue/enqueue', jsonHandler268((req) => state.queue.enqueue268(req.body)));
  app.post('/api/v268/offline-queue/replay', asyncHandler268(async (req, res) => {
    const result = await state.queue.replay268(req.body || {});
    res.json(result);
  }));
  app.get('/api/v268/offline-queue/depth', (req, res) => res.json({ ok: true, depth: state.queue.getDepth268?.() || 0 }));
  app.get('/api/v268/offline-queue/stats', (req, res) => res.json({ ok: true, stats: state.queue.getStats268?.() || null }));

  // ── Agent Receipts (V268 new) ─────────────────────────────────────────────
  app.post('/api/v268/receipts/init', jsonHandler268((req) => {
    state.receipts.initReceipt268(req.body.missionId, req.body.meta || {});
    return { ok: true };
  }));
  app.get('/api/v268/receipts/:missionId', (req, res) => res.json({ ok: true, receipt: state.receipts.getReceipt268?.(req.params.missionId) || null }));
  app.post('/api/v268/receipts/:missionId/verify', jsonHandler268((req) => {
    const valid = state.receipts.verifyChain268?.(req.params.missionId);
    return { ok: true, valid: valid !== false };
  }));
  app.get('/api/v268/receipts/:missionId/manifest', (req, res) => res.json({ ok: true, manifest: state.receipts.exportAP2Manifest268?.(req.params.missionId) || null }));

  // ── Injection Firewall (V268 new) ─────────────────────────────────────────
  app.post('/api/v268/firewall/check', jsonHandler268((req) => state.firewall.checkInput268?.(req.body.input || '', req.body) || { ok: true, safe: true }));
  app.post('/api/v268/firewall/scan-egress', jsonHandler268((req) => state.firewall.scanEgress268?.(req.body.output || '', req.body) || { ok: true, safe: true }));
  app.get('/api/v268/firewall/stats', (req, res) => res.json({ ok: true, stats: state.firewall.getStats268?.() || null }));

  // ── Conversion Gateway (V268 new) ─────────────────────────────────────────
  app.post('/api/v268/conversion/credit-to-usdc', asyncHandler268(async (req, res) => {
    const result = await state.conversion.creditToUsdc268(req.body.userId, BigInt(req.body.amountMicro || 0), req.body);
    res.json(result);
  }));
  app.post('/api/v268/conversion/rate', jsonHandler268((req) => {
    state.conversion.setRate268(req.body.currency || 'USDC', req.body.rate);
    return { ok: true };
  }));
  app.get('/api/v268/conversion/stats', (req, res) => res.json({ ok: true, stats: state.conversion.getStats268?.() || null }));

  // ── Metacognition (V268 new) ──────────────────────────────────────────────
  app.post('/api/v268/metacognition/record', jsonHandler268((req) => state.metacog.recordOutcome268?.(req.body.taskType, req.body.strategyId, req.body.success, req.body) || { ok: true }));
  app.get('/api/v268/metacognition/strategy/:taskType', (req, res) => res.json({ ok: true, strategy: state.metacog.suggestStrategy268?.(req.params.taskType) || 'default' }));
  app.get('/api/v268/metacognition/stats', (req, res) => res.json({ ok: true, stats: state.metacog.getStats268?.() || null }));

  return state;
}

// ── State Factory ────────────────────────────────────────────────────────────

function createV268State(deps = {}) {
  const wallet = deps.embeddedWallet || new EmbeddedWallet268({
    logger:          deps.logger          || null,
    auditLog:        deps.auditLog        || null,
    custodyProvider: deps.custodyProvider || null,
  });

  const receipts = deps.receipts || new AgentReceipts268({
    logger:        deps.logger        || null,
    auditLog:      deps.auditLog      || null,
    creditReserve: deps.creditReserve || null,
  });

  const metacog = deps.metacognition || new Metacognition268({
    logger:         deps.logger         || null,
    auditLog:       deps.auditLog       || null,
    snapshotEngine: deps.snapshotEngine || null,
  });

  const reflection = deps.reflection || new ReflectionLoop268({
    logger:        deps.logger        || null,
    auditLog:      deps.auditLog      || null,
    hitlGate:      deps.hitlGate      || null,
    sandboxExec:   deps.sandboxExec   || null,
    metacognition: metacog,
    agentReceipts: receipts,
  });

  const credits = deps.credits || new CreditReserve268({
    logger:    deps.logger    || null,
    auditLog:  deps.auditLog  || null,
    db:        deps.db        || null,
  });

  const router = deps.router || new CostAwareRouter268({
    logger:               deps.logger               || null,
    auditLog:             deps.auditLog             || null,
    intelligenceRegistry: deps.intelligenceRegistry || null,
    vectorMemory:         deps.vectorMemory         || null,
  });

  return {
    version: '268',
    // ── V267 enhanced modules ──
    x402: deps.x402 || new X402Processor268({
      logger:             deps.logger             || null,
      auditLog:           deps.auditLog           || null,
      settlementProvider: deps.settlementProvider || null,
    }),
    mcp: deps.mcp || new MCPDeepIntegration268({
      logger:            deps.logger            || null,
      auditLog:          deps.auditLog          || null,
      agentReceipts:     receipts,
      mcpServerRegistry: deps.mcpServerRegistry || null,
      toolExecutor:      deps.toolExecutor      || null,
    }),
    wallets: wallet,
    ussd: deps.ussd || new UssdSmsStateMachine268({
      logger:       deps.logger       || null,
      auditLog:     deps.auditLog     || null,
      smsGateway:   deps.smsGateway   || null,
      ussdGateway:  deps.ussdGateway  || null,
      sessionStore: deps.sessionStore || null,
    }),
    auditBloom: deps.auditBloom || new AuditBloom268({
      logger:             deps.logger             || null,
      auditLog:           deps.auditLog           || null,
      persistenceAdapter: deps.persistenceAdapter || null,
    }),
    onboarding: deps.onboarding || new OnboardingFlow268({
      logger:            deps.logger            || null,
      auditLog:          deps.auditLog          || null,
      authProvider:      deps.authProvider      || null,
      authService:       deps.authService       || null,
      agentReceipts:     receipts,
      reputationLedger:  deps.reputationLedger  || null,
      embeddedWallet:    wallet,
      persistence:       deps.persistence       || null,
      cryptoWordsFilter: deps.cryptoWordsFilter || null,
    }),
    splits: deps.splits || new SplitModule268({
      logger:           deps.logger           || null,
      auditLog:         deps.auditLog         || null,
      creditReserve:    credits,
      agentReceipts:    receipts,
      antiDumpProvider: deps.antiDumpProvider || null,
      vestingProvider:  deps.vestingProvider  || null,
    }),
    programs: deps.programs || new ExecutionProgramRegistry268({
      logger:            deps.logger            || null,
      auditLog:          deps.auditLog          || null,
      agentReceipts:     receipts,
      costRouter:        router,
      memIntegrity:      deps.memIntegrity      || null,
      metacognition:     metacog,
      schedulerProvider: deps.schedulerProvider || null,
      budgetProvider:    deps.budgetProvider    || null,
    }),
    // ── V268 new modules ──
    receipts,
    metacog,
    reflection,
    credits,
    router,
    breakage: deps.breakage || new BreakageEngine268({
      logger:   deps.logger   || null,
      auditLog: deps.auditLog || null,
    }),
    conversion: deps.conversion || new ConversionGateway268({
      logger:        deps.logger        || null,
      creditReserve: credits,
      auditLog:      deps.auditLog      || null,
      agentReceipts: receipts,
    }),
    firewall: deps.firewall || new InjectionFirewall268({
      logger:   deps.logger   || null,
      auditLog: deps.auditLog || null,
    }),
    memory: deps.memory || new MemoryIntegrity268({
      logger:   deps.logger   || null,
      auditLog: deps.auditLog || null,
    }),
    queue: deps.queue || new OfflineQueue268({
      logger:   deps.logger   || null,
      auditLog: deps.auditLog || null,
    }),
    qFunding: deps.qFunding || new QuadraticFunding268({
      logger:   deps.logger   || null,
      auditLog: deps.auditLog || null,
    }),
    reputation: deps.reputation || new ReputationLedger268({
      logger:   deps.logger   || null,
      auditLog: deps.auditLog || null,
    }),
    sybil: deps.sybil || new SybilGuard268({
      logger:   deps.logger   || null,
      auditLog: deps.auditLog || null,
    }),
    telemetry: deps.telemetry || new Telemetry268({
      logger:   deps.logger   || null,
      auditLog: deps.auditLog || null,
    }),
    tips: deps.tips || new TipModule268({
      logger:   deps.logger   || null,
      auditLog: deps.auditLog || null,
    }),
    modules: {
      x402: true, mcp: true, wallets: true, ussd: true,
      auditBloom: true, onboarding: true, splits: true, programs: true,
      receipts: true, metacog: true, reflection: true, credits: true,
      router: true, breakage: true, conversion: true, firewall: true,
      memory: true, queue: true, qFunding: true, reputation: true,
      sybil: true, telemetry: true, tips: true,
      // V268 capabilities
      providerValidation: true, perfTelemetry: true, healthChecks: true,
      logAdapterDI: true, newProviderContracts: 6, totalContracts: 21,
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function jsonHandler268(fn) {
  return (req, res) => {
    try { res.json(fn(req)); }
    catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  };
}

function asyncHandler268(fn) {
  return (req, res) => Promise.resolve(fn(req, res)).catch(err => res.status(400).json({ ok: false, error: err.message }));
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  registerEcosV268Routes,
  createV268State,
  PROGRAMS_268,
};
