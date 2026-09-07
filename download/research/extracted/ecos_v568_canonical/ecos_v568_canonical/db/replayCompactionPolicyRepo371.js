'use strict';
/**
 * db/replayCompactionPolicyRepo371.js — ECOS V371 (Phase P259)
 *
 * Adaptive policy ledger extending the V370 cooldown ledger with
 * `consecutiveBlocks` tracking. A successful `recordRun(ts)` resets
 * the counter; `recordBlock()` increments it.
 *
 * Contract:
 *   createReplayCompactionPolicyRepo371({ filePath?, ephemeral? })
 *     -> { lastRunAt, recordRun, recordBlock, consecutiveBlocks,
 *          _flush, _reset, filePath, ephemeral, schema }
 *
 * @version 371.0.0
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_REL_PATH_371 = 'data/replayCompactionPolicy371.json';
const SCHEMA_371 = 'ecos.integrity.delivery.replay.compaction.policy.adaptive/v371';

function _atomicWritePolicy371(filePath, payload) {
  const dir = path.dirname(filePath);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  const tmp = filePath + '.tmp.' + process.pid + '.' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
  fs.renameSync(tmp, filePath);
}

function _safeReadPolicy371(filePath) {
  try {
    const txt = fs.readFileSync(filePath, 'utf8');
    const obj = JSON.parse(txt);
    if (obj && typeof obj === 'object') return obj;
  } catch (_) {}
  return { schema: SCHEMA_371, lastRunAt: null, consecutiveBlocks: 0 };
}

function createReplayCompactionPolicyRepo371(opts) {
  const o = opts || {};
  const ephemeral = !!o.ephemeral;
  const filePath = ephemeral
    ? null
    : path.resolve(o.filePath
        || process.env.ECOS_DELIVERY_REPLAY_COMPACTION_POLICY_REPO_FILE_371
        || DEFAULT_REL_PATH_371);
  let lastRun = null;
  let consecutive = 0;
  if (filePath) {
    const persisted = _safeReadPolicy371(filePath);
    if (persisted && typeof persisted.lastRunAt === 'string') lastRun = persisted.lastRunAt;
    if (persisted && Number.isFinite(persisted.consecutiveBlocks)) {
      consecutive = Math.max(0, Math.floor(persisted.consecutiveBlocks));
    }
  }
  function _flush() {
    if (!filePath) return;
    _atomicWritePolicy371(filePath, {
      schema: SCHEMA_371,
      lastRunAt: lastRun,
      consecutiveBlocks: consecutive,
      updatedAt: new Date().toISOString(),
    });
  }
  return {
    schema: SCHEMA_371,
    filePath, ephemeral,
    lastRunAt() { return lastRun; },
    consecutiveBlocks() { return consecutive; },
    recordRun(tsIso) {
      lastRun = (typeof tsIso === 'string') ? tsIso : new Date().toISOString();
      consecutive = 0;
      _flush();
      return lastRun;
    },
    recordBlock() {
      consecutive += 1;
      _flush();
      return consecutive;
    },
    _flush,
    _reset() { lastRun = null; consecutive = 0; _flush(); },
  };
}

module.exports = {
  createReplayCompactionPolicyRepo371,
  DEFAULT_REL_PATH_371,
  SCHEMA_371,
};
