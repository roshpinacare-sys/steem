'use strict';
/**
 * lib/pentaTowerCanon480.js — ECOS V480
 *
 * Canonical facade for five parallel towers (V263–V268, 6 modules each):
 *   1. reputationLedger  — Non-Transferable Reputation, SBT-style, multi-dim
 *   2. reflectionLoop    — Execution-Based Reflection, multi-agent Proposer/Critic
 *   3. quadraticFunding  — Quadratic Funding pool, anti-collusion
 *   4. offlineQueue      — Priority offline queue, fail-safe delivery
 *   5. onboardingFlow    — Onboarding flow, USSD/crypto-words/channels
 *
 * Chain: V263 → V264 → V265 → V266 → V267 → V268 (tip) for each tower.
 * New code imports THIS file — never individual versioned modules directly.
 *
 * Usage:
 *   const penta = require('./lib/pentaTowerCanon480.js');
 *   penta.getCanonInfo480()           // tower metadata
 *   penta.getHealthSummary480()       // live snapshot of all five towers
 *   penta.registerEndpoints480(app)   // wire status + summary endpoints
 *
 * All identifiers end in 480. Sacred files untouched. Zero npm deps.
 * @module pentaTowerCanon480
 * @version 480.0.0
 */

const CANON_VERSION_480     = '480.0.0';
const CANON_TIP_VERSION_480 = 268;
const CANON_BASE_VERSION_480 = 263;
const CANON_COUNT_480        = CANON_TIP_VERSION_480 - CANON_BASE_VERSION_480 + 1; // 6 each

// ── Tower imports (tip only) ─────────────────────────────────────────────────
let _repLedger480, _reflLoop480, _qf480, _oq480, _ob480;
let _loadErrors480 = {};

(function _loadTowers480() {
  const towers480 = [
    ['reputationLedger', './reputationLedger268.js'],
    ['reflectionLoop',   './reflectionLoop268.js'],
    ['quadraticFunding', './quadraticFunding268.js'],
    ['offlineQueue',     './offlineQueue268.js'],
    ['onboardingFlow',   './onboardingFlow268.js'],
  ];
  for (const [name, path] of towers480) {
    try {
      const m = require(path);
      if (name === 'reputationLedger') _repLedger480 = m;
      if (name === 'reflectionLoop')   _reflLoop480  = m;
      if (name === 'quadraticFunding') _qf480        = m;
      if (name === 'offlineQueue')     _oq480        = m;
      if (name === 'onboardingFlow')   _ob480        = m;
    } catch (e) {
      _loadErrors480[name] = e.message;
    }
  }
})();

// ── Metadata ─────────────────────────────────────────────────────────────────
function getCanonInfo480() {
  return Object.freeze({
    canonVersion:  CANON_VERSION_480,
    tipVersion:    CANON_TIP_VERSION_480,
    baseVersion:   CANON_BASE_VERSION_480,
    moduleCount:   CANON_COUNT_480,
    towers: [
      'reputationLedger268',
      'reflectionLoop268',
      'quadraticFunding268',
      'offlineQueue268',
      'onboardingFlow268',
    ],
    endpoints: [
      'V480-T01 GET /api/v1/penta-tower/canon/status',
      'V480-T02 GET /api/v1/admin/summary/v480',
    ],
    importGuidance480: 'Import pentaTowerCanon480 — never individual versioned modules.',
    ecosVersion: 'V480',
    loadErrors: _loadErrors480,
  });
}

// ── Health summary ────────────────────────────────────────────────────────────
function getHealthSummary480() {
  const ts480 = Date.now();
  const towers480 = {};

  if (_repLedger480) {
    try {
      const inst = _repLedger480.defaultReputationLedger268;
      towers480.reputationLedger = {
        ok: true,
        userCount: inst && inst._users ? inst._users.size : 0,
        attestationTypes: (_repLedger480.ATTESTATION_TYPES_268 || []).length,
        decayHalfLifeMs: _repLedger480.DECAY_HALF_LIFE_MS_268 || null,
      };
    } catch (e) { towers480.reputationLedger = { ok: false, error: e.message }; }
  } else {
    towers480.reputationLedger = { ok: false, error: _loadErrors480.reputationLedger || 'not loaded' };
  }

  if (_reflLoop480) {
    try {
      towers480.reflectionLoop = {
        ok: true,
        maxRetries: _reflLoop480.MAX_RETRIES_268,
        selfCorrectRate: _reflLoop480.SELF_CORRECT_RATE_268,
      };
    } catch (e) { towers480.reflectionLoop = { ok: false, error: e.message }; }
  } else {
    towers480.reflectionLoop = { ok: false, error: _loadErrors480.reflectionLoop || 'not loaded' };
  }

  if (_qf480) {
    try {
      towers480.quadraticFunding = {
        ok: true,
        minContribution: _qf480.QF_MIN_CONTRIBUTION_268 !== undefined
          ? String(_qf480.QF_MIN_CONTRIBUTION_268) : null,
      };
    } catch (e) { towers480.quadraticFunding = { ok: false, error: e.message }; }
  } else {
    towers480.quadraticFunding = { ok: false, error: _loadErrors480.quadraticFunding || 'not loaded' };
  }

  if (_oq480) {
    try {
      const inst = _oq480.defaultOfflineQueue268;
      towers480.offlineQueue = {
        ok: true,
        priorityLevels: (_oq480.PRIORITY_LEVELS_268 || []).length,
        maxQueueSize: _oq480.MAX_QUEUE_SIZE_268 || null,
        queuedItems: inst && inst._queue ? inst._queue.length : 0,
      };
    } catch (e) { towers480.offlineQueue = { ok: false, error: e.message }; }
  } else {
    towers480.offlineQueue = { ok: false, error: _loadErrors480.offlineQueue || 'not loaded' };
  }

  if (_ob480) {
    try {
      towers480.onboardingFlow = {
        ok: true,
        flowSteps: (_ob480.FLOW_STEPS_268 || []).length,
        channels: (_ob480.CHANNELS_268 || []).length,
        cryptoWords: (_ob480.CRYPTO_WORDS_268 || []).length,
      };
    } catch (e) { towers480.onboardingFlow = { ok: false, error: e.message }; }
  } else {
    towers480.onboardingFlow = { ok: false, error: _loadErrors480.onboardingFlow || 'not loaded' };
  }

  const allOk480 = Object.values(towers480).every(t => t.ok);
  return { ok: allOk480, timestamp: ts480, towers: towers480 };
}

// ── Endpoint registration ─────────────────────────────────────────────────────
function registerEndpoints480(app) {
  if (!app || typeof app.get !== 'function') return;

  // V480-T01: tower status
  app.get('/api/v1/penta-tower/canon/status', (req, res) => {
    try {
      res.json({ ok: true, canon: getCanonInfo480(), health: getHealthSummary480() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // V480-T02: admin summary
  app.get('/api/v1/admin/summary/v480', (req, res) => {
    try {
      const info480 = getCanonInfo480();
      const health480 = getHealthSummary480();
      res.json({
        version: CANON_VERSION_480,
        summary: 'PentaTowerCanon480: facade for 5 towers × 6 versions (V263–V268)',
        towers: info480.towers,
        health: health480.ok ? 'all-ok' : 'degraded',
        towerStatus: health480.towers,
        loadErrors: info480.loadErrors,
        endpoints: info480.endpoints,
        timestamp: Date.now(),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}

module.exports = {
  // metadata
  CANON_VERSION_480,
  CANON_TIP_VERSION_480,
  CANON_BASE_VERSION_480,
  CANON_COUNT_480,

  // public API
  getCanonInfo480,
  getHealthSummary480,
  registerEndpoints480,

  // re-export canonical tips — callers need only this file
  // reputationLedger268
  get ReputationLedger268()         { return _repLedger480 && _repLedger480.ReputationLedger268; },
  get defaultReputationLedger268()  { return _repLedger480 && _repLedger480.defaultReputationLedger268; },
  get ATTESTATION_TYPES_268()       { return _repLedger480 && _repLedger480.ATTESTATION_TYPES_268; },
  get DECAY_HALF_LIFE_MS_268()      { return _repLedger480 && _repLedger480.DECAY_HALF_LIFE_MS_268; },

  // reflectionLoop268
  get ReflectionLoop268()           { return _reflLoop480 && _reflLoop480.ReflectionLoop268; },
  get defaultReflectionLoop268()    { return _reflLoop480 && _reflLoop480.defaultReflectionLoop268; },
  get MAX_RETRIES_268()             { return _reflLoop480 && _reflLoop480.MAX_RETRIES_268; },
  get SELF_CORRECT_RATE_268()       { return _reflLoop480 && _reflLoop480.SELF_CORRECT_RATE_268; },

  // quadraticFunding268
  get QuadraticFunding268()         { return _qf480 && _qf480.QuadraticFunding268; },
  get defaultQuadraticFunding268()  { return _qf480 && _qf480.defaultQuadraticFunding268; },
  get QF_MIN_CONTRIBUTION_268()     { return _qf480 && _qf480.QF_MIN_CONTRIBUTION_268; },

  // offlineQueue268
  get OfflineQueue268()             { return _oq480 && _oq480.OfflineQueue268; },
  get defaultOfflineQueue268()      { return _oq480 && _oq480.defaultOfflineQueue268; },
  get PRIORITY_LEVELS_268()         { return _oq480 && _oq480.PRIORITY_LEVELS_268; },
  get MAX_QUEUE_SIZE_268()          { return _oq480 && _oq480.MAX_QUEUE_SIZE_268; },

  // onboardingFlow268
  get OnboardingFlow268()           { return _ob480 && _ob480.OnboardingFlow268; },
  get FLOW_STEPS_268()              { return _ob480 && _ob480.FLOW_STEPS_268; },
  get CHANNELS_268()                { return _ob480 && _ob480.CHANNELS_268; },
  get CRYPTO_WORDS_268()            { return _ob480 && _ob480.CRYPTO_WORDS_268; },
  get USSD_FLOW_268()               { return _ob480 && _ob480.USSD_FLOW_268; },
};
