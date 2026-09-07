'use strict';
/**
 * src/lib/governanceDiagnose533.js — ECOS V533 (Phase P294)
 *
 * CONNECTION: heartbeatGovernanceBridge532 ↔ its snapshotOpts dependencies.
 *
 * PROBLEM: snapshotOpts deps (O437, status505, gc499) are loaded with lazy
 * try/catch — if any fails, snapshotsFailed increments silently. No visibility.
 *
 * SOLUTION: diagnoseBridgeOpts533(opts) inspects each dep individually and
 * returns a structured ok/missing/degraded report. Used by the diagnose endpoint.
 *
 * All identifiers end in 533. Zero new npm deps. SACRED untouched.
 * @version 533.0.0
 */

const DIAGNOSE_VERSION_533 = '533.0.0';

function diagnoseBridgeOpts533(opts) {
  if (!opts) opts = {};

  // O437: flexible interface — just needs to be a non-null object
  const o437Status = (opts.O437 && typeof opts.O437 === 'object')
    ? 'ok' : 'missing';
  const o437Fns = opts.O437
    ? Object.keys(opts.O437).filter(k => typeof opts.O437[k] === 'function').slice(0, 5)
    : [];

  // status505: needs getSystemPosture505
  const status505Status = (!opts.status505)
    ? 'missing'
    : (typeof opts.status505.getSystemPosture505 === 'function' ? 'ok' : 'degraded');

  // gc499: needs runGovernanceCycle499
  const gc499Status = (!opts.gc499)
    ? 'missing'
    : (typeof opts.gc499.runGovernanceCycle499 === 'function' ? 'ok' : 'degraded');

  var deps = [
    { name: 'O437',      status: o437Status,      presentFns: o437Fns,   missingFns: o437Status === 'missing' ? ['(any fn)'] : [] },
    { name: 'status505', status: status505Status,  presentFns: status505Status === 'ok' ? ['getSystemPosture505'] : [],   missingFns: status505Status !== 'ok' ? ['getSystemPosture505'] : [] },
    { name: 'gc499',     status: gc499Status,      presentFns: gc499Status === 'ok' ? ['runGovernanceCycle499'] : [],     missingFns: gc499Status !== 'ok' ? ['runGovernanceCycle499'] : [] },
  ];

  var criticalOk = deps.every(function(d) { return d.status === 'ok'; });
  var auditOk    = typeof opts.audit === 'function';
  var libDirOk   = typeof opts.libDir === 'string' && opts.libDir.length > 0;
  var allOk      = criticalOk && auditOk && libDirOk;

  var failed = deps.filter(function(d) { return d.status !== 'ok'; }).map(function(d) { return d.name; });
  var summary = criticalOk
    ? 'All critical deps OK — buildBridgeSnapshot531 should succeed.'
    : ('Missing/degraded critical deps: ' + failed.join(', ') + ' — snapshotsFailed will increment.');

  return {
    version:             DIAGNOSE_VERSION_533,
    allOk:               allOk,
    criticalDepsOk:      criticalOk,
    snapshotWillSucceed: criticalOk,
    deps:                deps,
    optional: {
      audit:  auditOk  ? 'ok' : 'missing (non-fatal)',
      libDir: libDirOk ? 'ok' : 'missing (non-fatal)',
    },
    summary: summary,
  };
}

module.exports = {
  DIAGNOSE_VERSION_533: DIAGNOSE_VERSION_533,
  diagnoseBridgeOpts533: diagnoseBridgeOpts533,
};
