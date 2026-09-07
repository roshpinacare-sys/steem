'use strict';
/**
 * src/lib/systemStatus505.js — ECOS V505
 *
 * Diamond Posture v2: תיקון `_loadGovernance` שנשבר ב-V504.
 *
 * הבעיות שתוקנו:
 *   1. fn(null) → throws "orchestrator required". V505 מעביר ctx מינימלי עם
 *      orchestrator stub (object עם executePlan437 stub) — fail-closed, dryRun.
 *   2. getter() הוא async — V505 מחזיר posture מ-cycle.cognition ישירות
 *      (synchronous path דרך runGovernanceCycle499 שהוא synchronous).
 *
 * מקורות (זהים ל-504):
 *   1. testStatusReport503  — pass/cannotRun/realFail
 *   2. diamondCodeHealthSignal498 — debtScore + cleanup proposals
 *   3. heartbeatGovernanceState501 — healthScore + posture (תוקן)
 *
 * Zero deps. All identifiers end in 505.
 * @version 505.0.0
 */

const path = require('path');

const STATUS_VERSION_505 = '505.0.0';

// ── safe loader ───────────────────────────────────────────────────────────────
function _safeLoad505(relPath) {
  try { return require(relPath); }
  catch (e) { return { _loadError: e.message }; }
}

// ── source 1: test status ─────────────────────────────────────────────────────
function _loadTestStatus505(libDir) {
  const m = _safeLoad505(path.join(libDir, 'testStatusReport503.js'));
  if (m._loadError) return { ok: false, error: m._loadError, source: 'testStatusReport503' };
  try {
    const r = m.getStatusReport503();
    return {
      ok:        true,
      source:    'testStatusReport503',
      pass:      r.pass       ?? null,
      cannotRun: r.cannotRun  ?? null,
      realFail:  r.realFail   ?? null,
      total:     r.total      ?? null,
      snapshot:  r.snapshotAge ?? null,
    };
  } catch (e) { return { ok: false, error: e.message, source: 'testStatusReport503' }; }
}

// ── source 2: code health ─────────────────────────────────────────────────────
function _loadCodeHealth505(libDir) {
  const m = _safeLoad505(path.join(libDir, 'diamondCodeHealthSignal498.js'));
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

// ── source 3: governance state (FIXED in V505) ────────────────────────────────
//
// Root cause (V504 bug): governanceSystemState501(ctx) requires ctx.orchestrator
// and fn(null) threw. Also, the returned getter is async.
//
// Fix: supply a minimal read-only orchestrator stub so the function can proceed,
// and extract posture from the synchronous cycle.cognition path instead.

function _makeOrchestratorStub505() {
  // Minimal stub — satisfies ctx.orchestrator check, no side-effects.
  return {
    _stub:       true,
    _version:    'stub-505',
    executePlan437: async () => ({ ok: false, reason: 'stub — read-only posture check' }),
    planFromIntent437: () => ({ steps: [] }),
  };
}

function _loadGovernanceState505(libDir) {
  const m = _safeLoad505(path.join(libDir, 'heartbeatGovernanceState501.js'));
  if (m._loadError) return { ok: false, error: m._loadError, source: 'hbState501' };

  // Try path 1: read via diamondGovernanceCycle499 directly (synchronous)
  try {
    const gc = _safeLoad505(path.join(libDir, 'diamondGovernanceCycle499.js'));
    if (!gc._loadError && typeof gc.runGovernanceCycle499 === 'function') {
      const cycle = gc.runGovernanceCycle499({}, { authorized: false, dryRun: true });
      const c = (cycle && cycle.cognition) ? cycle.cognition : {};
      return {
        ok:          true,
        source:      'hbState501-via-gc499',
        healthScore: (typeof c.healthScore === 'number') ? c.healthScore : null,
        posture:     c.posture ?? 'unknown',
        proposals:   (cycle && cycle.decisions) ? (cycle.decisions.actionCount ?? 0) : 0,
      };
    }
  } catch (_) { /* fall through to path 2 */ }

  // Try path 2: call governanceSystemState501 with orchestrator stub
  try {
    const fn = m.governanceSystemState501;
    if (typeof fn !== 'function')
      return { ok: false, error: 'governanceSystemState501 not a function', source: 'hbState501' };

    const ctx = { orchestrator: _makeOrchestratorStub505(), dryRun: true, authorized: false };
    const getter = fn(ctx);

    // getter is async — we can't await here (sync context).
    // Instead, call synchronously and handle the Promise.
    if (typeof getter === 'function') {
      const result = getter();
      if (result && typeof result.then === 'function') {
        // Cannot await — return partial posture from ctx (no healthScore available sync)
        return {
          ok:          true,
          source:      'hbState501-async-pending',
          healthScore: null,
          posture:     'unknown',
          proposals:   0,
          note:        'async getter — healthScore not available synchronously',
        };
      }
      return {
        ok:          true,
        source:      'hbState501',
        healthScore: result.healthScore ?? null,
        posture:     result.posture     ?? 'unknown',
        proposals:   result.proposals   ?? 0,
      };
    }
    return { ok: false, error: 'governanceSystemState501 did not return a getter', source: 'hbState501' };
  } catch (e) {
    return { ok: false, error: e.message, source: 'hbState501' };
  }
}

// ── lib dir resolver ──────────────────────────────────────────────────────────
function _libDir505(override) {
  if (override) return override;
  const d = __dirname;
  if (d.includes('/src/lib') || d.includes('src' + require('path').sep + 'lib')) {
    return path.resolve(d, '..', '..', 'lib');
  }
  return d;
}

// ── main aggregator ───────────────────────────────────────────────────────────
/**
 * Returns unified system posture505 from all Diamond sources.
 * @param {string} [libDir] — override lib/ path (for testing)
 */
function getSystemPosture505(libDir) {
  const dir   = _libDir505(libDir);
  const tests = _loadTestStatus505(dir);
  const code  = _loadCodeHealth505(dir);
  const gov   = _loadGovernanceState505(dir);

  let signal505 = 'GREEN';
  if (tests.realFail > 0)         signal505 = 'RED';
  else if (!tests.ok || !code.ok) signal505 = 'YELLOW';
  else if (code.debtScore > 50)   signal505 = 'YELLOW';

  return {
    ok:          true,
    version:     STATUS_VERSION_505,
    generatedAt: new Date().toISOString(),
    signal:      signal505,
    tests,
    codeHealth:  code,
    governance:  gov,
    summary:     `signal=${signal505} | tests: ${tests.pass ?? '?'}/${tests.total ?? '?'} pass, ${tests.realFail ?? '?'} fail | debt: ${code.debtScore ?? '?'} | posture: ${gov.posture ?? 'unknown'}`,
  };
}

module.exports = {
  getSystemPosture505,
  STATUS_VERSION_505,
};
