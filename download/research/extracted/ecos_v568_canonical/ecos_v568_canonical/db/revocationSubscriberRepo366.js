'use strict';
/**
 * db/revocationSubscriberRepo366.js — ECOS V366 (Phase P254)
 *
 * Durable subscriber repo for V365's `ctx.subscriberRepo` contract.
 * File-backed JSON store (atomic write-rename), no external deps (R3).
 *
 * NOTE on sync vs async: V365's `dispatchRevocationFeed365` calls store
 * methods synchronously (e.g. `store.list().filter(...)`), so this repo
 * exposes a synchronous API. The methods are still safe to `await` because
 * non-Promise values pass through `await` unchanged.
 *
 * Test-friendly: pass `{ ephemeral: true }` for an in-memory store with
 * the same API, or `{ filePath }` to point at a per-test file.
 *
 * @version 366.0.0
 */

const fs = require('fs');
const path = require('path');

const REPO_VERSION_366 = '366.0.0';

function _readAll(filePath) {
  try {
    const txt = fs.readFileSync(filePath, 'utf8');
    const j = JSON.parse(txt);
    if (j && j.subscribers && typeof j.subscribers === 'object') return j.subscribers;
    return {};
  } catch (_) { return {}; }
}
function _writeAll(filePath, subscribers) {
  const dir = path.dirname(filePath);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  const tmp = filePath + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify({
    version: REPO_VERSION_366, updatedAt: new Date().toISOString(), subscribers,
  }, null, 2));
  fs.renameSync(tmp, filePath);
}

function createRevocationSubscriberRepo366(opts) {
  const o = opts || {};
  const ephemeral = !!o.ephemeral;
  const filePath = o.filePath || path.join(process.cwd(), 'data', 'revocationSubscribers366.json');
  let cache = ephemeral ? {} : _readAll(filePath);
  function persist() { if (!ephemeral) _writeAll(filePath, cache); }
  return {
    version: REPO_VERSION_366,
    filePath: ephemeral ? null : filePath,
    isEphemeral: ephemeral,
    list() { return Object.values(cache).map(s => Object.assign({}, s)); },
    get(id) { return cache[id] ? Object.assign({}, cache[id]) : null; },
    upsert(rec) {
      if (!rec || !rec.id) throw new Error('subscriber id required');
      cache[rec.id] = Object.assign({}, cache[rec.id] || {}, rec);
      persist();
      return Object.assign({}, cache[rec.id]);
    },
    updateCursor(id, nextCursor) {
      const r = cache[id]; if (!r) return null;
      r.cursor = nextCursor;
      r.lastDeliveredAt = new Date().toISOString();
      r.failures = 0;
      persist();
      return Object.assign({}, r);
    },
    bumpFailure(id) {
      const r = cache[id]; if (!r) return 0;
      r.failures = (r.failures || 0) + 1;
      r.lastFailureAt = new Date().toISOString();
      persist();
      return r.failures;
    },
    markDead(id, reason) {
      const r = cache[id]; if (!r) return null;
      r.dead = true; r.deadReason = reason || 'unknown';
      r.deadAt = new Date().toISOString();
      persist();
      return Object.assign({}, r);
    },
    // test helpers (not part of V365 contract)
    _reset() { cache = {}; if (!ephemeral) persist(); },
    _all()   { return Object.assign({}, cache); },
  };
}

module.exports = {
  REPO_VERSION_366,
  createRevocationSubscriberRepo366,
};
