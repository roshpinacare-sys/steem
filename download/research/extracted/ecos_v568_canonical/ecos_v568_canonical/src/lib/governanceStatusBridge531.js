'use strict';
/**
 * src/lib/governanceStatusBridge531.js — ECOS V531 (Phase P259)
 * Governance × Status Bridge
 *
 * Connects two existing modules that were running in isolation:
 *   • systemStatus505.getSystemPosture505()  — operational health (tests, debt, governance signal)
 *   • diamondGovernanceCycle499.runGovernanceCycle499() — full propose-only governance cycle
 *
 * Produces ONE unified snapshot: system posture + governance cycle summary.
 * Useful for operators who need a single call to see: "is the system healthy,
 * and what is the diamond currently proposing?"
 *
 * Fail-safe: if either source fails, the bridge returns a degraded result
 * with an error field rather than throwing. Caller always gets a usable object.
 *
 * All identifiers end in 531. Zero new npm deps. SACRED files untouched.
 * @version 531.0.0
 */

const BRIDGE_VERSION_531 = '531.0.0';

/**
 * buildBridgeSnapshot531(opts)
 *   opts.O437   — moduleOrchestrator437 module (required for GC499)
 *   opts.status505 — systemStatus505 module (required)
 *   opts.gc499  — diamondGovernanceCycle499 module (required)
 *   opts.audit  — optional audit fn(type, payload)
 *   opts.libDir — optional libDir hint for codeHealthOpts
 *
 * Returns:
 *   { ok, version, generatedAt, signal, postureSummary, governanceCycle, errors }
 */
function buildBridgeSnapshot531(opts = {}) {
  const errors531 = [];
  const now531 = new Date().toISOString();

  // ── 1. system posture (status505) ────────────────────────────────────────
  let posture531 = null;
  try {
    if (!opts.status505 || typeof opts.status505.getSystemPosture505 !== 'function') {
      throw new Error('status505 module missing or invalid');
    }
    posture531 = opts.status505.getSystemPosture505();
  } catch (e531a) {
    errors531.push({ source: 'systemStatus505', error: e531a.message });
  }

  // ── 2. governance cycle (gc499, propose-only, dry-run) ───────────────────
  let cycle531 = null;
  try {
    if (!opts.gc499 || typeof opts.gc499.runGovernanceCycle499 !== 'function') {
      throw new Error('gc499 module missing or invalid');
    }
    if (!opts.O437) throw new Error('O437 (orchestrator) required');

    const auditFn531 = typeof opts.audit === 'function' ? opts.audit : null;
    const signals531 = posture531
      ? { solvency: posture531.solvency || null, circuitBreaker: posture531.circuitBreaker || null }
      : {};

    const raw531 = opts.gc499.runGovernanceCycle499(signals531, {
      orchestrator: opts.O437,
      authorized: false,       // always propose-only; never execute autonomously
      dryRun: true,
      audit: auditFn531,
      codeHealthOpts: opts.libDir ? { libDir: opts.libDir, rootDir: opts.rootDir || opts.libDir + '/..' } : {},
    });

    cycle531 = {
      posture:      raw531.cognition.posture,
      healthScore:  raw531.cognition.healthScore,
      concerns:     (raw531.cognition.concerns || []).slice(0, 5),
      actionCount:  raw531.decisions.actionCount,
      topActions:   (raw531.decisions.actions || []).slice(0, 3).map(a => ({
        capability: a.capability, priority: a.priority, advisory: !!a.advisory,
      })),
      mode:         raw531.action.mode,
      summary:      raw531.summary,
    };
  } catch (e531b) {
    errors531.push({ source: 'diamondGovernanceCycle499', error: e531b.message });
  }

  // ── 3. merged signal ─────────────────────────────────────────────────────
  // Elevate to RED if governance cycle fails or posture is degraded
  let signal531 = (posture531 && posture531.signal) || 'UNKNOWN';
  if (errors531.length > 0 && signal531 === 'GREEN') signal531 = 'YELLOW';
  if (cycle531 && cycle531.posture === 'critical') signal531 = 'RED';

  return {
    ok:              errors531.length === 0,
    version:         BRIDGE_VERSION_531,
    generatedAt:     now531,
    signal:          signal531,
    postureSummary:  posture531 ? posture531.summary : null,
    systemStatus:    posture531 ? {
      signal:       posture531.signal,
      tests:        posture531.tests   ? { pass: posture531.tests.pass, cannotRun: posture531.tests.cannotRun, realFail: posture531.tests.realFail } : null,
      codeHealth:   posture531.codeHealth ? { debtScore: posture531.codeHealth.debtScore, ok: posture531.codeHealth.ok } : null,
      governanceOk: posture531.governance ? posture531.governance.ok : null,
    } : null,
    governanceCycle: cycle531,
    errors:          errors531.length ? errors531 : undefined,
  };
}

module.exports = {
  BRIDGE_VERSION_531,
  buildBridgeSnapshot531,
};
