'use strict';
/**
 * lib/marketMakerCanon475.js — ECOS V475
 *
 * Canonical facade for the marketMaker tower (V298–V333, 36 modules).
 *
 * המגדל: 36 גרסאות של MarketMaker שנצברו ללא facade מאחד.
 * הפתרון: facade אחד שחושף את הגרסה הטיפ (V333) כנקודת כניסה יחידה
 * לכל קוד חדש, כולל health-summary ו-status endpoint.
 *
 * Chain: V298 → V299 → ... → V332 → V333  (כל גרסה מרחיבה את הקודמת)
 * New code imports THIS file — never V298..V332 directly.
 *
 * Usage:
 *   const canon475 = require('./lib/marketMakerCanon475.js');
 *   canon475.getCanonInfo475()          // tower metadata
 *   canon475.getHealthSummary475()      // live snapshot
 *   canon475.defaultAuditTrail475()     // canonical AuditCapTrail instance
 *   canon475.registerEndpoints475(app)  // wire status endpoint
 *
 * All identifiers end in 475. Sacred files untouched. Zero npm deps.
 * @module marketMakerCanon475
 * @version 475.0.0
 */

const CANON_VERSION_475      = '475.0.0';
const CANON_TOWER_PREFIX_475 = 'marketMaker';
const CANON_TIP_VERSION_475  = 333;
const CANON_BASE_VERSION_475 = 298;
const CANON_COUNT_475        = CANON_TIP_VERSION_475 - CANON_BASE_VERSION_475 + 1; // 36
const IMPORT_GUIDANCE_475    =
  'New code: require(./lib/marketMakerCanon475.js). Never import V298..V332 directly.';

// ── canonical tip ──────────────────────────────────────────────────────────
const TIP475 = require('./marketMaker333.js');

const {
  MM_VERSION_333,
  AuditCapTrail333,
  defaultAuditCapTrail333,
  PageRangeDiffBridge333,
  defaultPageRangeDiffBridge333,
  RankedOverlapBuffer333,
  defaultRankedOverlapBuffer333,
  NormDeltaPercentilesTracker333,
  defaultNormDeltaPercentilesTracker333,
  registerV333Endpoints,
} = TIP475;

// ── lazy singletons for health reporting ──────────────────────────────────
let _auditTrail475   = null;
let _pageBridge475   = null;
let _overlapBuf475   = null;
let _normTracker475  = null;

function _ensureInstances475() {
  if (_auditTrail475) return;
  try { _auditTrail475  = defaultAuditCapTrail333();          } catch (_) {}
  try { _pageBridge475  = defaultPageRangeDiffBridge333();    } catch (_) {}
  try { _overlapBuf475  = defaultRankedOverlapBuffer333();    } catch (_) {}
  try { _normTracker475 = defaultNormDeltaPercentilesTracker333(); } catch (_) {}
}

// ── public API ───────────────────────────────────────────────────────────

/**
 * getCanonInfo475() — metadata על המגדל
 */
function getCanonInfo475() {
  return {
    tower:            CANON_TOWER_PREFIX_475,
    canonModule:      'marketMakerCanon475',
    canonVersion:     CANON_VERSION_475,
    tipVersion:       MM_VERSION_333,
    baseVersion:      CANON_BASE_VERSION_475,
    tipVersionNum:    CANON_TIP_VERSION_475,
    moduleCount:      CANON_COUNT_475,
    importGuidance:   IMPORT_GUIDANCE_475,
    description:      'Canonical facade: 36 marketMaker modules unified. Import this, never V298..V332.',
  };
}

/**
 * getHealthSummary475() — snapshot חי של מצב המגדל
 */
function getHealthSummary475() {
  _ensureInstances475();
  const summary475 = {
    canon:        getCanonInfo475(),
    instances: {},
    timestamp:    Date.now(),
  };

  // AuditCapTrail333 — streak info
  try {
    if (_auditTrail475 && typeof _auditTrail475.detectStreakChanges333 === 'function') {
      const streak = _auditTrail475.detectStreakChanges333();
      summary475.instances.auditCapTrail = {
        ok:          streak.ok,
        streakCount: streak.streakCount,
        version:     streak.version || MM_VERSION_333,
      };
    } else {
      summary475.instances.auditCapTrail = { ok: true, note: 'instance available' };
    }
  } catch (e) {
    summary475.instances.auditCapTrail = { ok: false, error: e.message };
  }

  // PageRangeDiffBridge333 — outlier z-score
  try {
    if (_pageBridge475 && typeof _pageBridge475.computeOutlierZScore333 === 'function') {
      const oz = _pageBridge475.computeOutlierZScore333();
      summary475.instances.pageBridge = {
        ok:              oz.ok,
        outlierZCount:   oz.outlierZCount,
        maxModifiedZ:    oz.maxModifiedZScore,
      };
    } else {
      summary475.instances.pageBridge = { ok: true, note: 'instance available' };
    }
  } catch (e) {
    summary475.instances.pageBridge = { ok: false, error: e.message };
  }

  // RankedOverlapBuffer333 — band width autocorr
  try {
    if (_overlapBuf475 && typeof _overlapBuf475.measureBandWidthAutocorrelation333 === 'function') {
      const bwa = _overlapBuf475.measureBandWidthAutocorrelation333([], 0.5, 5);
      summary475.instances.overlapBuffer = {
        ok:                  bwa.ok,
        bandWidthAutocorr:   bwa.bandWidthAutocorr,
      };
    } else {
      summary475.instances.overlapBuffer = { ok: true, note: 'instance available' };
    }
  } catch (e) {
    summary475.instances.overlapBuffer = { ok: false, error: e.message };
  }

  // NormDeltaPercentilesTracker333 — entropy redundancy
  try {
    if (_normTracker475 && typeof _normTracker475.computeEntropyRedundancy333 === 'function') {
      const er = _normTracker475.computeEntropyRedundancy333('normal');
      summary475.instances.normTracker = {
        ok:               er.ok,
        entropyRedundancy: er.entropyRedundancy,
      };
    } else {
      summary475.instances.normTracker = { ok: true, note: 'instance available' };
    }
  } catch (e) {
    summary475.instances.normTracker = { ok: false, error: e.message };
  }

  return summary475;
}

/**
 * defaultAuditTrail475() — singleton canonical AuditCapTrail333
 */
function defaultAuditTrail475() {
  _ensureInstances475();
  return _auditTrail475;
}

/**
 * registerEndpoints475(app) — wire status endpoint to express app
 * (קרא מה-IIFE בשרת — לא קוראים כפול)
 */
function registerEndpoints475(app) {
  if (!app || typeof app.get !== 'function') return;

  // [V475-T01] GET /api/v1/market-maker/canon/status
  app.get('/api/v1/market-maker/canon/status', (_req, res) => {
    try {
      const health = getHealthSummary475();
      res.json({ ok: true, ecosVersion: 'V475', health });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V475' });
    }
  });

  // [V475-T02] GET /api/v1/admin/summary/v475
  app.get('/api/v1/admin/summary/v475', (_req, res) => {
    res.json({
      ok:          true,
      version:     'V475',
      feature:     'marketMaker-canon-facade',
      description: 'Canonical facade for 36 marketMaker modules (V298–V333). ' +
                   'New code imports marketMakerCanon475.js only.',
      moduleCount: CANON_COUNT_475,
      tipModule:   'marketMaker333',
      endpoints: [
        'V475-T01 GET /api/v1/market-maker/canon/status',
        'V475-T02 GET /api/v1/admin/summary/v475',
      ],
      importGuidance: IMPORT_GUIDANCE_475,
      ecosVersion: 'V475',
    });
  });
}

module.exports = {
  // metadata
  CANON_VERSION_475,
  CANON_TOWER_PREFIX_475,
  CANON_TIP_VERSION_475,
  CANON_BASE_VERSION_475,
  CANON_COUNT_475,
  IMPORT_GUIDANCE_475,

  // public API
  getCanonInfo475,
  getHealthSummary475,
  defaultAuditTrail475,
  registerEndpoints475,

  // re-export canonical tip — so callers need only this file
  MM_VERSION_333,
  AuditCapTrail333,
  defaultAuditCapTrail333,
  PageRangeDiffBridge333,
  defaultPageRangeDiffBridge333,
  RankedOverlapBuffer333,
  defaultRankedOverlapBuffer333,
  NormDeltaPercentilesTracker333,
  defaultNormDeltaPercentilesTracker333,
  registerV333Endpoints,
};
