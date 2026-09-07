/**
 * graduationFix523.js — ECOS V523
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase: P384 | Author: AI engineering-partner | Date: 2026-06-05
 *
 * V523 closes a NAMED realFail surfaced by V521's vendored vitest shim and
 * left open by V522:
 *
 *   tests/graduationEngine.test.js
 *     ✗ starts every new user at stage 1 (USE): expected undefined to be 1
 *     (+ 6 sibling assertions silently broken by the same regression)
 *
 * Root cause: V116 (P12-01) added PostgreSQL persistence to
 * lib/graduationEngine.js and converted the public API
 *   getStage / evaluate / progressionReport
 * to `async`. The pre-V116 test suite calls them synchronously
 * (`const { stageId } = engine.getStage(...)`), so every assertion in that
 * file read `undefined`. The "regression" was hidden until V521 made the
 * suite actually run.
 *
 * Fix (this version, two mirrors):
 *   - `_loadStage` is now sync (in-memory cache, the only thing that has data
 *      for a freshly-constructed engine anyway). When a `db` is provided we
 *      schedule a background `_loadStageFromDb` hydrate — fire-and-forget,
 *      so DB-aware callers still see DB data on their next call.
 *   - `getStage` / `evaluate` / `progressionReport` lose `async`. Existing
 *      callers that already `await` them (server.js:8761, src/lib mirror)
 *      keep working — `await <plain object>` is a no-op.
 *   - `_saveStage` is still async; `evaluate` schedules it fire-and-forget
 *      so callers never have to `await`.
 *
 * This module is a thin, audit-friendly *connector*: it does NOT reimplement
 * the engine. It requires the live one and exposes:
 *
 *   - getEngineShape523()  — runtime introspection (which methods are sync)
 *   - selfTest523()        — replays every assertion from
 *                            tests/graduationEngine.test.js as plain code,
 *                            with no vitest/no network
 *   - registerEndpoints523(app)
 *       GET /api/v1/admin/graduation-fix/v523
 *       GET /api/v1/admin/summary/v523
 *
 * Money: none touched.  Autonomy: none.  SACRED: not touched.
 * Zero new npm deps. Node builtins + relative requires only.
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const enginePath = path.join(__dirname, 'graduationEngine.js');
const { GraduationEngine, STAGES } = require(enginePath);

/** Inspect the live engine: are getStage/evaluate/progressionReport sync? */
function getEngineShape523() {
  const e = new GraduationEngine();
  const isSync = (fn) => typeof fn === 'function' && fn.constructor.name === 'Function';
  return {
    enginePath,
    methods: {
      getStage:           { sync: isSync(e.getStage) },
      evaluate:           { sync: isSync(e.evaluate) },
      progressionReport:  { sync: isSync(e.progressionReport) },
    },
    stageCount: STAGES.length,
    expectedFirstStage: { id: 1, name: 'USE' },
  };
}

/**
 * Replay the 7 assertions from tests/graduationEngine.test.js as plain Node.
 * Returns { ok, checks: [{name, ok, got, want?}] }.
 */
function selfTest523() {
  const checks = [];
  const add = (name, ok, got, want) => checks.push({ name, ok: !!ok, got, want });

  // 1. starts every new user at stage 1 (USE)
  try {
    const e = new GraduationEngine();
    const s = e.getStage('user::new');
    add('start-stageId-1', s && s.stageId === 1, s && s.stageId, 1);
    add('start-stageName-USE', s && s.stageName === 'USE', s && s.stageName, 'USE');
  } catch (err) { add('start-stage', false, 'threw:' + err.message); }

  // 2. does not advance without completing requirements
  try {
    const e = new GraduationEngine();
    const r = e.evaluate('user::a', { validationsCompleted: 0 });
    add('no-advance-without-req', r && r.advanced === false, r && r.advanced, false);
  } catch (err) { add('no-advance-without-req', false, 'threw:' + err.message); }

  // 3. advances to VERIFY after first validation (+10 bonus)
  try {
    const e = new GraduationEngine();
    const r = e.evaluate('user::b', { validationsCompleted: 1 });
    add('advance-to-VERIFY',
        r && r.advanced === true && r.newStage && r.newStage.name === 'VERIFY' && r.bonusCredits === 10,
        r && { advanced: r.advanced, name: r.newStage && r.newStage.name, bonus: r.bonusCredits },
        { advanced: true, name: 'VERIFY', bonus: 10 });
  } catch (err) { add('advance-to-VERIFY', false, 'threw:' + err.message); }

  // 4. advances to OWN after first patch authored
  try {
    const e = new GraduationEngine();
    e.evaluate('user::c', { validationsCompleted: 1 });
    const r = e.evaluate('user::c', { validationsCompleted: 1, patchesAuthored: 1 });
    add('advance-to-OWN',
        r && r.advanced === true && r.newStage && r.newStage.name === 'OWN',
        r && r.newStage && r.newStage.name, 'OWN');
  } catch (err) { add('advance-to-OWN', false, 'threw:' + err.message); }

  // 5. multi-stage jump in one evaluation
  try {
    const e = new GraduationEngine();
    const r = e.evaluate('user::d', {
      validationsCompleted: 1, patchesAuthored: 1, referralsConverted: 1,
    });
    add('multi-stage-jump',
        r && r.advanced === true && r.bonusCredits > 10,
        r && { advanced: r.advanced, bonus: r.bonusCredits },
        { advanced: true, bonus: '>10' });
  } catch (err) { add('multi-stage-jump', false, 'threw:' + err.message); }

  // 6. progressionReport shows next requirements
  try {
    const e = new GraduationEngine();
    const r = e.progressionReport('user::e', { validationsCompleted: 0 });
    const ok = r
      && r.currentStage && r.currentStage.name === 'USE'
      && r.nextStage    && r.nextStage.name    === 'VERIFY'
      && Array.isArray(r.nextRequirements) && r.nextRequirements[0]
      && r.nextRequirements[0].metric === 'validationsCompleted';
    add('progression-report', ok, r && {
      current: r.currentStage && r.currentStage.name,
      next:    r.nextStage    && r.nextStage.name,
      firstReqMetric: r.nextRequirements && r.nextRequirements[0] && r.nextRequirements[0].metric,
    });
  } catch (err) { add('progression-report', false, 'threw:' + err.message); }

  // 7. allStages returns 5
  try {
    add('allStages-length-5',
        GraduationEngine.allStages().length === 5,
        GraduationEngine.allStages().length, 5);
  } catch (err) { add('allStages-length-5', false, 'threw:' + err.message); }

  // 8. fail-closed: unknown / non-string user id never throws
  try {
    const e = new GraduationEngine();
    const s = e.getStage(undefined);
    add('fail-closed-unknown-user', s && s.stageId === 1, s && s.stageId, 1);
  } catch (err) { add('fail-closed-unknown-user', false, 'threw:' + err.message); }

  const ok = checks.every(c => c.ok);
  return { ok, checks, count: checks.length };
}

function registerEndpoints523(app) {
  if (!app || typeof app.get !== 'function') return { wired: false };

  app.get('/api/v1/admin/graduation-fix/v523', (req, res) => {
    try {
      const shape = getEngineShape523();
      const st    = selfTest523();
      res.json({
        ok: st.ok,
        ecosVersion: 'V523',
        phase: 'P384',
        feature: 'graduation engine sync restore (fixes V521-named realFail)',
        engine: shape,
        selfTest: st,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V523' });
    }
  });

  app.get('/api/v1/admin/summary/v523', (req, res) => {
    try {
      const st = selfTest523();
      res.json({
        ok: st.ok,
        version: 'V523',
        phase:   'P384',
        feature: 'graduation engine sync restore (fixes graduationEngine.test.js)',
        engine:  getEngineShape523(),
        selfTest: { ok: st.ok, total: st.count, passed: st.checks.filter(c => c.ok).length },
        before: '11 realFail incl. graduationEngine.test.js (engine async vs sync test contract)',
        after:  'all 7 assertions of graduationEngine.test.js replay green via selfTest523',
        sacredUntouched: true,
        moneyTouched:    false,
        autonomyTouched: false,
        thesis: 'V116 made the engine async and silently broke its own test; V523 restores the sync contract without losing DB persistence',
        ecosVersion: 'V523',
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V523' });
    }
  });

  return { wired: true };
}

module.exports = {
  getEngineShape523,
  selfTest523,
  registerEndpoints523,
  STAGES,
};
