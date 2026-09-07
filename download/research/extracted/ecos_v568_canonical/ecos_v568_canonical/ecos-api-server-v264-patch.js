'use strict';
/**
 * ecos-api-server-v264-patch.js — V264 API Route Registration
 *
 * Apply this patch to the main ECOS Express server:
 *   const applyV264Patch = require('./ecos-api-server-v264-patch');
 *   applyV264Patch(app, { db, auditLog, logger, ... });
 *
 * Registers ALL new V264 endpoints. Additive only — zero existing endpoints removed.
 * Includes: x402 full V2 wire protocol, AP2 mandate chain, execution programs,
 * vesting schedules, churn monitoring, program-level metrics, USSD/SMS degraded path.
 *
 * Zero new npm deps. Identifiers end with 264.
 */
'use strict';

const { defaultCreditReserve264, REWARD_SOURCES_264 }        = require('./src/lib/creditReserve264');
const { defaultBreakageEngine264, BREAKAGE_DAYS_264 }         = require('./src/lib/breakageEngine264');
const { defaultConversionGateway264 }                         = require('./src/lib/conversionGateway264');
const { defaultReputationLedger264, ATTESTATION_TYPES_264 }   = require('./src/lib/reputationLedger264');
const { defaultSybilGuard264 }                                 = require('./src/lib/sybilGuard264');
const { defaultInjectionFirewall264 }                          = require('./src/lib/injectionFirewall264');
const { defaultMemoryIntegrity264 }                            = require('./src/lib/memoryIntegrity264');
const { defaultReflectionLoop264 }                             = require('./src/lib/reflectionLoop264');
const { defaultMetacognition264 }                              = require('./src/lib/metacognition264');
const { defaultCostAwareRouter264 }                            = require('./src/lib/costAwareRouter264');
const { defaultAgentReceipts264, MANDATE_STEPS_264 }           = require('./src/lib/agentReceipts264');
const { defaultSplitModule264 }                                = require('./src/lib/splitModule264');
const { defaultTipModule264 }                                  = require('./src/lib/tipModule264');
const { defaultQuadraticFunding264 }                           = require('./src/lib/quadraticFunding264');
const { OnboardingFlow264 }                                    = require('./src/lib/onboardingFlow264');
const { defaultOfflineQueue264 }                               = require('./src/lib/offlineQueue264');
const { defaultTelemetry264 }                                  = require('./src/lib/telemetry264');
const { defaultX402Processor264, x402Middleware264,
        buildPaymentRequired264, X402_VERSION_264 }            = require('./src/lib/x402264');
const { defaultExecutionProgramRegistry264, PROGRAMS_264 }    = require('./src/lib/executionPrograms264');

/**
 * @param {import('express').Application} app
 * @param {object} deps — { db, auditLog, logger, sybilResistance, hitlGate }
 */
function applyV264Patch(app, deps = {}) {
  const log = deps.logger || console;

  // Wire x402 processor with credit reserve and agent receipts
  const x402Processor = defaultX402Processor264;
  // (In production: inject these via constructor; here we wire defaults)

  // ── Offline queue middleware (must be before other routes) ────────────────
  app.use('/api/v1', defaultOfflineQueue264.middleware264());

  // ── x402 Payment Protocol ─────────────────────────────────────────────────

  // GET /api/v1/x402/price/:resource — advertise price for a resource
  app.get('/api/v1/x402/price/:resource', (req, res) => {
    const resource = req.params.resource;
    const price = x402Processor.getPrice264(resource);
    if (!price) {
      const { descriptor } = buildPaymentRequired264({ resource, amount: 0.0001, network: 'base' });
      return res.json({ resource, price: null, descriptor });
    }
    const { descriptor } = buildPaymentRequired264({ resource, ...price });
    res.json({ resource, ...price, descriptor });
  });

  // POST /api/v1/x402/register-resource — register a priced resource (admin)
  app.post('/api/v1/x402/register-resource', (req, res) => {
    try {
      const { resource, amount, currency } = req.body;
      if (!resource || !amount) return res.status(400).json({ error: 'resource and amount required' });
      x402Processor.registerResource264(resource, Number(amount), currency);
      res.json({ ok: true, resource, amount, currency: currency || 'USDC' });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/x402/pay — process an x402 payment (direct API)
  app.post('/api/v1/x402/pay', (req, res) => {
    try {
      const { from, to, amount, resource, nonce, timestamp, signature, network, currency } = req.body;
      if (!from || !to || !amount || !resource || !nonce || !timestamp)
        return res.status(400).json({ error: 'from, to, amount, resource, nonce, timestamp required' });
      const payload = { version: X402_VERSION_264, from, to, amount: Number(amount), resource, nonce, timestamp: Number(timestamp), signature, network, currency };
      const result = x402Processor.processPayment264(payload, { testMode: process.env.X402_TEST_MODE === '1' });
      if (!result.ok) return res.status(result.code === 'INSUFFICIENT' ? 402 : 400).json({ error: result.error, code: result.code });
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/v1/x402/receipt/:receiptId
  app.get('/api/v1/x402/receipt/:receiptId', (req, res) => {
    const r = x402Processor.getReceipt264(req.params.receiptId);
    if (!r) return res.status(404).json({ error: 'Receipt not found' });
    res.json(r);
  });

  // GET /api/v1/x402/stats
  app.get('/api/v1/x402/stats', (_req, res) => {
    res.json(x402Processor.getStats264());
  });

  // ── Execution Programs ────────────────────────────────────────────────────

  // GET /api/v1/programs — list all 25 execution programs
  app.get('/api/v1/programs', (req, res) => {
    const { category, status } = req.query;
    res.json(defaultExecutionProgramRegistry264.listPrograms264({ category, status }));
  });

  // GET /api/v1/programs/dashboard
  app.get('/api/v1/programs/dashboard', (_req, res) => {
    res.json(defaultExecutionProgramRegistry264.getDashboard264());
  });

  // GET /api/v1/programs/:id
  app.get('/api/v1/programs/:id', (req, res) => {
    const p = defaultExecutionProgramRegistry264.getProgram264(req.params.id);
    if (!p) return res.status(404).json({ error: 'Program not found' });
    res.json(p);
  });

  // POST /api/v1/programs/:id/start
  app.post('/api/v1/programs/:id/start', (req, res) => {
    try { res.json(defaultExecutionProgramRegistry264.startProgram264(req.params.id, req.body || {})); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/programs/:id/complete
  app.post('/api/v1/programs/:id/complete', (req, res) => {
    try { res.json(defaultExecutionProgramRegistry264.completeProgram264(req.params.id, req.body || {})); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/programs/:id/missions — add mission to program
  app.post('/api/v1/programs/:id/missions', (req, res) => {
    try {
      const { missionId, description } = req.body;
      if (!missionId) return res.status(400).json({ error: 'missionId required' });
      res.json(defaultExecutionProgramRegistry264.addMission264(req.params.id, missionId, description));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // ── Credit Reserve V264 ───────────────────────────────────────────────────

  // GET /api/v1/credit/v264/status
  app.get('/api/v1/credit/v264/status', (_req, res) => {
    res.json(defaultCreditReserve264.getStatus264());
  });

  // GET /api/v1/credit/v264/status/mobile — compact mobile payload
  app.get('/api/v1/credit/v264/status/mobile', (_req, res) => {
    res.json(defaultCreditReserve264.getMobileStatus264());
  });

  // GET /api/v1/credit/v264/backing-ratio
  app.get('/api/v1/credit/v264/backing-ratio', (_req, res) => {
    res.json(defaultCreditReserve264.getStatus264());
  });

  // POST /api/v1/credit/v264/deposit — reserve deposit
  app.post('/api/v1/credit/v264/deposit', (req, res) => {
    try {
      const { amountMicro, source, userId, mandateId } = req.body;
      if (!amountMicro || !source) return res.status(400).json({ error: 'amountMicro and source required' });
      res.json(defaultCreditReserve264.depositReserve264(BigInt(amountMicro), source, { userId, mandateId }));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/credit/v264/issue
  app.post('/api/v1/credit/v264/issue', (req, res) => {
    try {
      const { amountMicro, source, userId, mandateId } = req.body;
      res.json(defaultCreditReserve264.issue264(BigInt(amountMicro), source, { userId, mandateId }));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/credit/v264/redeem
  app.post('/api/v1/credit/v264/redeem', (req, res) => {
    try {
      const { userId, amountMicro } = req.body;
      if (!userId || !amountMicro) return res.status(400).json({ error: 'userId and amountMicro required' });
      res.json(defaultCreditReserve264.redeem264(BigInt(amountMicro), { userId }));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/credit/v264/consume
  app.post('/api/v1/credit/v264/consume', (req, res) => {
    try {
      const { amountMicro, reason, mandateId } = req.body;
      res.json(defaultCreditReserve264.consume264(BigInt(amountMicro), reason || 'missionSpend', { mandateId }));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/credit/v264/x402-deposit — x402 micro top-up
  app.post('/api/v1/credit/v264/x402-deposit', (req, res) => {
    try {
      const { amountMicro, x402Receipt } = req.body;
      res.json(defaultCreditReserve264.depositX402264(BigInt(amountMicro), x402Receipt || {}));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // GET /api/v1/credit/v264/x402-deposits
  app.get('/api/v1/credit/v264/x402-deposits', (req, res) => {
    res.json(defaultCreditReserve264.getX402Deposits264(Number(req.query.limit) || 50));
  });

  // POST /api/v1/credit/v264/breakage-scan
  app.post('/api/v1/credit/v264/breakage-scan', (_req, res) => {
    res.json(defaultBreakageEngine264.runBreakageScan264());
  });

  // GET /api/v1/credit/v264/breakage-status
  app.get('/api/v1/credit/v264/breakage-status', (_req, res) => {
    res.json(defaultBreakageEngine264.getStatus264());
  });

  // POST /api/v1/credit/v264/escheat-flag
  app.post('/api/v1/credit/v264/escheat-flag', (req, res) => {
    try {
      const { userId, amountMicro, jurisdiction } = req.body;
      res.json(defaultCreditReserve264.flagEscheat264(userId, BigInt(amountMicro), jurisdiction));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // ── Conversion Gateway V264 ───────────────────────────────────────────────

  // POST /api/v1/credit/v264/credit-to-usdc
  app.post('/api/v1/credit/v264/credit-to-usdc', async (req, res) => {
    try {
      const { userId, amountMicro, currency } = req.body;
      if (!userId || !amountMicro) return res.status(400).json({ error: 'userId and amountMicro required' });
      res.json(await defaultConversionGateway264.creditToUsdc264(userId, BigInt(amountMicro), { currency }));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/credit/v264/usdc-to-credit
  app.post('/api/v1/credit/v264/usdc-to-credit', async (req, res) => {
    try {
      const { userId, amountCurrency, currency } = req.body;
      res.json(await defaultConversionGateway264.usdcToCredit264(userId, amountCurrency, currency));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // GET /api/v1/credit/v264/churn/:userId
  app.get('/api/v1/credit/v264/churn/:userId', (req, res) => {
    res.json(defaultConversionGateway264.getChurnStatus264(req.params.userId));
  });

  // ── Reputation Ledger V264 ────────────────────────────────────────────────

  // POST /api/v1/rep/v264/attest
  app.post('/api/v1/rep/v264/attest', async (req, res) => {
    try {
      const { attesterId, subjectId, type, context } = req.body;
      if (!attesterId || !subjectId || !type) return res.status(400).json({ error: 'attesterId, subjectId, type required' });
      res.json(defaultReputationLedger264.attest264(attesterId, subjectId, type, context || {}));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // GET /api/v1/rep/v264/standing/:userId
  app.get('/api/v1/rep/v264/standing/:userId', (req, res) => {
    res.json(defaultReputationLedger264.getStanding264(req.params.userId));
  });

  // GET /api/v1/rep/v264/standing/:userId/mobile
  app.get('/api/v1/rep/v264/standing/:userId/mobile', (req, res) => {
    res.json(defaultReputationLedger264.getMobileStanding264(req.params.userId));
  });

  // POST /api/v1/rep/v264/disclose/:userId
  app.post('/api/v1/rep/v264/disclose/:userId', (req, res) => {
    try {
      const { dimensions } = req.body;
      res.json(defaultReputationLedger264.selectiveDisclose264(req.params.userId, dimensions || []));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/rep/v264/program-reputation
  app.post('/api/v1/rep/v264/program-reputation', (req, res) => {
    try {
      const { programId, userIds } = req.body;
      res.json(defaultReputationLedger264.getProgramReputation264(programId, userIds || []));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // ── Sybil Guard V264 ──────────────────────────────────────────────────────

  // GET /api/v1/sybil/v264/evaluate/:userId
  app.get('/api/v1/sybil/v264/evaluate/:userId', (req, res) => {
    res.json(defaultSybilGuard264.evaluate264(req.params.userId));
  });

  // POST /api/v1/sybil/v264/self-report
  app.post('/api/v1/sybil/v264/self-report', (req, res) => {
    try {
      const { userId, evidence } = req.body;
      if (!userId) return res.status(400).json({ error: 'userId required' });
      res.json(defaultSybilGuard264.selfReport264(userId, evidence || {}));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/sybil/v264/signal — record a signal
  app.post('/api/v1/sybil/v264/signal', (req, res) => {
    try {
      const { userId, signal, value } = req.body;
      defaultSybilGuard264.recordSignal264(userId, signal, value !== false);
      res.json({ ok: true, userId, signal });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/sybil/v264/velocity — record action velocity
  app.post('/api/v1/sybil/v264/velocity', (req, res) => {
    try {
      const { userId } = req.body;
      res.json(defaultSybilGuard264.recordVelocity264(userId));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // GET /api/v1/sybil/v264/stats
  app.get('/api/v1/sybil/v264/stats', (_req, res) => {
    res.json(defaultSybilGuard264.getStats264());
  });

  // ── Agent Receipts V264 (Mandate Chain) ───────────────────────────────────

  // POST /api/v1/receipts/v264/init/:missionId
  app.post('/api/v1/receipts/v264/init/:missionId', (req, res) => {
    try { res.json(defaultAgentReceipts264.initReceipt264(req.params.missionId, req.body || {})); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/receipts/v264/:missionId/step — emit a mandate step
  app.post('/api/v1/receipts/v264/:missionId/step', (req, res) => {
    try {
      const { stepType, data } = req.body;
      res.json(defaultAgentReceipts264.emitStep264(req.params.missionId, stepType, data || {}));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/receipts/v264/:missionId/intent
  app.post('/api/v1/receipts/v264/:missionId/intent', (req, res) => {
    try { res.json(defaultAgentReceipts264.emitIntent264(req.params.missionId, req.body)); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/receipts/v264/:missionId/plan
  app.post('/api/v1/receipts/v264/:missionId/plan', (req, res) => {
    try { res.json(defaultAgentReceipts264.emitPlan264(req.params.missionId, req.body)); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/receipts/v264/:missionId/action
  app.post('/api/v1/receipts/v264/:missionId/action', (req, res) => {
    try { res.json(defaultAgentReceipts264.emitAction264(req.params.missionId, req.body)); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/receipts/v264/:missionId/verify
  app.post('/api/v1/receipts/v264/:missionId/verify', (req, res) => {
    try { res.json(defaultAgentReceipts264.emitVerification264(req.params.missionId, req.body)); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/receipts/v264/:missionId/settle
  app.post('/api/v1/receipts/v264/:missionId/settle', (req, res) => {
    try { res.json(defaultAgentReceipts264.emitSettlement264(req.params.missionId, req.body)); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  // GET /api/v1/receipts/v264/:missionId
  app.get('/api/v1/receipts/v264/:missionId', (req, res) => {
    const r = defaultAgentReceipts264.getReceipt264(req.params.missionId);
    if (!r) return res.status(404).json({ error: 'Receipt not found' });
    res.json(r);
  });

  // GET /api/v1/receipts/v264/:missionId/verify-chain
  app.get('/api/v1/receipts/v264/:missionId/verify-chain', (req, res) => {
    res.json(defaultAgentReceipts264.verifyChain264(req.params.missionId));
  });

  // GET /api/v1/receipts/v264/:missionId/ap2-manifest
  app.get('/api/v1/receipts/v264/:missionId/ap2-manifest', (req, res) => {
    try { res.json(defaultAgentReceipts264.exportAP2Manifest264(req.params.missionId)); }
    catch (err) { res.status(404).json({ error: err.message }); }
  });

  // GET /api/v1/receipts/v264/:missionId/mobile
  app.get('/api/v1/receipts/v264/:missionId/mobile', (req, res) => {
    const r = defaultAgentReceipts264.mobileReceipt264(req.params.missionId);
    if (!r) return res.status(404).json({ error: 'Receipt not found' });
    res.json(r);
  });

  // GET /api/v1/receipts/v264 — list recent
  app.get('/api/v1/receipts/v264', (req, res) => {
    res.json(defaultAgentReceipts264.listReceipts264(Number(req.query.limit) || 20));
  });

  // GET /api/v1/receipts/v264/stats
  app.get('/api/v1/receipts/v264/stats', (_req, res) => {
    res.json(defaultAgentReceipts264.getStats264());
  });

  // ── Collaboration / Splits V264 ───────────────────────────────────────────

  // POST /api/v1/collab/v264/primary-split
  app.post('/api/v1/collab/v264/primary-split', (req, res) => {
    try {
      const { missionId, totalMicro, executorId, connectorIds } = req.body;
      if (!missionId || !totalMicro) return res.status(400).json({ error: 'missionId and totalMicro required' });
      res.json(defaultSplitModule264.applyPrimarysplit264(missionId, BigInt(totalMicro), { executorId, connectorIds }));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/collab/v264/create
  app.post('/api/v1/collab/v264/create', (req, res) => {
    try {
      const { creatorId, recipients, waterfall, vestingDays, enforceVesting, programId } = req.body;
      res.json(defaultSplitModule264.createSplit264(creatorId, recipients, { waterfall, vestingDays, enforceVesting, programId }));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // GET /api/v1/collab/v264/:id
  app.get('/api/v1/collab/v264/:id', (req, res) => {
    const s = defaultSplitModule264.getSplit264(req.params.id);
    if (!s) return res.status(404).json({ error: 'Split not found' });
    res.json(s);
  });

  // GET /api/v1/collab/v264/:id/vesting
  app.get('/api/v1/collab/v264/:id/vesting', (req, res) => {
    const v = defaultSplitModule264.getVestingStatus264(req.params.id);
    if (!v) return res.status(404).json({ error: 'No vesting schedule' });
    res.json(v);
  });

  // POST /api/v1/collab/v264/:id/distribute
  app.post('/api/v1/collab/v264/:id/distribute', (req, res) => {
    try {
      const { amountMicro } = req.body;
      res.json(defaultSplitModule264.distribute264(req.params.id, BigInt(amountMicro)));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // ── Tips V264 ─────────────────────────────────────────────────────────────

  // POST /api/v1/tip/v264
  app.post('/api/v1/tip/v264', (req, res) => {
    try {
      const { fromUserId, toUserId, amountMicro, message, missionId, channel, programId } = req.body;
      res.json(defaultTipModule264.tip264(fromUserId, toUserId, BigInt(amountMicro), { message, missionId, channel, programId }));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // GET /api/v1/tip/v264/epoch/:userId
  app.get('/api/v1/tip/v264/epoch/:userId', (req, res) => {
    res.json(defaultTipModule264.getEpochStats264(req.params.userId));
  });

  // GET /api/v1/tip/v264/leaderboard
  app.get('/api/v1/tip/v264/leaderboard', (req, res) => {
    res.json(defaultTipModule264.getEpochLeaderboard264(Number(req.query.limit) || 10));
  });

  // POST /api/v1/tip/v264/community-pool
  app.post('/api/v1/tip/v264/community-pool', (req, res) => {
    try {
      const { amountMicro } = req.body;
      res.json(defaultTipModule264.addToCommunityPool264(BigInt(amountMicro)));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // GET /api/v1/tip/v264/history/:userId
  app.get('/api/v1/tip/v264/history/:userId', (req, res) => {
    res.json(defaultTipModule264.getTipHistory264(req.params.userId, Number(req.query.limit) || 20));
  });

  // ── Quadratic Funding V264 ────────────────────────────────────────────────

  // POST /api/v1/fund/v264/rounds
  app.post('/api/v1/fund/v264/rounds', (req, res) => {
    try {
      const { projectId, matchingPool, roundDays, description, programId, retroactive } = req.body;
      res.json(defaultQuadraticFunding264.createRound264(projectId, BigInt(matchingPool), { roundDays, description, programId, retroactive }));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/fund/v264/rounds/:roundId/contribute
  app.post('/api/v1/fund/v264/rounds/:roundId/contribute', (req, res) => {
    try {
      const { userId, amountMicro } = req.body;
      res.json(defaultQuadraticFunding264.contribute264(req.params.roundId, userId, BigInt(amountMicro)));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/fund/v264/rounds/:roundId/finalize
  app.post('/api/v1/fund/v264/rounds/:roundId/finalize', (req, res) => {
    try { res.json(defaultQuadraticFunding264.finalizeRound264(req.params.roundId)); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  // GET /api/v1/fund/v264/rounds/:roundId
  app.get('/api/v1/fund/v264/rounds/:roundId', (req, res) => {
    const r = defaultQuadraticFunding264.getRound264(req.params.roundId);
    if (!r) return res.status(404).json({ error: 'Round not found' });
    res.json(r);
  });

  // POST /api/v1/fund/v264/retroactive
  app.post('/api/v1/fund/v264/retroactive', (req, res) => {
    try {
      const { projectId, beneficiaryId, amountMicro, evidence } = req.body;
      res.json(defaultQuadraticFunding264.recordRetroactive264(projectId, beneficiaryId, BigInt(amountMicro), evidence));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // ── Onboarding V264 ───────────────────────────────────────────────────────
  const onboardingFlow264 = new OnboardingFlow264({ logger: log });

  app.post('/api/v1/onboarding/v264/:userId/start', (req, res) => {
    res.json(onboardingFlow264.startFlow264(req.params.userId, req.body?.channel || 'chat', req.body || {}));
  });

  app.post('/api/v1/onboarding/v264/:userId/step/:stepId', async (req, res) => {
    try { res.json(await onboardingFlow264.completeStep264(req.params.userId, req.params.stepId, req.body || {})); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.get('/api/v1/onboarding/v264/:userId', (req, res) => {
    const f = onboardingFlow264.getFlow264(req.params.userId);
    if (!f) return res.status(404).json({ error: 'No onboarding session' });
    res.json(f);
  });

  app.get('/api/v1/onboarding/v264/ussd/:userId', (req, res) => {
    res.json(onboardingFlow264.getUSSDMenu264(req.params.userId, req.query.input || ''));
  });

  // ── Offline Queue V264 ────────────────────────────────────────────────────

  app.post('/api/v1/offline/v264/replay/:userId', async (req, res) => {
    try { res.json(await defaultOfflineQueue264.replay264(req.params.userId)); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/v1/offline/v264/queue/:userId', (req, res) => {
    res.json(defaultOfflineQueue264.getQueue264(req.params.userId));
  });

  // ── Security V264 ─────────────────────────────────────────────────────────

  // POST /api/v1/security/v264/analyze-input
  app.post('/api/v1/security/v264/analyze-input', (req, res) => {
    try {
      const { content } = req.body;
      res.json(defaultInjectionFirewall264.analyzeInput264(content));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/security/v264/scan-egress
  app.post('/api/v1/security/v264/scan-egress', (req, res) => {
    try { res.json(defaultInjectionFirewall264.scanEgress264(req.body?.outputText || '')); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/security/v264/check-sacred-file
  app.post('/api/v1/security/v264/check-sacred-file', (req, res) => {
    res.json(defaultInjectionFirewall264.checkSacredFile264(req.body?.filename || ''));
  });

  // POST /api/v1/security/v264/memory-quarantine
  app.post('/api/v1/security/v264/memory-quarantine', (req, res) => {
    try { res.json(defaultMemoryIntegrity264.quarantine264(req.body.entryId, req.body.reason)); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/security/v264/memory-rollback
  app.post('/api/v1/security/v264/memory-rollback', (req, res) => {
    try { res.json(defaultMemoryIntegrity264.rollback264(req.body.beforeTs)); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/security/v264/memory-rollback-program
  app.post('/api/v1/security/v264/memory-rollback-program', (req, res) => {
    try { res.json(defaultMemoryIntegrity264.rollbackProgram264(req.body.programId)); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/v1/security/v264/memory-sign
  app.post('/api/v1/security/v264/memory-sign', (req, res) => {
    try {
      const { content, provenance } = req.body;
      res.json(defaultMemoryIntegrity264.signWrite264(content, provenance || {}));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // GET /api/v1/security/v264/memory-scope/:scope
  app.get('/api/v1/security/v264/memory-scope/:scope', (req, res) => {
    res.json(defaultMemoryIntegrity264.getScopeEntries264(req.params.scope));
  });

  // ── Metrics / Observability V264 ──────────────────────────────────────────

  app.get('/api/v1/metrics/v264', (_req, res) => {
    res.json({
      telemetry:          defaultTelemetry264.getDashboard264(),
      creditReserve:      defaultCreditReserve264.getStatus264(),
      agentReceipts:      defaultAgentReceipts264.getStats264(),
      sybilGuard:         defaultSybilGuard264.getStats264(),
      reputationLedger:   defaultReputationLedger264.stats264(),
      splitModule:        defaultSplitModule264.getStats264(),
      tipModule:          defaultTipModule264.getStats264(),
      injectionFirewall:  defaultInjectionFirewall264.getStats264(),
      memoryIntegrity:    defaultMemoryIntegrity264.getStats264(),
      costRouter:         defaultCostAwareRouter264.getStats264(),
      offlineQueue:       defaultOfflineQueue264.getStats264(),
      x402:               defaultX402Processor264.getStats264(),
      executionPrograms:  defaultExecutionProgramRegistry264.getDashboard264(),
    });
  });

  app.get('/api/v1/metrics/v264/mobile', (_req, res) => {
    res.json({
      reserve: defaultCreditReserve264.getMobileStatus264(),
      telemetry: defaultTelemetry264.getMobileDashboard264(),
    });
  });

  // GET /api/v1/metrics/v264/program/:programId
  app.get('/api/v1/metrics/v264/program/:programId', (req, res) => {
    res.json({
      program:   defaultExecutionProgramRegistry264.getProgram264(req.params.programId),
      cost:      defaultCostAwareRouter264.getProgramCostReport264(req.params.programId),
      telemetry: defaultTelemetry264.getProgramMetrics264(req.params.programId),
    });
  });

  // ── Agent Reflection V264 (programmatic) ─────────────────────────────────

  // POST /api/v1/agent/v264/reflect — trigger a reflection loop (demo/test endpoint)
  app.post('/api/v1/agent/v264/reflect', async (req, res) => {
    try {
      const { taskType, query, maxRetries, missionId } = req.body;
      if (!taskType || !query) return res.status(400).json({ error: 'taskType and query required' });

      // Simple echo proposer / always-pass verifier for demo
      const proposer = async (ctx, attempt) => `[attempt ${attempt}] ${ctx.query}`;
      const verifier = async (output) => ({ ok: true, score: 0.95, errors: [] });

      const result = await defaultReflectionLoop264.execute264(
        taskType, proposer, verifier,
        { query },
        { maxRetries: maxRetries || 1, missionId }
      );
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/v1/agent/v264/reflect/stats
  app.get('/api/v1/agent/v264/reflect/stats', (_req, res) => {
    res.json(defaultReflectionLoop264.getStats264());
  });

  // GET /api/v1/agent/v264/metacog/stats
  app.get('/api/v1/agent/v264/metacog/stats', (_req, res) => {
    res.json(defaultMetacognition264.getStats264());
  });

  // ── Version info ──────────────────────────────────────────────────────────

  app.get('/api/v1/version/v264', (_req, res) => {
    res.json({
      version: '264',
      x402: X402_VERSION_264,
      modules: [
        'creditReserve264', 'breakageEngine264', 'conversionGateway264',
        'reputationLedger264', 'sybilGuard264', 'injectionFirewall264',
        'memoryIntegrity264', 'reflectionLoop264', 'metacognition264',
        'costAwareRouter264', 'agentReceipts264', 'splitModule264',
        'tipModule264', 'quadraticFunding264', 'onboardingFlow264',
        'offlineQueue264', 'telemetry264', 'x402264', 'executionPrograms264',
      ],
      programs: PROGRAMS_264.length,
      tradableTokenEnabled: false,
      sacredFiles: ['lib/fiatLedger.js', 'lib/auditLog.js'],
    });
  });

  log.info?.('[V264] All V264 endpoints registered (additive, zero existing endpoints removed)');
  return app;
}

module.exports = applyV264Patch;
