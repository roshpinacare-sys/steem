'use strict';
/**
 * db/replayCompactionPolicyRepo370.js — ECOS V370 (Phase P258)
 *
 * Tiny file-backed ledger recording the last time the V369 replay TTL
 * compaction ran successfully. Used by
 * `enforceDeliveryReplayCompactionPolicy370` to enforce a recurring
 * cooldown.
 *
 * Contract:
 *   createReplayCompactionPolicyRepo370({ filePath?, ephemeral? })
 *     -> { lastRunAt, recordRun, _flush, _reset, filePath, ephemeral, schema }
 *
 * @version 370.0.0
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_REL_PATH_370 = 'data/replayCompactionPolicy370.json';
const SCHEMA_370 = 'ecos.integrity.delivery.replay.compaction.policy/v370';

function _atomicWritePolicy370(filePath, payload) {
  const dir = path.dirname(filePath);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  const tmp = filePath + '.tmp.' + process.pid + '.' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
  fs.renameSync(tmp, filePath);
}

function _safeReadPolicy370(filePath) {
  try {
    const txt = fs.readFileSync(filePath, 'utf8');
    const obj = JSON.parse(txt);
    if (obj && typeof obj === 'object') return obj;
  } catch (_) {}
  return { schema: SCHEMA_370, lastRunAt: null };
}

function createReplayCompactionPolicyRepo370(opts) {
  const o = opts || {};
  const ephemeral = !!o.ephemeral;
  const filePath = ephemeral
    ? null
    : path.resolve(o.filePath || process.env.ECOS_DELIVERY_REPLAY_COMPACTION_POLICY_REPO_FILE_370 || DEFAULT_REL_PATH_370);
  let lastRun = null;
  if (filePath) {
    const persisted = _safeReadPolicy370(filePath);
    if (persisted && typeof persisted.lastRunAt === 'string') lastRun = persisted.lastRunAt;
  }
  function _flush() {
    if (!filePath) return;
    _atomicWritePolicy370(filePath, {
      schema: SCHEMA_370,
      lastRunAt: lastRun,
      updatedAt: new Date().toISOString(),
    });
  }
  return {
    schema: SCHEMA_370,
    filePath, ephemeral,
    lastRunAt() { return lastRun; },
    recordRun(tsIso) {
      lastRun = (typeof tsIso === 'string') ? tsIso : new Date().toISOString();
      _flush();
      return lastRun;
    },
    _flush,
    _reset() { lastRun = null; _flush(); },
  };
}

module.exports = {
  createReplayCompactionPolicyRepo370,
  DEFAULT_REL_PATH_370,
  SCHEMA_370,
};
