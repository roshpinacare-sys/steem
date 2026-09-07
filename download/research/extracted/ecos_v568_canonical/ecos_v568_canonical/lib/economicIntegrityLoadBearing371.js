'use strict';
/**
 * lib/economicIntegrityLoadBearing371.js — ECOS V371 (Phase P259)
 *
 * STRATEGIC THESIS — Deepen the V370 integrity-load-bearing surface along
 * the four leverage points identified in the V370 hand-off:
 *
 *   1. Prewarm feed cursor + pagination
 *        buildSignedPrewarmAttestationFeedPage371 returns one page of
 *        signed envelopes starting at `cursor.seq`, optionally filtered
 *        by `cursor.since` (ISO timestamp), with a stable `nextCursor`
 *        for incremental subscriber catch-up.
 *
 *   2. Rotation transcript verifier
 *        verifyRepoIntegrityRotationTranscript371 walks the V370
 *        transcript, recomputes each `manifestHashSig` under the
 *        record's `activeKeyId` (looked up via opts.keyById /
 *        opts.previousKeys / current active key), and returns the
 *        first divergent index along with per-record results.
 *
 *   3. Quota schedule what-if probe
 *        simulateBreakGlassClear371 projects the schedule that WOULD
 *        result after N additional clears at `now`, without mutating
 *        ctx.auditLog or any repo. Returns the simulated status, the
 *        projected schedule, and the rejection point if quota would
 *        be exceeded mid-simulation.
 *
 *   4. Compaction policy adaptive cooldown
 *        enforceDeliveryReplayCompactionPolicyAdaptive371 wraps the
 *        V370 policy with exponential backoff: once consecutive
 *        blocked attempts cross `blockThreshold`, the effective
 *        window grows as `baseWindow * 2^(consecutive - threshold)`
 *        (capped by `maxMultiplier`). A successful compaction resets
 *        the counter. Requires a repo exposing `consecutiveBlocks()`
 *        / `recordBlock()` / `recordRun()` — degrades gracefully to
 *        V370 if absent.
 *
 * Pure + dependency-free (R3 — Node built-ins only). Every public
 * identifier ends with 371 (R2). Sacred files untouched (R1).
 * V361..V370 contracts preserved (R6).
 *
 * @version 371.0.0
 */

const crypto = require('crypto');

const LB370 = require('./economicIntegrityLoadBearing370.js');
const LB369 = require('./economicIntegrityLoadBearing369.js');
const LB368 = require('./economicIntegrityLoadBearing368.js');
const LB367 = require('./economicIntegrityLoadBearing367.js');

const LOAD_BEARING_VERSION_371                       = '371.0.0';
const PREWARM_FEED_PAGE_SCHEMA_371                   = 'ecos.integrity.verifier.keys.prewarm.feed.page/v371';
const ROTATION_TRANSCRIPT_VERIFY_SCHEMA_371          = 'ecos.integrity.subscribers.repo.rotation.transcript.verify/v371';
const QUOTA_SCHEDULE_SIMULATION_SCHEMA_371           = 'ecos.integrity.break_glass.quota.simulation/v371';
const COMPACTION_POLICY_ADAPTIVE_SCHEMA_371          = 'ecos.integrity.delivery.replay.compaction.policy.adaptive/v371';
const COMPACTION_POLICY_ADAPTIVE_BLOCKED_TYPE_371    = 'integrity.revocation.feed.replay_compaction_policy_adaptive_blocked371';
const COMPACTION_POLICY_ADAPTIVE_RESET_TYPE_371      = 'integrity.revocation.feed.replay_compaction_policy_adaptive_reset371';
const DEFAULT_PAGE_LIMIT_371                         = 50;
const DEFAULT_ADAPTIVE_BLOCK_THRESHOLD_371           = 3;
const DEFAULT_ADAPTIVE_MAX_MULTIPLIER_371            = 8;

// ── helpers ───────────────────────────────────────────────────────────────
function _stableStringify371(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(_stableStringify371).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + _stableStringify371(value[k])).join(',') + '}';
}
function _hmacSha256Hex371(secret, message) {
  return crypto.createHmac('sha256', String(secret)).update(message, 'utf8').digest('hex');
}
function _timingSafeEqHex371(aHex, bHex) {
  if (typeof aHex !== 'string' || typeof bHex !== 'string') return false;
  if (aHex.length !== bHex.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(aHex, 'hex'), Buffer.from(bHex, 'hex')); }
  catch (_) { return false; }
}
function _activeRepoIntegrityKey371(opts) {
  const o = opts || {};
  if (o.key) return { key: String(o.key), keyId: o.keyId || 'inline' };
  const env369 = process.env.ECOS_REPO_INTEGRITY_HMAC_KEY_369;
  if (env369) return { key: String(env369), keyId: 'env369' };
  const env368 = process.env.ECOS_REPO_INTEGRITY_HMAC_KEY_368;
  if (env368) return { key: String(env368), keyId: 'env368' };
  return { key: null, keyId: null };
}
function _collectKeyMap371(opts) {
  const o = opts || {};
  const m = new Map();
  const active = _activeRepoIntegrityKey371(o);
  if (active.key && active.keyId) m.set(active.keyId, active.key);
  if (o.keyById && typeof o.keyById === 'object') {
    for (const id of Object.keys(o.keyById)) {
      if (o.keyById[id]) m.set(id, String(o.keyById[id]));
    }
  }
  if (Array.isArray(o.previousKeys)) {
    for (const k of o.previousKeys) {
      if (!k) continue;
      if (typeof k === 'object' && k.key && k.keyId) m.set(k.keyId, String(k.key));
    }
  }
  return m;
}

// ── 1. Prewarm feed cursor + pagination ───────────────────────────────────
/**
 * Returns one page of the V370 signed prewarm attestation feed
 * starting at `cursor.seq` (default 0), optionally filtered to
 * envelopes whose payload.ts > `cursor.since`. Yields a stable
 * `nextCursor` that subscribers can pass back to resume.
 *
 * Pure read-only — composes V370 builder + slicing.
 */
function buildSignedPrewarmAttestationFeedPage371(ctx, opts) {
  const c = ctx || {};
  const o = opts || {};
  const now = (typeof o.now === 'number') ? o.now : Date.now();
  const cursor = (o.cursor && typeof o.cursor === 'object') ? o.cursor : {};
  const startSeq = (typeof cursor.seq === 'number' && cursor.seq >= 0) ? Math.floor(cursor.seq) : 0;
  const sinceMs = cursor.since ? Date.parse(cursor.since) : null;
  const limit = (typeof o.limit === 'number' && o.limit > 0)
    ? Math.floor(o.limit)
    : DEFAULT_PAGE_LIMIT_371;
  const full = LB370.buildSignedPrewarmAttestationFeed370(c, o);
  const filtered = [];
  for (const env of full.envelopes) {
    const seq = (env.payload && typeof env.payload.seq === 'number') ? env.payload.seq : -1;
    if (seq < startSeq) continue;
    if (Number.isFinite(sinceMs)) {
      const ts = (env.payload && env.payload.ts) ? Date.parse(env.payload.ts) : NaN;
      if (Number.isFinite(ts) && ts <= sinceMs) continue;
    }
    filtered.push(env);
  }
  const page = filtered.slice(0, limit);
  const hasMore = filtered.length > limit;
  const last = page[page.length - 1];
  const lastSeq = (last && last.payload && typeof last.payload.seq === 'number') ? last.payload.seq : (startSeq - 1);
  const nextCursor = hasMore
    ? { seq: lastSeq + 1, since: cursor.since || null }
    : null;
  return {
    schema: PREWARM_FEED_PAGE_SCHEMA_371,
    cursor: { seq: startSeq, since: cursor.since || null },
    nextCursor,
    hasMore,
    count: page.length,
    totalCount: full.count,
    envelopes: page,
    ts: new Date(now).toISOString(),
  };
}

// ── 2. Rotation transcript verifier ───────────────────────────────────────
/**
 * Walk the V370 rotation transcript and re-verify each record's
 * `manifestHashSig` under its declared `activeKeyId`. Returns:
 *   {valid, firstDivergentIndex, count, verifiedCount, divergences[], records[]}
 *
 * Key resolution order:
 *   opts.keyById[activeKeyId] → opts.previousKeys[].keyId match →
 *   active repo integrity key if its keyId matches.
 *
 * Pure — no mutations, no audit emissions.
 */
function verifyRepoIntegrityRotationTranscript371(ctx, opts) {
  const c = ctx || {};
  const o = opts || {};
  const now = (typeof o.now === 'number') ? o.now : Date.now();
  const transcript = LB370.repoIntegrityRotationTranscript370(c, o);
  const keyMap = _collectKeyMap371(o);
  const records = transcript.records || [];
  const results = [];
  const divergences = [];
  let firstDivergentIndex = -1;
  let verifiedCount = 0;
  for (let i = 0; i < records.length; i++) {
    const r = records[i] || {};
    const keyId = r.activeKeyId || null;
    const key = keyId ? keyMap.get(keyId) : null;
    const sig = r.manifestHashSig || null;
    const integHash = (r.repoIntegrityHash != null) ? String(r.repoIntegrityHash) : null;
    const res = {
      index: i,
      activeKeyId: keyId,
      ts: r.ts || null,
      hasSignature: !!sig,
      keyAvailable: !!key,
      valid: false,
      reason: '',
    };
    if (!sig) { res.reason = 'missing manifestHashSig'; }
    else if (!key) { res.reason = 'key for activeKeyId not provided'; }
    else if (integHash == null) { res.reason = 'missing repoIntegrityHash'; }
    else {
      const expected = _hmacSha256Hex371(key, integHash);
      if (_timingSafeEqHex371(expected, sig)) {
        res.valid = true;
        res.reason = 'manifest signature valid';
        verifiedCount++;
      } else {
        res.reason = 'manifest signature mismatch';
      }
    }
    if (!res.valid) {
      divergences.push({ index: i, reason: res.reason, activeKeyId: keyId });
      if (firstDivergentIndex < 0) firstDivergentIndex = i;
    }
    results.push(res);
  }
  return {
    schema: ROTATION_TRANSCRIPT_VERIFY_SCHEMA_371,
    valid: firstDivergentIndex < 0,
    count: records.length,
    verifiedCount,
    firstDivergentIndex,
    divergences,
    records: results,
    ts: new Date(now).toISOString(),
  };
}

// ── 3. Quota schedule what-if probe ───────────────────────────────────────
/**
 * Project the schedule that would result if `clears` additional
 * break-glass clears were applied at `now`. Pure — never mutates
 * the audit log or any repo. Returns:
 *   {accepted, rejectedAt, simulatedClears, before, after, schedule}
 */
function simulateBreakGlassClear371(ctx, opts) {
  const c = ctx || {};
  const o = opts || {};
  const now = (typeof o.now === 'number') ? o.now : Date.now();
  const clears = (typeof o.clears === 'number' && o.clears >= 0) ? Math.floor(o.clears) : 1;
  const horizon = (typeof o.horizon === 'number' && o.horizon > 0)
    ? Math.floor(o.horizon)
    : LB370.DEFAULT_SCHEDULE_HORIZON_370;
  const before = LB369.breakGlassQuotaStatus369(c, o);
  const windowMs = before.quotaWindowMs;
  const maxClears = before.maxClearsPerWindow;

  // Re-collect existing in-window timestamps (mirror V369/V370 logic).
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

  let accepted = 0;
  let rejectedAt = -1;
  const simulatedTimestamps = timestamps.slice();
  for (let i = 0; i < clears; i++) {
    // re-window relative to `now`
    const inWindow = simulatedTimestamps.filter(t => t >= now - windowMs);
    if (inWindow.length >= maxClears) { rejectedAt = i; break; }
    simulatedTimestamps.push(now);
    accepted++;
  }

  const afterInWindow = simulatedTimestamps.filter(t => t >= now - windowMs);
  const after = {
    slotsUsed: afterInWindow.length,
    slotsRemaining: Math.max(0, maxClears - afterInWindow.length),
    blocked: afterInWindow.length >= maxClears,
    nextSlotAvailableAt: (afterInWindow.length < maxClears || !afterInWindow.length)
      ? new Date(now).toISOString()
      : new Date(Math.min.apply(null, afterInWindow) + windowMs).toISOString(),
  };

  // Build a forward schedule similar to V370 using the simulated state.
  const slots = [];
  let slotsRemainingProjected = Math.max(0, maxClears - afterInWindow.length);
  const sortedAfter = afterInWindow.slice().sort((a, b) => a - b);
  for (let i = 0; i < horizon; i++) {
    let freesAtMs;
    if (slotsRemainingProjected > 0) {
      freesAtMs = now;
      slotsRemainingProjected--;
    } else if (sortedAfter.length) {
      const idx = i - Math.max(0, maxClears - sortedAfter.length);
      const safeIdx = Math.min(Math.max(idx, 0), sortedAfter.length - 1);
      freesAtMs = sortedAfter[safeIdx] + windowMs;
    } else {
      freesAtMs = now;
    }
    slots.push({ slotIndex: i, freesAt: new Date(freesAtMs).toISOString() });
  }

  return {
    schema: QUOTA_SCHEDULE_SIMULATION_SCHEMA_371,
    requestedClears: clears,
    simulatedClears: accepted,
    accepted: rejectedAt < 0,
    rejectedAt,
    quotaWindowMs: windowMs,
    maxClearsPerWindow: maxClears,
    before: {
      slotsUsed: before.slotsUsed,
      slotsRemaining: before.slotsRemaining,
      blocked: before.blocked,
    },
    after,
    schedule: { horizon, slots },
    ts: new Date(now).toISOString(),
  };
}

// ── 4. Compaction policy adaptive cooldown ────────────────────────────────
/**
 * Adaptive variant of V370's compaction policy enforcement. The
 * cooldown window grows exponentially once consecutive blocked
 * attempts cross `blockThreshold` and resets after a successful
 * compaction.
 *
 *   effectiveWindowMs = baseWindowMs * 2^(consecutive - blockThreshold)
 *   (capped by `maxMultiplier`, default 8x)
 *
 * Requires a repo that exposes `consecutiveBlocks()`, `recordBlock()`,
 * and `recordRun()`. When the repo only exposes the V370 shape
 * (`lastRunAt` / `recordRun`), the adaptive path degrades to V370.
 */
function enforceDeliveryReplayCompactionPolicyAdaptive371(repo, opts) {
  const o = opts || {};
  const now = (typeof o.now === 'number') ? o.now : Date.now();
  const baseWindowMs = (typeof o.policyWindowMs === 'number' && o.policyWindowMs >= 0)
    ? o.policyWindowMs
    : (Number(process.env.ECOS_DELIVERY_REPLAY_COMPACTION_POLICY_MS_370) || LB370.DEFAULT_POLICY_WINDOW_MS_370);
  const blockThreshold = (typeof o.blockThreshold === 'number' && o.blockThreshold > 0)
    ? Math.floor(o.blockThreshold)
    : DEFAULT_ADAPTIVE_BLOCK_THRESHOLD_371;
  const maxMultiplier = (typeof o.maxMultiplier === 'number' && o.maxMultiplier > 0)
    ? Math.floor(o.maxMultiplier)
    : DEFAULT_ADAPTIVE_MAX_MULTIPLIER_371;
  const policyRepo = o.compactionPolicyRepo || null;
  const auditLog = o.auditLog || null;
  const adaptiveCapable = !!(policyRepo
    && typeof policyRepo.consecutiveBlocks === 'function'
    && typeof policyRepo.recordBlock === 'function'
    && typeof policyRepo.recordRun === 'function');

  if (!adaptiveCapable) {
    const summary = LB370.enforceDeliveryReplayCompactionPolicy370(repo, o);
    return Object.assign({}, summary, {
      schema: COMPACTION_POLICY_ADAPTIVE_SCHEMA_371,
      adaptive: false,
      consecutiveBlocks: 0,
      effectiveWindowMs: baseWindowMs,
      blockThreshold,
      maxMultiplier,
    });
  }

  const consecutive = Number(policyRepo.consecutiveBlocks()) || 0;
  let effectiveWindowMs = baseWindowMs;
  if (consecutive > blockThreshold) {
    const exp = Math.min(consecutive - blockThreshold, 30);
    const mult = Math.min(Math.pow(2, exp), maxMultiplier);
    effectiveWindowMs = Math.floor(baseWindowMs * mult);
  }

  let lastRunMs = NaN;
  try { lastRunMs = Date.parse(policyRepo.lastRunAt() || ''); } catch (_) { lastRunMs = NaN; }
  if (Number.isFinite(lastRunMs) && (now - lastRunMs) < effectiveWindowMs) {
    try { policyRepo.recordBlock(); } catch (_) {}
    const nextEligibleAt = new Date(lastRunMs + effectiveWindowMs).toISOString();
    const blocked = {
      schema: COMPACTION_POLICY_ADAPTIVE_SCHEMA_371,
      compacted: false,
      blocked: true,
      adaptive: true,
      reason: 'adaptive cooldown active',
      baseWindowMs,
      effectiveWindowMs,
      blockThreshold,
      maxMultiplier,
      consecutiveBlocks: consecutive + 1,
      lastRunAt: new Date(lastRunMs).toISOString(),
      nextEligibleAt,
      ts: new Date(now).toISOString(),
    };
    if (auditLog && typeof auditLog.append === 'function') {
      try {
        auditLog.append(COMPACTION_POLICY_ADAPTIVE_BLOCKED_TYPE_371, {
          baseWindowMs,
          effectiveWindowMs,
          consecutiveBlocks: blocked.consecutiveBlocks,
          lastRunAt: blocked.lastRunAt,
          nextEligibleAt,
          ts: blocked.ts,
        });
      } catch (_) {}
    }
    return blocked;
  }

  const summary = LB369.enforceDeliveryReplayTtl369(repo, o);
  try { policyRepo.recordRun(new Date(now).toISOString()); } catch (_) {}
  if (consecutive > 0 && auditLog && typeof auditLog.append === 'function') {
    try {
      auditLog.append(COMPACTION_POLICY_ADAPTIVE_RESET_TYPE_371, {
        priorConsecutiveBlocks: consecutive,
        ts: new Date(now).toISOString(),
      });
    } catch (_) {}
  }
  return Object.assign({}, summary, {
    schema: COMPACTION_POLICY_ADAPTIVE_SCHEMA_371,
    blocked: false,
    adaptive: true,
    baseWindowMs,
    effectiveWindowMs,
    blockThreshold,
    maxMultiplier,
    consecutiveBlocks: 0,
    policyEnforced: true,
  });
}

module.exports = {
  LOAD_BEARING_VERSION_371,
  PREWARM_FEED_PAGE_SCHEMA_371,
  ROTATION_TRANSCRIPT_VERIFY_SCHEMA_371,
  QUOTA_SCHEDULE_SIMULATION_SCHEMA_371,
  COMPACTION_POLICY_ADAPTIVE_SCHEMA_371,
  COMPACTION_POLICY_ADAPTIVE_BLOCKED_TYPE_371,
  COMPACTION_POLICY_ADAPTIVE_RESET_TYPE_371,
  DEFAULT_PAGE_LIMIT_371,
  DEFAULT_ADAPTIVE_BLOCK_THRESHOLD_371,
  DEFAULT_ADAPTIVE_MAX_MULTIPLIER_371,
  buildSignedPrewarmAttestationFeedPage371,
  verifyRepoIntegrityRotationTranscript371,
  simulateBreakGlassClear371,
  enforceDeliveryReplayCompactionPolicyAdaptive371,
  _stableStringify371,
  _hmacSha256Hex371,
};
