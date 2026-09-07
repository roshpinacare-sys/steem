'use strict';
/**
 * src/lib/solvencyFederationQuorumHistory408.js — ECOS V408 (Phase P296) —
 * Federation Quorum Decision History.
 *
 * Append-only record of V407 quorum decisions with content-addressed
 * chaining (each entry hashes the previous entry's hash), so an offline
 * auditor can verify continuity of operator-observed quorum results.
 *
 * Pure, deterministic. No new npm deps (R3). Sacred read-only (R1).
 * Identifiers end in 408 (R2).
 *
 * @version 408.0.0
 */

const crypto = require('crypto');

const QUORUM_HISTORY_VERSION_408 = '408.0.0';
const _sha408 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSolvencyFederationQuorumHistory408(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const maxEntries = Number.isFinite(opts.maxEntries) ? Math.max(64, opts.maxEntries | 0) : 4096;

  const history = []; // { seq, ts, decision, prevHash, chainHash }
  let nextSeq = 1;
  let lastChainHash = _sha408('quorum-history408|genesis');
  let reached = 0, missed = 0;

  function record408(decision) {
    if (!decision || typeof decision !== 'object') throw new Error('decision required');
    if (typeof decision.decisionHash !== 'string') throw new Error('decision.decisionHash required');
    const ts = now();
    const seq = nextSeq++;
    const prevHash = lastChainHash;
    const chainHash = _sha408('quorum-history408|' + seq + '|' + prevHash + '|' + decision.decisionHash + '|' + ts);
    const rec = { seq, ts, decision, prevHash, chainHash };
    history.push(rec);
    while (history.length > maxEntries) history.shift();
    lastChainHash = chainHash;
    if (decision.quorumReached) reached++; else missed++;
    return { ok: true, seq, chainHash };
  }

  function list408(limit) {
    const n = Number.isFinite(limit) ? Math.max(1, limit | 0) : history.length;
    return history.slice(-n).map(r => ({
      seq: r.seq, ts: r.ts,
      quorumReached: !!(r.decision && r.decision.quorumReached),
      decisionHash: r.decision && r.decision.decisionHash,
      prevHash: r.prevHash, chainHash: r.chainHash,
    }));
  }

  function verifyChain408() {
    let prev = _sha408('quorum-history408|genesis');
    for (const r of history) {
      if (r.prevHash !== prev) return { valid: false, brokenAtSeq: r.seq, reason: 'prev_hash_mismatch_408' };
      const expected = _sha408('quorum-history408|' + r.seq + '|' + r.prevHash + '|' + r.decision.decisionHash + '|' + r.ts);
      if (expected !== r.chainHash) return { valid: false, brokenAtSeq: r.seq, reason: 'chain_hash_mismatch_408' };
      prev = r.chainHash;
    }
    return { valid: true, length: history.length, head: prev };
  }

  function stats408() {
    return { entries: history.length, nextSeq, reached, missed, head: lastChainHash };
  }

  return { record408, list408, verifyChain408, stats408 };
}

module.exports = {
  QUORUM_HISTORY_VERSION_408,
  createSolvencyFederationQuorumHistory408,
};
