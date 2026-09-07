'use strict';
/**
 * src/lib/regressionAutoBisect436.js — ECOS V436
 * Feature 3: Auto-bisect recent rehearsal runs when regression triggers.
 * @version 436.0.0
 */
const REGRESSION_AUTO_BISECT_VERSION436 = '436.0.0';
const _bisectState436 = { bisections: 0, lastSuspect: null };

function bisect436(runs, baseline) {
  const list = (runs || []).slice().sort((a, b) => new Date(a.at) - new Date(b.at));
  if (list.length < 2 || !baseline) return { ok: false, error: 'insufficient data' };
  let lo = 0, hi = list.length - 1, suspect = list[hi];
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (Number(list[mid].durationMs || 0) > baseline * 1.25) { suspect = list[mid]; hi = mid; }
    else lo = mid + 1;
  }
  _bisectState436.bisections += 1;
  _bisectState436.lastSuspect = suspect;
  return { ok: true, suspect, steps: Math.ceil(Math.log2(list.length)) };
}

function wireRegressionAutoBisect436(app) {
  const BASE = '/api/v1/solvency/tower/auth/keys/bulk/rotate/rollback/dryrun/rehearse/regression/bisect';
  app.post(BASE, (req, res) => {
    const { runs, baseline } = req.body || {};
    res.json(bisect436(runs, baseline));
  });
  app.get(BASE + '/status', (req, res) => res.json({ version: REGRESSION_AUTO_BISECT_VERSION436, ..._bisectState436 }));
}

module.exports = { REGRESSION_AUTO_BISECT_VERSION436, bisect436, wireRegressionAutoBisect436, _bisectState436 };
