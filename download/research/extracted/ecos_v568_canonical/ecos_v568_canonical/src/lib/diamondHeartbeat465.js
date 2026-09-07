'use strict';
/**
 * diamondHeartbeat465.js — Diamond Heartbeat Loop V465
 *
 * Wires V462 (DiamondCognitionEngine) + V437 (Orchestrator) into a
 * scheduled, opt-in observe→trends→foresight→audit loop.
 *
 * Every HEARTBEAT_INTERVAL_MS465 (default 5 min) the heartbeat:
 *   1. Reads live system state (health, solvency, dissatisfaction).
 *   2. Ingest observation into DiamondCognitionEngine462 (memory).
 *   3. Runs analyzeTrends462 + proactiveDecisions462 (foresight).
 *   4. Logs result to auditLog (full accountability).
 *   5. Emits the result as the latest heartbeat status (readable via API).
 *
 * Rules:
 *  - Fail-closed: any error is caught and logged; never crashes server.
 *  - No new npm deps. No financial ops. Read-only observation.
 *  - All identifiers end in 465.
 *  - BigInt not used here (no money — only health metrics).
 *  - intervalHandle465 is exported so tests can clearInterval().
 */

const HEARTBEAT_VERSION_465 = '465';
const HEARTBEAT_INTERVAL_MS_465 = 5 * 60 * 1000; // 5 minutes (overridable in opts)
const MAX_HEARTBEAT_LOG_465 = 100; // keep last 100 heartbeat records in-memory

class HeartbeatError465 extends Error {
  constructor(msg, code) {
    super(msg);
    this.name = 'HeartbeatError465';
    this.code = code || 'HEARTBEAT_ERROR';
    this.statusCode = 500;
  }
}

/**
 * DiamondHeartbeat465
 * @param {object} opts
 *   cognitionEngine: DiamondCognitionEngine462 instance (required)
 *   auditLog:        function(event, data) — audit recorder (optional)
 *   getSystemState:  async() => { healthScore, solvencySurplus, dissatisfaction }
 *                    (optional — defaults to safe no-op returning nulls)
 *   intervalMs:      number (optional, default HEARTBEAT_INTERVAL_MS_465)
 *   autoStart:       boolean (default false — must call start465() explicitly)
 */
class DiamondHeartbeat465 {
  constructor(opts = {}) {
    if (!opts.cognitionEngine) throw new HeartbeatError465('cognitionEngine required', 'BAD_ARGS');
    this.engine465 = opts.cognitionEngine;
    this.audit465 = (typeof opts.auditLog === 'function') ? opts.auditLog : null;
    this.getSystemState465 = (typeof opts.getSystemState === 'function')
      ? opts.getSystemState
      : async () => ({ healthScore: null, solvencySurplus: null, dissatisfaction: null });
    this.intervalMs465 = (typeof opts.intervalMs === 'number' && opts.intervalMs > 0)
      ? opts.intervalMs
      : HEARTBEAT_INTERVAL_MS_465;
    this.intervalHandle465 = null;
    this.lastBeat465 = null;       // most recent heartbeat result
    this.beatLog465 = [];          // rolling log of last MAX_HEARTBEAT_LOG_465 beats
    this.running465 = false;
    this.totalBeats465 = 0;
    this.errorCount465 = 0;

    if (opts.autoStart) this.start465();
  }

  /** Start the heartbeat loop (idempotent). */
  start465() {
    if (this.running465) return this;
    this.running465 = true;
    // Fire immediately, then repeat
    this._beat465().catch(() => {});
    this.intervalHandle465 = setInterval(() => {
      this._beat465().catch(() => {});
    }, this.intervalMs465);
    // Allow Node to exit even if interval is still set (don't block shutdown)
    if (this.intervalHandle465 && typeof this.intervalHandle465.unref === 'function') {
      this.intervalHandle465.unref();
    }
    return this;
  }

  /** Stop the heartbeat loop. */
  stop465() {
    if (this.intervalHandle465) {
      clearInterval(this.intervalHandle465);
      this.intervalHandle465 = null;
    }
    this.running465 = false;
    return this;
  }

  /** Execute one heartbeat cycle. Returns the beat record. */
  async _beat465() {
    const beatAt465 = new Date().toISOString();
    let beatRecord465 = {
      version: HEARTBEAT_VERSION_465,
      at: beatAt465,
      ok: false,
      state: null,
      trends: null,
      proactive: null,
      error: null,
    };

    try {
      // 1. Read live system state
      const state465 = await this.getSystemState465();
      beatRecord465.state = state465;

      // 2. Ingest into cognition engine (only if we have at least healthScore)
      if (state465 && state465.healthScore != null) {
        this.engine465.ingestCognition462({
          healthScore: state465.healthScore,
          solvencySurplus: state465.solvencySurplus != null ? state465.solvencySurplus : undefined,
          dissatisfaction: state465.dissatisfaction != null ? state465.dissatisfaction : undefined,
        });
      }

      // 3. Analyze trends
      const trends465 = this.engine465.analyzeTrends462();
      beatRecord465.trends = {
        ready: trends465.ready,
        earlyWarningsCount: (trends465.earlyWarnings || []).length,
        earlyWarnings: trends465.earlyWarnings || [],
      };

      // 4. Proactive decisions (foresight)
      const proactive465 = this.engine465.proactiveDecisions462(trends465);
      beatRecord465.proactive = {
        proactive: proactive465.proactive,
        actionsCount: (proactive465.actions || []).length,
        actions: (proactive465.actions || []).map(a => ({
          action: a.action,
          reason: a.reason,
          urgency: a.urgency,
        })),
      };

      beatRecord465.ok = true;
    } catch (err465) {
      beatRecord465.error = err465.message;
      beatRecord465.ok = false;
      this.errorCount465++;
    }

    // 5. Audit log (always, even on error)
    if (this.audit465) {
      try {
        this.audit465('diamond.heartbeat', {
          version: HEARTBEAT_VERSION_465,
          at: beatAt465,
          ok: beatRecord465.ok,
          earlyWarningsCount: beatRecord465.trends ? beatRecord465.trends.earlyWarningsCount : 0,
          proactiveActionsCount: beatRecord465.proactive ? beatRecord465.proactive.actionsCount : 0,
          error: beatRecord465.error || null,
        });
      } catch (_) {}
    }

    // Update state
    this.lastBeat465 = beatRecord465;
    this.beatLog465.push(beatRecord465);
    if (this.beatLog465.length > MAX_HEARTBEAT_LOG_465) this.beatLog465.shift();
    this.totalBeats465++;

    return beatRecord465;
  }

  /** Return current status (for API endpoint). */
  status465() {
    return {
      version: HEARTBEAT_VERSION_465,
      running: this.running465,
      intervalMs: this.intervalMs465,
      totalBeats: this.totalBeats465,
      errorCount: this.errorCount465,
      lastBeat: this.lastBeat465,
    };
  }

  /** Return last N beats (for diagnostics). */
  recentBeats465(n = 10) {
    return this.beatLog465.slice(-Math.min(n, MAX_HEARTBEAT_LOG_465));
  }
}

// Singleton factory
let _defaultHeartbeat465 = null;
function defaultDiamondHeartbeat465(opts) {
  if (!_defaultHeartbeat465 && opts) {
    _defaultHeartbeat465 = new DiamondHeartbeat465(opts);
  }
  return _defaultHeartbeat465;
}

module.exports = {
  HEARTBEAT_VERSION_465,
  HEARTBEAT_INTERVAL_MS_465,
  HeartbeatError465,
  DiamondHeartbeat465,
  defaultDiamondHeartbeat465,
};
