'use strict';
/**
 * src/lib/testAuditHarness502.js — ECOS V502 (Phase P381) — Honest Test Audit (reporter)
 *
 * Surfaces the truth produced by scripts/audit-tests.js (TEST_AUDIT.json): how many test
 * suites actually PASS under node, how many CANNOT RUN here (they need vitest/ESM — not
 * installable in this offline environment), and how many genuinely FAIL. This exists because
 * earlier "verification" spot-checked a few suites and over-claimed "all green". This module
 * + script make the whole picture explicit and queryable — word is word, with the gaps shown.
 *
 *   loadAudit502()   — read the committed TEST_AUDIT.json (fail-soft if absent).
 *   summarize502()   — counts + the honest caveat about what is NOT verified here.
 *
 * Pure JS, no new deps (R3/R6). Read-only. Version-suffixed (…502).
 * @version 502.0.0
 */
const fs = require('fs');
const path = require('path');
const AUDIT_VERSION_502 = '502.0.0';
function _auditPath502(rootDir) { return path.join(rootDir || process.cwd(), 'TEST_AUDIT.json'); }

function loadAudit502(rootDir) {
  try { return JSON.parse(fs.readFileSync(_auditPath502(rootDir), 'utf8')); }
  catch (_) { return { generatedAt: null, total: 0, counts: { pass: 0, cannotRun: 0, realFail: 0 }, pass: [], cannotRun: [], realFail: [], note: 'no TEST_AUDIT.json — run: node scripts/audit-tests.js' }; }
}

function summarize502(rootDir) {
  const a = loadAudit502(rootDir);
  const c = a.counts || { pass: 0, cannotRun: 0, realFail: 0 };
  const verifiablePct = a.total ? Math.round((c.pass + c.realFail) / a.total * 100) : 0;
  return {
    version: AUDIT_VERSION_502,
    generatedAt: a.generatedAt,
    total: a.total,
    pass: c.pass, cannotRun: c.cannotRun, realFail: c.realFail,
    realFailures: a.realFail || [],
    verifiableHerePct: verifiablePct,
    honestCaveat: `Only ${verifiablePct}% of suites run under plain node here; ${c.cannotRun} require vitest/ESM and are NOT verified in this offline environment. "pass" means exit 0 under node — not a guarantee about the ${c.cannotRun} unrun suites.`,
  };
}

module.exports = { AUDIT_VERSION_502, loadAudit502, summarize502 };
