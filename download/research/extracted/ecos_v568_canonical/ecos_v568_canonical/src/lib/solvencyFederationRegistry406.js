'use strict';
/**
 * src/lib/solvencyFederationRegistry406.js — ECOS V406 (Phase P294) —
 * Cross-Operator Federation Registry.
 *
 * Registers peer ECOS operators (their operatorId + shared HMAC secret +
 * optional ingest URL) so the local node can both verify inbound signed
 * digests from peers (V405 exporter format) and address outbound pushes.
 *
 * Pure, deterministic. Sacred read-only (R1). No new npm deps (R3).
 * Identifiers end in 406 (R2).
 *
 * @version 406.0.0
 */

const crypto = require('crypto');

const FEDERATION_REGISTRY_VERSION_406 = '406.0.0';
const _sha406 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSolvencyFederationRegistry406(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const peers = new Map(); // operatorId -> { secret, ingestUrl, addedAt, fingerprint }

  function registerPeer406({ operatorId, secret, ingestUrl }) {
    if (!operatorId || typeof operatorId !== 'string') throw new Error('operatorId required');
    if (!secret || typeof secret !== 'string' || secret.length < 16) {
      throw new Error('secret must be a string of length >= 16');
    }
    const fingerprint = _sha406('fed406|' + operatorId + '|' + secret).slice(0, 16);
    peers.set(operatorId, {
      secret, ingestUrl: ingestUrl || null, addedAt: now(), fingerprint,
    });
    return { ok: true, operatorId, fingerprint };
  }

  function removePeer406(operatorId) {
    return { ok: peers.delete(operatorId) };
  }

  function getPeer406(operatorId) {
    const p = peers.get(operatorId);
    if (!p) return null;
    return { operatorId, ingestUrl: p.ingestUrl, addedAt: p.addedAt, fingerprint: p.fingerprint };
  }

  function _peerSecret406(operatorId) {
    const p = peers.get(operatorId);
    return p ? p.secret : null;
  }

  function listPeers406() {
    return Array.from(peers.entries()).map(([id, v]) => ({
      operatorId: id, ingestUrl: v.ingestUrl, addedAt: v.addedAt, fingerprint: v.fingerprint,
    }));
  }

  function size406() { return peers.size; }

  return { registerPeer406, removePeer406, getPeer406, listPeers406, size406, _peerSecret406 };
}

module.exports = {
  FEDERATION_REGISTRY_VERSION_406,
  createSolvencyFederationRegistry406,
};
