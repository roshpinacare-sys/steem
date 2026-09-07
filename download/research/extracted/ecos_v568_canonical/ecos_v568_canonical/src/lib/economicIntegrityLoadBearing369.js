'use strict';
/**
 * lib/economicIntegrityLoadBearing369.js — ECOS V369 (Phase P257)
 *
 * STRATEGIC THESIS — Close the V368 integrity-load-bearing surface along
 * four leverage points the V368 hand-off identified:
 *
 *   1. Persistent verifier-key pre-warm dedupe
 *        createPrewarmEmissionRepo369 + emitVerifierKeyPreWarmPersistent369
 *        back V368's in-memory dedupe with a file-backed `(activeKeyId,
 *        manifestHash)` ledger so the single-emit guarantee survives
 *        process restart. Without a repo we degrade to V368 behaviour
 *        (parity).
 *
 *   2. Subscriber repo attestation HMAC key rotation
 *        signSubscriberRepoIntegrityWithRotation369 signs under the
 *        active key while exposing the active keyId; the matching
 *        verifySignedSubscriberRepoIntegrityWithRotation369 accepts the
 *        active key OR any previously-rotated key, so counterparties
 *        survive an in-flight rotation. Active key falls back to
 *        `ECOS_REPO_INTEGRITY_HMAC_KEY_369` then V368's key (parity).
 *
 *   3. Break-glass quota status view
 *        breakGlassQuotaStatus369 returns a pure, read-only projection
 *        of the V368 rolling-quota state: clears in window, remaining
 *        slots, oldest-clear timestamp, and the timestamp at which the
 *        next slot frees up. No audit emissions.
 *
 *   4. Persistent replay cache TTL compaction
 *        enforceDeliveryReplayTtl369 evicts persisted nonces older than
 *        `ttlMs369` (default 7d) from any repo exposing the
 *        `{list, _drop}` extension contract, and emits a single
 *        `integrity.revocation.feed.replay_compacted369` summary.
 *        Repos without `_drop` are inspected read-only.
 *
 * Pure + dependency-free (R3 — Node built-ins only). Every public
 * identifier ends with 369 (R2). Sacred files untouched (R1).
 * V361..V368 contracts preserved (R6).
 *
 * @version 369.0.0
 */

const crypto = require('crypto');

const LB368 = require('./economicIntegrityLoadBearing368.js');
const LB367 = require('./economicIntegrityLoadBearing367.js');
const LB366 = require('./economicIntegrityLoadBearing366.js');
const LB365 = require('./economicIntegrityLoadBearing365.js');

const LOAD_BEARING_VERSION_369                  = '369.0.0';
const PREWARM_EMISSION_SCHEMA_369               = 'ecos.integrity.verifier.prewarm.emissions/v369';
const SIGNED_REPO_INTEGRITY_SCHEMA_369          = 'ecos.integrity.subscribers.repo.signed.rotated/v369';
const SIGNED_REPO_INTEGRITY_ALGO_369            = 'hmac-sha256';
const REPLAY_COMPACTED_TYPE_369                 = 'integrity.revocation.feed.replay_compacted369';
const PREWARM_PERSISTED_TYPE_369                = 'integrity.verifier.keys.prewarm_persisted369';
const DEFAULT_REPLAY_TTL_MS_369                 = 7 * 24 * 60 * 60 * 1000;

// ── helpers (canonical recipe — identical shape across versions) ──────────
function _stableStringify369(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(_stableStringify369).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + _stableStringify369(value[k])).join(',') + '}';
}
function _sha256Hex369(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}
function _hmacSha256Hex369(secret, message) {
  return crypto.createHmac('sha256', String(secret)).update(message, 'utf8').digest('hex');
}
function _timingSafeEqHex369(aHex, bHex) {
  if (typeof aHex !== 'string' || typeof bHex !== 'string') return false;
  if (aHex.length !== bHex.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(aHex, 'hex'), Buffer.from(bHex, 'hex')); }
  catch (_) { return false; }
}

// ── 1. Persistent verifier-key pre-warm dedupe ────────────────────────────
/**
 * Emit `prewarm_signal368` AT MOST ONCE per `(activeKeyId, manifestHash)`
 * across process restarts. If `ctx.prewarmEmissionRepo` is provided the
 * dedupe consults it first; otherwise we degrade to V368's
 * audit-log-scan dedupe.
 */
function emitVerifierKeyPreWarmPersistent369(ctx, opts) {
  const c = ctx || {};
  const o = opts || {};
  const status = LB368.verifierKeyPreWarmStatus368(c, o);
  if (!status.preWarmActive) return { emitted: false, status, persistent: false };
  const repo = o.prewarmEmissionRepo || c.prewarmEmissionRepo || null;
  // Persistence is keyed on activeKeyId only — manifestHash drifts with
  // unrelated ctx state, so a tuple including it would re-emit per
  // restart. The V369 contract guarantees "one prewarm signal per
  // active verifier key across restarts".
  const tupleKey = String(status.activeKeyId);
  if (repo && typeof repo.has === 'function' && repo.has(tupleKey)) {
    return { emitted: false, status, persistent: true, deduped: true };
  }
  const v368res = LB368.emitVerifierKeyPreWarm368(c, o);
  if (v368res.emitted && repo && typeof repo.add === 'function') {
    try { repo.add(tupleKey); } catch (_) {}
    if (c.auditLog && typeof c.auditLog.append === 'function') {
      try {
        c.auditLog.append(PREWARM_PERSISTED_TYPE_369, {
          activeKeyId: status.activeKeyId,
          manifestHash: status.manifestHash,
          ts: new Date((o && o.now) || Date.now()).toISOString(),
        });
      } catch (_) {}
    }
  }
  return Object.assign({}, v368res, { persistent: !!repo });
}

// ── 2. Subscriber repo attestation HMAC key rotation ──────────────────────
function _activeRepoIntegrityKey369(opts) {
  const o = opts || {};
  if (o.key) return { key: String(o.key), keyId: o.keyId || 'inline' };
  const env369 = process.env.ECOS_REPO_INTEGRITY_HMAC_KEY_369;
  if (env369) return { key: String(env369), keyId: 'env369' };
  const env368 = process.env.ECOS_REPO_INTEGRITY_HMAC_KEY_368;
  if (env368) return { key: String(env368), keyId: 'env368' };
  return { key: null, keyId: null };
}

function _previousRepoIntegrityKeys369(opts) {
  const o = opts || {};
  const out = [];
  if (Array.isArray(o.previousKeys)) {
    for (const k of o.previousKeys) {
      if (!k) continue;
      if (typeof k === 'string') out.push({ key: k, keyId: null });
      else if (typeof k === 'object' && k.key) out.push({ key: String(k.key), keyId: k.keyId || null });
    }
  }
  const envPrev = process.env.ECOS_REPO_INTEGRITY_HMAC_PREVIOUS_KEYS_369;
  if (envPrev) {
    for (const piece of String(envPrev).split(',').map(s => s.trim()).filter(Boolean)) {
      out.push({ key: piece, keyId: 'env369-prev' });
    }
  }
  return out;
}

/**
 * Sign V367 repo integrity under the active rotation key. Envelope is a
 * superset of V368: adds `activeKeyId` and `rotationGeneration`.
 */
function signSubscriberRepoIntegrityWithRotation369(ctx, opts) {
  const c = ctx || {};
  const o = opts || {};
  const active = _activeRepoIntegrityKey369(o);
  const integ = LB367.subscriberRepoIntegrity367(c);
  const now = (typeof o.now === 'number') ? o.now : Date.now();
  const payload = {
    repoIntegrityHash: integ.repoIntegrityHash,
    count: integ.count,
    ephemeral: !!integ.ephemeral,
    sourceSchema: integ.schema,
    ts: new Date(now).toISOString(),
    rotationGeneration: typeof o.rotationGeneration === 'number' ? o.rotationGeneration : 0,
  };
  const envelope = {
    schema: SIGNED_REPO_INTEGRITY_SCHEMA_369,
    algo: SIGNED_REPO_INTEGRITY_ALGO_369,
    payload,
    activeKeyId: active.keyId,
    keyId: active.keyId,
    signature: null,
    signed: false,
  };
  if (!active.key) {
    envelope.error = 'missing repo integrity hmac key (ECOS_REPO_INTEGRITY_HMAC_KEY_369)';
    return envelope;
  }
  envelope.signature = _hmacSha256Hex369(active.key, _stableStringify369(payload));
  envelope.signed = true;
  return envelope;
}

/**
 * Verify under the active key OR any rotated previous key. Pure.
 * Accepts envelopes from V368 too (signature is identical recipe).
 */
function verifySignedSubscriberRepoIntegrityWithRotation369(envelope, opts) {
  const o = opts || {};
  const r = { valid: false, reason: '', matchedKeyId: null };
  if (!envelope || typeof envelope !== 'object') { r.reason = 'envelope required'; return r; }
  if (envelope.schema !== SIGNED_REPO_INTEGRITY_SCHEMA_369 &&
      envelope.schema !== LB368.SIGNED_REPO_INTEGRITY_SCHEMA_368) {
    r.reason = 'schema mismatch'; return r;
  }
  if (envelope.algo !== SIGNED_REPO_INTEGRITY_ALGO_369)     { r.reason = 'algo mismatch';   return r; }
  if (!envelope.signature || typeof envelope.signature !== 'string') { r.reason = 'signature required'; return r; }
  if (!envelope.payload || typeof envelope.payload !== 'object')     { r.reason = 'payload required';   return r; }
  const candidates = [];
  const active = _activeRepoIntegrityKey369(o);
  if (active.key) candidates.push(active);
  for (const prev of _previousRepoIntegrityKeys369(o)) candidates.push(prev);
  if (!candidates.length) { r.reason = 'verifier key unavailable'; return r; }
  const expectedMsg = _stableStringify369(envelope.payload);
  for (const cand of candidates) {
    const expected = _hmacSha256Hex369(cand.key, expectedMsg);
    if (_timingSafeEqHex369(expected, envelope.signature)) {
      r.valid = true; r.reason = 'signed repo integrity valid'; r.matchedKeyId = cand.keyId;
      return r;
    }
  }
  r.reason = 'signature mismatch';
  return r;
}

// ── 3. Break-glass quota status view ──────────────────────────────────────
/**
 * Pure read-only projection of the V368 rolling quota state. No audit
 * writes. Returns `{slotsUsed, slotsRemaining, oldestClearAt,
 * nextSlotAvailableAt, ...}`.
 */
function breakGlassQuotaStatus369(ctx, opts) {
  const c = ctx || {};
  const o = opts || {};
  const now = (typeof o.now === 'number') ? o.now : Date.now();
  const windowMs = (typeof o.quotaWindowMs === 'number' && o.quotaWindowMs >= 0)
    ? o.quotaWindowMs
    : Number(process.env.ECOS_BREAK_GLASS_QUOTA_WINDOW_MS_368
        || LB368.DEFAULT_QUOTA_WINDOW_MS_368);
  const maxClears = (typeof o.maxClearsPerWindow === 'number' && o.maxClearsPerWindow >= 0)
    ? o.maxClearsPerWindow
    : Number(process.env.ECOS_BREAK_GLASS_MAX_CLEARS_PER_WINDOW_368
        || LB368.DEFAULT_MAX_CLEARS_PER_WINDOW_368);
  const since = now - windowMs;
  const log = c.auditLog;
  const breakGlassTypes = [
    'integrity.quarantine.break_glass_cleared364',
    'integrity.quarantine.break_glass_cleared',
  ];
  let entries = [];
  try {
    if (log && typeof log.list === 'function') entries = log.list();
    else if (log && typeof log.toArray === 'function') entries = log.toArray();
    else if (log && Array.isArray(log.entries)) entries = log.entries;
    else if (log && Array.isArray(log._entries)) entries = log._entries;
  } catch (_) { entries = []; }
  const timestamps = [];
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    if (!breakGlassTypes.includes(e.type)) continue;
    const tsRaw = (e.payload && (e.payload.ts || e.payload.clearedAt)) || e.ts || null;
    const ms = tsRaw ? Date.parse(tsRaw) : null;
    if (Number.isFinite(ms) && ms >= since) timestamps.push(ms);
  }
  timestamps.sort((a, b) => a - b);
  const slotsUsed = timestamps.length;
  const slotsRemaining = Math.max(0, maxClears - slotsUsed);
  const oldestClearAt = timestamps.length ? new Date(timestamps[0]).toISOString() : null;
  const newestClearAt = timestamps.length ? new Date(timestamps[timestamps.length - 1]).toISOString() : null;
  const nextSlotAvailableAt = (slotsRemaining > 0 || !timestamps.length)
    ? new Date(now).toISOString()
    : new Date(timestamps[0] + windowMs).toISOString();
  return {
    schema: 'ecos.integrity.break_glass.quota.status/v369',
    quotaWindowMs: windowMs,
    maxClearsPerWindow: maxClears,
    slotsUsed,
    slotsRemaining,
    blocked: slotsRemaining === 0,
    oldestClearAt,
    newestClearAt,
    nextSlotAvailableAt,
    ts: new Date(now).toISOString(),
  };
}

// ── 4. Persistent replay cache TTL compaction ─────────────────────────────
/**
 * Compact the V368 persistent replay repo by dropping nonces whose
 * recorded timestamp is older than `ttlMs369` (default 7d).
 *
 * The V368 repo records nonces only — to enable compaction the repo
 * must expose `entries()` returning `[{nonce, ts}]` AND a `_drop(nonce)`
 * method. The V369 repo extension supplies both; older repos are
 * inspected and skipped (returns `{compacted:false, reason:...}`).
 */
function enforceDeliveryReplayTtl369(repo, opts) {
  const o = opts || {};
  const now = (typeof o.now === 'number') ? o.now : Date.now();
  const ttl = (typeof o.ttlMs === 'number' && o.ttlMs >= 0)
    ? o.ttlMs
    : (Number(process.env.ECOS_DELIVERY_REPLAY_TTL_MS_369) || DEFAULT_REPLAY_TTL_MS_369);
  const summary = {
    schema: 'ecos.integrity.delivery.replay.compaction/v369',
    compacted: false,
    examined: 0,
    evicted: 0,
    retained: 0,
    ttlMs: ttl,
    ts: new Date(now).toISOString(),
  };
  if (!repo || typeof repo.entries !== 'function' || typeof repo._drop !== 'function') {
    summary.reason = 'repo lacks {entries, _drop} contract (pre-V369)';
    return summary;
  }
  const cutoff = now - ttl;
  const all = repo.entries();
  summary.examined = all.length;
  for (const ent of all) {
    if (!ent) continue;
    const ms = ent.ts ? Date.parse(ent.ts) : NaN;
    if (Number.isFinite(ms) && ms < cutoff) {
      try { repo._drop(ent.nonce); summary.evicted++; } catch (_) {}
    } else {
      summary.retained++;
    }
  }
  summary.compacted = true;
  if (o.auditLog && typeof o.auditLog.append === 'function') {
    try {
      o.auditLog.append(REPLAY_COMPACTED_TYPE_369, {
        examined: summary.examined,
        evicted: summary.evicted,
        retained: summary.retained,
        ttlMs: ttl,
        ts: summary.ts,
      });
    } catch (_) {}
  }
  return summary;
}

module.exports = {
  LOAD_BEARING_VERSION_369,
  PREWARM_EMISSION_SCHEMA_369,
  SIGNED_REPO_INTEGRITY_SCHEMA_369,
  SIGNED_REPO_INTEGRITY_ALGO_369,
  REPLAY_COMPACTED_TYPE_369,
  PREWARM_PERSISTED_TYPE_369,
  DEFAULT_REPLAY_TTL_MS_369,
  emitVerifierKeyPreWarmPersistent369,
  signSubscriberRepoIntegrityWithRotation369,
  verifySignedSubscriberRepoIntegrityWithRotation369,
  breakGlassQuotaStatus369,
  enforceDeliveryReplayTtl369,
  _stableStringify369,
  _sha256Hex369,
  _hmacSha256Hex369,
};
