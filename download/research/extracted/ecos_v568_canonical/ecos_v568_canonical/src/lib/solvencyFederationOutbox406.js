'use strict';
/**
 * src/lib/solvencyFederationOutbox406.js — ECOS V406 (Phase P294) —
 * Federation Outbox for Outbound Peer Push.
 *
 * Holds outbound signed-digest envelopes addressed to each registered peer,
 * each one re-signed with the per-peer shared secret so the receiver can
 * verify it using only that peer's V405-format verifier. Pure queue, no
 * network I/O — a dispatcher walks `pendingForPeer406()` and marks delivered.
 *
 * No new npm deps (R3). Sacred read-only (R1). Identifiers end in 406 (R2).
 *
 * @version 406.0.0
 */

const crypto = require('crypto');
const path = require('path');
const DE405 = require(path.join(__dirname, 'solvencyDigestExporter405.js'));

const FEDERATION_OUTBOX_VERSION_406 = '406.0.0';
const _sha406 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSolvencyFederationOutbox406(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const registry = opts.registry;
  if (!registry || typeof registry._peerSecret406 !== 'function') {
    throw new Error('registry (V406 federation registry) required');
  }
  const windowSize = Number.isFinite(opts.windowSize) ? Math.max(1, opts.windowSize | 0) : 100;
  const maxQueuePerPeer = Number.isFinite(opts.maxQueuePerPeer) ? Math.max(1, opts.maxQueuePerPeer | 0) : 500;

  const queues = new Map(); // operatorId -> Array<msg>
  let nextMsgId = 1;

  function _signFor(peerSecret, bulletinEntries) {
    // Build envelope using a per-peer exporter so the signature matches that
    // peer's shared secret, while the body & digest remain operator-content-addressed.
    const exporter = DE405.createSolvencyDigestExporter405({
      secret: peerSecret, windowSize, now,
    });
    return exporter.exportDigest405(bulletinEntries);
  }

  function broadcastDigest406(bulletinEntries) {
    if (!Array.isArray(bulletinEntries)) throw new Error('bulletinEntries array required');
    const peers = registry.listPeers406();
    const ts = now();
    const fanout = [];
    for (const p of peers) {
      const secret = registry._peerSecret406(p.operatorId);
      if (!secret) continue;
      const envelope = _signFor(secret, bulletinEntries);
      const msg = {
        msgId: nextMsgId++,
        operatorId: p.operatorId,
        ingestUrl: p.ingestUrl,
        ts,
        envelope,
        envelopeHash: _sha406('out406|' + envelope.digest + '|' + envelope.signature),
        delivered: false,
        deliveredAt: null,
      };
      let q = queues.get(p.operatorId);
      if (!q) { q = []; queues.set(p.operatorId, q); }
      q.push(msg);
      while (q.length > maxQueuePerPeer) q.shift();
      fanout.push({ operatorId: p.operatorId, msgId: msg.msgId, envelopeHash: msg.envelopeHash });
    }
    return { ts, count: fanout.length, fanout };
  }

  function pendingForPeer406(operatorId, limit) {
    const q = queues.get(operatorId) || [];
    const pend = q.filter(m => !m.delivered);
    const n = Number.isFinite(limit) ? Math.max(0, limit | 0) : pend.length;
    return pend.slice(0, n).map(m => Object.assign({}, m));
  }

  function markDelivered406(operatorId, msgId) {
    const q = queues.get(operatorId) || [];
    const m = q.find(x => x.msgId === (msgId | 0));
    if (!m) return { ok: false, error: 'msg not found' };
    if (m.delivered) return { ok: true, alreadyDelivered: true };
    m.delivered = true; m.deliveredAt = now();
    return { ok: true, deliveredAt: m.deliveredAt };
  }

  function stats406() {
    let pending = 0, delivered = 0;
    for (const q of queues.values()) for (const m of q) (m.delivered ? delivered++ : pending++);
    return { peerQueues: queues.size, pending, delivered };
  }

  return { broadcastDigest406, pendingForPeer406, markDelivered406, stats406 };
}

module.exports = {
  FEDERATION_OUTBOX_VERSION_406,
  createSolvencyFederationOutbox406,
};
