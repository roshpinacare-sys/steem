'use strict';
/**
 * lib/marketMakerCompositeEnhanced563.js — ECOS V563
 *
 * Enhanced composite score that connects tokenSnapshotBuffer562 to the
 * autocorr component of getCompositeScore543.
 *
 * הבעיה שנסגרת:
 *   getCompositeScore543() → autocorr component קורא measureBandWidthAutocorrelation333([], ...)
 *   → תמיד ok:false → autocorr=0 → compositeScore תקרה ב-0.8.
 *   V562 הוסיף ring buffer (tokenSnapshotBuffer562) אך לא חיבר אותו ל-compositeScore.
 *
 * הפתרון:
 *   getCompositeScore563() — composite score אמיתי:
 *     - kurtosis, outlierZ, entropy: מ-getCompositeScore543() (unchanged)
 *     - autocorr: מ-getAutoCorrelationScore562(rb) עם buffer אמיתי
 *   כשה-buffer מאוכלס (≥5 snapshots) → compositeScore יכול להגיע ל-1.0.
 *
 * Chain: tokenSnapshotBuffer562 → getAutoCorrelationScore562 → getCompositeScore563
 *        ↑ seeded via POST /autocorr/seed/v562
 *
 * Usage:
 *   const e563 = require('./marketMakerCompositeEnhanced563.js');
 *   e563.getCompositeScore563()      // { compositeScore, grade, components, autocorrSource }
 *   e563.registerEndpoints563(app)   // wire live composite endpoint
 *
 * All identifiers end in 563. Zero npm deps. Sacred untouched.
 * @module marketMakerCompositeEnhanced563
 * @version 563.0.0
 */

const ENHANCED_VERSION_563 = '563.0.0';

const C543 = require('./marketMakerCanon543.js');
const TSB562 = require('./tokenSnapshotBuffer562.js');

// Weights — must match V543 (sum=1.0)
const WEIGHTS_563 = { kurtosis: 0.3, outlierZ: 0.3, autocorr: 0.2, entropy: 0.2 };

/**
 * _grade563(score) — letter grade from compositeScore in [0,1]
 */
function _grade563(score563) {
  if (score563 >= 0.95) return 'A+';
  if (score563 >= 0.85) return 'A';
  if (score563 >= 0.70) return 'B';
  if (score563 >= 0.50) return 'C';
  return 'D';
}

/**
 * getCompositeScore563() — enhanced composite score
 * - kurtosis, outlierZ, entropy: from getCompositeScore543() (stable, unchanged)
 * - autocorr: from getAutoCorrelationScore562(rb) using real tokenSnapshotBuffer562
 *
 * @returns {{ compositeScore, grade, weights, componentScores, details, autocorrSource, version }}
 */
function getCompositeScore563() {
  // Pull base components (kurtosis, outlierZ, entropy) from V543
  const base563 = C543.getCompositeScore543();
  const s563 = {
    kurtosis: base563.componentScores.kurtosis,
    outlierZ: base563.componentScores.outlierZ,
    entropy:  base563.componentScores.entropy,
    autocorr: 0, // will be replaced below
  };
  const d563 = {
    kurtosis: base563.details.kurtosis,
    outlierZ: base563.details.outlierZ,
    entropy:  base563.details.entropy,
    autocorr: { ok: false, source: 'V562-buffer', bufferSize: 0 },
  };

  // Replace autocorr with real buffer-based score
  let autocorrSource563 = 'empty-buffer';
  try {
    const rb563 = C543.defaultRankedOverlapBuffer333();
    const ar563 = TSB562.getAutoCorrelationScore562(rb563);
    s563.autocorr = ar563.score;     // 1 if ok:true, 0 if not enough snapshots
    d563.autocorr = {
      ok:         ar563.ok,
      score:      ar563.score,
      autocorr:   ar563.autocorr,
      bufferSize: ar563.bufferSize,
      minRequired: TSB562.MIN_SNAPSHOTS_562,
      source:     'tokenSnapshotBuffer562 (V562)',
      hint:       ar563.ok
        ? 'buffer seeded — autocorr contributing to score'
        : 'seed via POST /api/v1/market-maker/autocorr/seed/v562 (need ≥' + TSB562.MIN_SNAPSHOTS_562 + ' snapshots)',
    };
    autocorrSource563 = ar563.ok ? 'V562-buffer-seeded' : 'V562-buffer-empty';
  } catch (e563) {
    d563.autocorr.error = e563.message;
    autocorrSource563 = 'error';
  }

  const composite563 = parseFloat((
    s563.kurtosis * WEIGHTS_563.kurtosis +
    s563.outlierZ * WEIGHTS_563.outlierZ +
    s563.autocorr * WEIGHTS_563.autocorr +
    s563.entropy  * WEIGHTS_563.entropy
  ).toFixed(4));

  return {
    compositeScore:  composite563,
    grade:           _grade563(composite563),
    weights:         WEIGHTS_563,
    componentScores: s563,
    details:         d563,
    autocorrSource:  autocorrSource563,
    v543baseline:    base563.compositeScore,  // for comparison
    improvement:     parseFloat((composite563 - base563.compositeScore).toFixed(4)),
    version:         ENHANCED_VERSION_563,
  };
}

/**
 * registerEndpoints563(app) — wire endpoints
 * @param {object} app — express app
 */
function registerEndpoints563(app) {
  // [V563-T01] GET /api/v1/market-maker/composite/live/v563
  app.get('/api/v1/market-maker/composite/live/v563', function(req563, res563) {
    try {
      const result563 = getCompositeScore563();
      res563.json(Object.assign({ ok: true, ecosVersion: 'V563' }, result563));
    } catch (e563) {
      res563.status(500).json({ ok: false, error: e563.message, ecosVersion: 'V563' });
    }
  });

  // [V563-T02] GET /api/v1/admin/summary/v563
  app.get('/api/v1/admin/summary/v563', function(req563s, res563s) {
    const bufferSize563 = TSB562.getTokenSnapshots562().length;
    res563s.json({
      ok:          true,
      version:     'V563',
      feature:     'composite-score-live-autocorr',
      description: 'Enhanced compositeScore that connects tokenSnapshotBuffer562 (V562) ' +
                   'to the autocorr component. getCompositeScore543 always scored autocorr=0 ' +
                   'via measureBandWidthAutocorrelation333([], …). V563 reads from the real ' +
                   'token-snapshot ring buffer → autocorr can reach 1.0 after seeding.',
      endpoints: [
        'V563-T01 GET /api/v1/market-maker/composite/live/v563',
        'V563-T02 GET /api/v1/admin/summary/v563',
      ],
      chain:        'POST /autocorr/seed/v562 → tokenSnapshotBuffer562 → getCompositeScore563 → live score',
      bufferStatus: { current: bufferSize563, minRequired: TSB562.MIN_SNAPSHOTS_562, capacity: TSB562.MAX_SNAPSHOTS_562 },
      fixes:        ['getCompositeScore543: autocorr=0 (hardcoded []) → live from V562 buffer'],
      ecosVersion:  'V563',
    });
  });
}

module.exports = {
  getCompositeScore563,
  registerEndpoints563,
  ENHANCED_VERSION_563,
  WEIGHTS_563,
};
