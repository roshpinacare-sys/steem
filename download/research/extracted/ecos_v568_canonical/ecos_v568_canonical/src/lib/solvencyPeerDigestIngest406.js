'use strict';
/**
 * src/lib/solvencyPeerDigestIngest406.js — ECOS V406 (Phase P294) —
 * Peer Signed-Digest Ingest.
 *
 * Accepts V405-format signed digests pushed by federated peer operators,
 * verifies the digest content-address + HMAC signature against the peer's
 * shared secret (from the V406 federation registry), and stores the latest
 * accepted digest per peer. Fail-closed on bad signature or tampered body.
 *
 * No new npm deps (R3). Sacred read-only (R1). Identifiers end in 406 (R2).
 *
 * @version 406.0.0
 */

const crypto = require('crypto');
const path = require('path');
const DE405 = require(path.join(__dirname, 'solvencyDigestExporter405.js'));

const PEER_DIGEST_INGEST_VERSION_406 = '406.0.0';

function createSolvencyPeerDigestIngest406(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const registry = opts.registry;
  if (!registry || typeof registry._peerSecret406 !== 'function') {
    throw new Error('registry (V406 federation registry) required');
  }
  const maxHistory = Number.isFinite(opts.maxHistory) ? Math.max(1, opts.maxHistory | 0) : 200;

  // operatorId -> latest accepted { digest, body, signature, receivedAt }
  const latest = new Map();
  // operatorId -> Array<{digest, ts, ok, reason}>
  const history = new Map();

  // A local verifier instance for content-address recompute; secret is per-peer.
  function _verify406(envelope, peerSecret) {
    const probe = DE405.createSolvencyDigestExporter405({ secret: peerSecret, windowSize: 1 });
    return probe.verifyExport405(envelope, peerSecret);
  }

  function ingestDigest406({ operatorId, envelope }) {
    if (!operatorId) throw new Error('operatorId required');
    if (!envelope || !envelope.body || !envelope.digest || !envelope.signature) {
      throw new Error('envelope { body, digest, signature } required');
    }
    const secret = registry._peerSecret406(operatorId);
    if (!secret) {
      _record(operatorId, envelope.digest, false, 'unknown_peer');
      return { ok: false, error: 'unknown peer', code: 'UNKNOWN_PEER_406' };
    }
    const v = _verify406(envelope, secret);
    if (!v || v.valid !== true) {
      _record(operatorId, envelope.digest, false, v && v.reason ? v.reason : 'invalid');
      return { ok: false, error: 'digest verification failed', code: 'BAD_DIGEST_406',
               reason: v && v.reason };
    }
    const rec = {
      digest: envelope.digest,
      body: envelope.body,
      signature: envelope.signature,
      receivedAt: now(),
    };
    latest.set(operatorId, rec);
    _record(operatorId, envelope.digest, true, 'ok');
    return { ok: true, operatorId, digest: rec.digest, receivedAt: rec.receivedAt,
             entriesCount: envelope.body.count | 0 };
  }

  function _record(operatorId, digest, ok, reason) {
    let h = history.get(operatorId);
    if (!h) { h = []; history.set(operatorId, h); }
    h.push({ digest, ts: now(), ok: !!ok, reason });
    while (h.length > maxHistory) h.shift();
  }

  function latestForPeer406(operatorId) {
    const rec = latest.get(operatorId);
    return rec ? Object.assign({}, rec) : null;
  }

  function listLatest406() {
    return Array.from(latest.entries()).map(([id, r]) => ({
      operatorId: id, digest: r.digest, receivedAt: r.receivedAt,
      count: r.body.count | 0, lastSeq: r.body.lastSeq, firstSeq: r.body.firstSeq,
    }));
  }

  function historyFor406(operatorId, limit) {
    const h = history.get(operatorId) || [];
    const n = Number.isFinite(limit) ? Math.max(1, limit | 0) : h.length;
    return h.slice(-n).map(x => Object.assign({}, x));
  }

  function stats406() {
    let accepted = 0, rejected = 0;
    for (const h of history.values()) for (const r of h) (r.ok ? accepted++ : rejected++);
    return { peersWithDigest: latest.size, accepted, rejected };
  }

  return { ingestDigest406, latestForPeer406, listLatest406, historyFor406, stats406 };
}

module.exports = {
  PEER_DIGEST_INGEST_VERSION_406,
  createSolvencyPeerDigestIngest406,
};
