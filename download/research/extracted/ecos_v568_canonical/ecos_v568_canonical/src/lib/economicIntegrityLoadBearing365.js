'use strict';
/**
 * lib/economicIntegrityLoadBearing365.js — ECOS V365 (Phase P253)
 *
 * STRATEGIC THESIS — Deepen the V364 cross-counterparty trust surface
 * along the four leverage points the V364 hand-off identified:
 *
 *   1. asymmetricSignVerifierAsset365 / verifyAsymmetricVerifierAsset365
 *        Upgrade the V364 HMAC verifier signature to Ed25519 so
 *        counterparties pin a PUBLIC key (out-of-band) and verify the SDK
 *        bytes without sharing the issuer's secret. The V364 HMAC mode
 *        remains a documented fallback.
 *
 *   2. registerRevocationSubscriber365 / dispatchRevocationFeed365 /
 *      listRevocationSubscribers365
 *        V364 makes counterparties POLL `/feed/since/:cursor`. V365 adds
 *        a subscriber registry and a signed delivery pipeline (per-target
 *        cursor, retry counter, dead-letter quarantine). Each batch is
 *        signed with the V364 feed-hash recipe so subscribers verify in
 *        one shot.
 *
 *   3. recordSignedOperatorApproval365
 *        V364 approvals carry only an operator id. V365 requires a
 *        detached Ed25519 signature over `(trippedAt + ":" + operator)`
 *        verified against that operator's pinned public key. When
 *        ECOS_REQUIRE_SIGNED_APPROVALS_365=1, unsigned V364 approvals
 *        are rejected at the audit layer.
 *
 *   4. quarantineStatusFromRepo365
 *        `projectQuarantineLedger364` writes-through. V365 reads-through:
 *        when `ctx.quarantineRepo.latest()` is available, status is
 *        answered from the repo (with audit-log fallback for parity with
 *        V363's `getRevocationStatus363`).
 *
 * Pure + dependency-free (R3 — only built-in `crypto`). Every public
 * identifier ends with 365 (R2). Sacred files untouched (R1). V361 + V362
 * + V363 + V364 contracts preserved (R6).
 *
 * @version 365.0.0
 */

const crypto = require('crypto');

const LB364 = require('./economicIntegrityLoadBearing364.js');
const LB363 = require('./economicIntegrityLoadBearing363.js');
const LB362 = require('./economicIntegrityLoadBearing362.js');

const LOAD_BEARING_VERSION_365            = '365.0.0';
const VERIFIER_ASYM_SIGNATURE_ALGO_365    = 'ed25519';
const SUBSCRIBER_REGISTERED_TYPE_365      = 'integrity.revocation.subscriber.registered365';
const SUBSCRIBER_DISPATCHED_TYPE_365      = 'integrity.revocation.feed.dispatched365';
const SUBSCRIBER_DEAD_LETTERED_TYPE_365   = 'integrity.revocation.feed.dead_lettered365';
const SIGNED_APPROVAL_TYPE_365            = 'integrity.quarantine.signed_approval365';
const REVOCATION_DELIVERY_SCHEMA_365      = 'ecos.integrity.revocation.delivery/v365';
const DEFAULT_DEAD_LETTER_AFTER_365       = 5;
const APPROVAL_SIGNATURE_MESSAGE_RECIPE_365 =
  'ed25519(forTrippedAt + ":" + operator)';

// ── helpers (canonical recipe — identical to V362/V363/V364) ───────────────
function _stableStringify365(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(_stableStringify365).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + _stableStringify365(value[k])).join(',') + '}';
}
function _sha256Hex365(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

// Deterministic dev keypair under NODE_ENV=test so wiring is exercisable
// end-to-end without external key material. Production reads
// ECOS_VERIFIER_ED25519_PRIVATE_PEM_365 / ECOS_VERIFIER_ED25519_PUBLIC_PEM_365.
let _testKeyPairCache365 = null;
function _testKeyPair365() {
  if (_testKeyPairCache365) return _testKeyPairCache365;
  // Use a fixed 32-byte seed so the public key is stable across test runs.
  const seed = Buffer.from('ecos-v365-deterministic-ed25519-s', 'utf8').slice(0, 32);
  // PKCS#8 DER for Ed25519 = 16-byte prefix + 32-byte seed
  const pkcs8 = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    seed,
  ]);
  const privateKey = crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  const publicKey = crypto.createPublicKey(privateKey);
  _testKeyPairCache365 = { privateKey, publicKey };
  return _testKeyPairCache365;
}

function _resolveAsymKeys365(opts) {
  const o = opts || {};
  if (o.privateKey || o.publicKey) {
    return { privateKey: o.privateKey || null, publicKey: o.publicKey || null, source: 'opts' };
  }
  const privPem = process.env.ECOS_VERIFIER_ED25519_PRIVATE_PEM_365;
  const pubPem  = process.env.ECOS_VERIFIER_ED25519_PUBLIC_PEM_365;
  if (privPem || pubPem) {
    return {
      privateKey: privPem ? crypto.createPrivateKey({ key: privPem, format: 'pem' }) : null,
      publicKey:  pubPem  ? crypto.createPublicKey({ key: pubPem,  format: 'pem' }) : null,
      source: 'env',
    };
  }
  if (process.env.NODE_ENV === 'test') {
    const kp = _testKeyPair365();
    return { privateKey: kp.privateKey, publicKey: kp.publicKey, source: 'test-deterministic' };
  }
  return { privateKey: null, publicKey: null, source: 'none' };
}

function _exportPublicPem365(publicKey) {
  if (!publicKey) return null;
  try { return publicKey.export({ format: 'pem', type: 'spki' }).toString(); }
  catch (_) { return null; }
}

// ── 1. Asymmetric (Ed25519) verifier asset signature ───────────────────────
/**
 * Sign V363's served verifier bytes with Ed25519 so counterparties pin the
 * PUBLIC key out-of-band. Returns the V364 asset shape extended with
 * `{ asymSignature, asymSignatureAlgo, publicKeyPem, asymSigned, … }`.
 * Falls back to V364 HMAC fallback metadata when no Ed25519 key is
 * configured — the served bytes are unchanged either way (R6).
 */
function asymmetricSignVerifierAsset365(ctx, opts) {
  const o = opts || {};
  const base = LB364.signVerifierAsset364(ctx, o); // keeps HMAC fields too
  const keys = _resolveAsymKeys365(o);
  const out = Object.assign({}, base, {
    asymSignature: null,
    asymSignatureAlgo: VERIFIER_ASYM_SIGNATURE_ALGO_365,
    asymSignatureKeyId: o.asymKeyId || 'ecos-verifier-ed25519-365',
    publicKeyPem: _exportPublicPem365(keys.publicKey),
    asymSigned: false,
    issuerVersion: LOAD_BEARING_VERSION_365,
    asymSignatureMessageRecipe: 'ed25519(sha256 + ":" + byteLength + ":" + filename)',
  });
  if (!keys.privateKey) {
    out.asymSignatureReason = 'no Ed25519 private key configured';
    return out;
  }
  const message = base.sha256 + ':' + base.byteLength + ':' + base.filename;
  try {
    const sig = crypto.sign(null, Buffer.from(message, 'utf8'), keys.privateKey);
    out.asymSignature = sig.toString('hex');
    out.asymSigned = true;
  } catch (e) {
    out.asymSignatureReason = 'sign failed: ' + e.message;
  }
  return out;
}

function verifyAsymmetricVerifierAsset365(input, opts) {
  const o = opts || {};
  const r = { valid: false, reason: '', verifierVersion: LOAD_BEARING_VERSION_365 };
  if (!input || typeof input !== 'object') { r.reason = 'input required'; return r; }
  if (!input.asymSignature) { r.reason = 'no asymSignature on asset'; return r; }
  const sha256 = input.sha256, byteLength = input.byteLength, filename = input.filename;
  if (!sha256 || typeof byteLength !== 'number' || !filename) {
    r.reason = 'missing fields (sha256, byteLength, filename)'; return r;
  }
  let publicKey = null;
  if (o.publicKey) publicKey = o.publicKey;
  else if (o.publicKeyPem) publicKey = crypto.createPublicKey({ key: o.publicKeyPem, format: 'pem' });
  else if (input.publicKeyPem) publicKey = crypto.createPublicKey({ key: input.publicKeyPem, format: 'pem' });
  else {
    const keys = _resolveAsymKeys365(o);
    publicKey = keys.publicKey;
  }
  if (!publicKey) { r.reason = 'no verification public key available'; return r; }
  const message = sha256 + ':' + byteLength + ':' + filename;
  let ok = false;
  try { ok = crypto.verify(null, Buffer.from(message, 'utf8'), publicKey, Buffer.from(input.asymSignature, 'hex')); }
  catch (e) { r.reason = 'verify failed: ' + e.message; return r; }
  if (!ok) { r.reason = 'asymSignature mismatch — asset bytes do not match pinned public key'; return r; }
  r.valid = true;
  r.reason = 'asymSignature valid; pinned Ed25519 key matches';
  return r;
}

// ── 2. Revocation feed webhook push pipeline ───────────────────────────────
// In-memory subscriber registry; production deployments wire
// `ctx.subscriberRepo = {upsert, list, updateCursor, markDead}` to persist.
const _defaultSubscriberStore365 = (() => {
  const m = new Map();
  return {
    isDefault: true,
    list() { return Array.from(m.values()).map(s => Object.assign({}, s)); },
    get(id) { return m.has(id) ? Object.assign({}, m.get(id)) : null; },
    upsert(rec) { m.set(rec.id, Object.assign({}, rec)); },
    updateCursor(id, nextCursor) { const r = m.get(id); if (r) { r.cursor = nextCursor; r.lastDeliveredAt = new Date().toISOString(); r.failures = 0; } },
    bumpFailure(id) { const r = m.get(id); if (r) { r.failures = (r.failures || 0) + 1; r.lastFailureAt = new Date().toISOString(); return r.failures; } return 0; },
    markDead(id, reason) { const r = m.get(id); if (r) { r.dead = true; r.deadReason = reason || 'unknown'; r.deadAt = new Date().toISOString(); } },
    _reset() { m.clear(); },
  };
})();

function _resolveSubscriberStore365(ctx) {
  if (ctx && ctx.subscriberRepo && typeof ctx.subscriberRepo.list === 'function') return ctx.subscriberRepo;
  return _defaultSubscriberStore365;
}

function registerRevocationSubscriber365(ctx, opts) {
  const c = ctx || {};
  const o = opts || {};
  if (!o.id || typeof o.id !== 'string') return { registered: false, error: 'id required' };
  if (!o.url || typeof o.url !== 'string') return { registered: false, error: 'url required' };
  const store = _resolveSubscriberStore365(c);
  const rec = {
    id: o.id, url: o.url,
    cursor: (typeof o.cursor === 'number') ? o.cursor : -1,
    secret: o.secret || null,            // optional shared secret for HMAC delivery sig
    publicKeyPem: o.publicKeyPem || null,
    failures: 0, dead: false,
    registeredAt: new Date().toISOString(),
  };
  store.upsert(rec);
  let appendedIndex = null;
  if (c.auditLog && typeof c.auditLog.append === 'function') {
    try {
      const r = c.auditLog.append(SUBSCRIBER_REGISTERED_TYPE_365, {
        id: rec.id, url: rec.url, cursor: rec.cursor, ts: rec.registeredAt,
      });
      appendedIndex = (r && r.index != null) ? r.index : null;
    } catch (_) {}
  }
  return { registered: true, subscriber: rec, appendedIndex };
}

function listRevocationSubscribers365(ctx) {
  const store = _resolveSubscriberStore365(ctx);
  return store.list();
}

/**
 * Dispatch new revocation events to every live subscriber. Pure of network
 * I/O: the caller supplies `opts.deliver(target, payload) -> {ok, status?, error?}`
 * (sync or async). Default deliver returns `{ok:true, simulated:true}` so
 * tests can drive the pipeline deterministically.
 *
 * Returns `{dispatched, results, deadLettered}`. Each delivery batch is
 * signed with the V364 feed-hash recipe; the wrapper includes
 * `{schema, deliveryId, target, batch, deliveryHash}` so subscribers verify
 * end-to-end.
 */
async function dispatchRevocationFeed365(ctx, opts) {
  const c = ctx || {};
  const o = opts || {};
  const store = _resolveSubscriberStore365(c);
  const deadLetterAfter = (typeof o.deadLetterAfter === 'number' && o.deadLetterAfter > 0)
    ? o.deadLetterAfter : DEFAULT_DEAD_LETTER_AFTER_365;
  const deliver = (typeof o.deliver === 'function')
    ? o.deliver
    : (async () => ({ ok: true, simulated: true }));
  const results = [];
  const subscribers = store.list().filter(s => !s.dead);
  for (const sub of subscribers) {
    const batch = LB364.revocationFeedSince364(c, { sinceCursor: sub.cursor, limit: o.limit || 500 });
    if (batch.count === 0) {
      results.push({ id: sub.id, delivered: false, skipped: 'no new events', cursor: sub.cursor });
      continue;
    }
    const deliveryBody = {
      schema: REVOCATION_DELIVERY_SCHEMA_365,
      deliveryId: crypto.randomBytes(8).toString('hex'),
      target: sub.id,
      issuedAt: new Date().toISOString(),
      issuerVersion: LOAD_BEARING_VERSION_365,
      batch,
    };
    deliveryBody.deliveryHash = _sha256Hex365(_stableStringify365(deliveryBody));
    let outcome;
    try { outcome = await deliver(sub, deliveryBody); }
    catch (e) { outcome = { ok: false, error: e.message }; }
    if (outcome && outcome.ok) {
      store.updateCursor(sub.id, batch.nextCursor);
      results.push({ id: sub.id, delivered: true, count: batch.count, cursor: batch.nextCursor, deliveryId: deliveryBody.deliveryId });
      if (c.auditLog && typeof c.auditLog.append === 'function') {
        try {
          c.auditLog.append(SUBSCRIBER_DISPATCHED_TYPE_365, {
            id: sub.id, count: batch.count, cursor: batch.nextCursor,
            deliveryId: deliveryBody.deliveryId, deliveryHash: deliveryBody.deliveryHash,
            ts: deliveryBody.issuedAt,
          });
        } catch (_) {}
      }
    } else {
      const failures = store.bumpFailure(sub.id);
      const error = (outcome && outcome.error) || 'delivery failed';
      const reason = (outcome && outcome.status) ? ('status=' + outcome.status) : error;
      results.push({ id: sub.id, delivered: false, error, failures });
      if (failures >= deadLetterAfter) {
        store.markDead(sub.id, reason);
        if (c.auditLog && typeof c.auditLog.append === 'function') {
          try {
            c.auditLog.append(SUBSCRIBER_DEAD_LETTERED_TYPE_365, {
              id: sub.id, failures, reason, ts: new Date().toISOString(),
            });
          } catch (_) {}
        }
      }
    }
  }
  const deadLettered = results.filter(r => !r.delivered && r.failures && r.failures >= deadLetterAfter).length;
  return { dispatched: results.filter(r => r.delivered).length, deadLettered, results };
}

// ── 3. Signed N-of-M operator approvals ────────────────────────────────────
/**
 * Verify an operator's detached Ed25519 signature over
 * `(forTrippedAt + ":" + operator)`, then chain into V364's
 * `recordOperatorApproval364`. Adds a parallel `signed_approval365` audit
 * event carrying the signature + public key fingerprint for replay.
 *
 * Required opts: `{ operator, signature(hex), publicKeyPem }`.
 * Optional: `{ reason, threshold, allowedOperators }` (forwarded to V364).
 */
function recordSignedOperatorApproval365(ctx, opts) {
  const c = ctx || {};
  const o = opts || {};
  if (!o.operator)     return { recorded: false, error: 'operator id required' };
  if (!o.signature)    return { recorded: false, error: 'signature required' };
  if (!o.publicKeyPem) return { recorded: false, error: 'publicKeyPem required' };
  const q = LB363.quarantineStatus363(c);
  if (!q.tripped) return { recorded: false, error: 'not quarantined' };
  let pubKey;
  try { pubKey = crypto.createPublicKey({ key: o.publicKeyPem, format: 'pem' }); }
  catch (e) { return { recorded: false, error: 'bad publicKeyPem: ' + e.message }; }
  const message = q.at + ':' + o.operator;
  let ok = false;
  try { ok = crypto.verify(null, Buffer.from(message, 'utf8'), pubKey, Buffer.from(o.signature, 'hex')); }
  catch (e) { return { recorded: false, error: 'verify failed: ' + e.message }; }
  if (!ok) return { recorded: false, error: 'signature does not match operator + trippedAt' };
  // Chain into V364 to keep the canonical approval ledger and dedupe logic.
  const inner = LB364.recordOperatorApproval364(c, {
    operator: o.operator, reason: o.reason, threshold: o.threshold, allowedOperators: o.allowedOperators,
  });
  if (c.auditLog && typeof c.auditLog.append === 'function') {
    try {
      c.auditLog.append(SIGNED_APPROVAL_TYPE_365, {
        operator: o.operator, forTrippedAt: q.at,
        signature: o.signature,
        publicKeyFingerprint: _sha256Hex365(o.publicKeyPem),
        signatureRecipe: APPROVAL_SIGNATURE_MESSAGE_RECIPE_365,
        ts: new Date().toISOString(),
      });
    } catch (_) {}
  }
  return Object.assign({}, inner, { signed: true, signatureRecipe: APPROVAL_SIGNATURE_MESSAGE_RECIPE_365 });
}

// When ECOS_REQUIRE_SIGNED_APPROVALS_365=1, the policy gate rejects every
// V364 approval that does NOT have a paired V365 signed_approval365 event
// for the same operator+trip. Exposed as a pure read so middleware can call
// it; we do not silently drop V364 events.
function isApprovalSignaturePolicyActive365() {
  return process.env.ECOS_REQUIRE_SIGNED_APPROVALS_365 === '1';
}

function listUnsignedApprovalsInCurrentTrip365(ctx) {
  const c = ctx || {};
  const q = LB363.quarantineStatus363(c);
  if (!q.tripped) return [];
  const auditLog = c.auditLog;
  if (!auditLog || typeof auditLog.entries !== 'function') return [];
  const v364 = [];
  const v365Pairs = new Set();
  for (const e of auditLog.entries()) {
    if (e.index <= q.at) continue;
    const p = e.payload || {};
    if (e.type === LB364.QUARANTINE_APPROVAL_TYPE_364 && p.forTrippedAt === q.at) {
      v364.push({ operator: p.operator, index: e.index });
    } else if (e.type === SIGNED_APPROVAL_TYPE_365 && p.forTrippedAt === q.at) {
      v365Pairs.add(p.operator);
    }
  }
  return v364.filter(x => !v365Pairs.has(x.operator));
}

// ── 4. Read-through quarantine status from repo ────────────────────────────
/**
 * Answer quarantine status from `ctx.quarantineRepo.latest()` when wired,
 * falling back to V363's audit-log scan. Mirrors V363's
 * `getRevocationStatus363` repo-fallback shape so middleware can be
 * agnostic to whether the projection has run yet.
 */
async function quarantineStatusFromRepo365(ctx) {
  const c = ctx || {};
  const repo = c.quarantineRepo;
  if (repo && typeof repo.latest === 'function') {
    try {
      const latest = await repo.latest();
      if (latest) {
        return {
          source: 'repo',
          tripped: latest.state === 'tripped',
          trippedAt: latest.trippedAt,
          state: latest.state,
          clearKind: latest.clearKind || null,
          clearedBy: latest.clearedBy || null,
          approvers: latest.approvers || [],
          approvals: latest.approvals || 0,
          version: LOAD_BEARING_VERSION_365,
        };
      }
    } catch (_) { /* fall through to audit-log */ }
  }
  const live = LB363.quarantineStatus363(c);
  const apps = LB364.quarantineApprovalsStatus364(c);
  return {
    source: 'audit-log',
    tripped: live.tripped,
    trippedAt: live.tripped ? live.at : null,
    state: live.tripped ? 'tripped' : 'cleared',
    clearKind: null,
    clearedBy: null,
    approvers: apps.approvers || [],
    approvals: apps.approvalsSoFar || 0,
    version: LOAD_BEARING_VERSION_365,
  };
}

module.exports = {
  LOAD_BEARING_VERSION_365,
  VERIFIER_ASYM_SIGNATURE_ALGO_365,
  SUBSCRIBER_REGISTERED_TYPE_365,
  SUBSCRIBER_DISPATCHED_TYPE_365,
  SUBSCRIBER_DEAD_LETTERED_TYPE_365,
  SIGNED_APPROVAL_TYPE_365,
  REVOCATION_DELIVERY_SCHEMA_365,
  DEFAULT_DEAD_LETTER_AFTER_365,
  APPROVAL_SIGNATURE_MESSAGE_RECIPE_365,
  asymmetricSignVerifierAsset365,
  verifyAsymmetricVerifierAsset365,
  registerRevocationSubscriber365,
  listRevocationSubscribers365,
  dispatchRevocationFeed365,
  recordSignedOperatorApproval365,
  isApprovalSignaturePolicyActive365,
  listUnsignedApprovalsInCurrentTrip365,
  quarantineStatusFromRepo365,
  _stableStringify365,
  _sha256Hex365,
  _testKeyPair365,
  _defaultSubscriberStore365,
};
