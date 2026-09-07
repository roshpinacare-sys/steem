'use strict';
/**
 * src/lib/solvencyObserverSubscriptions405.js — ECOS V405 (Phase P293) —
 * Observer Subscriptions for Public Solvency Bulletin Board.
 *
 * External observers register with an id + HMAC secret. When a new bulletin
 * entry is published, the registry enqueues a notification (HMAC over the
 * bulletin entryHash) which a webhook dispatcher can drain and mark delivered.
 *
 * Pure, deterministic, no network I/O. No new npm deps (R3). Sacred read-only
 * (R1). Identifiers end in 405 (R2).
 *
 * @version 405.0.0
 */

const crypto = require('crypto');

const OBSERVER_SUBSCRIPTIONS_VERSION_405 = '405.0.0';

function _hmac405(secret, msg) {
  return crypto.createHmac('sha256', String(secret)).update(String(msg)).digest('hex');
}

function createSolvencyObserverSubscriptions405(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const maxQueue = Number.isFinite(opts.maxQueuePerObserver) ? Math.max(1, opts.maxQueuePerObserver | 0) : 1000;

  const observers = new Map(); // observerId -> { secret, callbackUrl, addedAt }
  const queues = new Map();    // observerId -> Array<notification>
  let nextNotifId = 1;

  function registerObserver405({ observerId, secret, callbackUrl }) {
    if (!observerId || typeof observerId !== 'string') throw new Error('observerId required');
    if (!secret || typeof secret !== 'string' || secret.length < 16) {
      throw new Error('secret must be a string of length >= 16');
    }
    observers.set(observerId, { secret, callbackUrl: callbackUrl || null, addedAt: now() });
    if (!queues.has(observerId)) queues.set(observerId, []);
    return { ok: true, observerId };
  }

  function removeObserver405(observerId) {
    const had = observers.delete(observerId);
    queues.delete(observerId);
    return { ok: had };
  }

  function listObservers405() {
    return Array.from(observers.entries()).map(([id, v]) => ({
      observerId: id, callbackUrl: v.callbackUrl, addedAt: v.addedAt,
      queueDepth: (queues.get(id) || []).length,
    }));
  }

  function enqueueForAll405(bulletinEntry) {
    if (!bulletinEntry || !bulletinEntry.entryHash) {
      throw new Error('bulletin entry with entryHash required');
    }
    const ts = now();
    const fanout = [];
    for (const [observerId, rec] of observers.entries()) {
      const id = nextNotifId++;
      const signature = _hmac405(rec.secret, bulletinEntry.entryHash);
      const notif = {
        notifId: id,
        observerId,
        ts,
        bulletinSeq: bulletinEntry.seq,
        bulletinEntryHash: bulletinEntry.entryHash,
        signature,
        delivered: false,
        deliveredAt: null,
      };
      let q = queues.get(observerId);
      if (!q) { q = []; queues.set(observerId, q); }
      q.push(notif);
      while (q.length > maxQueue) q.shift();
      fanout.push({ observerId, notifId: id });
    }
    return { ts, count: fanout.length, fanout };
  }

  function pending405(observerId, limit) {
    const q = queues.get(observerId) || [];
    const pend = q.filter(n => !n.delivered);
    const n = Number.isFinite(limit) ? Math.max(0, limit | 0) : pend.length;
    return pend.slice(0, n).map(x => Object.assign({}, x));
  }

  function markDelivered405(observerId, notifId) {
    const q = queues.get(observerId) || [];
    const n = q.find(x => x.notifId === (notifId | 0));
    if (!n) return { ok: false, error: 'notif not found' };
    if (n.delivered) return { ok: true, alreadyDelivered: true };
    n.delivered = true; n.deliveredAt = now();
    return { ok: true, deliveredAt: n.deliveredAt };
  }

  function stats405() {
    let pendingTotal = 0, deliveredTotal = 0;
    for (const q of queues.values()) for (const n of q) (n.delivered ? deliveredTotal++ : pendingTotal++);
    return { observers: observers.size, pendingTotal, deliveredTotal };
  }

  return { registerObserver405, removeObserver405, listObservers405,
           enqueueForAll405, pending405, markDelivered405, stats405 };
}

module.exports = {
  OBSERVER_SUBSCRIPTIONS_VERSION_405,
  createSolvencyObserverSubscriptions405,
  _hmac405,
};
