'use strict';
/**
 * src/lib/solvencyFederationReplayGuard407.js — ECOS V407 (Phase P295) —
 * Federation Anti-Replay Guard.
 *
 * Tracks inbound peer envelopes (by operatorId + envelopeHash) and the
 * highest accepted lastSeq per peer, so the V406 peer-digest ingest layer
 * can fail-closed on duplicate envelopes and on stale (out-of-order) lastSeq
 * values — even when each envelope, in isolation, has a valid HMAC.
 *
 * Pure, deterministic. No new npm deps (R3). Sacred read-only (R1).
 * Identifiers end in 407 (R2).
 *
 * @version 407.0.0
 */

const REPLAY_GUARD_VERSION_407 = '407.0.0';

function createSolvencyFederationReplayGuard407(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const maxPerPeer = Number.isFinite(opts.maxPerPeer) ? Math.max(16, opts.maxPerPeer | 0) : 1024;

  // operatorId -> { seen:Set<envelopeHash>, order:Array<envelopeHash>, highestSeq:number, lastTs:number }
  const state = new Map();
  let totalAccepted = 0, totalRejected = 0;
  const rejections = []; // { operatorId, envelopeHash, reason, ts }

  function _peer(operatorId) {
    let p = state.get(operatorId);
    if (!p) { p = { seen: new Set(), order: [], highestSeq: -1, lastTs: 0 }; state.set(operatorId, p); }
    return p;
  }

  function checkAndMark407({ operatorId, envelopeHash, lastSeq }) {
    if (!operatorId) throw new Error('operatorId required');
    if (!envelopeHash || typeof envelopeHash !== 'string') throw new Error('envelopeHash required');
    const seq = Number.isFinite(lastSeq) ? (lastSeq | 0) : -1;
    const p = _peer(operatorId);
    if (p.seen.has(envelopeHash)) {
      totalRejected++;
      const rec = { operatorId, envelopeHash, reason: 'duplicate_envelope_407', ts: now() };
      rejections.push(rec);
      return { ok: false, code: 'DUPLICATE_ENVELOPE_407', reason: rec.reason };
    }
    if (seq >= 0 && seq <= p.highestSeq) {
      totalRejected++;
      const rec = { operatorId, envelopeHash, reason: 'stale_seq_407', ts: now() };
      rejections.push(rec);
      return { ok: false, code: 'STALE_SEQ_407', reason: rec.reason,
               highestSeq: p.highestSeq, attemptedSeq: seq };
    }
    // Accept
    p.seen.add(envelopeHash);
    p.order.push(envelopeHash);
    while (p.order.length > maxPerPeer) {
      const drop = p.order.shift();
      p.seen.delete(drop);
    }
    if (seq > p.highestSeq) p.highestSeq = seq;
    p.lastTs = now();
    totalAccepted++;
    return { ok: true, highestSeq: p.highestSeq, peerWindow: p.order.length };
  }

  function highestSeqFor407(operatorId) {
    const p = state.get(operatorId);
    return p ? p.highestSeq : -1;
  }

  function recentRejections407(limit) {
    const n = Number.isFinite(limit) ? Math.max(1, limit | 0) : rejections.length;
    return rejections.slice(-n).map(r => Object.assign({}, r));
  }

  function stats407() {
    return {
      trackedPeers: state.size,
      totalAccepted,
      totalRejected,
      maxPerPeer,
    };
  }

  return { checkAndMark407, highestSeqFor407, recentRejections407, stats407 };
}

module.exports = {
  REPLAY_GUARD_VERSION_407,
  createSolvencyFederationReplayGuard407,
};
