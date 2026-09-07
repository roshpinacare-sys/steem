'use strict';
/**
 * src/lib/solvencyBulletinBoard405.js — ECOS V405 (Phase P293) — Public Solvency Bulletin Board
 *
 * Aggregates V404 attestation log entries, published roots, and witness quorum
 * status into a single, content-addressed, paginated public bulletin. Each
 * bulletin entry is self-contained and tamper-evident: an external observer
 * can fetch any page and verify entry hashes locally without privileged access.
 *
 * Read-only over sacred (R1). No new npm deps (R3). Identifiers end in 405 (R2).
 *
 * @version 405.0.0
 */

const crypto = require('crypto');

const BULLETIN_BOARD_VERSION_405 = '405.0.0';
const _sha405 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSolvencyBulletinBoard405(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const max = Number.isFinite(opts.maxEntries) ? Math.max(1, opts.maxEntries | 0) : 5000;
  const entries = [];

  function publishBulletin405({ attestation, attestationLogEntry, publishedRoot, witnessCount, quorum }) {
    if (!attestation || typeof attestation !== 'object') {
      throw new Error('attestation required');
    }
    const seq = entries.length + 1;
    const ts = now();
    const body = {
      seq,
      ts,
      ecosVersion: 'V405',
      attestationHash: attestation.attestationHash || null,
      liabilityRoot: attestation.liabilityRoot || null,
      totalLiabilities: attestation.totalLiabilities || '0',
      reserveMicro: attestation.reserveMicro || null,
      surplusMicro: attestation.surplusMicro || null,
      solvent: attestation.solvent === true,
      logEntrySeq: attestationLogEntry ? attestationLogEntry.seq : null,
      logEntryHash: attestationLogEntry ? attestationLogEntry.entryHash : null,
      publishedRootDigest: publishedRoot ? publishedRoot.digest : null,
      witnessCount: Number.isFinite(witnessCount) ? (witnessCount | 0) : 0,
      quorum: Number.isFinite(quorum) ? (quorum | 0) : 0,
      witnessed: Number.isFinite(witnessCount) && Number.isFinite(quorum) ? witnessCount >= quorum : false,
    };
    const entryHash = _sha405('bul405|' + JSON.stringify(body));
    const entry = Object.assign({}, body, { entryHash });
    entries.push(entry);
    while (entries.length > max) entries.shift();
    return entry;
  }

  function page405({ limit, offsetSeq } = {}) {
    const n = Number.isFinite(limit) ? Math.max(1, Math.min(500, limit | 0)) : 50;
    let arr = entries;
    if (Number.isFinite(offsetSeq)) {
      arr = entries.filter(e => e.seq < (offsetSeq | 0));
    }
    return arr.slice(-n).map(e => Object.assign({}, e));
  }

  function getBySeq405(seq) {
    const e = entries.find(x => x.seq === (seq | 0));
    return e ? Object.assign({}, e) : null;
  }

  function getByHash405(entryHash) {
    const e = entries.find(x => x.entryHash === entryHash);
    return e ? Object.assign({}, e) : null;
  }

  function size405() { return entries.length; }
  function latest405() { return entries.length ? Object.assign({}, entries[entries.length - 1]) : null; }

  function verifyEntry405(entry) {
    if (!entry || typeof entry !== 'object' || !entry.entryHash) {
      return { valid: false, reason: 'missing entry/entryHash' };
    }
    const { entryHash, ...body } = entry;
    const recomputed = _sha405('bul405|' + JSON.stringify(body));
    return { valid: recomputed === entryHash, expected: recomputed };
  }

  return { publishBulletin405, page405, getBySeq405, getByHash405, size405, latest405, verifyEntry405 };
}

module.exports = {
  BULLETIN_BOARD_VERSION_405,
  createSolvencyBulletinBoard405,
};
