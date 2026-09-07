'use strict';
/**
 * src/lib/solvencyAttestationLog404.js — ECOS V404 (Phase P292) — Solvency Attestation Log
 *
 * Append-only, content-addressed log of V403 solvency attestations. Each entry
 * chains the previous entry's hash so the trail is tamper-evident (a single
 * mutation breaks every downstream link). Read-only over sacred (R1).
 *
 * No new npm deps (R3). Node built-in crypto only. Identifiers end in 404 (R2).
 *
 * @version 404.0.0
 */

const crypto = require('crypto');

const ATTESTATION_LOG_VERSION_404 = '404.0.0';
const _sha404 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSolvencyAttestationLog404(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const max = Number.isFinite(opts.maxEntries) ? Math.max(1, opts.maxEntries | 0) : 10000;
  const entries = [];

  function append404(attestation) {
    if (!attestation || typeof attestation !== 'object') {
      throw new Error('attestation object required');
    }
    const prev = entries.length ? entries[entries.length - 1] : null;
    const prevHash = prev ? prev.entryHash : _sha404('genesis|404');
    const seq = entries.length + 1;
    const ts = now();
    const body = {
      seq,
      ts,
      prevHash,
      liabilityRoot: attestation.liabilityRoot || null,
      totalLiabilities: attestation.totalLiabilities || '0',
      reserveMicro: attestation.reserveMicro || null,
      solvent: attestation.solvent === true,
      surplusMicro: attestation.surplusMicro || null,
      attestationHash: attestation.attestationHash || null,
    };
    const entryHash = _sha404('att404|' + JSON.stringify(body));
    const entry = Object.assign({}, body, { entryHash });
    entries.push(entry);
    while (entries.length > max) entries.shift();
    return entry;
  }

  function list404(limit) {
    const n = Number.isFinite(limit) ? Math.max(0, limit | 0) : entries.length;
    return entries.slice(-n).map(e => Object.assign({}, e));
  }

  function head404() { return entries.length ? Object.assign({}, entries[entries.length - 1]) : null; }
  function size404() { return entries.length; }

  function verifyChain404() {
    let prevHash = _sha404('genesis|404');
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e.prevHash !== prevHash) return { valid: false, brokenAt: e.seq, reason: 'prevHash mismatch' };
      const body = { seq: e.seq, ts: e.ts, prevHash: e.prevHash, liabilityRoot: e.liabilityRoot,
        totalLiabilities: e.totalLiabilities, reserveMicro: e.reserveMicro, solvent: e.solvent,
        surplusMicro: e.surplusMicro, attestationHash: e.attestationHash };
      const recomputed = _sha404('att404|' + JSON.stringify(body));
      if (recomputed !== e.entryHash) return { valid: false, brokenAt: e.seq, reason: 'entryHash mismatch' };
      prevHash = e.entryHash;
    }
    return { valid: true, length: entries.length, head: head404() };
  }

  return { append404, list404, head404, size404, verifyChain404 };
}

module.exports = {
  ATTESTATION_LOG_VERSION_404,
  createSolvencyAttestationLog404,
};
