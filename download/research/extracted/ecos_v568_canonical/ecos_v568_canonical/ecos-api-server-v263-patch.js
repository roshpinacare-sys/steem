'use strict';
/**
 * ecos-api-server-v263-patch.js — V263 API Route Registration
 *
 * Apply this patch to the main ECOS Express server:
 *   const applyV263Patch = require('./ecos-api-server-v263-patch');
 *   applyV263Patch(app, { db, auditLog, logger, ... });
 *
 * Registers ALL new V263 endpoints. Additive only — zero existing endpoints removed.
 * Zero new npm deps. Identifiers end with 263.
 */
'use strict';

const { defaultCreditReserve263 }     = require('./src/lib/creditReserve263');
const { defaultBreakageEngine263 }    = require('./src/lib/breakageEngine263');
const { defaultConversionGateway263 } = require('./src/lib/conversionGateway263');
const { defaultReputationLedger263 }  = require('./src/lib/reputationLedger263');
const { defaultSybilGuard263 }        = require('./src/lib/sybilGuard263');
const { defaultInjectionFirewall263 } = require('./src/lib/injectionFirewall263');
const { defaultMemoryIntegrity263 }   = require('./src/lib/memoryIntegrity263');
const { defaultReflectionLoop263 }    = require('./src/lib/reflectionLoop263');
const { defaultMetacognition263 }     = require('./src/lib/metacognition263');
const { defaultCostAwareRouter263 }   = require('./src/lib/costAwareRouter263');
const { defaultAgentReceipts263 }     = require('./src/lib/agentReceipts263');
const { defaultSplitModule263 }       = require('./src/lib/splitModule263');
const { defaultTipModule263 }         = require('./src/lib/tipModule263');
const { defaultQuadraticFunding263 }  = require('./src/lib/quadraticFunding263');
const { OnboardingFlow263 }           = require('./src/lib/onboardingFlow263');
const { defaultOfflineQueue263 }      = require('./src/lib/offlineQueue263');
const { defaultTelemetry263 }         = require('./src/lib/telemetry263');

/**
 * @param {import('express').Application} app
 * @param {object} deps — { db, auditLog, logger, sybilResistance, hitlGate }
 */
function applyV263Patch(app, deps = {}) {
  const log = deps.logger || console;

  // ── Offline queue middleware (must be first) ───────────────────────────────
  app.use('/api/v1', defaultOfflineQueue263.middleware263());

  // ── Credit Reserve ────────────────────────────────────────────────────────

  // GET /api/v1/credit/backing-ratio — public transparency metric
  app.get('/api/v1/credit/backing-ratio', (req, res) => {
    res.json(defaultCreditReserve263.getStatus263());
  });

  // POST /api/v1/credit/redeem — reserve-checked redemption
  app.post('/api/v1/credit/redeem', (req, res) => {
    try {
      const { userId, amountMicro } = req.body;
      if (!userId || !amountMicro) return res.status(400).json({ error: 'userId and amountMicro required' });
      const result = defaultCreditReserve263.redeem263(BigInt(amountMicro), { userId });
      res.json(result);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/credit/deposit — reserve deposit
  app.post('/api/v1/credit/deposit', (req, res) => {
    try {
      const { amountMicro, source, userId } = req.body;
      defaultCreditReserve263.depositReserve263(BigInt(amountMicro), source, { userId });
      res.json(defaultCreditReserve263.getStatus263());
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/credit/breakage-scan — run ASC 606 breakage scan
  app.post('/api/v1/credit/breakage-scan', (req, res) => {
    res.json(defaultBreakageEngine263.runBreakageScan263());
  });

  // ── Reputation Ledger ─────────────────────────────────────────────────────

  // POST /api/v1/rep/attest
  app.post('/api/v1/rep/attest', async (req, res) => {
    try {
      const { attesterId, subjectId, type, context } = req.body;
      if (!attesterId || !subjectId || !type) return res.status(400).json({ error: 'attesterId, subjectId, type required' });
      // Sybil check before attestation
      const sybil = defaultSybilGuard263.evaluate263(attesterId);
      if (sybil.verdict === 'BLOCK') return res.status(403).json({ error: 'Attester is sybil-blocked', verdict: sybil });
      const result = defaultReputationLedger263.attest263(attesterId, subjectId, type, context || {});
      res.json(result);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // GET /api/v1/rep/standing/:userId
  app.get('/api/v1/rep/standing/:userId', (req, res) => {
    res.json(defaultReputationLedger263.getStanding263(req.params.userId));
  });

  // ── Sybil Guard ───────────────────────────────────────────────────────────

  // POST /api/v1/sybil/self-report
  app.post('/api/v1/sybil/self-report', (req, res) => {
    try {
      const { userId, evidence } = req.body;
      if (!userId) return res.status(400).json({ error: 'userId required' });
      res.json(defaultSybilGuard263.selfReport263(userId, evidence || {}));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // GET /api/v1/sybil/evaluate/:userId
  app.get('/api/v1/sybil/evaluate/:userId', (req, res) => {
    res.json(defaultSybilGuard263.evaluate263(req.params.userId));
  });

  // ── Agent Receipts ────────────────────────────────────────────────────────

  // GET /api/v1/missions/:id/receipt
  app.get('/api/v1/missions/:id/receipt', (req, res) => {
    const receipt = defaultAgentReceipts263.getReceipt263(req.params.id);
    if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
    res.json(receipt);
  });

  // GET /api/v1/missions/:id/receipt/verify
  app.get('/api/v1/missions/:id/receipt/verify', (req, res) => {
    res.json(defaultAgentReceipts263.verifyReceipt263(req.params.id));
  });

  // POST /api/v1/missions/:id/receipt/init
  app.post('/api/v1/missions/:id/receipt/init', (req, res) => {
    try {
      res.json(defaultAgentReceipts263.initReceipt263(req.params.id, req.body));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // GET /api/v1/receipts — list recent receipts
  app.get('/api/v1/receipts', (req, res) => {
    res.json(defaultAgentReceipts263.listReceipts263(Number(req.query.limit) || 20));
  });

  // ── Collaboration / Splits ────────────────────────────────────────────────

  // POST /api/v1/collab/create
  app.post('/api/v1/collab/create', (req, res) => {
    try {
      const { creatorId, recipients, waterfall, vestingDays } = req.body;
      res.json(defaultSplitModule263.createSplit263(creatorId, recipients, { waterfall, vestingDays }));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // GET /api/v1/collab/:id
  app.get('/api/v1/collab/:id', (req, res) => {
    const split = defaultSplitModule263.getSplit263(req.params.id);
    if (!split) return res.status(404).json({ error: 'Split not found' });
    res.json(split);
  });

  // POST /api/v1/collab/:id/distribute
  app.post('/api/v1/collab/:id/distribute', (req, res) => {
    try {
      const { amountMicro } = req.body;
      res.json(defaultSplitModule263.distribute263(req.params.id, BigInt(amountMicro)));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // ── Tips ──────────────────────────────────────────────────────────────────

  // POST /api/v1/tip
  app.post('/api/v1/tip', (req, res) => {
    try {
      const { fromUserId, toUserId, amountMicro, message, missionId } = req.body;
      res.json(defaultTipModule263.tip263(fromUserId, toUserId, BigInt(amountMicro), { message, missionId }));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // GET /api/v1/tip/epoch/:userId
  app.get('/api/v1/tip/epoch/:userId', (req, res) => {
    res.json(defaultTipModule263.getEpochStats263(req.params.userId));
  });

  // ── Quadratic Funding ─────────────────────────────────────────────────────

  // POST /api/v1/fund/quadratic/rounds
  app.post('/api/v1/fund/quadratic/rounds', (req, res) => {
    try {
      const { projectId, matchingPool, roundDays, description } = req.body;
      res.json(defaultQuadraticFunding263.createRound263(projectId, BigInt(matchingPool), { roundDays, description }));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/fund/quadratic/:roundId
  app.post('/api/v1/fund/quadratic/:roundId', (req, res) => {
    try {
      const { userId, amountMicro } = req.body;
      res.json(defaultQuadraticFunding263.contribute263(req.params.roundId, userId, BigInt(amountMicro)));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // GET /api/v1/fund/quadratic/:roundId
  app.get('/api/v1/fund/quadratic/:roundId', (req, res) => {
    const round = defaultQuadraticFunding263.getRound263(req.params.roundId);
    if (!round) return res.status(404).json({ error: 'Round not found' });
    res.json(round);
  });

  // POST /api/v1/fund/quadratic/:roundId/finalize
  app.post('/api/v1/fund/quadratic/:roundId/finalize', (req, res) => {
    try { res.json(defaultQuadraticFunding263.finalizeRound263(req.params.roundId)); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  // ── Onboarding ────────────────────────────────────────────────────────────
  const onboardingFlow263 = new OnboardingFlow263({ logger: log });

  app.get('/api/v1/onboarding/flow263/:userId', (req, res) => {
    res.json(onboardingFlow263.getFlow263(req.params.userId));
  });

  app.post('/api/v1/onboarding/flow263/:userId/start', (req, res) => {
    res.json(onboardingFlow263.startFlow263(req.params.userId, req.body?.channel || 'chat'));
  });

  app.post('/api/v1/onboarding/flow263/:userId/step/:stepId', async (req, res) => {
    try {
      res.json(await onboardingFlow263.completeStep263(req.params.userId, req.params.stepId, req.body || {}));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // ── Offline Queue ─────────────────────────────────────────────────────────

  app.post('/api/v1/offline/replay/:userId', async (req, res) => {
    try { res.json(await defaultOfflineQueue263.replay263(req.params.userId)); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/v1/offline/queue/:userId', (req, res) => {
    res.json(defaultOfflineQueue263.getQueue263(req.params.userId));
  });

  // ── Metrics / Observability ───────────────────────────────────────────────

  app.get('/api/v1/metrics/agents263', (req, res) => {
    res.json({
      telemetry:         defaultTelemetry263.getDashboard263(),
      costRouter:        defaultCostAwareRouter263.getStats263(),
      injectionFirewall: defaultInjectionFirewall263.getStats263(),
      memoryIntegrity:   defaultMemoryIntegrity263.getStats263(),
      sybilGuard:        defaultSybilGuard263.getStats263(),
      reputationLedger:  defaultReputationLedger263.stats263(),
      reserveStatus:     defaultCreditReserve263.getStatus263(),
    });
  });

  // ── Firewall / Security (admin) ───────────────────────────────────────────

  app.post('/api/v1/security/memory-integrity/quarantine', (req, res) => {
    try { res.json(defaultMemoryIntegrity263.quarantine263(req.body.entryId, req.body.reason)); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.post('/api/v1/security/memory-integrity/rollback', (req, res) => {
    try { res.json(defaultMemoryIntegrity263.rollback263(req.body.beforeTs)); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  log.info && log.info('[V263] All V263 endpoints registered (additive, zero existing endpoints removed)');
  return app;
}

module.exports = applyV263Patch;
