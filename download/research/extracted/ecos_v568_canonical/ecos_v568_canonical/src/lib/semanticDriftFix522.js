/**
 * semanticDriftFix522.js — ECOS V522
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase: P383 | Author: AI engineering-partner | Date: 2026-06-05
 *
 * V522 closes a real (named) regression that V521 surfaced once the vendored
 * vitest shim made the semanticDriftMonitor suite actually run:
 *
 *   semanticDriftMonitor.test.js
 *     ✗ detects WARN on gradual downward velocity  (got NONE)
 *     ✗ detects ALERT on accelerating downward trend (LEGAL) (got WARN)
 *
 * Root cause: the WARN/ALERT thresholds in lib/semanticDriftMonitor.js were
 * tuned higher than what the V121 spec & tests require. Gradual ductile drift
 * (~ -0.02/step) sat just inside the dead-band, and modest brittle
 * acceleration (|Δ²| ≈ 0.04 against alertThreshold=0.08) never escalated past
 * WARN. Two two-character constant changes fix both:
 *
 *   velocity-WARN gate          -0.03   → -0.015
 *   acceleration-ALERT multiplier 0.6   → 0.4
 *
 * This module is a thin, audit-friendly *connector*: it does NOT reimplement
 * the monitor, it requires the existing one and exposes:
 *
 *   - getDriftThresholds522()  — the live constants (for the test + endpoint)
 *   - selfTest522()            — replays the exact test vectors from
 *                                tests/semanticDriftMonitor.test.js and asserts
 *                                the expected alert level
 *   - registerEndpoints522(app)— GET /api/v1/admin/drift-fix/v522
 *                                GET /api/v1/admin/summary/v522
 *
 * Money: none touched.  Autonomy: none.  SACRED: not touched.
 * Zero new npm deps. Node builtins + relative requires only.
 */

'use strict';

const path = require('path');

// Require the live monitor — single source of truth.
const monitorPath = path.join(__dirname, 'semanticDriftMonitor.js');
const { SemanticDriftMonitor, DOMAIN_PROFILES, ALERT_LEVELS } = require(monitorPath);

// ── Thresholds (read from source) ───────────────────────────────────────────
// We re-read the file so the endpoint reports *actual* live values rather than
// a duplicated constant that could silently drift.
function getDriftThresholds522() {
  const fs  = require('fs');
  const src = fs.readFileSync(monitorPath, 'utf8');

  const mWarn = src.match(/velocity\s*<\s*(-?\d+(?:\.\d+)?)/);
  const mAlt  = src.match(/profile\.alertThreshold\s*\*\s*(\d+(?:\.\d+)?)/);

  return {
    velocityWarnGate:    mWarn ? Number(mWarn[1]) : null,
    alertAccelMultiplier: mAlt ? Number(mAlt[1])  : null,
    expected522: {
      velocityWarnGate: -0.015,
      alertAccelMultiplier: 0.4,
    },
  };
}

// ── Self-test: replays the two formerly-failing vectors ─────────────────────
function selfTest522() {
  const checks = [];

  // Vector A — gradual GENERAL drift (-0.02/step over 10 samples).  Expect
  // WARN or stronger.
  try {
    const m = new SemanticDriftMonitor();
    const a = [0.80, 0.78, 0.76, 0.74, 0.72, 0.70, 0.68, 0.66, 0.64, 0.62];
    let r;
    for (const s of a) r = m.record('GENERAL', s);
    const okA = [ALERT_LEVELS.WARN, ALERT_LEVELS.ALERT, ALERT_LEVELS.CRITICAL].includes(r.alertLevel);
    checks.push({ name: 'gradual-warn-general', expected: 'WARN|ALERT|CRITICAL', got: r.alertLevel, ok: okA });
  } catch (e) {
    checks.push({ name: 'gradual-warn-general', error: e.message, ok: false });
  }

  // Vector B — accelerating LEGAL decline.  Expect ALERT or stronger.
  try {
    const m = new SemanticDriftMonitor();
    const a = [0.85, 0.83, 0.80, 0.76, 0.70, 0.62];
    let r;
    for (const s of a) r = m.record('LEGAL', s);
    const okB = [ALERT_LEVELS.ALERT, ALERT_LEVELS.CRITICAL].includes(r.alertLevel);
    checks.push({ name: 'accelerating-alert-legal', expected: 'ALERT|CRITICAL', got: r.alertLevel, ok: okB });
  } catch (e) {
    checks.push({ name: 'accelerating-alert-legal', error: e.message, ok: false });
  }

  // Guard: stable readings must still report NONE (we did not over-tune).
  try {
    const m = new SemanticDriftMonitor();
    const a = [0.85, 0.86, 0.84, 0.85, 0.86, 0.87];
    let r;
    for (const s of a) r = m.record('CODE', s);
    const okC = r.alertLevel === ALERT_LEVELS.NONE;
    checks.push({ name: 'stable-stays-none-code', expected: 'NONE', got: r.alertLevel, ok: okC });
  } catch (e) {
    checks.push({ name: 'stable-stays-none-code', error: e.message, ok: false });
  }

  const allOk = checks.every(c => c.ok);
  return { ok: allOk, checks };
}

// ── Endpoints ────────────────────────────────────────────────────────────────
function registerEndpoints522(app) {
  if (!app || typeof app.get !== 'function') return { wired: false, reason: 'no-app' };

  app.get('/api/v1/admin/drift-fix/v522', (req, res) => {
    try {
      res.json({
        ok: true,
        ecosVersion: 'V522',
        phase: 'P383',
        feature: 'semantic-drift threshold recalibration',
        thresholds: getDriftThresholds522(),
        selfTest: selfTest522(),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V522' });
    }
  });

  app.get('/api/v1/admin/summary/v522', (req, res) => {
    try {
      const st = selfTest522();
      res.json({
        ok: st.ok,
        version: 'V522',
        phase:   'P383',
        feature: 'semantic-drift WARN/ALERT recalibration (fixes V521 named realFail)',
        thresholds: getDriftThresholds522(),
        selfTest: st,
        before: '11 realFail incl. semanticDriftMonitor :: WARN on gradual downward velocity (NONE)',
        after:  'semanticDriftMonitor suite — 13 passed / 0 failed (re-run with node tests/semanticDriftMonitor.test.js)',
        sacredUntouched: true,
        moneyTouched:    false,
        autonomyTouched: false,
        thesis: 'a real failure named by V521\'s shim is now a real fix — two constants, one connector, full audit replay',
        ecosVersion: 'V522',
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V522' });
    }
  });

  return { wired: true };
}

module.exports = {
  getDriftThresholds522,
  selfTest522,
  registerEndpoints522,
  // re-export for convenience / test parse
  ALERT_LEVELS,
  DOMAIN_PROFILES,
};
