'use strict';
/**
 * lib/ttlSweepHistoryTracker385.js — ECOS V385 (Phase P273)
 *
 * DIRECTION 3: Sweep history tracker.
 *
 * recordTtlSweepResult385(registry, sweepResult, opts) wraps
 * sweepTtlCursorRegistry384 and appends a ttl_sweep_event_type_385 audit
 * event so operators can audit the history of on-demand TTL sweeps
 * (sweptAt, evicted, remaining) without scanning server logs.
 *
 * Exports:
 *   TTL_SWEEP_HISTORY_VERSION_385
 *   TTL_SWEEP_HISTORY_SCHEMA_385
 *   TTL_SWEEP_EVENT_TYPE_385
 *   recordTtlSweepResult385(registry, sweepResult, opts)
 *     — returns { ok, schema, version, eventRecorded, sweep, entry }
 *
 * Endpoint: POST /api/v1/missions/proof-index/snapshot/compare/cursor-registry/ttl/sweep/record [V385-T03]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 385 (R2).
 * Sacred untouched (R1). V361..V384 preserved (R6).
 *
 * @version 385.0.0
 */

const TRS384 = require('./ttlRegistrySweep384.js');

const TTL_SWEEP_HISTORY_VERSION_385 = '385.0.0';
const TTL_SWEEP_HISTORY_SCHEMA_385  =
  'ecos.integrity.mission.proof.index.comparator.history.cursor.registry.ttl.sweep.history/v385';
const TTL_SWEEP_EVENT_TYPE_385 = 'ttl_sweep_event_type_385';

/**
 * Perform an on-demand TTL sweep and append a structured audit event to the
 * provided audit log so operators can track sweep history.
 *
 * @param {{
 *   evictExpired: function(): { evicted: number },
 *   size: function(): number,
 *   getStats?: function(): object,
 * }} registry  — a createTtlCursorRegistry383() instance
 * @param {{
 *   auditLog: {
 *     append: function(type: string, payload: object): object|void,
 *   },
 *   hashFn?: function,
 *   canonicalize?: function,
 * }} ctx
 * @param {{}} [opts]
 * @returns {{
 *   ok: boolean,
 *   schema: string,
 *   version: string,
 *   eventRecorded: boolean,
 *   sweep: {
 *     ok: boolean,
 *     sweptAt: string,
 *     evicted: number,
 *     remaining: number,
 *   },
 *   entry: object|null,
 * }}
 */
function recordTtlSweepResult385(registry, ctx, opts) {
  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema:        TTL_SWEEP_HISTORY_SCHEMA_385,
    version:       TTL_SWEEP_HISTORY_VERSION_385,
    eventRecorded: false,
    sweep:         { ok: false, sweptAt: new Date().toISOString(), evicted: 0, remaining: 0 },
    entry:         null,
  });

  if (!registry || typeof registry.evictExpired !== 'function') {
    return errorResult('registry must be a createTtlCursorRegistry383() instance with evictExpired()');
  }
  if (!ctx || !ctx.auditLog || typeof ctx.auditLog.append !== 'function') {
    return errorResult('ctx.auditLog must expose append(type, payload)');
  }

  // Perform the sweep
  const sweep = TRS384.sweepTtlCursorRegistry384(registry);

  if (!sweep.ok) {
    return {
      ok:            false,
      error:         sweep.error || 'sweep failed',
      schema:        TTL_SWEEP_HISTORY_SCHEMA_385,
      version:       TTL_SWEEP_HISTORY_VERSION_385,
      eventRecorded: false,
      sweep,
      entry:         null,
    };
  }

  // Build the audit event payload
  const payload = {
    type:       TTL_SWEEP_EVENT_TYPE_385,
    sweptAt:    sweep.sweptAt,
    evicted:    sweep.evicted,
    remaining:  sweep.remaining,
    recordedAt: new Date().toISOString(),
  };

  // Hash for integrity (optional — use provided hashFn)
  if (typeof ctx.hashFn === 'function' && typeof ctx.canonicalize === 'function') {
    try {
      payload.hash = ctx.hashFn(ctx.canonicalize(payload));
    } catch (_) {}
  }

  let entry = null;
  let eventRecorded = false;

  try {
    const appendResult = ctx.auditLog.append(TTL_SWEEP_EVENT_TYPE_385, payload);
    entry = appendResult || payload;
    eventRecorded = true;
  } catch (e) {
    return {
      ok:            false,
      error:         'audit log append failed: ' + e.message,
      schema:        TTL_SWEEP_HISTORY_SCHEMA_385,
      version:       TTL_SWEEP_HISTORY_VERSION_385,
      eventRecorded: false,
      sweep,
      entry:         null,
    };
  }

  return {
    ok:            true,
    schema:        TTL_SWEEP_HISTORY_SCHEMA_385,
    version:       TTL_SWEEP_HISTORY_VERSION_385,
    eventRecorded,
    sweep,
    entry,
  };
}

module.exports = {
  TTL_SWEEP_HISTORY_VERSION_385,
  TTL_SWEEP_HISTORY_SCHEMA_385,
  TTL_SWEEP_EVENT_TYPE_385,
  recordTtlSweepResult385,
};
