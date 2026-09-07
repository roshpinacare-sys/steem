'use strict';
/**
 * src/lib/solvencyFederationSweepExport409.js — ECOS V409 (Phase P297) —
 * Federation Sweep Export Bundle.
 *
 * Produces a deterministic, HMAC-signed bundle of the V408 replay-sweep
 * bucket history so an offline auditor can carry a single self-contained
 * artifact, verify its signature, and reason about replay/stale pressure
 * over time without access to the live federation.
 *
 * Pure, deterministic. No new npm deps (R3). Sacred read-only (R1).
 * Identifiers end in 409 (R2).
 *
 * @version 409.0.0
 */

const crypto = require('crypto');

const SWEEP_EXPORT_VERSION_409 = '409.0.0';

const _sha409 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const _hmac409 = (secret, s) =>
  crypto.createHmac('sha256', secret).update(s).digest('hex');

function _canonicalize409(buckets) {
  // Deterministic JSON: sort bucketStart asc, sort inner keys alphabetically.
  const sorted = buckets.slice().sort((a, b) => a.bucketStart - b.bucketStart);
  return sorted.map((b) => {
    const perPeerKeys = Object.keys(b.perPeer || {}).sort();
    const perReasonKeys = Object.keys(b.perReason || {}).sort();
    const perPeer = {};
    for (const k of perPeerKeys) perPeer[k] = b.perPeer[k];
    const perReason = {};
    for (const k of perReasonKeys) perReason[k] = b.perReason[k];
    return {
      bucketStart: b.bucketStart,
      total: b.total,
      perPeer,
      perReason,
    };
  });
}

function createSolvencyFederationSweepExport409(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const secret = typeof opts.secret === 'string' && opts.secret.length >= 16
    ? opts.secret
    : null;
  if (!secret) throw new Error('secret (>=16 chars) required');

  let lastBundle = null;
  let lastExportedAt = 0;
  let totalExports = 0;

  function export409(sweep408) {
    if (!sweep408 || typeof sweep408.listBuckets408 !== 'function') {
      throw new Error('sweep408 required');
    }
    const buckets = _canonicalize409(sweep408.listBuckets408());
    const stats = sweep408.stats408();
    const ts = now();
    const body = {
      ecosVersion: 'V409',
      schema: 'federation_sweep_export_409',
      exportedAt: ts,
      stats,
      buckets,
    };
    const payload = JSON.stringify(body);
    const contentHash = _sha409('sweep-export409|' + payload);
    const signature = _hmac409(secret, contentHash);
    lastBundle = { body, contentHash, signature };
    lastExportedAt = ts;
    totalExports++;
    return { ok: true, bundle: lastBundle, exportedAt: ts };
  }

  function verifyBundle409(bundle) {
    if (!bundle || !bundle.body || !bundle.contentHash || !bundle.signature) {
      return { valid: false, reason: 'bundle_shape_invalid_409' };
    }
    const payload = JSON.stringify(bundle.body);
    const expectedHash = _sha409('sweep-export409|' + payload);
    if (expectedHash !== bundle.contentHash) {
      return { valid: false, reason: 'content_hash_mismatch_409' };
    }
    const expectedSig = _hmac409(secret, bundle.contentHash);
    if (expectedSig !== bundle.signature) {
      return { valid: false, reason: 'signature_mismatch_409' };
    }
    return { valid: true, contentHash: bundle.contentHash };
  }

  function getLastBundle409() {
    return lastBundle;
  }

  function stats409() {
    return {
      lastExportedAt,
      totalExports,
      hasBundle: !!lastBundle,
    };
  }

  return { export409, verifyBundle409, getLastBundle409, stats409 };
}

module.exports = {
  SWEEP_EXPORT_VERSION_409,
  createSolvencyFederationSweepExport409,
};
