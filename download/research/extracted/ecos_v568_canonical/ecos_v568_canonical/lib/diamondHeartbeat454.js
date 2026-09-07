'use strict';
/**
 * src/lib/diamondHeartbeat454.js — ECOS V454 — Diamond Heartbeat 💓
 *
 * Opt-in periodic cognition→decide cycle for the Diamond (V453).
 * Every `intervalMs` milliseconds (default 60 s):
 *   1. Collect live pillar signals via a caller-supplied `collectSignals()`.
 *   2. Run assessSystem453 → decide453 (pure logic, no side-effects).
 *   3. Append a tamper-evident record to the audit log.
 *   4. Broadcast a `diamond.heartbeat` event to all connected admins via adminWsHub.
 *   5. NEVER auto-execute. Proposals only — HITL required for real action.
 *
 * Design principle: the heartbeat is a continuous self-awareness pulse, not an actuator.
 * It gives operators a live, auditable window into the Diamond's reasoning without
 * any autonomous side-effects. Execution is deliberately separated (V453 /diamond/act).
 *
 * Public API:
 *   createHeartbeat454(opts) → { start(), stop(), status(), lastBeat() }
 *   opts = {
 *     collectSignals: () => sigObj,           // required: live pillar signals
 *     assess: fn,                             // assessSystem453 (injected)
 *     decide: fn,                             // decide453       (injected)
 *     auditLog: AuditLog | null,              // optional: tamper-evident append
 *     adminWsHub: AdminWsHub | null,          // optional: broadcast to admins
 *     intervalMs: number,                     // default 60_000
 *     maxHistory: number,                     // beats kept in memory, default 20
 *     onBeat: (beat) => void,                 // optional callback
 *   }
 *
 * Pure JS, zero new npm deps. Version-suffixed …454.
 * @version 454.0.0
 */

const HEARTBEAT_VERSION_454 = '454.0.0';
const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_MAX_HISTORY = 20;

class HeartbeatError454 extends Error {
  constructor(msg, code) {
    super(msg);
    this.name = 'HeartbeatError454';
    this.code = code || 'HEARTBEAT_ERROR';
  }
}

/**
 * Create a Diamond Heartbeat instance.
 * @param {object} opts
 * @returns {{ start, stop, status, lastBeat }}
 */
function createHeartbeat454(opts = {}) {
  if (typeof opts.collectSignals !== 'function') {
    throw new HeartbeatError454('collectSignals must be a function', 'BAD_OPTS');
  }
  if (typeof opts.assess !== 'function') {
    throw new HeartbeatError454('assess (assessSystem453) must be a function', 'BAD_OPTS');
  }
  if (typeof opts.decide !== 'function') {
    throw new HeartbeatError454('decide (decide453) must be a function', 'BAD_OPTS');
  }

  const intervalMs = (typeof opts.intervalMs === 'number' && opts.intervalMs >= 1000)
    ? opts.intervalMs : DEFAULT_INTERVAL_MS;
  const maxHistory = (typeof opts.maxHistory === 'number' && opts.maxHistory >= 1)
    ? opts.maxHistory : DEFAULT_MAX_HISTORY;

  let _timer = null;
  let _running = false;
  let _beatCount = 0;
  let _lastBeat = null;
  let _lastError = null;
  const _history = []; // ring buffer of recent beats

  /**
   * Execute one heartbeat cycle (propose-only, never executes).
   * @returns {object} beat record
   */
  function _tick() {
    const ts = new Date().toISOString();
    let beat;
    try {
      const signals = opts.collectSignals();
      const cognition = opts.assess(signals);
      const decisions = opts.decide(cognition);

      beat = {
        beatIndex: ++_beatCount,
        ts,
        version: HEARTBEAT_VERSION_454,
        mode: 'propose',          // heartbeat NEVER executes
        cognition: {
          posture: cognition.posture,
          healthScore: cognition.healthScore,
          concernCount: cognition.concernCount,
          concerns: (cognition.concerns || []).map(c => ({
            pillar: c.pillar,
            severity: c.severity,
            detail: c.detail,
          })),
        },
        proposals: (decisions.actions || []).map(a => ({
          capability: a.capability,
          priority: a.priority,
          reason: a.reason,
          reversible: a.reversible,
        })),
        proposalCount: (decisions.actions || []).length,
        ok: true,
      };
    } catch (err) {
      _lastError = err.message;
      beat = {
        beatIndex: ++_beatCount,
        ts,
        version: HEARTBEAT_VERSION_454,
        mode: 'propose',
        ok: false,
        error: err.message,
      };
    }

    // Store in ring buffer
    _history.push(beat);
    if (_history.length > maxHistory) _history.shift();
    _lastBeat = beat;

    // Audit log (tamper-evident, fire-and-forget)
    if (opts.auditLog && typeof opts.auditLog.append === 'function') {
      try {
        opts.auditLog.append('diamond.heartbeat', {
          beatIndex: beat.beatIndex,
          posture: beat.cognition ? beat.cognition.posture : null,
          healthScore: beat.cognition ? beat.cognition.healthScore : null,
          concernCount: beat.cognition ? beat.cognition.concernCount : null,
          proposalCount: beat.proposalCount || 0,
          ok: beat.ok,
          error: beat.error || null,
          mode: 'propose',
        });
      } catch (_) { /* non-fatal */ }
    }

    // Broadcast to admins (fire-and-forget)
    if (opts.adminWsHub && typeof opts.adminWsHub.broadcast === 'function') {
      try {
        opts.adminWsHub.broadcast('diamond.heartbeat', beat);
      } catch (_) { /* non-fatal */ }
    }

    // Optional callback
    if (typeof opts.onBeat === 'function') {
      try { opts.onBeat(beat); } catch (_) { /* non-fatal */ }
    }

    return beat;
  }

  return {
    /**
     * Start periodic heartbeat. Idempotent.
     * @param {boolean} [runImmediately=true] — fire once before first interval
     */
    start(runImmediately = true) {
      if (_running) return this;
      _running = true;
      if (runImmediately) {
        try { _tick(); } catch (_) { /* non-fatal startup beat */ }
      }
      _timer = setInterval(() => {
        try { _tick(); } catch (_) { /* non-fatal */ }
      }, intervalMs);
      // Allow Node process to exit even if heartbeat is running
      if (_timer && typeof _timer.unref === 'function') _timer.unref();
      return this;
    },

    /** Stop the heartbeat. Idempotent. */
    stop() {
      if (!_running) return this;
      _running = false;
      if (_timer) { clearInterval(_timer); _timer = null; }
      return this;
    },

    /** Live status snapshot. */
    status() {
      return {
        running: _running,
        beatCount: _beatCount,
        intervalMs,
        maxHistory,
        lastBeatTs: _lastBeat ? _lastBeat.ts : null,
        lastPosture: (_lastBeat && _lastBeat.cognition) ? _lastBeat.cognition.posture : null,
        lastHealthScore: (_lastBeat && _lastBeat.cognition) ? _lastBeat.cognition.healthScore : null,
        lastError: _lastError,
        version: HEARTBEAT_VERSION_454,
      };
    },

    /** Latest beat record, or null. */
    lastBeat() { return _lastBeat; },

    /** Recent beats (up to maxHistory). */
    history() { return [..._history]; },

    /** Run one beat synchronously (for testing). */
    _tickOnce() { return _tick(); },
  };
}

module.exports = { createHeartbeat454, HEARTBEAT_VERSION_454, HeartbeatError454 };
