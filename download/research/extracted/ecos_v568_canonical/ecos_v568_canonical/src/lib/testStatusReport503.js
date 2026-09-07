'use strict';
/**
 * lib/testStatusReport503.js — Test Status Report V503
 *
 * Reads TEST_AUDIT.json (produced by scripts/audit-tests.js) and exposes
 * a structured truth-map via API. TEST_AUDIT.json format:
 *   { generatedAt, total, counts:{pass,cannotRun,realFail},
 *     pass:string[], cannotRun:string[], realFail:{suite,reason}[] }
 *
 * Fail-closed: if TEST_AUDIT.json missing → returns degraded status.
 * All identifiers end in 503. Zero npm deps.
 * @module testStatusReport503
 * @version 503.0.0
 */

const fs503   = require('fs');
const path503 = require('path');

const TEST_STATUS_VERSION_503 = '503';
const AUDIT_JSON_PATH_503 = path503.join(__dirname, '..', 'TEST_AUDIT.json');
const CANNOT_RUN_REASON_503 =
  'Suites written with vitest (describe/it/expect). ' +
  'Cannot run without npm install + npx vitest. ' +
  'These are UNVERIFIED — neither pass nor fail.';

function loadAuditSnapshot503() {
  try {
    return JSON.parse(fs503.readFileSync(AUDIT_JSON_PATH_503, 'utf8'));
  } catch (_) {
    return null;
  }
}

function getStatusReport503() {
  const snap = loadAuditSnapshot503();

  if (!snap) {
    return {
      version: TEST_STATUS_VERSION_503,
      available: false,
      error: 'TEST_AUDIT.json not found — run: node scripts/audit-tests.js',
      pass: null, cannotRun: null, realFail: null,
    };
  }

  // TEST_AUDIT.json: counts:{pass,cannotRun,realFail}, arrays for each
  const counts503    = snap.counts || {};
  const passN503     = counts503.pass      ?? (Array.isArray(snap.pass)      ? snap.pass.length      : 0);
  const cannotRunN503= counts503.cannotRun ?? (Array.isArray(snap.cannotRun) ? snap.cannotRun.length : 0);
  const realFailN503 = counts503.realFail  ?? (Array.isArray(snap.realFail)  ? snap.realFail.length  : 0);
  const total503     = snap.total ?? (passN503 + cannotRunN503 + realFailN503);
  const lastRun503   = snap.generatedAt ?? null;

  // realFail: array of {suite, reason}
  const rfArr503 = Array.isArray(snap.realFail) ? snap.realFail : [];
  const failures503 = rfArr503.map(f => ({
    suite: f.suite || String(f),
    error: f.reason || f.error || null,
  }));

  // cannotRun: array of strings (suite names)
  const crArr503 = Array.isArray(snap.cannotRun) ? snap.cannotRun : [];
  const cannotRunSample503 = crArr503.slice(0, 5);

  return {
    version: TEST_STATUS_VERSION_503,
    available: true,
    lastRun: lastRun503,
    summary: `${passN503}/${total503} pass, ${cannotRunN503} cannotRun (unverified), ${realFailN503} realFail`,
    pass: passN503,
    cannotRun: cannotRunN503,
    realFail: realFailN503,
    total: total503,
    honesty: 'cannotRun suites are UNVERIFIED — neither pass nor fail (need vitest)',
    cannotRunReason: CANNOT_RUN_REASON_503,
    cannotRunSample: cannotRunSample503,
    realFailures: failures503,
  };
}

module.exports = {
  TEST_STATUS_VERSION_503,
  AUDIT_JSON_PATH_503,
  CANNOT_RUN_REASON_503,
  loadAuditSnapshot503,
  getStatusReport503,
};
