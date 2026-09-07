'use strict';
/**
 * src/lib/safetyChatGuard441.js — ECOS V441
 *
 * Safety-Aware Chat Guard
 * Connects unifiedSafetyDashboard439 → conversationPipeline415.
 * When the safety score is critical, chat responses get a safety banner
 * and money-touching intents are blocked. When degraded, extra hedging
 * is applied. Creates transparency: users SEE the safety status.
 *
 * R1: sacred files untouched. R2: all identifiers end in 441. R3: no new npm deps.
 *
 * @version 441.0.0
 */

const SAFETY_CHAT_GUARD_VERSION441 = '441.0.0';

const _thresholds441 = {
  critical: 50,
  degraded: 80,
};

const _state441 = {
  lastMode: null,
  lastScore: null,
  lastCheckTs: null,
};

/**
 * getChatSafetyMode441()
 * Reads the unified safety dashboard and returns a chat-safety mode.
 * @returns {{ok:boolean, mode:string, score:number, thresholds:object}}
 */
function getChatSafetyMode441() {
  const dashboardMod = require('./unifiedSafetyDashboard439.js');
  const dashboard = dashboardMod.computeUnifiedSafetyDashboard439({});
  const score = dashboard.overallScore;
  const mode = score <= _thresholds441.critical ? 'critical'
    : (score <= _thresholds441.degraded ? 'degraded' : 'healthy');

  _state441.lastMode = mode;
  _state441.lastScore = score;
  _state441.lastCheckTs = Date.now();

  return { ok: true, mode, score, thresholds: _thresholds441, dashboardStatus: dashboard.status };
}

/**
 * runSafetyAwareTurn441(opts)
 * Wraps conversationPipeline415.runTurn415 with safety-aware post-processing.
 * @param {object} opts — forwarded to runTurn415 plus safety overrides
 * @returns {{ok:boolean, turn:object|null, safety:object, blocked:boolean}}
 */
function runSafetyAwareTurn441(opts) {
  opts = opts || {};
  const safety = getChatSafetyMode441();
  const mode = safety.mode;

  const pipeline = require('./conversationPipeline415.js');

  // critical: block money-touching intents entirely
  if (mode === 'critical' && opts.mustPassMoneyGuard) {
    return {
      ok: true,
      turn: null,
      safety,
      blocked: true,
      reason: 'chat_guard441: money-touching intents blocked while safety is critical',
    };
  }

  // run the normal pipeline turn
  const turn = pipeline.runTurn415({
    userMessage: opts.userMessage,
    draftResponse: opts.draftResponse,
    conversation: opts.conversation,
    improvementLoop: opts.improvementLoop,
    audit: opts.audit,
    maxSentences: opts.maxSentences,
  });

  // post-process based on safety mode
  if (mode === 'critical') {
    turn.finalResponse = '[SAFETY CRITICAL — withdrawals/mints paused] ' + turn.finalResponse;
    turn.safetyApplied441 = 'critical_banner';
  } else if (mode === 'degraded') {
    turn.finalResponse = '[Caution: system safety degraded] ' + turn.finalResponse;
    turn.safetyApplied441 = 'degraded_caution';
  } else {
    turn.safetyApplied441 = 'none';
  }

  return { ok: true, turn, safety, blocked: false };
}

/**
 * wireSafetyChatGuard441(app)
 * @param {object} app — Express-like app with .get() and .post()
 */
function wireSafetyChatGuard441(app) {
  if (!app || typeof app.post !== 'function') return;

  // V441-T01 POST /api/v1/chat/safe-turn
  app.post('/api/v1/chat/safe-turn', function(req, res) {
    try {
      const b = req.body || {};
      if (!b.userMessage)   return res.status(400).json({ ok: false, error: 'userMessage required',   code: 'BAD_ARGS', ecosVersion: 'V441' });
      if (!b.draftResponse) return res.status(400).json({ ok: false, error: 'draftResponse required', code: 'BAD_ARGS', ecosVersion: 'V441' });
      const result = runSafetyAwareTurn441({
        userMessage: b.userMessage,
        draftResponse: b.draftResponse,
        mustPassMoneyGuard: Boolean(b.mustPassMoneyGuard),
        maxSentences: b.maxSentences,
      });
      res.json(Object.assign({ ok: true, ecosVersion: 'V441' }, result));
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V441' });
    }
  });

  // V441-T02 GET /api/v1/chat/safety/status
  app.get('/api/v1/chat/safety/status', function(_req, res) {
    try {
      const safety = getChatSafetyMode441();
      res.json(Object.assign({ ok: true, ecosVersion: 'V441' }, safety));
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V441' });
    }
  });

  // V441-T03 GET /api/v1/admin/summary/v441
  app.get('/api/v1/admin/summary/v441', function(_req, res) {
    res.json({
      ok: true,
      ecosVersion: 'V441',
      version: SAFETY_CHAT_GUARD_VERSION441,
      feature: 'Safety-Aware Chat Guard — connects unifiedSafetyDashboard439 → conversationPipeline415',
      endpoints: [
        'POST /api/v1/chat/safe-turn [T01]',
        'GET /api/v1/chat/safety/status [T02]',
        'GET /api/v1/admin/summary/v441 [T03]',
      ],
      state: JSON.parse(JSON.stringify(_state441)),
    });
  });
}

module.exports = {
  SAFETY_CHAT_GUARD_VERSION441,
  getChatSafetyMode441,
  runSafetyAwareTurn441,
  wireSafetyChatGuard441,
  _state441,
};
