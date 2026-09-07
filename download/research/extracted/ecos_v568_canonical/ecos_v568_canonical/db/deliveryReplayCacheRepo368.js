'use strict';
/**
 * db/deliveryReplayCacheRepo368.js — ECOS V368 (Phase P256)
 *
 * File-backed, append-only nonce store used to make the V367 delivery
 * replay guard survive process restarts. Pure Node built-ins, atomic
 * write-rename, mirrors the contract V367 LRU cache exposes
 * (`has(nonce)`, `add(nonce)`, `size()`).
 *
 * Contract:
 *   createDeliveryReplayCacheRepo368({ filePath?, ephemeral?, maxSize? })
 *     -> { has, add, size, list, _flush, _reset, filePath, ephemeral }
 *
 * `ephemeral:true` keeps everything in memory (used by tests + when
 * `NODE_ENV === 'test'`). `filePath` defaults to
 * `process.env.ECOS_DELIVERY_REPLAY_REPO_FILE_368` or
 * `./data/deliveryReplayCache368.json`.
 *
 * @version 368.0.0
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_SIZE_368 = 16384;
const DEFAULT_REL_PATH_368 = 'data/deliveryReplayCache368.json';

function _atomicWrite368(filePath, payload) {
  const dir = path.dirname(filePath);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  const tmp = filePath + '.tmp.' + process.pid + '.' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
  fs.renameSync(tmp, filePath);
}

function _safeRead368(filePath) {
  try {
    const txt = fs.readFileSync(filePath, 'utf8');
    const obj = JSON.parse(txt);
    if (obj && Array.isArray(obj.nonces)) return obj;
  } catch (_) {}
  return { schema: 'ecos.integrity.delivery.replay/v368', nonces: [] };
}

function createDeliveryReplayCacheRepo368(opts) {
  const o = opts || {};
  const ephemeral = !!o.ephemeral;
  const maxSize = (typeof o.maxSize === 'number' && o.maxSize > 0)
    ? o.maxSize : DEFAULT_MAX_SIZE_368;
  const filePath = ephemeral
    ? null
    : path.resolve(o.filePath || process.env.ECOS_DELIVERY_REPLAY_REPO_FILE_368 || DEFAULT_REL_PATH_368);
  const order = [];
  const seen = new Map();
  if (filePath) {
    const persisted = _safeRead368(filePath);
    for (const n of persisted.nonces) {
      const k = String(n);
      if (!seen.has(k)) { seen.set(k, true); order.push(k); }
    }
  }
  function _flush() {
    if (!filePath) return;
    _atomicWrite368(filePath, {
      schema: 'ecos.integrity.delivery.replay/v368',
      nonces: order.slice(),
      updatedAt: new Date().toISOString(),
    });
  }
  return {
    schema: 'ecos.integrity.delivery.replay/v368',
    filePath, ephemeral,
    has(nonce) { return seen.has(String(nonce)); },
    add(nonce) {
      const k = String(nonce);
      if (seen.has(k)) return false;
      seen.set(k, true); order.push(k);
      while (order.length > maxSize) seen.delete(order.shift());
      _flush();
      return true;
    },
    size() { return seen.size; },
    list() { return order.slice(); },
    _flush,
    _reset() { order.length = 0; seen.clear(); _flush(); },
  };
}

module.exports = {
  createDeliveryReplayCacheRepo368,
  DEFAULT_MAX_SIZE_368,
  DEFAULT_REL_PATH_368,
};
