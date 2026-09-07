'use strict';
/**
 * db/deliveryReplayCacheRepoTtl369.js — ECOS V369 (Phase P257)
 *
 * Timestamp-aware extension of the V368 delivery replay repo. Exposes
 * the V368 contract (`has`, `add`, `size`, `list`) AND the V369
 * extension contract (`entries`, `_drop`) so
 * `enforceDeliveryReplayTtl369` can evict stale nonces.
 *
 * Contract:
 *   createDeliveryReplayCacheRepoTtl369({ filePath?, ephemeral?, maxSize? })
 *     -> { has, add, size, list, entries, _drop, _flush, _reset, filePath, ephemeral }
 *
 * Each persisted record is `{nonce, ts}` where `ts` is an ISO timestamp.
 *
 * @version 369.0.0
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_SIZE_369 = 16384;
const DEFAULT_REL_PATH_369 = 'data/deliveryReplayCacheTtl369.json';
const SCHEMA_369 = 'ecos.integrity.delivery.replay.ttl/v369';

function _atomicWriteTtl369(filePath, payload) {
  const dir = path.dirname(filePath);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  const tmp = filePath + '.tmp.' + process.pid + '.' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
  fs.renameSync(tmp, filePath);
}

function _safeReadTtl369(filePath) {
  try {
    const txt = fs.readFileSync(filePath, 'utf8');
    const obj = JSON.parse(txt);
    if (obj && Array.isArray(obj.records)) return obj;
  } catch (_) {}
  return { schema: SCHEMA_369, records: [] };
}

function createDeliveryReplayCacheRepoTtl369(opts) {
  const o = opts || {};
  const ephemeral = !!o.ephemeral;
  const maxSize = (typeof o.maxSize === 'number' && o.maxSize > 0)
    ? o.maxSize : DEFAULT_MAX_SIZE_369;
  const filePath = ephemeral
    ? null
    : path.resolve(o.filePath || process.env.ECOS_DELIVERY_REPLAY_TTL_REPO_FILE_369 || DEFAULT_REL_PATH_369);
  const order = [];
  const records = new Map(); // nonce -> ts(ISO)
  if (filePath) {
    const persisted = _safeReadTtl369(filePath);
    for (const r of persisted.records) {
      if (!r || !r.nonce) continue;
      const k = String(r.nonce);
      if (!records.has(k)) { records.set(k, r.ts || new Date().toISOString()); order.push(k); }
    }
  }
  function _flush() {
    if (!filePath) return;
    _atomicWriteTtl369(filePath, {
      schema: SCHEMA_369,
      records: order.map(n => ({ nonce: n, ts: records.get(n) })),
      updatedAt: new Date().toISOString(),
    });
  }
  return {
    schema: SCHEMA_369,
    filePath, ephemeral,
    has(nonce) { return records.has(String(nonce)); },
    add(nonce) {
      const k = String(nonce);
      if (records.has(k)) return false;
      records.set(k, new Date().toISOString()); order.push(k);
      while (order.length > maxSize) records.delete(order.shift());
      _flush();
      return true;
    },
    size() { return records.size; },
    list() { return order.slice(); },
    entries() { return order.map(n => ({ nonce: n, ts: records.get(n) })); },
    _drop(nonce) {
      const k = String(nonce);
      if (!records.has(k)) return false;
      records.delete(k);
      const idx = order.indexOf(k);
      if (idx >= 0) order.splice(idx, 1);
      _flush();
      return true;
    },
    _flush,
    _reset() { order.length = 0; records.clear(); _flush(); },
  };
}

module.exports = {
  createDeliveryReplayCacheRepoTtl369,
  DEFAULT_MAX_SIZE_369,
  DEFAULT_REL_PATH_369,
  SCHEMA_369,
};
