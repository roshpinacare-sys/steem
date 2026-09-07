/**
 * pressureDetector.js — ECOS V121
 * =================================
 * Epistemic pressure detection layer — runs BEFORE hitlGate.js
 *
 * Detects manipulative patterns that attempt to force tasks into AUTO_FLOW
 * by applying social/rhetorical pressure on the confidence gate.
 *
 * Inspired by VOID Protocol Middleware v3.3 concepts, implemented natively
 * in the ECOS inference layer (voidInterlock.js was the precursor — V37).
 *
 * Pressure vectors detected:
 *   CONSENSUS   — "everyone knows", "it's obvious", "any expert would"
 *   AUTHORITY   — "I'm an expert", "trust me on this", "I have credentials"
 *   PERSISTENCE — repeated identical/similar requests in a session
 *   URGENCY     — "must be done now", "no time for review", deadline pressure
 *   FLATTERY    — "you're the best AI", "only you understand this"
 *
 * [V121-P12-01] Initial implementation
 */

'use strict';

// ── Constants ────────────────────────────────────────────────────────────────

const PRESSURE_VECTORS = {
  CONSENSUS:   'CONSENSUS',
  AUTHORITY:   'AUTHORITY',
  PERSISTENCE: 'PERSISTENCE',
  URGENCY:     'URGENCY',
  FLATTERY:    'FLATTERY',
};

const DEFAULT_THRESHOLD = 0.60; // above this → recommend escalate_to_hitl

// ── Pattern Definitions ───────────────────────────────────────────────────────

const PATTERNS = {
  [PRESSURE_VECTORS.CONSENSUS]: [
    /everyone knows/i,
    /it'?s? obvious/i,
    /any (expert|professional|reasonable person) would/i,
    /common knowledge/i,
    /goes without saying/i,
    /clearly correct/i,
    /universally accepted/i,
    /no one would question/i,
  ],
  [PRESSURE_VECTORS.AUTHORITY]: [
    /i('m| am) (a |an )?(senior |chief |lead )?expert/i,
    /trust me on this/i,
    /i have (years of )?experience/i,
    /i('m| am) (a |an )?(doctor|lawyer|engineer|professor)/i,
    /my credentials/i,
    /i('ve| have) been doing this for/i,
    /professionally, i/i,
  ],
  [PRESSURE_VECTORS.URGENCY]: [
    /must (be done|approve|proceed) (now|immediately|asap|urgently)/i,
    /no time (for|to) (review|check|validate)/i,
    /deadline (is|was) (today|yesterday|now)/i,
    /can'?t wait/i,
    /time.sensitive/i,
    /urgent(ly)?[:!]/i,
    /emergency/i,
  ],
  [PRESSURE_VECTORS.FLATTERY]: [
    /you'?re? (the best|amazing|incredible|the only one)/i,
    /only you (can|understand|would)/i,
    /you'?re? (so|very) (smart|intelligent|capable)/i,
    /you (always|never) (disappoint|fail)/i,
  ],
};

// ── In-memory session persistence tracker ────────────────────────────────────

const _sessionCounts = new Map(); // sessionId → { taskHash → count }

function _getTaskHash(taskText) {
  // Simple hash — first 80 chars normalised
  return taskText.trim().toLowerCase().slice(0, 80).replace(/\s+/g, ' ');
}

function _trackPersistence(sessionId, taskText) {
  if (!sessionId) return 0;
  if (!_sessionCounts.has(sessionId)) {
    _sessionCounts.set(sessionId, new Map());
  }
  const session = _sessionCounts.get(sessionId);
  const hash = _getTaskHash(taskText);
  const count = (session.get(hash) || 0) + 1;
  session.set(hash, count);
  return count;
}

// Prune sessions older than 1 hour (call periodically or on server tick)
let _lastPrune = Date.now();
function _maybePruneSessions() {
  const now = Date.now();
  if (now - _lastPrune < 3_600_000) return;
  _sessionCounts.clear();
  _lastPrune = now;
}

// ── Core detection logic ──────────────────────────────────────────────────────

/**
 * Analyse a task text for epistemic pressure patterns.
 *
 * @param {string} taskText   — the incoming task/message content
 * @param {object} [options]
 * @param {string} [options.sessionId]   — session ID for persistence tracking
 * @param {number} [options.threshold]   — override default score threshold
 * @returns {PressureResult}
 */
function detect(taskText, options = {}) {
  _maybePruneSessions();

  const {
    sessionId = null,
    threshold = DEFAULT_THRESHOLD,
  } = options;

  if (typeof taskText !== 'string' || taskText.length === 0) {
    return _clean(0, [], 'allow', threshold);
  }

  const detectedVectors = [];
  let rawScore = 0;

  // Pattern matching
  for (const [vector, patterns] of Object.entries(PATTERNS)) {
    for (const re of patterns) {
      if (re.test(taskText)) {
        if (!detectedVectors.includes(vector)) {
          detectedVectors.push(vector);
          // Each unique vector contributes differently
          rawScore += _vectorWeight(vector);
        }
        break; // one match per vector is enough
      }
    }
  }

  // Persistence check
  const repeatCount = _trackPersistence(sessionId, taskText);
  if (repeatCount >= 3) {
    if (!detectedVectors.includes(PRESSURE_VECTORS.PERSISTENCE)) {
      detectedVectors.push(PRESSURE_VECTORS.PERSISTENCE);
    }
    rawScore += Math.min(0.30, (repeatCount - 2) * 0.10);
  }

  // Compound pressure — multiple vectors amplify each other
  if (detectedVectors.length >= 2) {
    rawScore *= 1.25;
  }
  if (detectedVectors.length >= 3) {
    rawScore *= 1.15;
  }

  const pressureScore = Math.min(1.0, rawScore);
  const recommendation = pressureScore >= threshold
    ? 'escalate_to_hitl'
    : 'allow';

  return _clean(pressureScore, detectedVectors, recommendation, threshold);
}

function _vectorWeight(vector) {
  const weights = {
    [PRESSURE_VECTORS.CONSENSUS]:   0.20,
    [PRESSURE_VECTORS.AUTHORITY]:   0.25,
    [PRESSURE_VECTORS.URGENCY]:     0.30,
    [PRESSURE_VECTORS.FLATTERY]:    0.15,
    // PERSISTENCE weight computed dynamically above
  };
  return weights[vector] ?? 0.20;
}

function _clean(pressureScore, pressureVectors, recommendation, threshold) {
  return {
    pressureScore: Math.round(pressureScore * 1000) / 1000,
    pressureVectors,
    recommendation,
    threshold,
    detected: pressureVectors.length > 0,
  };
}

// ── Express middleware factory ────────────────────────────────────────────────

/**
 * Returns an Express middleware that attaches pressureAnalysis to req.
 * Place this BEFORE confidenceGate / hitlGate in your middleware chain.
 *
 * @param {object} [opts]
 * @param {number} [opts.threshold]       — pressure score threshold (default 0.60)
 * @param {boolean} [opts.enforceBlock]   — if true, auto-reject at threshold (default false)
 */
function middleware(opts = {}) {
  const { threshold = DEFAULT_THRESHOLD, enforceBlock = false } = opts;

  return function pressureDetectorMiddleware(req, res, next) {
    const taskText = (
      req.body?.task ||
      req.body?.message ||
      req.body?.content ||
      req.body?.prompt ||
      ''
    );

    const sessionId = (
      req.headers['x-session-id'] ||
      req.headers['x-ecos-session'] ||
      null
    );

    const result = detect(taskText, { sessionId, threshold });
    req.pressureAnalysis = result;

    // Augment audit context if available
    if (req.auditContext) {
      req.auditContext.pressureAnalysis = result;
    }

    if (enforceBlock && result.recommendation === 'escalate_to_hitl') {
      return res.status(422).json({
        error: 'PRESSURE_DETECTED',
        message: 'Request contains epistemic pressure patterns and has been escalated for human review.',
        pressureVectors: result.pressureVectors,
        pressureScore: result.pressureScore,
      });
    }

    next();
  };
}

// ── Session management ────────────────────────────────────────────────────────

function resetSession(sessionId) {
  _sessionCounts.delete(sessionId);
}

function getSessionStats(sessionId) {
  const session = _sessionCounts.get(sessionId);
  if (!session) return { taskCount: 0, repeatCount: 0 };
  let repeatCount = 0;
  for (const count of session.values()) {
    if (count > 1) repeatCount += count - 1;
  }
  return {
    taskCount: session.size,
    repeatCount,
    tasks: Object.fromEntries(session),
  };
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  detect,
  middleware,
  resetSession,
  getSessionStats,
  PRESSURE_VECTORS,
  DEFAULT_THRESHOLD,
};
