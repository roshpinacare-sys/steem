'use strict';
/**
 * db/prewarmEmissionRepo369.js — ECOS V369 (Phase P257)
 *
 * File-backed ledger of `(activeKeyId|manifestHash)` tuples for which a
 * `prewarm_signal368` has already been emitted. Lets the V368 dedupe
 * guarantee survive process restarts. Pure Node built-ins, atomic
 * write-rename.
 *
 * Contract:
 *   createPrewarmEmissionRepo369({ filePath?, ephemeral?, maxSize? })
 *     -> { has, add, size, list, _flush, _reset, filePath, ephemeral }
 *
 * @version 369.0.0
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_SIZE_369 = 8192;
const DEFAULT_REL_PATH_369 = 'data/prewarmEmissions369.json';

function _atomicWrite369(filePath, payload) {
  const dir = path.dirname(filePath);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  const tmp = filePath + '.tmp.' + process.pid + '.' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
  fs.renameSync(tmp, filePath);
}

function _safeRead369(filePath) {
  try {
    const txt = fs.readFileSync(filePath, 'utf8');
    const obj = JSON.parse(txt);
    if (obj && Array.isArray(obj.tuples)) return obj;
  } catch (_) {}
  return { schema: 'ecos.integrity.verifier.prewarm.emissions/v369', tuples: [] };
}

function createPrewarmEmissionRepo369(opts) {
  const o = opts || {};
  const ephemeral = !!o.ephemeral;
  const maxSize = (typeof o.maxSize === 'number' && o.maxSize > 0)
    ? o.maxSize : DEFAULT_MAX_SIZE_369;
  const filePath = ephemeral
    ? null
    : path.resolve(o.filePath || process.env.ECOS_PREWARM_EMISSION_REPO_FILE_369 || DEFAULT_REL_PATH_369);
  const order = [];
  const seen = new Map();
  if (filePath) {
    const persisted = _safeRead369(filePath);
    for (const t of persisted.tuples) {
      const k = String(t);
      if (!seen.has(k)) { seen.set(k, true); order.push(k); }
    }
  }
  function _flush() {
    if (!filePath) return;
    _atomicWrite369(filePath, {
      schema: 'ecos.integrity.verifier.prewarm.emissions/v369',
      tuples: order.slice(),
      updatedAt: new Date().toISOString(),
    });
  }
  return {
    schema: 'ecos.integrity.verifier.prewarm.emissions/v369',
    filePath, ephemeral,
    has(tuple) { return seen.has(String(tuple)); },
    add(tuple) {
      const k = String(tuple);
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
  createPrewarmEmissionRepo369,
  DEFAULT_MAX_SIZE_369,
  DEFAULT_REL_PATH_369,
};
