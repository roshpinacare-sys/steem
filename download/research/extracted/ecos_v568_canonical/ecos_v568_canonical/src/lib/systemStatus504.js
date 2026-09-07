'use strict';
/**
 * src/lib/systemStatus504.js — ECOS V504
 *
 * Diamond Posture: אוסף signals מ-Diamond הקיימים ומחזיר
 * תמונת מצב אחת ב-GET /api/v1/status.
 *
 * מקורות (כולם require יחסי, fail-closed לכל אחד):
 *   1. testStatusReport503  — pass/cannotRun/realFail
 *   2. diamondCodeHealthSignal498 — debtScore + cleanup proposals
 *   3. heartbeatGovernanceState501 — healthScore + posture
 *   (heartbeat + cognition engine are long-running; we only read state, no side-effects)
 *
 * Zero deps. All identifiers end in 504.
 * @version 504.0.0
 */

const path = require('path');

const STATUS_VERSION_504 = '504.0.0';

// ── safe loaders (fail-closed per source) ──────────────────────────────────

function _safeLoad504(relPath) {
  try { return require(relPath); }
  catch (e) { return { _loadError: e.message }; }
}

function _loadTestStatus504(libDir) {
  const m = _safeLoad504(path.join(libDir, 'testStatusReport503.js'));
  if (m._loadError) return { ok: false, error: m._loadError, source: 'testStatusReport503' };
  try {
    const r = m.getStatusReport503();
    return {
      ok:         true,
      source:     'testStatusReport503',
      pass:       r.pass       ?? null,
      cannotRun:  r.cannotRun  ?? null,
      realFail:   r.realFail   ?? null,
      total:      r.total      ?? null,
      snapshot:   r.snapshotAge ?? null,
    };
  } catch (e) { return { ok: false, error: e.message, source: 'testStatusReport503' }; }
}

function _loadCodeHealth504(libDir) {
  const m = _safeLoad504(path.join(libDir, 'diamondCodeHealthSignal498.js'));
  if (m._loadError) return { ok: false, error: m._loadError, source: 'codeHealth498' };
  try {
    const h = m.gatherCodeHealth498({ libDir });
    return {
      ok:        true,
      source:    'codeHealth498',
      debtScore: h.debtScore ?? null,
      towers:    h.towerCount ?? null,
      retirable: h.honestRetirable ?? null,
    };
  } catch (e) { return { ok: false, error: e.message, source: 'codeHealth498' }; }
}

function _loadGovernanceState504(libDir) {
  const m = _safeLoad504(path.join(libDir, 'heartbeatGovernanceState501.js'));
  if (m._loadError) return { ok: false, error: m._loadError, source: 'hbState501' };
  try {
    const fn = m.governanceSystemState501;
    if (typeof fn !== 'function') return { ok: false, error: 'governanceSystemState501 not a function', source: 'hbState501' };
    // governanceSystemState501 returns a getter function that reads live cycle state
    const getter = fn(null);   // no ctx → returns snapshot from null ctx (safe)
    const state  = typeof getter === 'function' ? getter() : getter;
    return {
      ok:           true,
      source:       'hbState501',
      healthScore:  state.healthScore  ?? null,
      posture:      state.posture      ?? 'unknown',
      proposals:    state.proposals    ?? 0,
    };
  } catch (e) { return { ok: false, error: e.message, source: 'hbState501' }; }
}

// ── resolve lib dir ─────────────────────────────────────────────────────────
function _libDir504(override) {
  if (override) return override;
  const d = __dirname;
  if (d.includes('/src/lib') || d.includes('src' + require('path').sep + 'lib')) {
    return path.resolve(d, '..', '..', 'lib');
  }
  return d; // already in lib/
}

// ── main aggregator ─────────────────────────────────────────────────────────

/**
 * Returns unified system posture504 from all Diamond sources.
 * @param {string} [libDir] — override lib/ path (for testing)
 */
function getSystemPosture504(libDir) {
  const dir    = _libDir504(libDir);
  const tests  = _loadTestStatus504(dir);
  const code   = _loadCodeHealth504(dir);
  const gov    = _loadGovernanceState504(dir);

  // Compute overall traffic light
  let signal504 = 'GREEN';
  if (tests.realFail > 0)         signal504 = 'RED';
  else if (!tests.ok || !code.ok) signal504 = 'YELLOW';
  else if (code.debtScore > 50)   signal504 = 'YELLOW';

  return {
    ok:         true,
    version:    STATUS_VERSION_504,
    generatedAt: new Date().toISOString(),
    signal:     signal504,
    tests,
    codeHealth: code,
    governance: gov,
    summary: `signal=${signal504} | tests: ${tests.pass ?? '?'}/${tests.total ?? '?'} pass, ${tests.realFail ?? '?'} fail | debt: ${code.debtScore ?? '?'} | posture: ${gov.posture ?? 'unknown'}`,
  };
}

module.exports = {
  getSystemPosture504,
  STATUS_VERSION_504,
};
