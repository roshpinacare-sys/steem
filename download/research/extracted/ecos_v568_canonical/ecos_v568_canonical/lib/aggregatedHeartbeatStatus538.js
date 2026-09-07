'use strict';
/**
 * lib/aggregatedHeartbeatStatus538.js — ECOS V538
 *
 * Aggregated heartbeat-governance status.
 *
 * הבעיה שנפתרת:
 *   V534 IIFE מעביר `_hb532_534 = null` ל-buildHealthReport534 →
 *   השדה `hbRunning` תמיד false גם כשה-heartbeat חי.
 *   V537 תיקן את זה עבור endpoint משלו, אבל לא עדכן את V534.
 *
 * הפתרון ב-V538:
 *   endpoint אחד שמאגד את כל השלבים (V532 → V534 → V536 → V537)
 *   ומחזיר `hbRunning` אמיתי דרך Bridge532.activeHb532 (כמו V537).
 *   אין שינוי ב-IIFEs קיימים — הוספה בלבד.
 *
 * Zero new npm deps. All identifiers end in 538. Sacred files untouched.
 * @module aggregatedHeartbeatStatus538
 * @version 538.0.0
 */

const AGGREGATE_VERSION_538 = '538.0.0';

/**
 * buildAggregatedStatus538(opts)
 * @param {object} opts
 * @param {object} opts.Bridge532     — heartbeatGovernanceBridge532 module
 * @param {object} [opts.GHG534]      — governanceHealthGate534 module (optional)
 * @param {object} [opts.Diag533]     — governanceDiagnose533 module (optional)
 * @param {object} [opts.diagOpts]    — { O437, status505, gc499, audit, libDir }
 * @returns {object} aggregated status payload
 */
function buildAggregatedStatus538(opts) {
  opts = opts || {};
  const Bridge532 = opts.Bridge532;
  const errors538 = [];
  const phases538 = {};

  // ── Phase 1: Bridge / activeBridge532 ────────────────────────────────────
  let bridgeLive538 = false;
  try {
    const bridge = Bridge532 && Bridge532.activeBridge532;
    bridgeLive538 = !!bridge;
    phases538.bridge532 = {
      ok:   bridgeLive538,
      desc: bridgeLive538 ? 'activeBridge532 present' : 'activeBridge532 null',
    };
  } catch (e) {
    errors538.push('bridge532: ' + e.message);
    phases538.bridge532 = { ok: false, error: e.message };
  }

  // ── Phase 2: Heartbeat / activeHb532 (the fix) ───────────────────────────
  let hbLive538    = false;
  let hbRunning538 = false;
  try {
    const hb = Bridge532 && Bridge532.activeHb532;
    hbLive538 = !!hb;
    if (hb && typeof hb.getStatus === 'function') {
      const st = hb.getStatus();
      hbRunning538 = !!(st && st.running);
      phases538.hb532 = {
        ok:        hbLive538,
        hbRunning: hbRunning538,
        interval:  st ? st.intervalMs : null,
        ticks:     st ? st.ticks      : null,
        lastTick:  st ? st.lastTick   : null,
        desc:      'activeHb532 read via Bridge532.activeHb532 (V538 fix)',
      };
    } else if (hb) {
      hbRunning538 = true; // hb present but no getStatus — assume running
      phases538.hb532 = { ok: true, hbRunning: true, desc: 'activeHb532 present (no getStatus)' };
    } else {
      phases538.hb532 = { ok: false, hbRunning: false, desc: 'activeHb532 null — heartbeat not started' };
    }
  } catch (e) {
    errors538.push('hb532: ' + e.message);
    phases538.hb532 = { ok: false, hbRunning: false, error: e.message };
  }

  // ── Phase 3: governanceHealthGate534 snapshot (optional, don't blow up) ──
  if (opts.GHG534 && opts.Diag533) {
    try {
      const report = opts.GHG534.buildHealthReport534({
        bridge532:   Bridge532 && Bridge532.activeBridge532,
        hb532:       Bridge532 && Bridge532.activeHb532, // USE REAL activeHb532 (V538 fix)
        diagOpts533: opts.diagOpts || {},
        Diag533:     opts.Diag533,
      });
      phases538.healthGate534 = {
        ok:    report.level === 'healthy',
        level: report.level,
        desc:  'governanceHealthGate534 called with real activeHb532',
      };
    } catch (e) {
      phases538.healthGate534 = { ok: false, error: e.message };
    }
  } else {
    phases538.healthGate534 = { ok: null, desc: 'GHG534/Diag533 not provided (optional)' };
  }

  // ── Overall health ─────────────────────────────────────────────────────────
  const allOk538 = bridgeLive538 && hbLive538 && errors538.length === 0;
  const level538 = allOk538 ? 'healthy' : (bridgeLive538 ? 'degraded' : 'unhealthy');

  return {
    ok:           allOk538,
    level:        level538,
    version:      AGGREGATE_VERSION_538,
    ecosVersion:  'V538',
    bridgeLive:   bridgeLive538,
    hbLive:       hbLive538,
    hbRunning:    hbRunning538,        // ← the real value (V534 always returned false)
    hbFix:        'V538: hbRunning now reads Bridge532.activeHb532, not _hb532_534=null (V534 bug)',
    phases:       phases538,
    errors:       errors538,
    ts:           new Date().toISOString(),
  };
}

module.exports = {
  buildAggregatedStatus538,
  AGGREGATE_VERSION_538,
};
