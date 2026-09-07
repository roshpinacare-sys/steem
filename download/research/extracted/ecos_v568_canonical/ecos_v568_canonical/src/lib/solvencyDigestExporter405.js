'use strict';
/**
 * src/lib/solvencyDigestExporter405.js — ECOS V405 (Phase P293) —
 * Rolling Signed Digest Exporter.
 *
 * Produces a rolling-window, HMAC-signed digest over recent bulletin entries
 * for offline observers. Each export is content-addressed (sha256 over the
 * canonical body) and signed with a shared exporter secret, so an observer
 * can confirm the digest came from the expected operator before trusting it.
 *
 * No new npm deps (R3). Sacred read-only (R1). Identifiers end in 405 (R2).
 *
 * @version 405.0.0
 */

const crypto = require('crypto');

const DIGEST_EXPORTER_VERSION_405 = '405.0.0';
const _sha405 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSolvencyDigestExporter405(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const secret = String(opts.secret || '');
  if (secret.length < 16) throw new Error('exporter secret must be a string of length >= 16');
  const windowSize = Number.isFinite(opts.windowSize) ? Math.max(1, opts.windowSize | 0) : 100;

  function exportDigest405(bulletinEntries) {
    if (!Array.isArray(bulletinEntries)) throw new Error('bulletinEntries array required');
    const window = bulletinEntries.slice(-windowSize).map(e => ({
      seq: e.seq,
      ts: e.ts,
      attestationHash: e.attestationHash,
      liabilityRoot: e.liabilityRoot,
      totalLiabilities: e.totalLiabilities,
      solvent: e.solvent === true,
      witnessed: e.witnessed === true,
      entryHash: e.entryHash,
    }));
    const ts = now();
    const body = {
      ecosVersion: 'V405',
      exportTs: ts,
      windowSize,
      count: window.length,
      firstSeq: window.length ? window[0].seq : null,
      lastSeq: window.length ? window[window.length - 1].seq : null,
      entries: window,
    };
    const canonical = JSON.stringify(body);
    const digest = _sha405('exp405|' + canonical);
    const signature = crypto.createHmac('sha256', secret).update(digest).digest('hex');
    return { body, digest, signature };
  }

  function verifyExport405({ body, digest, signature }, observerSecret) {
    if (!body || !digest || !signature) return { valid: false, reason: 'missing fields' };
    const canonical = JSON.stringify(body);
    const recomputed = _sha405('exp405|' + canonical);
    if (recomputed !== digest) return { valid: false, reason: 'digest mismatch' };
    const expectedSig = crypto.createHmac('sha256', String(observerSecret || secret))
                              .update(digest).digest('hex');
    const a = Buffer.from(signature, 'utf8'), b = Buffer.from(expectedSig, 'utf8');
    if (a.length !== b.length) return { valid: false, reason: 'signature mismatch' };
    let valid = false;
    try { valid = crypto.timingSafeEqual(a, b); } catch (_) { valid = false; }
    return { valid, reason: valid ? 'ok' : 'signature mismatch' };
  }

  return { exportDigest405, verifyExport405, config: { windowSize } };
}

module.exports = {
  DIGEST_EXPORTER_VERSION_405,
  createSolvencyDigestExporter405,
};
