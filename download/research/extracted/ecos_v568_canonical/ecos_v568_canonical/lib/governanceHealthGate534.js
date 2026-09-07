'use strict';
/**
 * src/lib/governanceHealthGate534.js — ECOS V534
 *
 * Unified health view: stats + diagnose + governance-state in one call.
 *
 * Problem it solves:
 *   - GET /governance-state (V532) returns a sentinel with no "why" if snap.ok===false.
 *   - GET /governance/diagnose (V533) returns dep health but no snapshot.
 *   - Callers need two round-trips to understand bridge health.
 *
 * This module merges them:
 *   buildHealthReport534(opts) → {
 *     ok, level,           // 'healthy' | 'degraded' | 'unavailable'
 *     snapshot,            // last governance-state snapshot
 *     diagnose,            // dep health from diagnoseBridgeOpts533
 *     stats,               // bridge stats
 *     hbRunning,           // heartbeat alive?
 *     enriched,            // true if snap.ok===false and diagnose was added
 *     reason,              // why not healthy (if applicable)
 *     ecosVersion: 'V534'
 *   }
 *
 * All identifiers end in 534. Zero new npm deps. SACRED untouched.
 * @version 534.0.0
 */

const ECOS_VERSION_534 = 'V534';

/**
 * Determine overall health level from snapshot + diagnose.
 * @param {object} snap
 * @param {object} diag
 * @returns {'healthy'|'degraded'|'unavailable'}
 */
function _level534(snap, diag) {
  if (!diag || diag.criticalDepsOk === false) return 'unavailable';
  if (!snap || snap.ok === false)              return 'degraded';
  return 'healthy';
}

/**
 * Build the unified health report.
 *
 * @param {{
 *   bridge532:    object,   // heartbeatGovernanceBridge532 instance (has getSnapshot, stats)
 *   hb532:        object|null, // heartbeat instance (has status())
 *   diagOpts533:  object,   // opts for diagnoseBridgeOpts533
 *   Diag533:      object,   // governanceDiagnose533 module (has diagnoseBridgeOpts533)
 * }} opts
 * @returns {object}
 */
function buildHealthReport534(opts) {
  const { bridge532, hb532, diagOpts533, Diag533 } = opts || {};

  // ── snapshot ──────────────────────────────────────────────────────────────
  let snapshot = null;
  try { snapshot = bridge532 ? bridge532.getSnapshot() : null; } catch (_) {}

  // ── stats ─────────────────────────────────────────────────────────────────
  let stats = null;
  try { stats = bridge532 ? bridge532.stats() : null; } catch (_) {}

  // ── heartbeat running? ────────────────────────────────────────────────────
  let hbRunning = false;
  try { hbRunning = hb532 ? !!hb532.status().running : false; } catch (_) {}

  // ── diagnose ──────────────────────────────────────────────────────────────
  let diag = null;
  try {
    if (Diag533 && typeof Diag533.diagnoseBridgeOpts533 === 'function' && diagOpts533) {
      diag = Diag533.diagnoseBridgeOpts533(diagOpts533);
    }
  } catch (_) {}

  // ── enrichment: add diagnose when snapshot is failed ─────────────────────
  const snapFailed = !snapshot || snapshot.ok === false;
  const snapshotsFailed = stats && stats.snapshotsFailed > 0;
  const enriched = snapFailed || snapshotsFailed;

  // ── level + reason ────────────────────────────────────────────────────────
  const level = _level534(snapshot, diag);
  let reason = null;
  if (level !== 'healthy') {
    if (diag && diag.criticalDepsOk === false) {
      const missing = diag.deps ? Object.entries(diag.deps).filter(([,v]) => v.status !== 'ok').map(([k]) => k) : [];
      reason = 'critical_deps_missing: ' + (missing.join(', ') || 'unknown');
    } else if (snapshot && snapshot.reason) {
      reason = snapshot.reason;
    } else if (!hbRunning) {
      reason = 'heartbeat_not_running';
    } else {
      reason = 'snapshot_unavailable';
    }
  }

  return {
    ok:          level === 'healthy',
    level,
    snapshot,
    diagnose:    enriched ? diag : null,  // only include when needed
    stats,
    hbRunning,
    enriched,
    reason,
    ecosVersion: ECOS_VERSION_534,
  };
}

module.exports = {
  buildHealthReport534,
  ECOS_VERSION_534,
};
