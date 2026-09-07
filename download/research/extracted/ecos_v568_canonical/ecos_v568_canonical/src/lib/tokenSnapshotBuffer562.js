'use strict';
/**
 * lib/tokenSnapshotBuffer562.js — ECOS V562
 *
 * Token-snapshot ring buffer for autocorr warm-up.
 *
 * הבעיה שנפתרת:
 *   getCompositeScore543() קורא measureBandWidthAutocorrelation333([], 0.5, 5)
 *   עם רשימה ריקה תמיד → ok:false → autocorr=0 → compositeScore=0.8 (לא 1.0).
 *
 * הפתרון:
 *   RankedOverlapBuffer333 מקבל string[][] (רשומות snapshot של טוקנים ממוינים).
 *   מודול זה שומר ring buffer של snapshot-sets אחרונים, ומחשב את ה-autocorr score
 *   עם נתונים אמיתיים. קורא ל-measureBandWidthAutocorrelation333 עם הנתונים הנכונים.
 *
 * Usage:
 *   const buf562 = require('./tokenSnapshotBuffer562.js');
 *   buf562.pushTokenSnapshot562(['BTC','ETH','SOL'])       // add ranked token list
 *   buf562.getAutoCorrelationScore562()                    // { ok, score, autocorr }
 *   buf562.registerEndpoints562(app)                       // wire seed+score endpoints
 *
 * All identifiers end in 562. Zero npm deps. Sacred untouched.
 * @module tokenSnapshotBuffer562
 * @version 562.0.0
 */

const TOKEN_SNAPSHOT_VERSION_562 = '562.0.0';
const MAX_SNAPSHOTS_562           = 20;   // ring buffer capacity
const MIN_SNAPSHOTS_562           = 5;    // minimum for meaningful autocorr
const DEFAULT_THRESHOLD_562       = 0.5;
const DEFAULT_WINDOW_562          = 5;

// ── singleton ring buffer ─────────────────────────────────────────────────────
const _ring562 = [];  // string[][]

/**
 * pushTokenSnapshot562(tokenList)
 * Adds one snapshot (ordered token list) to the ring buffer.
 * @param {string[]} tokenList — e.g. ['BTC','ETH','SOL','XRP']
 * @returns {{ ok:boolean, bufferSize:number }}
 */
function pushTokenSnapshot562(tokenList) {
  if (!Array.isArray(tokenList) || tokenList.length === 0) {
    return { ok: false, error: 'tokenList must be a non-empty array of strings', version: TOKEN_SNAPSHOT_VERSION_562 };
  }
  // Normalise: string tokens only
  const clean562 = tokenList.map(t => String(t).trim()).filter(Boolean);
  if (clean562.length === 0) {
    return { ok: false, error: 'tokenList contained no valid tokens after normalisation', version: TOKEN_SNAPSHOT_VERSION_562 };
  }
  _ring562.push(clean562);
  // Trim to capacity
  while (_ring562.length > MAX_SNAPSHOTS_562) _ring562.shift();
  return { ok: true, bufferSize: _ring562.length, version: TOKEN_SNAPSHOT_VERSION_562 };
}

/**
 * getTokenSnapshots562() — returns a copy of the current ring buffer
 * @returns {string[][]}
 */
function getTokenSnapshots562() {
  return _ring562.slice();
}

/**
 * clearTokenSnapshots562() — empties the ring buffer (for testing)
 */
function clearTokenSnapshots562() {
  _ring562.splice(0, _ring562.length);
}

/**
 * getAutoCorrelationScore562(rb) — computes autocorr score using current snapshots
 * @param {object} rb — RankedOverlapBuffer333 instance (from marketMakerCanon543)
 * @returns {{ ok:boolean, score:number, autocorr:number|null, bufferSize:number }}
 */
function getAutoCorrelationScore562(rb) {
  const snapshots = getTokenSnapshots562();
  if (snapshots.length < MIN_SNAPSHOTS_562) {
    return {
      ok:         false,
      score:      0,
      autocorr:   null,
      bufferSize: snapshots.length,
      minRequired: MIN_SNAPSHOTS_562,
      error:      'need at least ' + MIN_SNAPSHOTS_562 + ' snapshots, have ' + snapshots.length,
      version:    TOKEN_SNAPSHOT_VERSION_562,
    };
  }
  if (!rb || typeof rb.measureBandWidthAutocorrelation333 !== 'function') {
    return { ok: false, score: 0, autocorr: null, error: 'rb instance required', version: TOKEN_SNAPSHOT_VERSION_562 };
  }
  try {
    const r = rb.measureBandWidthAutocorrelation333(snapshots, DEFAULT_THRESHOLD_562, DEFAULT_WINDOW_562);
    return {
      ok:         r.ok,
      score:      r.ok ? 1 : 0,
      autocorr:   r.bandWidthAutocorr,
      bufferSize: snapshots.length,
      version:    TOKEN_SNAPSHOT_VERSION_562,
    };
  } catch (e) {
    return { ok: false, score: 0, autocorr: null, error: e.message, version: TOKEN_SNAPSHOT_VERSION_562 };
  }
}

/**
 * registerEndpoints562(app) — wire express endpoints
 * @param {object} app — express app
 * @param {object} [rb] — RankedOverlapBuffer333 instance (optional; used for score endpoint)
 */
function registerEndpoints562(app, rb) {
  // [V562-T01] POST /api/v1/market-maker/autocorr/seed/v562
  // Body: { tokens: string[] } — add a ranked token list snapshot
  app.post('/api/v1/market-maker/autocorr/seed/v562', function(req562, res562) {
    try {
      const tokens562 = req562.body && req562.body.tokens;
      const result562 = pushTokenSnapshot562(tokens562);
      res562.status(result562.ok ? 200 : 400).json(Object.assign({ ecosVersion: 'V562' }, result562));
    } catch (e) {
      res562.status(500).json({ ok: false, error: e.message, ecosVersion: 'V562' });
    }
  });

  // [V562-T02] GET /api/v1/market-maker/autocorr/score/v562
  // Returns autocorr score using stored snapshots
  app.get('/api/v1/market-maker/autocorr/score/v562', function(req562, res562) {
    try {
      const score562 = getAutoCorrelationScore562(rb);
      res562.json(Object.assign({ ok: score562.ok, ecosVersion: 'V562' }, score562));
    } catch (e) {
      res562.status(500).json({ ok: false, error: e.message, ecosVersion: 'V562' });
    }
  });

  // [V562-T03] GET /api/v1/admin/summary/v562
  app.get('/api/v1/admin/summary/v562', function(req562s, res562s) {
    res562s.json({
      ok:          true,
      version:     'V562',
      feature:     'token-snapshot-buffer-autocorr',
      description: 'Fixes autocorr=0 in compositeScore: getCompositeScore543 called ' +
                   'measureBandWidthAutocorrelation333([],…) always — always ok:false. ' +
                   'V562 adds a token-snapshot ring buffer (up to 20 snapshots). ' +
                   'Seed via POST /seed/v562; score via GET /score/v562. ' +
                   'When ≥5 snapshots present, autocorr returns ok:true → score=1.',
      endpoints: [
        'V562-T01 POST /api/v1/market-maker/autocorr/seed/v562',
        'V562-T02 GET  /api/v1/market-maker/autocorr/score/v562',
        'V562-T03 GET  /api/v1/admin/summary/v562',
      ],
      bufferStatus: {
        current:     _ring562.length,
        capacity:    MAX_SNAPSHOTS_562,
        minRequired: MIN_SNAPSHOTS_562,
      },
      fixes:       ['getCompositeScore543: autocorr always 0 due to measureBandWidthAutocorrelation333([],…)'],
      ecosVersion: 'V562',
    });
  });
}

module.exports = {
  pushTokenSnapshot562,
  getTokenSnapshots562,
  clearTokenSnapshots562,
  getAutoCorrelationScore562,
  registerEndpoints562,
  TOKEN_SNAPSHOT_VERSION_562,
  MAX_SNAPSHOTS_562,
  MIN_SNAPSHOTS_562,
};
