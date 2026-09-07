'use strict';
/**
 * lib/economicIntegrityLoadBearing366.js — ECOS V366 (Phase P254)
 *
 * STRATEGIC THESIS — Deepen the V365 cross-counterparty trust surface
 * along the four leverage points the V365 hand-off identified:
 *
 *   1. signedDispatchRevocationFeed366 / verifyDeliverySignature366
 *        V365 signs each BATCH but not the per-subscriber envelope. V366
 *        wraps the V365 dispatcher and adds an HMAC-SHA256 of the rendered
 *        body keyed on the secret captured at registration, surfaced as the
 *        `X-Ecos-Delivery-Signature` header so subscribers can reject any
 *        spoofed push.
 *
 *   2. Persistent subscriber repo (`db/revocationSubscriberRepo366.js`).
 *        V365 ships an in-memory default. V366 promotes it to a durable
 *        repo with the same upsert / list / updateCursor / bumpFailure /
 *        markDead contract — wired through `ctx.subscriberRepo`.
 *
 *   3. verifierKeyManifest366
 *        V365 publishes a single Ed25519 public key. V366 adds a rotation
 *        manifest exposing the active key plus the previous N keys with
 *        `notBefore` / `notAfter`, so counterparties tolerate key rotation
 *        without re-pinning.
 *
 *   4. enforceBreakGlassApprovalPolicy366
 *        Activates the V365 `ECOS_REQUIRE_SIGNED_APPROVALS_365` gate at
 *        the V364 break-glass write-path: refuses break-glass clear when
 *        any unsigned approval is present in the current trip, and emits
 *        a `break_glass.policy_blocked366` audit event.
 *
 * Pure + dependency-free (R3 — only built-in `crypto`). Every public
 * identifier ends with 366 (R2). Sacred files untouched (R1).
 * V361..V365 contracts preserved (R6).
 *
 * @version 366.0.0
 */

const crypto = require('crypto');

const LB365 = require('./economicIntegrityLoadBearing365.js');
const LB364 = require('./economicIntegrityLoadBearing364.js');
const LB363 = require('./economicIntegrityLoadBearing363.js');

const LOAD_BEARING_VERSION_366             = '366.0.0';
const DELIVERY_SIGNATURE_HEADER_366        = 'x-ecos-delivery-signature';
const DELIVERY_SIGNATURE_ALGO_366          = 'hmac-sha256';
const VERIFIER_KEY_ROTATION_SCHEMA_366     = 'ecos.integrity.verifier.keys/v366';
const SIGNED_DELIVERY_DISPATCHED_TYPE_366  = 'integrity.revocation.feed.signed_dispatched366';
const BREAK_GLASS_POLICY_BLOCKED_TYPE_366  = 'integrity.break_glass.policy_blocked366';
const VERIFIER_KEY_ROTATION_PUBLISHED_366  = 'integrity.verifier.keys.published366';
const DEFAULT_KEY_HISTORY_LIMIT_366        = 5;

// ── helpers (canonical recipe — identical to V362..V365) ──────────────────
function _stableStringify366(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(_stableStringify366).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + _stableStringify366(value[k])).join(',') + '}';
}
function _sha256Hex366(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}
function _hmacSha256Hex366(secret, message) {
  return crypto.createHmac('sha256', String(secret)).update(message, 'utf8').digest('hex');
}
function _timingSafeEqHex366(aHex, bHex) {
  if (typeof aHex !== 'string' || typeof bHex !== 'string') return false;
  if (aHex.length !== bHex.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(aHex, 'hex'), Buffer.from(bHex, 'hex'));
  } catch (_) { return false; }
}

// ── 1. Per-subscriber HMAC delivery signature ─────────────────────────────
/**
 * Wrap V365's `dispatchRevocationFeed365` and add an HMAC delivery
 * signature header per subscriber, derived from the `secret` captured at
 * registration. Subscribers with no secret receive the unsigned V365 envelope
 * unchanged (and `signed:false` is surfaced on the result).
 *
 * The caller-provided `deliver(sub, body, headers)` receives a third
 * argument carrying `{[DELIVERY_SIGNATURE_HEADER_366]: hex, 'x-ecos-delivery-algo': 'hmac-sha256'}`.
 * Default `deliver` is a no-op simulator (kept identical to V365 for parity).
 */
async function signedDispatchRevocationFeed366(ctx, opts) {
  const c = ctx || {};
  const o = opts || {};
  const userDeliver = (typeof o.deliver === 'function')
    ? o.deliver
    : (async () => ({ ok: true, simulated: true }));
  const headersSink = [];
  const wrappedDeliver = async (sub, body) => {
    const headers = {};
    let signed = false, signatureHex = null;
    if (sub && sub.secret) {
      const message = _stableStringify366(body);
      signatureHex = _hmacSha256Hex366(sub.secret, message);
      headers[DELIVERY_SIGNATURE_HEADER_366] = signatureHex;
      headers['x-ecos-delivery-algo']        = DELIVERY_SIGNATURE_ALGO_366;
      headers['x-ecos-delivery-id']          = body.deliveryId;
      signed = true;
    }
    headersSink.push({ id: sub.id, signed, signatureHex, headers });
    if (signed && c.auditLog && typeof c.auditLog.append === 'function') {
      try {
        c.auditLog.append(SIGNED_DELIVERY_DISPATCHED_TYPE_366, {
          id: sub.id, deliveryId: body.deliveryId,
          algo: DELIVERY_SIGNATURE_ALGO_366, signature: signatureHex,
          ts: new Date().toISOString(),
        });
      } catch (_) {}
    }
    return userDeliver(sub, body, headers);
  };
  const base = await LB365.dispatchRevocationFeed365(c, Object.assign({}, o, { deliver: wrappedDeliver }));
  // Merge per-subscriber signature meta into base.results.
  const byId = new Map(headersSink.map(h => [h.id, h]));
  const results = base.results.map(r => {
    const h = byId.get(r.id);
    if (!h) return Object.assign({}, r, { signed: false });
    return Object.assign({}, r, {
      signed: h.signed,
      deliverySignature: h.signed ? h.signatureHex : null,
      deliverySignatureAlgo: h.signed ? DELIVERY_SIGNATURE_ALGO_366 : null,
    });
  });
  return Object.assign({}, base, { results, version: LOAD_BEARING_VERSION_366 });
}

/**
 * Subscriber-side verifier. Pure. Validates `signature` against
 * HMAC-SHA256(secret, stableStringify(body)).
 */
function verifyDeliverySignature366(input) {
  const r = { valid: false, reason: '', algo: DELIVERY_SIGNATURE_ALGO_366 };
  const i = input || {};
  if (!i.body || typeof i.body !== 'object') { r.reason = 'body required'; return r; }
  if (!i.secret) { r.reason = 'secret required'; return r; }
  if (!i.signature || typeof i.signature !== 'string') { r.reason = 'signature required'; return r; }
  const expected = _hmacSha256Hex366(i.secret, _stableStringify366(i.body));
  if (!_timingSafeEqHex366(expected, i.signature)) {
    r.reason = 'delivery signature mismatch';
    return r;
  }
  r.valid = true; r.reason = 'delivery signature valid';
  return r;
}

// ── 2. Persistent subscriber repo bridge ──────────────────────────────────
// Convenience loader so callers can `require('lib/economicIntegrityLoadBearing366').loadPersistentSubscriberRepo366()`.
// The repo module lives at `db/revocationSubscriberRepo366.js` and conforms to
// the V365 ctx.subscriberRepo contract:
//   { list, get, upsert, updateCursor, bumpFailure, markDead }
function loadPersistentSubscriberRepo366(opts) {
  // Lazy-required so unit tests can stub.
  // eslint-disable-next-line global-require
  const factory = require('../db/revocationSubscriberRepo366.js');
  return factory.createRevocationSubscriberRepo366(opts);
}

// ── 3. Verifier key rotation manifest ─────────────────────────────────────
/**
 * Build a signed key-rotation manifest exposing the active Ed25519 public
 * key plus the previous N keys with `notBefore` / `notAfter`. The active
 * key is always the V365 verifier key (resolved via the same env / test
 * fallback chain). Historical keys are sourced from
 * `ECOS_VERIFIER_ED25519_KEY_HISTORY_366` (JSON array) or `opts.history`.
 *
 * Manifest is sha256-stamped so counterparties can pin a digest.
 */
function verifierKeyManifest366(ctx, opts) {
  const o = opts || {};
  const limit = (typeof o.limit === 'number' && o.limit > 0) ? o.limit : DEFAULT_KEY_HISTORY_LIMIT_366;
  // Active key: derive from V365's signed asset (so the manifest never lies
  // about what the live `/signed365` endpoint hands out).
  const asset = LB365.asymmetricSignVerifierAsset365(ctx || {});
  const now = new Date().toISOString();
  const activeKeyId = asset.asymSignatureKeyId || 'ecos-verifier-ed25519-365';
  const active = {
    keyId: activeKeyId,
    publicKeyPem: asset.publicKeyPem || null,
    algo: asset.asymSignatureAlgo || 'ed25519',
    status: 'active',
    notBefore: o.activeNotBefore || now,
    notAfter:  o.activeNotAfter  || null,
  };
  let rawHistory = [];
  if (Array.isArray(o.history)) rawHistory = o.history;
  else {
    const env = process.env.ECOS_VERIFIER_ED25519_KEY_HISTORY_366;
    if (env) {
      try { rawHistory = JSON.parse(env); if (!Array.isArray(rawHistory)) rawHistory = []; }
      catch (_) { rawHistory = []; }
    }
  }
  const history = rawHistory
    .filter(k => k && typeof k === 'object' && k.keyId && k.publicKeyPem)
    .slice(0, limit)
    .map(k => ({
      keyId: String(k.keyId),
      publicKeyPem: String(k.publicKeyPem),
      algo: k.algo || 'ed25519',
      status: 'retired',
      notBefore: k.notBefore || null,
      notAfter:  k.notAfter  || null,
    }));
  const keys = [active].concat(history);
  const manifest = {
    schema: VERIFIER_KEY_ROTATION_SCHEMA_366,
    issuedAt: now,
    issuerVersion: LOAD_BEARING_VERSION_366,
    activeKeyId,
    keys,
  };
  manifest.manifestHash = _sha256Hex366(_stableStringify366({
    schema: manifest.schema, activeKeyId, keys,
  }));
  return manifest;
}

// ── 4. Break-glass policy enforcement ─────────────────────────────────────
/**
 * Wraps `breakGlassClearQuarantine364`. When V365's
 * `isApprovalSignaturePolicyActive365()` is true and there is at least one
 * unsigned V364 approval in the current trip, refuse the clear and emit a
 * `break_glass.policy_blocked366` audit event. Otherwise delegate verbatim.
 *
 * Pure of network I/O. Returns the V364 shape extended with
 * `{ policy: 'signed-approvals-365', enforced366, blocked366?, unsigned366? }`.
 */
function enforceBreakGlassApprovalPolicy366(ctx, opts) {
  const c = ctx || {};
  const o = opts || {};
  const policyActive = LB365.isApprovalSignaturePolicyActive365();
  if (!policyActive) {
    const r = LB364.breakGlassClearQuarantine364(c, o);
    return Object.assign({}, r, { policy: 'signed-approvals-365', enforced366: false });
  }
  const unsigned = LB365.listUnsignedApprovalsInCurrentTrip365(c);
  if (unsigned.length > 0) {
    const blockedAt = new Date().toISOString();
    if (c.auditLog && typeof c.auditLog.append === 'function') {
      try {
        c.auditLog.append(BREAK_GLASS_POLICY_BLOCKED_TYPE_366, {
          policy: 'signed-approvals-365',
          unsignedOperators: unsigned.map(u => u.operator).sort(),
          unsignedCount: unsigned.length,
          reason: o.reason || null,
          ts: blockedAt,
        });
      } catch (_) {}
    }
    return {
      cleared: false,
      policy: 'signed-approvals-365',
      enforced366: true,
      blocked366: true,
      unsigned366: unsigned,
      error: 'break-glass blocked: unsigned approvals present',
      ts: blockedAt,
    };
  }
  const r = LB364.breakGlassClearQuarantine364(c, o);
  return Object.assign({}, r, { policy: 'signed-approvals-365', enforced366: true, blocked366: false });
}

module.exports = {
  LOAD_BEARING_VERSION_366,
  DELIVERY_SIGNATURE_HEADER_366,
  DELIVERY_SIGNATURE_ALGO_366,
  VERIFIER_KEY_ROTATION_SCHEMA_366,
  SIGNED_DELIVERY_DISPATCHED_TYPE_366,
  BREAK_GLASS_POLICY_BLOCKED_TYPE_366,
  VERIFIER_KEY_ROTATION_PUBLISHED_366,
  DEFAULT_KEY_HISTORY_LIMIT_366,
  signedDispatchRevocationFeed366,
  verifyDeliverySignature366,
  loadPersistentSubscriberRepo366,
  verifierKeyManifest366,
  enforceBreakGlassApprovalPolicy366,
  _stableStringify366,
  _sha256Hex366,
  _hmacSha256Hex366,
};
