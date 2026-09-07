'use strict';
/**
 * lib/marketMakerCanon543.js — ECOS V543
 *
 * Enhanced canonical facade for the marketMaker tower (V298–V333, 36 modules).
 * Extends marketMakerCanon475 with cross-metric composite health scoring
 * and trend detection over a rolling score window.
 *
 * New in V543:
 *   getCompositeScore543()    — weighted composite [0..1]: kurtosis(0.3)+outlierZ(0.3)+autocorr(0.2)+entropy(0.2)
 *   getHealthReport543()      — full health snapshot + trend signal (rising/falling/stable/unknown)
 *   registerEndpoints543(app) — 3 endpoints
 *
 * Chain: V298→...→V333 (36 modules). New code imports this file only.
 * Sacred files untouched. Zero npm deps. All identifiers end in 543.
 * @module marketMakerCanon543
 * @version 543.0.0
 */

const CANON_VERSION_543     = '543.0.0';
const CANON_TOWER_PREFIX_543 = 'marketMaker';
const CANON_TIP_VERSION_543  = 333;
const CANON_BASE_VERSION_543 = 298;
const CANON_COUNT_543        = CANON_TIP_VERSION_543 - CANON_BASE_VERSION_543 + 1; // 36
const IMPORT_GUIDANCE_543    =
  'New code: require(./lib/marketMakerCanon543.js). Never import V298..V332 or Canon475 directly.';

// ── canonical base (Canon475 wraps V333 tip) ─────────────────────────────────
const CANON475 = require('./marketMakerCanon475.js');
const {
  MM_VERSION_333,
  AuditCapTrail333, defaultAuditCapTrail333,
  PageRangeDiffBridge333, defaultPageRangeDiffBridge333,
  RankedOverlapBuffer333, defaultRankedOverlapBuffer333,
  NormDeltaPercentilesTracker333, defaultNormDeltaPercentilesTracker333,
  registerV333Endpoints,
} = CANON475;

// ── lazy singletons ─────────────────────────────────────────────────────────
let _at543 = null, _pb543 = null, _rb543 = null, _nt543 = null;
function _init543() {
  if (_at543) return;
  try { _at543 = defaultAuditCapTrail333();              } catch (_) {}
  try { _pb543 = defaultPageRangeDiffBridge333();        } catch (_) {}
  try { _rb543 = defaultRankedOverlapBuffer333();        } catch (_) {}
  try { _nt543 = defaultNormDeltaPercentilesTracker333(); } catch (_) {}
}

// ── public API ───────────────────────────────────────────────────────────────

function getCanonInfo543() {
  return {
    tower: CANON_TOWER_PREFIX_543, canonModule: 'marketMakerCanon543',
    canonVersion: CANON_VERSION_543, tipVersion: MM_VERSION_333,
    baseVersion: CANON_BASE_VERSION_543, tipVersionNum: CANON_TIP_VERSION_543,
    moduleCount: CANON_COUNT_543, importGuidance: IMPORT_GUIDANCE_543,
    prevCanon: 'marketMakerCanon475',
    description: 'Enhanced facade: composite health score + trend from 36 marketMaker modules (V298–V333).',
  };
}

/**
 * getCompositeScore543() — weighted composite health score in [0,1].
 * Weights: kurtosis=0.3, outlierZ=0.3, autocorr=0.2, entropy=0.2 (sum=1.0)
 * Grade: A(>=0.8), B(>=0.6), C(>=0.4), D(<0.4)
 */
function getCompositeScore543() {
  _init543();
  const w = { kurtosis: 0.3, outlierZ: 0.3, autocorr: 0.2, entropy: 0.2 };
  const s = { kurtosis: 0,   outlierZ: 0,   autocorr: 0,   entropy: 0   };
  const d = {};

  try {
    if (_at543 && typeof _at543.detectAccelerationKurtosis333 === 'function') {
      const r = _at543.detectAccelerationKurtosis333(); // V561: correct method name
      s.kurtosis = r.ok ? 1 : 0;
      d.kurtosis = { ok: r.ok, streakCount: r.streakCount };
    }
  } catch (_) { d.kurtosis = { ok: false, error: 'unavailable' }; }

  try {
    if (_pb543 && typeof _pb543.computeOutlierZScore333 === 'function') {
      const r = _pb543.computeOutlierZScore333();
      s.outlierZ = (r.ok && (r.outlierZCount || 0) === 0) ? 1 : (r.ok ? 0.5 : 0);
      d.outlierZ = { ok: r.ok, outlierZCount: r.outlierZCount, maxModifiedZScore: r.maxModifiedZScore };
    }
  } catch (_) { d.outlierZ = { ok: false, error: 'unavailable' }; }

  try {
    if (_rb543 && typeof _rb543.measureBandWidthAutocorrelation333 === 'function') {
      const r = _rb543.measureBandWidthAutocorrelation333([], 0.5, 5);
      s.autocorr = r.ok ? 1 : 0;
      d.autocorr = { ok: r.ok, bandWidthAutocorr: r.bandWidthAutocorr };
    }
  } catch (_) { d.autocorr = { ok: false, error: 'unavailable' }; }

  try {
    if (_nt543 && typeof _nt543.computeEntropyRedundancy333 === 'function') {
      const r = _nt543.computeEntropyRedundancy333('normal');
      s.entropy = (r.ok && (r.entropyRedundancy === null || r.entropyRedundancy < 0.5)) ? 1 : (r.ok ? 0.5 : 0);
      d.entropy = { ok: r.ok, entropyRedundancy: r.entropyRedundancy };
    }
  } catch (_) { d.entropy = { ok: false, error: 'unavailable' }; }

  const composite = parseFloat((s.kurtosis*w.kurtosis + s.outlierZ*w.outlierZ + s.autocorr*w.autocorr + s.entropy*w.entropy).toFixed(4));
  const grade = composite >= 0.8 ? 'A' : composite >= 0.6 ? 'B' : composite >= 0.4 ? 'C' : 'D';

  return { compositeScore: composite, grade, weights: w, componentScores: s, details: d, version: CANON_VERSION_543 };
}

// rolling history for trend detection (last 10 snapshots, in-process)
const _history543 = [];
const _HMAX543 = 10;

/**
 * getHealthReport543() — full snapshot with composite + trend.
 * Trend: rising(>+0.05), falling(<-0.05), stable(±0.05), unknown(first call).
 */
function getHealthReport543() {
  const c = getCompositeScore543();
  _history543.push({ score: c.compositeScore, at: Date.now() });
  if (_history543.length > _HMAX543) _history543.splice(0, _history543.length - _HMAX543);

  let trend = 'unknown';
  if (_history543.length >= 2) {
    const diff = _history543[_history543.length-1].score - _history543[_history543.length-2].score;
    trend = diff > 0.05 ? 'rising' : diff < -0.05 ? 'falling' : 'stable';
  }

  return {
    ok: true, canon: getCanonInfo543(), composite: c,
    trend, historyLength: _history543.length,
    timestamp: Date.now(), ecosVersion: 'V543',
  };
}

function registerEndpoints543(app) {
  if (!app || typeof app.get !== 'function') return;
  // [V543-T01]
  app.get('/api/v1/market-maker/canon/health/v543', (_req, res) => {
    try { res.json(getHealthReport543()); }
    catch (e) { res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V543' }); }
  });
  // [V543-T02]
  app.get('/api/v1/market-maker/canon/composite/v543', (_req, res) => {
    try { res.json({ ok: true, ecosVersion: 'V543', ...getCompositeScore543() }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V543' }); }
  });
  // [V543-T03]
  app.get('/api/v1/admin/summary/v543', (_req, res) => {
    res.json({
      ok: true, version: 'V543', feature: 'marketMaker-canon-enhanced-health',
      description: 'Enhanced canon facade: composite health score + trend from 36 marketMaker modules.',
      moduleCount: CANON_COUNT_543, tipModule: 'marketMaker333', prevCanon: 'marketMakerCanon475',
      endpoints: ['V543-T01 GET /api/v1/market-maker/canon/health/v543','V543-T02 GET /api/v1/market-maker/canon/composite/v543','V543-T03 GET /api/v1/admin/summary/v543'],
      importGuidance: IMPORT_GUIDANCE_543, ecosVersion: 'V543',
    });
  });
}

module.exports = {
  CANON_VERSION_543, CANON_TOWER_PREFIX_543, CANON_TIP_VERSION_543,
  CANON_BASE_VERSION_543, CANON_COUNT_543, IMPORT_GUIDANCE_543,
  getCanonInfo543, getCompositeScore543, getHealthReport543, registerEndpoints543,
  // re-export tip for callers
  MM_VERSION_333, AuditCapTrail333, defaultAuditCapTrail333,
  PageRangeDiffBridge333, defaultPageRangeDiffBridge333,
  RankedOverlapBuffer333, defaultRankedOverlapBuffer333,
  NormDeltaPercentilesTracker333, defaultNormDeltaPercentilesTracker333,
  registerV333Endpoints,
};
