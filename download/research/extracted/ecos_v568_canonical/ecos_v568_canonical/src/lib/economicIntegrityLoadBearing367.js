'use strict';
/**
 * lib/economicIntegrityLoadBearing367.js — ECOS V367 (Phase P255)
 *
 * STRATEGIC THESIS — Close the V366 federated trust surface along four
 * leverage points the V366 hand-off identified:
 *
 *   1. Delivery replay protection
 *        signedDispatchRevocationFeedWithReplayGuard367 binds a per-push
 *        nonce + timestamp INTO the HMAC (and surfaces them as
 *        `X-Ecos-Delivery-Nonce` / `X-Ecos-Delivery-Timestamp`).
 *        Subscriber-side verifyDeliveryWithReplayGuard367 + the
 *        createDeliveryReplayCache367 LRU rejects replayed pushes and
 *        stale stamps outside `maxAgeMs367`.
 *
 *   2. Subscriber repo content-integrity attestation
 *        subscriberRepoIntegrity367 + verifyRepoIntegrity367 produce a
 *        sha256 over a canonical projection of the V366 persistent repo
 *        so operators can detect tampering at rest.
 *
 *   3. Verifier key rotation scheduler
 *        advanceVerifierKeyRotation367 advances activeKeyId past any
 *        `notAfter` boundary using the V366 manifest + history, emits a
 *        `verifier.keys.rotated367` audit event, and exposes
 *        rotationStatus367 (manifestHash, expiringWithinMs, etc.).
 *
 *   4. Break-glass cooldown
 *        enforceBreakGlassCooldown367 wraps V366
 *        enforceBreakGlassApprovalPolicy366 and additionally refuses if a
 *        prior successful break-glass landed within
 *        `ECOS_BREAK_GLASS_COOLDOWN_MS_367` (default 1h). Emits
 *        `break_glass.cooldown_blocked367` on refusal.
 *
 * Pure + dependency-free (R3 — Node built-ins only). Every public
 * identifier ends with 367 (R2). Sacred files untouched (R1).
 * V361..V366 contracts preserved (R6).
 *
 * @version 367.0.0
 */

const crypto = require('crypto');

const LB366 = require('./economicIntegrityLoadBearing366.js');
const LB365 = require('./economicIntegrityLoadBearing365.js');
const LB364 = require('./economicIntegrityLoadBearing364.js');

const LOAD_BEARING_VERSION_367              = '367.0.0';
const DELIVERY_NONCE_HEADER_367             = 'x-ecos-delivery-nonce';
const DELIVERY_TIMESTAMP_HEADER_367         = 'x-ecos-delivery-timestamp';
const DELIVERY_REPLAY_GUARD_ALGO_367        = 'hmac-sha256+nonce+ts';
const DELIVERY_REPLAY_GUARD_DISPATCHED_367  = 'integrity.revocation.feed.replay_guard_dispatched367';
const SUBSCRIBER_REPO_INTEGRITY_SCHEMA_367  = 'ecos.integrity.subscribers.repo/v367';
const VERIFIER_KEYS_ROTATED_TYPE_367        = 'integrity.verifier.keys.rotated367';
const BREAK_GLASS_COOLDOWN_BLOCKED_TYPE_367 = 'integrity.break_glass.cooldown_blocked367';
const BREAK_GLASS_CLEARED_TYPES_367         = Object.freeze([
  'integrity.quarantine.break_glass_cleared364',
  'integrity.quarantine.break_glass_cleared',
]);
const DEFAULT_REPLAY_MAX_AGE_MS_367         = 5 * 60 * 1000;
const DEFAULT_REPLAY_CACHE_SIZE_367         = 4096;
const DEFAULT_BREAK_GLASS_COOLDOWN_MS_367   = 60 * 60 * 1000;

// ── helpers (canonical recipe — identical to V362..V366) ──────────────────
function _stableStringify367(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(_stableStringify367).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + _stableStringify367(value[k])).join(',') + '}';
}
function _sha256Hex367(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}
function _hmacSha256Hex367(secret, message) {
  return crypto.createHmac('sha256', String(secret)).update(message, 'utf8').digest('hex');
}
function _timingSafeEqHex367(aHex, bHex) {
  if (typeof aHex !== 'string' || typeof bHex !== 'string') return false;
  if (aHex.length !== bHex.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(aHex, 'hex'), Buffer.from(bHex, 'hex')); }
  catch (_) { return false; }
}
function _newNonce367() { return crypto.randomBytes(16).toString('hex'); }
function _replayMessage367(body, nonce, ts) {
  return _stableStringify367(body) + '|' + String(nonce) + '|' + String(ts);
}

// ── 1. Delivery replay protection ─────────────────────────────────────────
/**
 * Wraps V366's `signedDispatchRevocationFeed366` and binds a per-push
 * nonce + ISO timestamp INTO the HMAC. The wrapper computes the V367
 * signature over `stableStringify(body)|nonce|ts` and surfaces:
 *   X-Ecos-Delivery-Signature   (already from V366 — recomputed here)
 *   X-Ecos-Delivery-Nonce       (V367)
 *   X-Ecos-Delivery-Timestamp   (V367)
 *   X-Ecos-Delivery-Algo        = 'hmac-sha256+nonce+ts'
 *
 * Subscribers without a `secret` keep the V366 unsigned envelope unchanged.
 */
async function signedDispatchRevocationFeedWithReplayGuard367(ctx, opts) {
  const c = ctx || {};
  const o = opts || {};
  const userDeliver = (typeof o.deliver === 'function')
    ? o.deliver
    : (async () => ({ ok: true, simulated: true }));
  const nowMs = (typeof o.now === 'number') ? o.now : Date.now();
  const meta = [];
  const wrappedDeliver = async (sub, body) => {
    const headers = {};
    let signed = false, nonce = null, ts = null, signatureHex = null;
    if (sub && sub.secret) {
      nonce = _newNonce367();
      ts = new Date(nowMs).toISOString();
      signatureHex = _hmacSha256Hex367(sub.secret, _replayMessage367(body, nonce, ts));
      headers[LB366.DELIVERY_SIGNATURE_HEADER_366] = signatureHex;
      headers['x-ecos-delivery-algo']              = DELIVERY_REPLAY_GUARD_ALGO_367;
      headers[DELIVERY_NONCE_HEADER_367]           = nonce;
      headers[DELIVERY_TIMESTAMP_HEADER_367]       = ts;
      headers['x-ecos-delivery-id']                = body.deliveryId;
      signed = true;
      if (c.auditLog && typeof c.auditLog.append === 'function') {
        try {
          c.auditLog.append(DELIVERY_REPLAY_GUARD_DISPATCHED_367, {
            id: sub.id, deliveryId: body.deliveryId,
            algo: DELIVERY_REPLAY_GUARD_ALGO_367, nonce, ts,
            signature: signatureHex,
          });
        } catch (_) {}
      }
    }
    meta.push({ id: sub.id, signed, signatureHex, nonce, ts });
    return userDeliver(sub, body, headers);
  };
  // Reuse V365 base dispatcher directly so V366 audit event is not duplicated.
  const base = await LB365.dispatchRevocationFeed365(c, Object.assign({}, o, { deliver: wrappedDeliver }));
  const byId = new Map(meta.map(m => [m.id, m]));
  const results = base.results.map(r => {
    const m = byId.get(r.id);
    if (!m) return Object.assign({}, r, { signed: false });
    return Object.assign({}, r, {
      signed: m.signed,
      deliverySignature: m.signed ? m.signatureHex : null,
      deliverySignatureAlgo: m.signed ? DELIVERY_REPLAY_GUARD_ALGO_367 : null,
      deliveryNonce: m.nonce,
      deliveryTimestamp: m.ts,
    });
  });
  return Object.assign({}, base, {
    results,
    version: LOAD_BEARING_VERSION_367,
    replayGuard367: true,
  });
}

/** In-memory LRU nonce cache. Subscribers use it to enforce single-use nonces. */
function createDeliveryReplayCache367(opts) {
  const o = opts || {};
  const maxSize = (typeof o.maxSize === 'number' && o.maxSize > 0) ? o.maxSize : DEFAULT_REPLAY_CACHE_SIZE_367;
  const order = [];
  const seen = new Map();
  return {
    has(nonce) { return seen.has(String(nonce)); },
    add(nonce) {
      const k = String(nonce);
      if (seen.has(k)) return false;
      seen.set(k, true); order.push(k);
      while (order.length > maxSize) seen.delete(order.shift());
      return true;
    },
    size() { return seen.size; },
    _reset() { order.length = 0; seen.clear(); },
  };
}

/**
 * Subscriber-side verifier with replay guard. Pure.
 * Inputs: body, secret, signature, nonce, timestamp, cache?, maxAgeMs?, now?.
 */
function verifyDeliveryWithReplayGuard367(input) {
  const r = { valid: false, reason: '', algo: DELIVERY_REPLAY_GUARD_ALGO_367 };
  const i = input || {};
  if (!i.body || typeof i.body !== 'object') { r.reason = 'body required'; return r; }
  if (!i.secret)                              { r.reason = 'secret required'; return r; }
  if (!i.signature || typeof i.signature !== 'string') { r.reason = 'signature required'; return r; }
  if (!i.nonce || typeof i.nonce !== 'string') { r.reason = 'nonce required'; return r; }
  if (!i.timestamp || typeof i.timestamp !== 'string') { r.reason = 'timestamp required'; return r; }
  const tsMs = Date.parse(i.timestamp);
  if (!Number.isFinite(tsMs)) { r.reason = 'timestamp unparseable'; return r; }
  const nowMs = (typeof i.now === 'number') ? i.now : Date.now();
  const maxAgeMs = (typeof i.maxAgeMs === 'number' && i.maxAgeMs > 0) ? i.maxAgeMs : DEFAULT_REPLAY_MAX_AGE_MS_367;
  if (Math.abs(nowMs - tsMs) > maxAgeMs) { r.reason = 'timestamp outside replay window'; return r; }
  const expected = _hmacSha256Hex367(i.secret, _replayMessage367(i.body, i.nonce, i.timestamp));
  if (!_timingSafeEqHex367(expected, i.signature)) { r.reason = 'delivery signature mismatch'; return r; }
  if (i.cache && typeof i.cache.has === 'function') {
    if (i.cache.has(i.nonce)) { r.reason = 'nonce replay detected'; return r; }
    if (typeof i.cache.add === 'function') i.cache.add(i.nonce);
  }
  r.valid = true; r.reason = 'delivery signature + replay guard valid';
  return r;
}

// ── 2. Subscriber repo content-integrity attestation ──────────────────────
/**
 * Compute a canonical sha256 over a stable projection of the V366
 * subscriber repo. Returns `{schema, count, repoIntegrityHash, snapshot}`.
 * Snapshot is omitted unless `opts.includeSnapshot === true`.
 */
function subscriberRepoIntegrity367(ctx, opts) {
  const c = ctx || {};
  const o = opts || {};
  const repo = c.subscriberRepo;
  if (!repo || typeof repo.list !== 'function') {
    return {
      schema: SUBSCRIBER_REPO_INTEGRITY_SCHEMA_367,
      count: 0, repoIntegrityHash: _sha256Hex367('[]'),
      snapshot: o.includeSnapshot ? [] : undefined,
      ephemeral: true,
    };
  }
  const list = repo.list();
  const projection = list
    .map(s => ({
      id: s.id, url: s.url || null, cursor: s.cursor || null,
      failures: s.failures || 0, dead: !!s.dead, deadReason: s.deadReason || null,
      hasSecret: !!s.secret, hasPublicKey: !!s.publicKeyPem,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0)));
  const repoIntegrityHash = _sha256Hex367(_stableStringify367({
    schema: SUBSCRIBER_REPO_INTEGRITY_SCHEMA_367, subscribers: projection,
  }));
  return {
    schema: SUBSCRIBER_REPO_INTEGRITY_SCHEMA_367,
    count: projection.length,
    repoIntegrityHash,
    ephemeral: !!repo.isEphemeral,
    filePath: repo.filePath || null,
    snapshot: o.includeSnapshot ? projection : undefined,
  };
}

/** Recompute and compare to a pinned hash. Pure. */
function verifyRepoIntegrity367(ctx, expectedHash) {
  const cur = subscriberRepoIntegrity367(ctx);
  return {
    valid: cur.repoIntegrityHash === expectedHash,
    actualHash: cur.repoIntegrityHash,
    expectedHash: expectedHash || null,
    count: cur.count,
  };
}

// ── 3. Verifier key rotation scheduler ────────────────────────────────────
/**
 * Given the V366 manifest, advance the active key when its `notAfter`
 * has passed. The first history entry with a still-future (or null)
 * `notAfter` becomes the new active key. Emits a
 * `verifier.keys.rotated367` audit event on rotation. Returns
 * `{rotated, before, after, manifest}`.
 */
function advanceVerifierKeyRotation367(ctx, opts) {
  const c = ctx || {};
  const o = opts || {};
  const now = (typeof o.now === 'number') ? o.now : Date.now();
  const manifest = LB366.verifierKeyManifest366(c, o);
  const active = manifest.keys.find(k => k.status === 'active') || manifest.keys[0];
  if (!active) return { rotated: false, before: null, after: null, manifest };
  const activeExpiresMs = active.notAfter ? Date.parse(active.notAfter) : null;
  const expired = Number.isFinite(activeExpiresMs) && activeExpiresMs <= now;
  if (!expired) return { rotated: false, before: active, after: active, manifest };
  const successor = manifest.keys.find(k => {
    if (k.keyId === active.keyId) return false;
    if (!k.notAfter) return true;
    const naMs = Date.parse(k.notAfter);
    return !Number.isFinite(naMs) || naMs > now;
  });
  if (!successor) return { rotated: false, before: active, after: active, manifest, error: 'no successor key available' };
  if (c.auditLog && typeof c.auditLog.append === 'function') {
    try {
      c.auditLog.append(VERIFIER_KEYS_ROTATED_TYPE_367, {
        from: active.keyId, to: successor.keyId,
        ts: new Date(now).toISOString(),
        manifestHash: manifest.manifestHash,
      });
    } catch (_) {}
  }
  return { rotated: true, before: active, after: successor, manifest };
}

/** Read-only rotation status — non-destructive view used by admin/summary. */
function rotationStatus367(ctx, opts) {
  const c = ctx || {};
  const o = opts || {};
  const now = (typeof o.now === 'number') ? o.now : Date.now();
  const manifest = LB366.verifierKeyManifest366(c, o);
  const active = manifest.keys.find(k => k.status === 'active') || manifest.keys[0];
  const activeExpiresMs = (active && active.notAfter) ? Date.parse(active.notAfter) : null;
  return {
    manifestHash: manifest.manifestHash,
    activeKeyId: manifest.activeKeyId,
    keyCount: manifest.keys.length,
    activeExpiresAt: active ? (active.notAfter || null) : null,
    expiringWithinMs: (Number.isFinite(activeExpiresMs)) ? (activeExpiresMs - now) : null,
    expired: Number.isFinite(activeExpiresMs) ? (activeExpiresMs <= now) : false,
  };
}

// ── 4. Break-glass cooldown ───────────────────────────────────────────────
function _cooldownMs367(opts) {
  const o = opts || {};
  if (typeof o.cooldownMs === 'number' && o.cooldownMs >= 0) return o.cooldownMs;
  const env = process.env.ECOS_BREAK_GLASS_COOLDOWN_MS_367;
  if (env != null) {
    const n = Number(env);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return DEFAULT_BREAK_GLASS_COOLDOWN_MS_367;
}
function _lastBreakGlassMs367(ctx) {
  const c = ctx || {};
  const log = c.auditLog;
  if (!log) return null;
  const types = BREAK_GLASS_CLEARED_TYPES_367;
  let entries = [];
  try {
    if (typeof log.list === 'function') entries = log.list();
    else if (typeof log.toArray === 'function') entries = log.toArray();
    else if (Array.isArray(log.entries)) entries = log.entries;
    else if (Array.isArray(log._entries)) entries = log._entries;
  } catch (_) { entries = []; }
  let latest = null;
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    if (!types.includes(e.type)) continue;
    const tsRaw = (e.payload && (e.payload.ts || e.payload.clearedAt)) || e.ts || null;
    const ms = tsRaw ? Date.parse(tsRaw) : null;
    if (Number.isFinite(ms) && (latest == null || ms > latest)) latest = ms;
  }
  return latest;
}

/**
 * Wrap V366 enforceBreakGlassApprovalPolicy366 with a cooldown:
 *   if a successful break-glass landed within `cooldownMs`, refuse and
 *   emit `break_glass.cooldown_blocked367`.
 */
function enforceBreakGlassCooldown367(ctx, opts) {
  const c = ctx || {};
  const o = opts || {};
  const now = (typeof o.now === 'number') ? o.now : Date.now();
  const cooldownMs = _cooldownMs367(o);
  const lastMs = _lastBreakGlassMs367(c);
  if (lastMs != null && (now - lastMs) < cooldownMs) {
    const remainingMs = cooldownMs - (now - lastMs);
    const blockedAt = new Date(now).toISOString();
    if (c.auditLog && typeof c.auditLog.append === 'function') {
      try {
        c.auditLog.append(BREAK_GLASS_COOLDOWN_BLOCKED_TYPE_367, {
          policy: 'break-glass-cooldown-367',
          cooldownMs, remainingMs,
          lastBreakGlassAt: new Date(lastMs).toISOString(),
          reason: o.reason || null, ts: blockedAt,
        });
      } catch (_) {}
    }
    return {
      cleared: false,
      policy: 'break-glass-cooldown-367',
      cooldown367: true,
      blocked367: true,
      cooldownMs, remainingMs,
      lastBreakGlassAt: new Date(lastMs).toISOString(),
      error: 'break-glass blocked: cooldown not elapsed',
      ts: blockedAt,
    };
  }
  const inner = LB366.enforceBreakGlassApprovalPolicy366(c, o);
  return Object.assign({}, inner, {
    cooldown367: true,
    blocked367: false,
    cooldownMs,
    lastBreakGlassAt: lastMs ? new Date(lastMs).toISOString() : null,
  });
}

module.exports = {
  LOAD_BEARING_VERSION_367,
  DELIVERY_NONCE_HEADER_367,
  DELIVERY_TIMESTAMP_HEADER_367,
  DELIVERY_REPLAY_GUARD_ALGO_367,
  DELIVERY_REPLAY_GUARD_DISPATCHED_367,
  SUBSCRIBER_REPO_INTEGRITY_SCHEMA_367,
  VERIFIER_KEYS_ROTATED_TYPE_367,
  BREAK_GLASS_COOLDOWN_BLOCKED_TYPE_367,
  DEFAULT_REPLAY_MAX_AGE_MS_367,
  DEFAULT_REPLAY_CACHE_SIZE_367,
  DEFAULT_BREAK_GLASS_COOLDOWN_MS_367,
  signedDispatchRevocationFeedWithReplayGuard367,
  verifyDeliveryWithReplayGuard367,
  createDeliveryReplayCache367,
  subscriberRepoIntegrity367,
  verifyRepoIntegrity367,
  advanceVerifierKeyRotation367,
  rotationStatus367,
  enforceBreakGlassCooldown367,
  _stableStringify367,
  _sha256Hex367,
  _hmacSha256Hex367,
  _replayMessage367,
};
