'use strict';
/**
 * lib/economicIntegrityLoadBearing370.js — ECOS V370 (Phase P258)
 *
 * STRATEGIC THESIS — Deepen the V369 integrity-load-bearing surface along
 * the four leverage points identified in the V369 hand-off:
 *
 *   1. Signed prewarm attestation feed
 *        signPrewarmPersistedRecord370 + buildSignedPrewarmAttestationFeed370
 *        sign each persisted `prewarm_signal368` emission under the V369
 *        rotation key so counterparties can verify the prewarm signal
 *        independently of the audit log. Verification reuses the V369
 *        rotation contract (active OR previousKeys).
 *
 *   2. Repo integrity rotation transcript
 *        recordRepoIntegrityRotation370 +
 *        repoIntegrityRotationTranscript370 record every key-switch
 *        event with `{activeKeyId, previousKeyIds, manifestHashSig, ts}`
 *        and project a signed manifest hash transcript so auditors can
 *        replay rotation history end-to-end.
 *
 *   3. Quota schedule projection
 *        breakGlassQuotaSchedule370 projects the next N quota windows
 *        forward from `now` and returns
 *        `{slotIndex, freesAt, slotsAvailableAfter}` for each one.
 *        Pure read-only — no audit emissions, no mutations.
 *
 *   4. Replay compaction policy enforcement
 *        enforceDeliveryReplayCompactionPolicy370 wraps V369 compaction
 *        with a cooldown policy: compaction runs at most once per
 *        `policyWindowMs370` (default 1h). Suppressed calls emit a
 *        single `integrity.revocation.feed.replay_compaction_policy_blocked370`
 *        summary; cleared calls delegate to V369 and update the policy
 *        ledger.
 *
 * Pure + dependency-free (R3 — Node built-ins only). Every public
 * identifier ends with 370 (R2). Sacred files untouched (R1).
 * V361..V369 contracts preserved (R6).
 *
 * @version 370.0.0
 */

const crypto = require('crypto');

const LB369 = require('./economicIntegrityLoadBearing369.js');
const LB368 = require('./economicIntegrityLoadBearing368.js');
const LB367 = require('./economicIntegrityLoadBearing367.js');
const LB366 = require('./economicIntegrityLoadBearing366.js');
const LB365 = require('./economicIntegrityLoadBearing365.js');

const LOAD_BEARING_VERSION_370                       = '370.0.0';
const SIGNED_PREWARM_ATTESTATION_SCHEMA_370          = 'ecos.integrity.verifier.keys.prewarm.attestation/v370';
const SIGNED_PREWARM_ATTESTATION_FEED_SCHEMA_370     = 'ecos.integrity.verifier.keys.prewarm.feed/v370';
const REPO_INTEGRITY_ROTATION_TRANSCRIPT_SCHEMA_370  = 'ecos.integrity.subscribers.repo.rotation.transcript/v370';
const QUOTA_SCHEDULE_SCHEMA_370                      = 'ecos.integrity.break_glass.quota.schedule/v370';
const COMPACTION_POLICY_SCHEMA_370                   = 'ecos.integrity.delivery.replay.compaction.policy/v370';
const COMPACTION_POLICY_BLOCKED_TYPE_370             = 'integrity.revocation.feed.replay_compaction_policy_blocked370';
const ROTATION_TRANSCRIPT_RECORDED_TYPE_370          = 'integrity.subscribers.repo.rotation_transcript_recorded370';
const SIGNED_PREWARM_ATTESTATION_ALGO_370            = 'hmac-sha256';
const DEFAULT_POLICY_WINDOW_MS_370                   = 60 * 60 * 1000; // 1h
const DEFAULT_SCHEDULE_HORIZON_370                   = 6;

// ── helpers (canonical recipe — identical shape across versions) ──────────
function _stableStringify370(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(_stableStringify370).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + _stableStringify370(value[k])).join(',') + '}';
}
function _sha256Hex370(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}
function _hmacSha256Hex370(secret, message) {
  return crypto.createHmac('sha256', String(secret)).update(message, 'utf8').digest('hex');
}
function _timingSafeEqHex370(aHex, bHex) {
  if (typeof aHex !== 'string' || typeof bHex !== 'string') return false;
  if (aHex.length !== bHex.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(aHex, 'hex'), Buffer.from(bHex, 'hex')); }
  catch (_) { return false; }
}
function _activeRepoIntegrityKey370(opts) {
  const o = opts || {};
  if (o.key) return { key: String(o.key), keyId: o.keyId || 'inline' };
  const env369 = process.env.ECOS_REPO_INTEGRITY_HMAC_KEY_369;
  if (env369) return { key: String(env369), keyId: 'env369' };
  const env368 = process.env.ECOS_REPO_INTEGRITY_HMAC_KEY_368;
  if (env368) return { key: String(env368), keyId: 'env368' };
  return { key: null, keyId: null };
}
function _previousRepoIntegrityKeys370(opts) {
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

// ── 1. Signed prewarm attestation feed ────────────────────────────────────
/**
 * Wrap a single `integrity.verifier.keys.prewarm_persisted369` audit
 * record (or any `{activeKeyId, manifestHash, ts}` tuple) in a signed
 * envelope so counterparties can verify the prewarm signal independently.
 */
function signPrewarmPersistedRecord370(record, opts) {
  const o = opts || {};
  const active = _activeRepoIntegrityKey370(o);
  const seq = (typeof o.seq === 'number') ? o.seq : 0;
  const payload = {
    activeKeyId: record && record.activeKeyId || null,
    manifestHash: record && record.manifestHash || null,
    ts: record && record.ts || null,
    seq,
  };
  const envelope = {
    schema: SIGNED_PREWARM_ATTESTATION_SCHEMA_370,
    algo: SIGNED_PREWARM_ATTESTATION_ALGO_370,
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
  envelope.signature = _hmacSha256Hex370(active.key, _stableStringify370(payload));
  envelope.signed = true;
  return envelope;
}

function verifySignedPrewarmAttestation370(envelope, opts) {
  const o = opts || {};
  const r = { valid: false, reason: '', matchedKeyId: null };
  if (!envelope || typeof envelope !== 'object') { r.reason = 'envelope required'; return r; }
  if (envelope.schema !== SIGNED_PREWARM_ATTESTATION_SCHEMA_370) { r.reason = 'schema mismatch'; return r; }
  if (envelope.algo !== SIGNED_PREWARM_ATTESTATION_ALGO_370) { r.reason = 'algo mismatch'; return r; }
  if (!envelope.signature || typeof envelope.signature !== 'string') { r.reason = 'signature required'; return r; }
  if (!envelope.payload || typeof envelope.payload !== 'object') { r.reason = 'payload required'; return r; }
  const candidates = [];
  const active = _activeRepoIntegrityKey370(o);
  if (active.key) candidates.push(active);
  for (const prev of _previousRepoIntegrityKeys370(o)) candidates.push(prev);
  if (!candidates.length) { r.reason = 'verifier key unavailable'; return r; }
  const expectedMsg = _stableStringify370(envelope.payload);
  for (const cand of candidates) {
    const expected = _hmacSha256Hex370(cand.key, expectedMsg);
    if (_timingSafeEqHex370(expected, envelope.signature)) {
      r.valid = true; r.reason = 'signed prewarm attestation valid'; r.matchedKeyId = cand.keyId;
      return r;
    }
  }
  r.reason = 'signature mismatch';
  return r;
}

/**
 * Build a feed of signed prewarm attestation envelopes from the
 * `integrity.verifier.keys.prewarm_persisted369` audit records. Pure
 * read-only — no mutations, no audit emissions.
 */
function buildSignedPrewarmAttestationFeed370(ctx, opts) {
  const c = ctx || {};
  const o = opts || {};
  const now = (typeof o.now === 'number') ? o.now : Date.now();
  const log = c.auditLog;
  let entries = [];
  try {
    if (log && typeof log.list === 'function') entries = log.list();
    else if (log && typeof log.toArray === 'function') entries = log.toArray();
    else if (log && Array.isArray(log.entries)) entries = log.entries;
    else if (log && Array.isArray(log._entries)) entries = log._entries;
  } catch (_) { entries = []; }
  const records = [];
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    if (e.type !== LB369.PREWARM_PERSISTED_TYPE_369) continue;
    const p = e.payload || {};
    records.push({
      activeKeyId: p.activeKeyId || null,
      manifestHash: p.manifestHash || null,
      ts: p.ts || e.ts || null,
    });
  }
  const envelopes = records.map((rec, idx) =>
    signPrewarmPersistedRecord370(rec, Object.assign({}, o, { seq: idx })));
  return {
    schema: SIGNED_PREWARM_ATTESTATION_FEED_SCHEMA_370,
    count: envelopes.length,
    envelopes,
    ts: new Date(now).toISOString(),
  };
}

// ── 2. Repo integrity rotation transcript ─────────────────────────────────
/**
 * Append a key-rotation event to the rotation transcript repo. Each
 * record carries `{activeKeyId, previousKeyIds, manifestHashSig, ts}`
 * where `manifestHashSig` is an HMAC-SHA256 of the current subscriber
 * repo integrity hash under the active key (so the transcript itself
 * is tamper-evident).
 */
function recordRepoIntegrityRotation370(ctx, opts) {
  const c = ctx || {};
  const o = opts || {};
  const now = (typeof o.now === 'number') ? o.now : Date.now();
  const active = _activeRepoIntegrityKey370(o);
  const previousKeyIds = [];
  if (Array.isArray(o.previousKeyIds)) {
    for (const id of o.previousKeyIds) if (id) previousKeyIds.push(String(id));
  } else {
    for (const prev of _previousRepoIntegrityKeys370(o)) {
      if (prev.keyId) previousKeyIds.push(prev.keyId);
    }
  }
  const integ = LB367.subscriberRepoIntegrity367(c);
  const manifestHashSig = active.key
    ? _hmacSha256Hex370(active.key, String(integ.repoIntegrityHash))
    : null;
  const record = {
    schema: REPO_INTEGRITY_ROTATION_TRANSCRIPT_SCHEMA_370,
    activeKeyId: active.keyId,
    previousKeyIds,
    repoIntegrityHash: integ.repoIntegrityHash,
    manifestHashSig,
    signed: !!manifestHashSig,
    ts: new Date(now).toISOString(),
  };
  const repo = o.rotationTranscriptRepo || c.rotationTranscriptRepo || null;
  if (repo && typeof repo.append === 'function') {
    try { repo.append(record); } catch (_) {}
  }
  if (c.auditLog && typeof c.auditLog.append === 'function') {
    try {
      c.auditLog.append(ROTATION_TRANSCRIPT_RECORDED_TYPE_370, {
        activeKeyId: record.activeKeyId,
        previousKeyIds: record.previousKeyIds,
        manifestHashSig: record.manifestHashSig,
        ts: record.ts,
      });
    } catch (_) {}
  }
  return record;
}

/**
 * Project the rotation transcript stored in `ctx.rotationTranscriptRepo`
 * (or the in-memory audit-log mirror) into a stable envelope. Pure.
 */
function repoIntegrityRotationTranscript370(ctx, opts) {
  const c = ctx || {};
  const o = opts || {};
  const now = (typeof o.now === 'number') ? o.now : Date.now();
  const repo = o.rotationTranscriptRepo || c.rotationTranscriptRepo || null;
  let records = [];
  if (repo && typeof repo.list === 'function') {
    try { records = repo.list(); } catch (_) { records = []; }
  } else if (c.auditLog) {
    let entries = [];
    try {
      if (typeof c.auditLog.list === 'function') entries = c.auditLog.list();
      else if (typeof c.auditLog.toArray === 'function') entries = c.auditLog.toArray();
      else if (Array.isArray(c.auditLog.entries)) entries = c.auditLog.entries;
      else if (Array.isArray(c.auditLog._entries)) entries = c.auditLog._entries;
    } catch (_) { entries = []; }
    for (const e of entries) {
      if (!e || e.type !== ROTATION_TRANSCRIPT_RECORDED_TYPE_370) continue;
      records.push(Object.assign({ schema: REPO_INTEGRITY_ROTATION_TRANSCRIPT_SCHEMA_370 }, e.payload || {}));
    }
  }
  return {
    schema: REPO_INTEGRITY_ROTATION_TRANSCRIPT_SCHEMA_370,
    count: records.length,
    records,
    ts: new Date(now).toISOString(),
  };
}

// ── 3. Quota schedule projection ──────────────────────────────────────────
/**
 * Project the next `horizon` slot-availability windows for the
 * break-glass quota, forward from `now`. Pure — no audit emissions.
 */
function breakGlassQuotaSchedule370(ctx, opts) {
  const c = ctx || {};
  const o = opts || {};
  const now = (typeof o.now === 'number') ? o.now : Date.now();
  const horizon = (typeof o.horizon === 'number' && o.horizon > 0)
    ? Math.floor(o.horizon)
    : DEFAULT_SCHEDULE_HORIZON_370;
  const status = LB369.breakGlassQuotaStatus369(c, o);
  const windowMs = status.quotaWindowMs;
  const maxClears = status.maxClearsPerWindow;

  // Re-collect the in-window timestamps so we can project forward
  // deterministically. Mirror the V369 collection contract.
  const breakGlassTypes = [
    'integrity.quarantine.break_glass_cleared364',
    'integrity.quarantine.break_glass_cleared',
  ];
  const log = c.auditLog;
  let entries = [];
  try {
    if (log && typeof log.list === 'function') entries = log.list();
    else if (log && typeof log.toArray === 'function') entries = log.toArray();
    else if (log && Array.isArray(log.entries)) entries = log.entries;
    else if (log && Array.isArray(log._entries)) entries = log._entries;
  } catch (_) { entries = []; }
  const since = now - windowMs;
  const timestamps = [];
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    if (!breakGlassTypes.includes(e.type)) continue;
    const tsRaw = (e.payload && (e.payload.ts || e.payload.clearedAt)) || e.ts || null;
    const ms = tsRaw ? Date.parse(tsRaw) : null;
    if (Number.isFinite(ms) && ms >= since) timestamps.push(ms);
  }
  timestamps.sort((a, b) => a - b);

  const slots = [];
  let slotsRemainingProjected = Math.max(0, maxClears - timestamps.length);
  // Slot 0: the *next* slot freed-up moment. If we still have room,
  // the next slot frees at `now`. Otherwise it frees at the oldest
  // clear + window.
  for (let i = 0; i < horizon; i++) {
    let freesAtMs;
    if (slotsRemainingProjected > 0) {
      freesAtMs = now;
      slotsRemainingProjected--;
    } else if (timestamps.length) {
      const idx = i - (Math.max(0, maxClears - timestamps.length));
      const safeIdx = Math.min(Math.max(idx, 0), timestamps.length - 1);
      freesAtMs = timestamps[safeIdx] + windowMs;
    } else {
      freesAtMs = now;
    }
    slots.push({
      slotIndex: i,
      freesAt: new Date(freesAtMs).toISOString(),
    });
  }

  return {
    schema: QUOTA_SCHEDULE_SCHEMA_370,
    horizon,
    quotaWindowMs: windowMs,
    maxClearsPerWindow: maxClears,
    slotsUsed: status.slotsUsed,
    slotsRemaining: status.slotsRemaining,
    blocked: status.blocked,
    slots,
    ts: new Date(now).toISOString(),
  };
}

// ── 4. Replay compaction policy enforcement ───────────────────────────────
/**
 * Run V369 replay TTL compaction at most once per `policyWindowMs370`
 * (default 1h). Suppressed calls emit a single
 * `integrity.revocation.feed.replay_compaction_policy_blocked370` audit
 * record and return `{compacted:false, blocked:true, nextEligibleAt}`.
 *
 * The policy ledger is supplied via `ctx.compactionPolicyRepo` (or
 * `opts.compactionPolicyRepo`) and must expose
 * `{lastRunAt, recordRun}` — without one the policy degrades to V369
 * behaviour (always compact, never blocked).
 */
function enforceDeliveryReplayCompactionPolicy370(repo, opts) {
  const o = opts || {};
  const now = (typeof o.now === 'number') ? o.now : Date.now();
  const windowMs = (typeof o.policyWindowMs === 'number' && o.policyWindowMs >= 0)
    ? o.policyWindowMs
    : (Number(process.env.ECOS_DELIVERY_REPLAY_COMPACTION_POLICY_MS_370) || DEFAULT_POLICY_WINDOW_MS_370);
  const policyRepo = o.compactionPolicyRepo || null;
  const auditLog = o.auditLog || null;
  const policySummaryBase = {
    schema: COMPACTION_POLICY_SCHEMA_370,
    policyWindowMs: windowMs,
    ts: new Date(now).toISOString(),
  };
  if (policyRepo && typeof policyRepo.lastRunAt === 'function') {
    let lastRunMs = NaN;
    try { lastRunMs = Date.parse(policyRepo.lastRunAt() || ''); } catch (_) { lastRunMs = NaN; }
    if (Number.isFinite(lastRunMs) && (now - lastRunMs) < windowMs) {
      const nextEligibleAt = new Date(lastRunMs + windowMs).toISOString();
      const blocked = Object.assign({}, policySummaryBase, {
        compacted: false,
        blocked: true,
        reason: 'cooldown active',
        lastRunAt: new Date(lastRunMs).toISOString(),
        nextEligibleAt,
      });
      if (auditLog && typeof auditLog.append === 'function') {
        try {
          auditLog.append(COMPACTION_POLICY_BLOCKED_TYPE_370, {
            policyWindowMs: windowMs,
            lastRunAt: blocked.lastRunAt,
            nextEligibleAt,
            ts: blocked.ts,
          });
        } catch (_) {}
      }
      return blocked;
    }
  }
  const summary = LB369.enforceDeliveryReplayTtl369(repo, o);
  if (policyRepo && typeof policyRepo.recordRun === 'function') {
    try { policyRepo.recordRun(new Date(now).toISOString()); } catch (_) {}
  }
  return Object.assign({}, summary, {
    blocked: false,
    policyWindowMs: windowMs,
    policyEnforced: !!policyRepo,
  });
}

module.exports = {
  LOAD_BEARING_VERSION_370,
  SIGNED_PREWARM_ATTESTATION_SCHEMA_370,
  SIGNED_PREWARM_ATTESTATION_FEED_SCHEMA_370,
  SIGNED_PREWARM_ATTESTATION_ALGO_370,
  REPO_INTEGRITY_ROTATION_TRANSCRIPT_SCHEMA_370,
  QUOTA_SCHEDULE_SCHEMA_370,
  COMPACTION_POLICY_SCHEMA_370,
  COMPACTION_POLICY_BLOCKED_TYPE_370,
  ROTATION_TRANSCRIPT_RECORDED_TYPE_370,
  DEFAULT_POLICY_WINDOW_MS_370,
  DEFAULT_SCHEDULE_HORIZON_370,
  signPrewarmPersistedRecord370,
  verifySignedPrewarmAttestation370,
  buildSignedPrewarmAttestationFeed370,
  recordRepoIntegrityRotation370,
  repoIntegrityRotationTranscript370,
  breakGlassQuotaSchedule370,
  enforceDeliveryReplayCompactionPolicy370,
  _stableStringify370,
  _sha256Hex370,
  _hmacSha256Hex370,
};
