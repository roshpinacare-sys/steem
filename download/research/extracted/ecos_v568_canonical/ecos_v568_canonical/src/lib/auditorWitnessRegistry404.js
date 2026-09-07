'use strict';
/**
 * src/lib/auditorWitnessRegistry404.js — ECOS V404 (Phase P292) — Auditor Witness Registry
 *
 * Registry of external auditor signatures (HMAC witnesses) over V403 attestation
 * hashes. Each auditor is registered with a shared secret; auditors POST a
 * witness HMAC over the attestation hash, and we verify and record it. Quorum
 * predicate enables multi-party trust: an attestation is "witnessed" when at
 * least `quorum` distinct auditors have signed.
 *
 * No new npm deps (R3). Node built-in crypto only. Read-only over sacred (R1).
 *
 * @version 404.0.0
 */

const crypto = require('crypto');

const AUDITOR_WITNESS_VERSION_404 = '404.0.0';

function _hmac404(secret, msg) {
  return crypto.createHmac('sha256', String(secret)).update(String(msg)).digest('hex');
}

function _eqConst404(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch (_) { return false; }
}

function createAuditorWitnessRegistry404(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const quorumDefault = Number.isFinite(opts.quorum) ? Math.max(1, opts.quorum | 0) : 2;
  const auditors = new Map(); // auditorId -> { secret, addedAt }
  const witnesses = new Map(); // attestationHash -> Map(auditorId -> {witnessHmac, ts})

  function registerAuditor404(auditorId, secret) {
    if (!auditorId || typeof auditorId !== 'string') throw new Error('auditorId required');
    if (!secret || typeof secret !== 'string' || secret.length < 16) {
      throw new Error('secret must be a string of length >= 16');
    }
    auditors.set(auditorId, { secret, addedAt: now() });
    return { ok: true, auditorId };
  }

  function removeAuditor404(auditorId) {
    const had = auditors.delete(auditorId);
    return { ok: had };
  }

  function listAuditors404() {
    return Array.from(auditors.entries()).map(([id, v]) => ({ auditorId: id, addedAt: v.addedAt }));
  }

  function submitWitness404({ auditorId, attestationHash, witnessHmac }) {
    if (!auditorId || !attestationHash || !witnessHmac) {
      throw new Error('auditorId, attestationHash, witnessHmac required');
    }
    const rec = auditors.get(auditorId);
    if (!rec) return { ok: false, error: 'unknown auditor', code: 'UNKNOWN_AUDITOR_404' };
    const expected = _hmac404(rec.secret, attestationHash);
    if (!_eqConst404(expected, witnessHmac)) {
      return { ok: false, error: 'witness hmac mismatch', code: 'BAD_WITNESS_404' };
    }
    let bucket = witnesses.get(attestationHash);
    if (!bucket) { bucket = new Map(); witnesses.set(attestationHash, bucket); }
    bucket.set(auditorId, { witnessHmac, ts: now() });
    return { ok: true, auditorId, attestationHash, witnessCount: bucket.size };
  }

  function listWitnesses404(attestationHash) {
    const bucket = witnesses.get(attestationHash);
    if (!bucket) return [];
    return Array.from(bucket.entries()).map(([auditorId, v]) => ({ auditorId, witnessHmac: v.witnessHmac, ts: v.ts }));
  }

  function quorumStatus404(attestationHash, quorum) {
    const q = Number.isFinite(quorum) ? Math.max(1, quorum | 0) : quorumDefault;
    const bucket = witnesses.get(attestationHash);
    const count = bucket ? bucket.size : 0;
    return { attestationHash, witnessCount: count, quorum: q, witnessed: count >= q };
  }

  return { registerAuditor404, removeAuditor404, listAuditors404,
           submitWitness404, listWitnesses404, quorumStatus404 };
}

module.exports = {
  AUDITOR_WITNESS_VERSION_404,
  createAuditorWitnessRegistry404,
  _hmac404,
};
