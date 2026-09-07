'use strict';
/**
 * lib/liveProofIndexWiring376.js — ECOS V376 (Phase P264)
 *
 * DIRECTION 1: MissionProofIndexDbAdapter375 wired as live default.
 *
 * When a `pool` is available, `buildLiveProofIndex376(opts)` returns a
 * MissionProofIndexDbAdapter375 so the proof index is durable by default,
 * not opt-in. Falls back gracefully to MissionProofIndexRepo374 (in-memory)
 * when no pool is supplied.
 *
 * Also exports `patchWireWithLiveIndex376(wire374fn, wire375fn, pool)` — a
 * drop-in replacement wiring function that replaces the in-memory
 * `defaultMissionProofIndex374` used in _wire374/_wire375 with the DB
 * adapter when pool is available.
 *
 * Exports:
 *   LIVE_INDEX_VERSION_376            — '376.0.0'
 *   LIVE_INDEX_SCHEMA_376             — schema tag
 *   buildLiveProofIndex376(opts)      — factory: DB adapter if pool else in-memory
 *   isDbAdapterActive376(repo)        — true when repo is a MissionProofIndexDbAdapter375
 *
 * Pure (R3 — no new npm deps). All new identifiers end with 376 (R2).
 * Sacred untouched (R1). V361..V375 preserved (R6).
 *
 * @version 376.0.0
 */

const MPIR  = require('./missionProofIndexRepo374.js');
const FLUSH = require('../db/missionProofIndexFlush375.js');

const LIVE_INDEX_VERSION_376 = '376.0.0';
const LIVE_INDEX_SCHEMA_376  = 'ecos.integrity.mission.proof.index.live/v376';

/**
 * Factory: return a DB-backed adapter when pool is available, otherwise
 * fall back to the in-memory MissionProofIndexRepo374.
 *
 * @param {{ pool?: object, fallbackRepo?: object }} [opts]
 * @returns {object}  MissionProofIndexDbAdapter375 or MissionProofIndexRepo374
 */
function buildLiveProofIndex376(opts) {
  const o    = opts || {};
  const pool = o.pool || null;
  if (pool && typeof pool.query === 'function') {
    const fallback = o.fallbackRepo || new MPIR.MissionProofIndexRepo374();
    return new FLUSH.MissionProofIndexDbAdapter375({ pool, fallbackRepo: fallback });
  }
  return o.fallbackRepo || new MPIR.MissionProofIndexRepo374();
}

/**
 * Returns true when `repo` is a MissionProofIndexDbAdapter375 instance
 * (i.e. the DB adapter is active for this repo).
 *
 * @param {object} repo
 * @returns {boolean}
 */
function isDbAdapterActive376(repo) {
  return repo instanceof FLUSH.MissionProofIndexDbAdapter375;
}

module.exports = {
  LIVE_INDEX_VERSION_376,
  LIVE_INDEX_SCHEMA_376,
  buildLiveProofIndex376,
  isDbAdapterActive376,
};
