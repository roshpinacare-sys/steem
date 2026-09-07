'use strict';
/**
 * src/lib/solvencyFederationAttestationBundle410.js — ECOS V410 (Phase P298) —
 * Federation Attestation Master Bundle.
 *
 * Aggregates the four V409 auditor-attestation outputs (sweep export,
 * quorum checkpoints, dispute alerts, archive pins) into a single
 * deterministic, HMAC-signed master bundle so an offline auditor can
 * carry one self-contained artifact representing the full federation
 * attestation surface at a point in time.
 *
 * Pure, deterministic. No new npm deps (R3). Sacred read-only (R1).
 * Identifiers end in 410 (R2).
 *
 * @version 410.0.0
 */

const crypto = require('crypto');

const ATTESTATION_BUNDLE_VERSION_410 = '410.0.0';

const _sha410 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const _hmac410 = (secret, s) =>
  crypto.createHmac('sha256', secret).update(s).digest('hex');

function createSolvencyFederationAttestationBundle410(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const secret = typeof opts.secret === 'string' && opts.secret.length >= 16
    ? opts.secret
    : null;
  if (!secret) throw new Error('secret (>=16 chars) required');

  let lastBundle = null;
  let lastBundledAt = 0;
  let totalBundles = 0;

  function bundle410(v409) {
    if (!v409 || typeof v409 !== 'object') {
      throw new Error('v409 component map required');
    }
    const sweep = v409.sweepExport409 || null;
    const checkpoint = v409.checkpoint409 || null;
    const alert = v409.alert409 || null;
    const pinRegistry = v409.pinRegistry409 || null;

    const ts = now();
    const body = {
      ecosVersion: 'V410',
      schema: 'federation_attestation_bundle_410',
      bundledAt: ts,
      sweepExport: sweep && typeof sweep.getLastBundle409 === 'function'
        ? { stats: sweep.stats409(), last: sweep.getLastBundle409() }
        : null,
      quorumCheckpoints: checkpoint && typeof checkpoint.list409 === 'function'
        ? { stats: checkpoint.stats409(), entries: checkpoint.list409() }
        : null,
      disputeAlerts: alert && typeof alert.list409 === 'function'
        ? { stats: alert.stats409(), entries: alert.list409() }
        : null,
      archivePins: pinRegistry && typeof pinRegistry.list409 === 'function'
        ? { stats: pinRegistry.stats409(), entries: pinRegistry.list409() }
        : null,
    };
    const payload = JSON.stringify(body);
    const contentHash = _sha410('attestation-bundle410|' + payload);
    const signature = _hmac410(secret, contentHash);
    lastBundle = { body, contentHash, signature };
    lastBundledAt = ts;
    totalBundles++;
    return { ok: true, bundle: lastBundle, bundledAt: ts };
  }

  function verifyBundle410(bundle) {
    if (!bundle || !bundle.body || !bundle.contentHash || !bundle.signature) {
      return { valid: false, reason: 'bundle_shape_invalid_410' };
    }
    const payload = JSON.stringify(bundle.body);
    const expectedHash = _sha410('attestation-bundle410|' + payload);
    if (expectedHash !== bundle.contentHash) {
      return { valid: false, reason: 'content_hash_mismatch_410' };
    }
    const expectedSig = _hmac410(secret, bundle.contentHash);
    if (expectedSig !== bundle.signature) {
      return { valid: false, reason: 'signature_mismatch_410' };
    }
    return { valid: true, contentHash: bundle.contentHash };
  }

  function getLastBundle410() {
    return lastBundle;
  }

  function stats410() {
    return {
      lastBundledAt,
      totalBundles,
      hasBundle: !!lastBundle,
    };
  }

  return { bundle410, verifyBundle410, getLastBundle410, stats410 };
}

module.exports = {
  ATTESTATION_BUNDLE_VERSION_410,
  createSolvencyFederationAttestationBundle410,
};
