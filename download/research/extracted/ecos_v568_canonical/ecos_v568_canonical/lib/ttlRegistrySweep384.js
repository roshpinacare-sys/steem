'use strict';
/**
 * lib/ttlRegistrySweep384.js — ECOS V384 (Phase P272)
 *
 * DIRECTION 3: TTL registry sweep endpoint.
 *
 * sweepTtlCursorRegistry384(registry, opts) wraps the evictExpired() method
 * of a createTtlCursorRegistry383 instance and returns { evicted, remaining }
 * — giving operators an on-demand TTL sweep without restarting the server.
 *
 * Exports:
 *   TTL_REGISTRY_SWEEP_VERSION_384
 *   TTL_REGISTRY_SWEEP_SCHEMA_384
 *   sweepTtlCursorRegistry384(registry, opts)
 *     — returns { ok, schema, version, sweptAt, evicted, remaining }
 *
 * Endpoint: POST /api/v1/missions/proof-index/snapshot/compare/cursor-registry/ttl/sweep [V384-T03]
 *
 * Pure (R3 no new npm deps). All new identifiers end with 384 (R2).
 * Sacred untouched (R1). V361..V383 preserved (R6).
 *
 * @version 384.0.0
 */

const TTL_REGISTRY_SWEEP_VERSION_384 = '384.0.0';
const TTL_REGISTRY_SWEEP_SCHEMA_384  = 'ecos.integrity.mission.proof.index.comparator.history.cursor.registry.ttl.sweep/v384';

/**
 * Perform an on-demand TTL sweep on a createTtlCursorRegistry383 instance.
 *
 * @param {{
 *   evictExpired: function(): { evicted: number },
 *   size: function(): number,
 *   getStats?: function(): { liveEntries: number, totalStored: number },
 * }} registry  — a createTtlCursorRegistry383() instance
 * @param {{}} [opts]
 * @returns {{
 *   ok: boolean,
 *   schema: string,
 *   version: string,
 *   sweptAt: string,
 *   evicted: number,
 *   remaining: number,
 * }}
 */
function sweepTtlCursorRegistry384(registry, opts) {
  const errorResult = (msg) => ({
    ok: false, error: msg,
    schema: TTL_REGISTRY_SWEEP_SCHEMA_384, version: TTL_REGISTRY_SWEEP_VERSION_384,
    sweptAt: new Date().toISOString(), evicted: 0, remaining: 0,
  });

  if (!registry || typeof registry.evictExpired !== 'function') {
    return errorResult('registry must be a createTtlCursorRegistry383() instance with evictExpired()');
  }
  if (typeof registry.size !== 'function') {
    return errorResult('registry must expose size()');
  }

  let evicted = 0;
  try {
    const result = registry.evictExpired();
    evicted = (result && typeof result.evicted === 'number') ? result.evicted : 0;
  } catch (e) {
    return errorResult('evictExpired() failed: ' + e.message);
  }

  let remaining = 0;
  try {
    remaining = registry.size();
  } catch (e) {
    remaining = 0;
  }

  const sweptAt = new Date().toISOString();

  return {
    ok:        true,
    schema:    TTL_REGISTRY_SWEEP_SCHEMA_384,
    version:   TTL_REGISTRY_SWEEP_VERSION_384,
    sweptAt,
    evicted,
    remaining,
  };
}

module.exports = {
  TTL_REGISTRY_SWEEP_VERSION_384,
  TTL_REGISTRY_SWEEP_SCHEMA_384,
  sweepTtlCursorRegistry384,
};
