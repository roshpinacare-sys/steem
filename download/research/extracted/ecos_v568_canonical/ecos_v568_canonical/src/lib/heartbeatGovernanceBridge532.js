'use strict';
/**
 * src/lib/heartbeatGovernanceBridge532.js — ECOS V532
 *
 * Heartbeat → Governance Bridge
 * ════════════════════════════
 * Closes the loop: on every Diamond Heartbeat beat, this bridge runs
 * buildBridgeSnapshot531 and stores the result as last-known-state.
 *
 * Design:
 *   • createBridge532(opts) → bridge instance with onBeat(beat), getSnapshot(),
 *     and stats().
 *   • The bridge is registered as an onBeat callback on the heartbeat instance.
 *   • If heartbeat not started → getSnapshot() returns fail-closed sentinel.
 *   • Governance cycle is always dryRun:true / authorized:false (propose-only).
 *   • Snapshot refresh is non-blocking (sync) and non-fatal: errors stored in
 *     lastError field, never thrown back to heartbeat loop.
 *
 * Public API:
 *   createBridge532(opts) → {
 *     onBeat(beat),          // call this from heartbeat onBeat callback
 *     getSnapshot(),         // returns last snapshot or fail-closed sentinel
 *     stats(),               // beatsSeen, snapshotsOk, snapshotsFailed, lastError
 *     attachTo(hbInstance),  // convenience: sets onBeat on an HB instance opts
 *   }
 *
 * opts = {
 *   buildSnapshot:  fn(opts) → snapshot  (buildBridgeSnapshot531, injected)
 *   snapshotOpts:   object passed to buildSnapshot (O437, status505, gc499, audit, libDir)
 *   maxAge:         ms before getSnapshot() marks snapshot as stale (default 5 min)
 * }
 *
 * All identifiers end in 532. Zero new npm deps.
 * @version 532.0.0
 */

const BRIDGE_VERSION_532 = '532.0.0';
const DEFAULT_MAX_AGE_532 = 5 * 60 * 1000; // 5 minutes

class BridgeError532 extends Error {
  constructor(msg, code) { super(msg); this.name = 'BridgeError532'; this.code = code; }
}

function createBridge532(opts = {}) {
  if (typeof opts.buildSnapshot !== 'function') {
    throw new BridgeError532('buildSnapshot (buildBridgeSnapshot531) must be a function', 'BAD_OPTS');
  }

  const maxAge532 = (typeof opts.maxAge === 'number' && opts.maxAge >= 0)
    ? opts.maxAge : DEFAULT_MAX_AGE_532;

  let _lastSnapshot532  = null;
  let _lastSnapshotTs532 = null;
  let _beatsSeen532      = 0;
  let _snapshotsOk532    = 0;
  let _snapshotsFailed532 = 0;
  let _lastError532      = null;

  /** Fail-closed sentinel for when no snapshot is available yet. */
  function _notStarted532() {
    return {
      ok:      false,
      version: BRIDGE_VERSION_532,
      reason:  'not_started',
      detail:  'No heartbeat beat received yet. Start the Diamond Heartbeat first.',
    };
  }

  /** Fail-closed sentinel for stale snapshots. */
  function _stale532(ageSec) {
    return {
      ok:         false,
      version:    BRIDGE_VERSION_532,
      reason:     'stale',
      detail:     `Last snapshot is ${ageSec}s old (max ${maxAge532 / 1000}s). Heartbeat may be paused.`,
      lastOk:     _lastSnapshot532,
    };
  }

  /**
   * Called on each heartbeat beat. Runs governance bridge and stores snapshot.
   * Never throws — all errors are stored in _lastError532.
   */
  function _onBeat532(beat) {
    _beatsSeen532++;
    try {
      const snap = opts.buildSnapshot(opts.snapshotOpts || {});
      _lastSnapshot532  = {
        ...snap,
        _bridge532: { version: BRIDGE_VERSION_532, beatIndex: beat && beat.beatIndex, ts: new Date().toISOString() },
      };
      _lastSnapshotTs532 = Date.now();
      _snapshotsOk532++;
      _lastError532 = null;
    } catch (e) {
      _snapshotsFailed532++;
      _lastError532 = e.message;
      // non-fatal: do not rethrow
    }
  }

  return {
    /** Register as onBeat callback — pass this to HB createHeartbeat454 opts.onBeat */
    onBeat: _onBeat532,

    /**
     * Returns last known governance snapshot.
     * Fail-closed: returns sentinel if no snapshot yet, or if too stale.
     */
    getSnapshot() {
      if (!_lastSnapshot532) return _notStarted532();
      const ageMs = Date.now() - _lastSnapshotTs532;
      if (maxAge532 === 0 || ageMs > maxAge532) return _stale532(Math.round(ageMs / 1000));
      return _lastSnapshot532;
    },

    /** Diagnostic stats */
    stats() {
      return {
        version:         BRIDGE_VERSION_532,
        beatsSeen:       _beatsSeen532,
        snapshotsOk:     _snapshotsOk532,
        snapshotsFailed: _snapshotsFailed532,
        lastError:       _lastError532,
        hasSnapshot:     !!_lastSnapshot532,
        snapshotAgeMs:   _lastSnapshotTs532 ? (Date.now() - _lastSnapshotTs532) : null,
        maxAgeMs:        maxAge532,
      };
    },

    /** Force a snapshot now (for testing / cold-start). Non-fatal. */
    _triggerNow532() {
      _onBeat532({ beatIndex: 0, ts: new Date().toISOString(), mode: 'manual' });
    },
  };
}

/**
 * activeBridge532 — singleton reference set by the V532 server IIFE.
 * Initially null. After the IIFE runs, set via:
 *   require('./heartbeatGovernanceBridge532').activeBridge532 = _bridge532;
 * V535+ reads this to get the live bridge instance.
 */
let activeBridge532 = null;

/**
 * activeHb532 — heartbeat singleton reference set by the V532 server IIFE (_getOrCreate532).
 * Initially null. V537+ reads this to get live heartbeat + hbRunning status.
 */
let activeHb532 = null;

module.exports = {
  createBridge532, BRIDGE_VERSION_532, BridgeError532,
  get activeBridge532() { return activeBridge532; }, set activeBridge532(v) { activeBridge532 = v; },
  get activeHb532()     { return activeHb532;     }, set activeHb532(v)     { activeHb532 = v;     },
};
