'use strict';
/**
 * lib/economicIntegrityLoadBearing368.js — ECOS V368 (Phase P256)
 *
 * STRATEGIC THESIS — Close the V367 federated trust surface along four
 * leverage points the V367 hand-off identified:
 *
 *   1. Persistent delivery replay cache
 *        createPersistentDeliveryReplayCache368 + the in-tree
 *        `db/deliveryReplayCacheRepo368.js` file-backed nonce store mean
 *        the V367 single-use nonce guarantee now survives process
 *        restart. `signedDispatchRevocationFeedWithPersistentGuard368`
 *        is a thin wrapper that records each dispatched nonce into the
 *        repo so subscribers can detect cross-restart replays.
 *
 *   2. Signed subscriber repo attestation
 *        signSubscriberRepoIntegrity368 HMACs the V367
 *        repoIntegrityHash with `ECOS_REPO_INTEGRITY_HMAC_KEY_368` (or a
 *        per-call key) and exposes the canonical signed envelope.
 *        verifySignedSubscriberRepoIntegrity368 is the
 *        counterparty-side check.
 *
 *   3. Verifier key pre-warm scheduler
 *        verifierKeyPreWarmStatus368 inspects the V366 manifest and
 *        reports whether the active key falls inside
 *        `preWarmWindowMs368` (default 24h). emitVerifierKeyPreWarm368
 *        appends a single `verifier.keys.prewarm_signal368` event per
 *        unique active key so operators are warned BEFORE V367's
 *        rotation scheduler fires.
 *
 *   4. Break-glass rolling quota
 *        enforceBreakGlassQuota368 wraps V367
 *        enforceBreakGlassCooldown367 and additionally refuses if the
 *        number of successful break-glass clears in the trailing
 *        `quotaWindowMs368` (default 24h) is already `>=
 *        maxClearsPerWindow368` (default 3). Emits
 *        `break_glass.quota_blocked368` on refusal.
 *
 * Pure + dependency-free (R3 — Node built-ins only). Every public
 * identifier ends with 368 (R2). Sacred files untouched (R1).
 * V361..V367 contracts preserved (R6).
 *
 * @version 368.0.0
 */

const crypto = require('crypto');

const LB367 = require('./economicIntegrityLoadBearing367.js');
const LB366 = require('./economicIntegrityLoadBearing366.js');
const LB365 = require('./economicIntegrityLoadBearing365.js');

const LOAD_BEARING_VERSION_368                    = '368.0.0';
const PERSISTENT_REPLAY_CACHE_SCHEMA_368          = 'ecos.integrity.delivery.replay/v368';
const SIGNED_REPO_INTEGRITY_SCHEMA_368            = 'ecos.integrity.subscribers.repo.signed/v368';
const SIGNED_REPO_INTEGRITY_ALGO_368              = 'hmac-sha256';
const VERIFIER_PREWARM_TYPE_368                   = 'integrity.verifier.keys.prewarm_signal368';
const BREAK_GLASS_QUOTA_BLOCKED_TYPE_368          = 'integrity.break_glass.quota_blocked368';
const PERSISTENT_REPLAY_RECORDED_TYPE_368         = 'integrity.revocation.feed.replay_persisted368';
const BREAK_GLASS_CLEARED_TYPES_368               = Object.freeze([
  'integrity.quarantine.break_glass_cleared364',
  'integrity.quarantine.break_glass_cleared',
]);
const DEFAULT_PERSISTENT_REPLAY_CACHE_SIZE_368    = 8192;
const DEFAULT_PREWARM_WINDOW_MS_368               = 24 * 60 * 60 * 1000;
const DEFAULT_QUOTA_WINDOW_MS_368                 = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_CLEARS_PER_WINDOW_368           = 3;

// ── helpers (canonical recipe — identical shape across versions) ──────────
function _stableStringify368(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(_stableStringify368).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + _stableStringify368(value[k])).join(',') + '}';
}
function _sha256Hex368(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}
function _hmacSha256Hex368(secret, message) {
  return crypto.createHmac('sha256', String(secret)).update(message, 'utf8').digest('hex');
}
function _timingSafeEqHex368(aHex, bHex) {
  if (typeof aHex !== 'string' || typeof bHex !== 'string') return false;
  if (aHex.length !== bHex.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(aHex, 'hex'), Buffer.from(bHex, 'hex')); }
  catch (_) { return false; }
}

// ── 1. Persistent delivery replay cache ───────────────────────────────────
/**
 * Wraps the V367 in-memory LRU replay cache around a durable repo
 * (`ctx.deliveryReplayRepo` or `opts.repo`). On `add` the nonce is
 * persisted; on `has` the repo is consulted before the memory layer.
 * If no repo is supplied the cache degrades to the V367 in-memory
 * behaviour (parity).
 */
function createPersistentDeliveryReplayCache368(opts) {
  const o = opts || {};
  const memory = LB367.createDeliveryReplayCache367({
    maxSize: (typeof o.maxSize === 'number' && o.maxSize > 0)
      ? o.maxSize : DEFAULT_PERSISTENT_REPLAY_CACHE_SIZE_368,
  });
  const repo = o.repo || null;
  return {
    schema: PERSISTENT_REPLAY_CACHE_SCHEMA_368,
    persistent: !!repo,
    has(nonce) {
      if (repo && typeof repo.has === 'function' && repo.has(String(nonce))) return true;
      return memory.has(nonce);
    },
    add(nonce) {
      const added = memory.add(nonce);
      if (added && repo && typeof repo.add === 'function') {
        try { repo.add(String(nonce)); } catch (_) {}
      }
      return added;
    },
    size() { return memory.size(); },
  };
}

/**
 * V367 dispatch + record each minted nonce into the persistent repo.
 * Result envelope mirrors V367 but adds `persistentReplayGuard368:true`.
 */
async function signedDispatchRevocationFeedWithPersistentGuard368(ctx, opts) {
  const c = ctx || {};
  const o = opts || {};
  const repo = (o.deliveryReplayRepo) || c.deliveryReplayRepo || null;
  const userDeliver = (typeof o.deliver === 'function')
    ? o.deliver
    : (async () => ({ ok: true, simulated: true }));
  const recorded = [];
  const wrappedDeliver = async (sub, body, headers) => {
    const nonce = headers && headers[LB367.DELIVERY_NONCE_HEADER_367];
    if (nonce && repo && typeof repo.add === 'function') {
      try { repo.add(String(nonce)); recorded.push(nonce); } catch (_) {}
      if (c.auditLog && typeof c.auditLog.append === 'function') {
        try {
          c.auditLog.append(PERSISTENT_REPLAY_RECORDED_TYPE_368, {
            id: sub.id, deliveryId: body.deliveryId, nonce,
          });
        } catch (_) {}
      }
    }
    return userDeliver(sub, body, headers);
  };
  const base = await LB367.signedDispatchRevocationFeedWithReplayGuard367(
    c, Object.assign({}, o, { deliver: wrappedDeliver }));
  return Object.assign({}, base, {
    version: LOAD_BEARING_VERSION_368,
    persistentReplayGuard368: true,
    persistedNonces368: recorded,
    persistentRepoBacked368: !!repo,
  });
}

// ── 2. Signed subscriber repo attestation ─────────────────────────────────
function _repoIntegrityKey368(opts) {
  const o = opts || {};
  if (o.key) return String(o.key);
  const env = process.env.ECOS_REPO_INTEGRITY_HMAC_KEY_368;
  if (env) return String(env);
  return null;
}

/**
 * Sign the V367 `subscriberRepoIntegrity367` projection. Returns a
 * canonical envelope `{schema, algo, payload, signature, keyId?, ts}`
 * where `payload` is the V367 hash + count + ephemeral flag, and
 * `signature` is `hmac-sha256(_stableStringify(payload))`.
 */
function signSubscriberRepoIntegrity368(ctx, opts) {
  const c = ctx || {};
  const o = opts || {};
  const key = _repoIntegrityKey368(o);
  const integ = LB367.subscriberRepoIntegrity367(c);
  const now = (typeof o.now === 'number') ? o.now : Date.now();
  const payload = {
    repoIntegrityHash: integ.repoIntegrityHash,
    count: integ.count,
    ephemeral: !!integ.ephemeral,
    sourceSchema: integ.schema,
    ts: new Date(now).toISOString(),
  };
  const envelope = {
    schema: SIGNED_REPO_INTEGRITY_SCHEMA_368,
    algo: SIGNED_REPO_INTEGRITY_ALGO_368,
    payload,
    keyId: o.keyId || null,
    signature: null,
    signed: false,
  };
  if (!key) {
    envelope.error = 'missing repo integrity hmac key (ECOS_REPO_INTEGRITY_HMAC_KEY_368)';
    return envelope;
  }
  envelope.signature = _hmacSha256Hex368(key, _stableStringify368(payload));
  envelope.signed = true;
  return envelope;
}

/** Counterparty-side verifier. Pure. */
function verifySignedSubscriberRepoIntegrity368(envelope, opts) {
  const o = opts || {};
  const r = { valid: false, reason: '' };
  if (!envelope || typeof envelope !== 'object') { r.reason = 'envelope required'; return r; }
  if (envelope.schema !== SIGNED_REPO_INTEGRITY_SCHEMA_368) { r.reason = 'schema mismatch'; return r; }
  if (envelope.algo !== SIGNED_REPO_INTEGRITY_ALGO_368)     { r.reason = 'algo mismatch';   return r; }
  if (!envelope.signature || typeof envelope.signature !== 'string') { r.reason = 'signature required'; return r; }
  if (!envelope.payload || typeof envelope.payload !== 'object')     { r.reason = 'payload required';   return r; }
  const key = _repoIntegrityKey368(o);
  if (!key) { r.reason = 'verifier key unavailable'; return r; }
  const expected = _hmacSha256Hex368(key, _stableStringify368(envelope.payload));
  if (!_timingSafeEqHex368(expected, envelope.signature)) { r.reason = 'signature mismatch'; return r; }
  r.valid = true; r.reason = 'signed repo integrity valid';
  return r;
}

// ── 3. Verifier key pre-warm scheduler ────────────────────────────────────
function _preWarmWindowMs368(opts) {
  const o = opts || {};
  if (typeof o.preWarmWindowMs === 'number' && o.preWarmWindowMs >= 0) return o.preWarmWindowMs;
  const env = process.env.ECOS_VERIFIER_KEY_PREWARM_WINDOW_MS_368;
  if (env != null) {
    const n = Number(env);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return DEFAULT_PREWARM_WINDOW_MS_368;
}

/** Read-only pre-warm view. */
function verifierKeyPreWarmStatus368(ctx, opts) {
  const c = ctx || {};
  const o = opts || {};
  const now = (typeof o.now === 'number') ? o.now : Date.now();
  const window = _preWarmWindowMs368(o);
  const manifest = LB366.verifierKeyManifest366(c, o);
  const active = manifest.keys.find(k => k.status === 'active') || manifest.keys[0] || null;
  const activeExpiresMs = (active && active.notAfter) ? Date.parse(active.notAfter) : null;
  const expired = Number.isFinite(activeExpiresMs) ? (activeExpiresMs <= now) : false;
  const remaining = Number.isFinite(activeExpiresMs) ? (activeExpiresMs - now) : null;
  const preWarmActive = Number.isFinite(activeExpiresMs)
    ? (!expired && remaining <= window) : false;
  return {
    schema: 'ecos.integrity.verifier.prewarm/v368',
    manifestHash: manifest.manifestHash,
    activeKeyId: manifest.activeKeyId,
    activeExpiresAt: active ? (active.notAfter || null) : null,
    remainingMs: remaining,
    preWarmWindowMs: window,
    preWarmActive,
    expired,
  };
}

/**
 * Emit at most ONE `verifier.keys.prewarm_signal368` per unique
 * `(activeKeyId, manifestHash)` tuple within the audit log so operators
 * see exactly one warning before V367 rotation triggers.
 */
function emitVerifierKeyPreWarm368(ctx, opts) {
  const c = ctx || {};
  const status = verifierKeyPreWarmStatus368(c, opts);
  if (!status.preWarmActive) return { emitted: false, status };
  const log = c.auditLog;
  if (!log) return { emitted: false, status };
  // dedupe: scan existing entries
  let entries = [];
  try {
    if (typeof log.list === 'function') entries = log.list();
    else if (typeof log.toArray === 'function') entries = log.toArray();
    else if (Array.isArray(log.entries)) entries = log.entries;
    else if (Array.isArray(log._entries)) entries = log._entries;
  } catch (_) { entries = []; }
  const dup = entries.find(e =>
    e && e.type === VERIFIER_PREWARM_TYPE_368 &&
    e.payload && e.payload.activeKeyId === status.activeKeyId &&
    e.payload.manifestHash === status.manifestHash);
  if (dup) return { emitted: false, status, deduped: true };
  if (typeof log.append === 'function') {
    try {
      log.append(VERIFIER_PREWARM_TYPE_368, {
        activeKeyId: status.activeKeyId,
        manifestHash: status.manifestHash,
        remainingMs: status.remainingMs,
        preWarmWindowMs: status.preWarmWindowMs,
        ts: new Date((opts && opts.now) || Date.now()).toISOString(),
      });
    } catch (_) {}
  }
  return { emitted: true, status };
}

// ── 4. Break-glass rolling quota ──────────────────────────────────────────
function _quotaWindowMs368(opts) {
  const o = opts || {};
  if (typeof o.quotaWindowMs === 'number' && o.quotaWindowMs >= 0) return o.quotaWindowMs;
  const env = process.env.ECOS_BREAK_GLASS_QUOTA_WINDOW_MS_368;
  if (env != null) {
    const n = Number(env);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return DEFAULT_QUOTA_WINDOW_MS_368;
}
function _maxClearsPerWindow368(opts) {
  const o = opts || {};
  if (typeof o.maxClearsPerWindow === 'number' && o.maxClearsPerWindow >= 0) return o.maxClearsPerWindow;
  const env = process.env.ECOS_BREAK_GLASS_MAX_CLEARS_PER_WINDOW_368;
  if (env != null) {
    const n = Number(env);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return DEFAULT_MAX_CLEARS_PER_WINDOW_368;
}
function _breakGlassClearsInWindow368(ctx, sinceMs) {
  const c = ctx || {};
  const log = c.auditLog;
  if (!log) return [];
  let entries = [];
  try {
    if (typeof log.list === 'function') entries = log.list();
    else if (typeof log.toArray === 'function') entries = log.toArray();
    else if (Array.isArray(log.entries)) entries = log.entries;
    else if (Array.isArray(log._entries)) entries = log._entries;
  } catch (_) { entries = []; }
  const out = [];
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    if (!BREAK_GLASS_CLEARED_TYPES_368.includes(e.type)) continue;
    const tsRaw = (e.payload && (e.payload.ts || e.payload.clearedAt)) || e.ts || null;
    const ms = tsRaw ? Date.parse(tsRaw) : null;
    if (Number.isFinite(ms) && ms >= sinceMs) out.push({ ms, entry: e });
  }
  return out;
}

/**
 * Wrap V367 enforceBreakGlassCooldown367 with a rolling-window quota.
 * If `>= maxClearsPerWindow368` successful break-glass events landed in
 * the trailing window, refuse and emit `break_glass.quota_blocked368`.
 */
function enforceBreakGlassQuota368(ctx, opts) {
  const c = ctx || {};
  const o = opts || {};
  const now = (typeof o.now === 'number') ? o.now : Date.now();
  const windowMs = _quotaWindowMs368(o);
  const maxClears = _maxClearsPerWindow368(o);
  const since = now - windowMs;
  const inWindow = _breakGlassClearsInWindow368(c, since);
  if (inWindow.length >= maxClears) {
    const blockedAt = new Date(now).toISOString();
    if (c.auditLog && typeof c.auditLog.append === 'function') {
      try {
        c.auditLog.append(BREAK_GLASS_QUOTA_BLOCKED_TYPE_368, {
          policy: 'break-glass-quota-368',
          quotaWindowMs: windowMs,
          maxClearsPerWindow: maxClears,
          clearsInWindow: inWindow.length,
          reason: o.reason || null,
          ts: blockedAt,
        });
      } catch (_) {}
    }
    return {
      cleared: false,
      policy: 'break-glass-quota-368',
      quota368: true,
      blocked368: true,
      quotaWindowMs: windowMs,
      maxClearsPerWindow: maxClears,
      clearsInWindow: inWindow.length,
      error: 'break-glass blocked: rolling quota exhausted',
      ts: blockedAt,
    };
  }
  const inner = LB367.enforceBreakGlassCooldown367(c, o);
  return Object.assign({}, inner, {
    quota368: true,
    blocked368: false,
    quotaWindowMs: windowMs,
    maxClearsPerWindow: maxClears,
    clearsInWindow: inWindow.length,
  });
}

module.exports = {
  LOAD_BEARING_VERSION_368,
  PERSISTENT_REPLAY_CACHE_SCHEMA_368,
  SIGNED_REPO_INTEGRITY_SCHEMA_368,
  SIGNED_REPO_INTEGRITY_ALGO_368,
  VERIFIER_PREWARM_TYPE_368,
  BREAK_GLASS_QUOTA_BLOCKED_TYPE_368,
  PERSISTENT_REPLAY_RECORDED_TYPE_368,
  DEFAULT_PERSISTENT_REPLAY_CACHE_SIZE_368,
  DEFAULT_PREWARM_WINDOW_MS_368,
  DEFAULT_QUOTA_WINDOW_MS_368,
  DEFAULT_MAX_CLEARS_PER_WINDOW_368,
  createPersistentDeliveryReplayCache368,
  signedDispatchRevocationFeedWithPersistentGuard368,
  signSubscriberRepoIntegrity368,
  verifySignedSubscriberRepoIntegrity368,
  verifierKeyPreWarmStatus368,
  emitVerifierKeyPreWarm368,
  enforceBreakGlassQuota368,
  _stableStringify368,
  _sha256Hex368,
  _hmacSha256Hex368,
};
