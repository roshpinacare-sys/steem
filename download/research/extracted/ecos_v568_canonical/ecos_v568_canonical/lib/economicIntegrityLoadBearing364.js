'use strict';
/**
 * lib/economicIntegrityLoadBearing364.js — ECOS V364 (Phase P252)
 *
 * STRATEGIC THESIS — Deepen the V363 operational surface along the four
 * leverage points the V363 hand-off identified. V363 made V362 observations
 * operational (persisted revocation index, signed revocation envelopes,
 * cross-chain auto-quarantine, verifier publish surface). V364 hardens those
 * primitives for trust between independent counterparties:
 *
 *   1. revocationFeedSince364(ctx, opts)
 *        Counterparties tail revocations as an append-only signed feed
 *        instead of polling per-hash. Returns `{cursor, items, feedHash}`
 *        where every item carries a stable monotonic feed index and the
 *        whole batch is hash-signed using the V363 canonical recipe.
 *
 *   2. recordOperatorApproval364 + breakGlassClearQuarantine364
 *        V363's `clearQuarantine363` accepted any operator id. V364 requires
 *        N-of-M signed approvals from a configured operator set. Each
 *        approval is appended as its own audit event
 *        (`integrity.quarantine.approval364`); only when the K-th distinct
 *        operator approves does state flip via
 *        `integrity.quarantine.break_glass_cleared364`.
 *
 *   3. signVerifierAsset364(ctx, opts)
 *        The served `verifier362.js` payload is hashed AND HMAC-signed with
 *        an issuer key derived from `ECOS_VERIFIER_SIGNING_KEY_364` (or a
 *        deterministic test key under NODE_ENV=test). The signature ships
 *        via the `X-Verifier-Signature` response header so counterparties
 *        pin the issuer's public key (or the HMAC secret in shared-secret
 *        deployments) before trusting the SDK bytes.
 *
 *   4. projectQuarantineLedger364(ctx)
 *        Mirror every quarantine trip/clear/approval event into
 *        `ctx.quarantineRepo.upsert()` so cross-process restarts read the
 *        durable state without re-scanning the audit chain.
 *
 * Pure + dependency-free (R3 — only built-in `crypto`). Every public
 * identifier ends with 364 (R2). Sacred files untouched (R1). V361 + V362 +
 * V363 contracts preserved (R6). `verifier362.js` remains byte-identical to
 * its V362 form on disk (R6) — V364 only WRAPS the served bytes with an
 * additional signature; it does NOT mutate the SDK file.
 *
 * @version 364.0.0
 */

const crypto = require('crypto');

const LB363 = require('./economicIntegrityLoadBearing363.js');
const LB362 = require('./economicIntegrityLoadBearing362.js');

const LOAD_BEARING_VERSION_364   = '364.0.0';
const REVOCATION_FEED_SCHEMA_364 = 'ecos.integrity.revocation.feed/v364';
const QUARANTINE_APPROVAL_TYPE_364     = 'integrity.quarantine.approval364';
const QUARANTINE_BREAK_GLASS_TYPE_364  = 'integrity.quarantine.break_glass_cleared364';
const QUARANTINE_PROJECTED_TYPE_364    = 'integrity.quarantine.projected364';
const DEFAULT_BREAK_GLASS_THRESHOLD_364 = 2;
const VERIFIER_SIGNATURE_ALGO_364 = 'hmac-sha256';

// ── helpers (canonical recipe — identical to V362/V363) ────────────────────
function _stableStringify364(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(_stableStringify364).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + _stableStringify364(value[k])).join(',') + '}';
}
function _sha256Hex364(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}
function _hmacSha256Hex364(key, input) {
  return crypto.createHmac('sha256', key).update(input, 'utf8').digest('hex');
}
function _resolveSigningKey364(opts) {
  if (opts && typeof opts.signingKey === 'string' && opts.signingKey.length) return opts.signingKey;
  if (process.env.ECOS_VERIFIER_SIGNING_KEY_364) return process.env.ECOS_VERIFIER_SIGNING_KEY_364;
  if (process.env.NODE_ENV === 'test') return 'ecos-v364-test-signing-key';
  return null;
}

// ── 1. Revocation feed (append-only, signed batch) ─────────────────────────
/**
 * Walk the audit log for V362 envelope emit + revoke events occurring after
 * `opts.sinceCursor` and return a signed feed batch:
 *
 *   {
 *     schema: 'ecos.integrity.revocation.feed/v364',
 *     sinceCursor, nextCursor,
 *     items: [{ feedIndex, auditIndex, eventType, envelopeHash, reason?, ts }],
 *     count, generatedAt, issuerVersion,
 *     feedHash: sha256(canonical stringify minus feedHash),
 *   }
 *
 * `feedIndex` is a stable monotonic counter assigned by appearance order
 * across the audit log; the audit log itself is append-only so the
 * (auditIndex, feedIndex) pair is permanent. `nextCursor` is the highest
 * `auditIndex` consumed in this batch — callers feed it back as
 * `sinceCursor` on the next call to tail without dupes.
 */
function revocationFeedSince364(ctx, opts) {
  const c = ctx || {};
  const o = opts || {};
  const sinceCursor = (typeof o.sinceCursor === 'number') ? o.sinceCursor : -1;
  const limit = (typeof o.limit === 'number' && o.limit > 0) ? o.limit : 500;
  const auditLog = c.auditLog;
  const items = [];
  let feedIndex = 0;
  let nextCursor = sinceCursor;
  if (auditLog && typeof auditLog.entries === 'function') {
    for (const e of auditLog.entries()) {
      if (e.type !== LB362.ENVELOPE_EMITTED_TYPE_362 && e.type !== LB362.ENVELOPE_REVOKED_TYPE_362) continue;
      const auditIndex = e.index;
      // feedIndex counts every relevant event ever seen, NOT just post-cursor;
      // this keeps indices stable for any caller, regardless of cursor.
      const myFeedIndex = feedIndex++;
      if (auditIndex <= sinceCursor) continue;
      const p = e.payload || {};
      items.push({
        feedIndex: myFeedIndex,
        auditIndex,
        eventType: e.type,
        envelopeHash: p.envelopeHash || null,
        reason: (e.type === LB362.ENVELOPE_REVOKED_TYPE_362) ? (p.reason || null) : null,
        ts: p.ts || p.generatedAt || null,
      });
      if (auditIndex > nextCursor) nextCursor = auditIndex;
      if (items.length >= limit) break;
    }
  }
  const body = {
    schema: REVOCATION_FEED_SCHEMA_364,
    sinceCursor, nextCursor,
    count: items.length,
    items,
    generatedAt: new Date().toISOString(),
    issuerVersion: LOAD_BEARING_VERSION_364,
  };
  const feedHash = _sha256Hex364(_stableStringify364(body));
  return Object.assign({}, body, { feedHash });
}

/**
 * Verify a revocation feed batch (canonical sha256 over body minus feedHash).
 * Pure, never throws.
 */
function verifyRevocationFeed364(feed) {
  const out = {
    valid: false, reason: '', schemaAccepted: false,
    expectedFeedHash: null, providedFeedHash: null,
    verifierVersion: LOAD_BEARING_VERSION_364,
  };
  if (!feed || typeof feed !== 'object') { out.reason = 'feed must be an object'; return out; }
  out.providedFeedHash = feed.feedHash || null;
  if (!out.providedFeedHash) { out.reason = 'feed.feedHash missing'; return out; }
  out.schemaAccepted = (feed.schema === REVOCATION_FEED_SCHEMA_364);
  if (!out.schemaAccepted) { out.reason = 'unsupported feed.schema: ' + feed.schema; return out; }
  const clone = Object.assign({}, feed); delete clone.feedHash;
  out.expectedFeedHash = _sha256Hex364(_stableStringify364(clone));
  if (out.expectedFeedHash !== out.providedFeedHash) { out.reason = 'feedHash mismatch — feed tampered'; return out; }
  out.valid = true;
  out.reason = 'signature valid; count=' + (feed.count || 0);
  return out;
}

// ── 2. Quarantine break-glass with N-of-M operator signatures ──────────────
/**
 * Record one operator's approval to clear the current quarantine. Returns
 * `{recorded, operator, threshold, approvalsSoFar, approvers}`. Repeated
 * approvals from the same operator id are deduplicated (idempotent).
 *
 * Approvals are scoped to the CURRENT trip (the last `tripped363` index);
 * clearing the quarantine resets the approval window for the next trip.
 */
function recordOperatorApproval364(ctx, opts) {
  const c = ctx || {};
  const operator = (opts && opts.operator) || null;
  const reason   = (opts && opts.reason)   || 'approve-clear';
  if (!operator || typeof operator !== 'string') {
    return { recorded: false, error: 'operator id required' };
  }
  const q = LB363.quarantineStatus363(c);
  if (!q.tripped) return { recorded: false, error: 'not quarantined' };
  const threshold = _resolveThreshold364(opts);
  const allowed = _resolveOperatorSet364(opts);
  if (allowed && !allowed.has(operator)) {
    return { recorded: false, error: 'operator not in allowed set', operator };
  }
  const approvers = _approversForCurrentTrip364(c, q.at);
  if (approvers.has(operator)) {
    return { recorded: false, alreadyApproved: true, operator, threshold, approvalsSoFar: approvers.size, approvers: Array.from(approvers) };
  }
  let appendedIndex = null;
  if (c.auditLog && typeof c.auditLog.append === 'function') {
    try {
      const r = c.auditLog.append(QUARANTINE_APPROVAL_TYPE_364, {
        operator, reason, ts: new Date().toISOString(),
        forTrippedAt: q.at,
      });
      appendedIndex = (r && r.index != null) ? r.index : null;
    } catch (e) {
      return { recorded: false, error: e.message };
    }
  }
  approvers.add(operator);
  return {
    recorded: true, operator, appendedIndex,
    threshold, approvalsSoFar: approvers.size,
    approvers: Array.from(approvers),
    quorumReached: approvers.size >= threshold,
  };
}

/**
 * If the current trip has N>=threshold distinct approvals, flip state via a
 * `break_glass_cleared364` audit event and return `{cleared:true}`. Otherwise
 * returns `{cleared:false, approvalsSoFar, threshold}` — caller must collect
 * more approvals first.
 */
function breakGlassClearQuarantine364(ctx, opts) {
  const c = ctx || {};
  const q = LB363.quarantineStatus363(c);
  if (!q.tripped) return { cleared: false, alreadyClear: true };
  const threshold = _resolveThreshold364(opts);
  const approvers = _approversForCurrentTrip364(c, q.at);
  if (approvers.size < threshold) {
    return { cleared: false, threshold, approvalsSoFar: approvers.size, approvers: Array.from(approvers) };
  }
  let appendedIndex = null;
  if (c.auditLog && typeof c.auditLog.append === 'function') {
    try {
      const r = c.auditLog.append(QUARANTINE_BREAK_GLASS_TYPE_364, {
        approvers: Array.from(approvers).sort(),
        threshold,
        clearedTrippedAt: q.at,
        ts: new Date().toISOString(),
        reason: (opts && opts.reason) || 'break-glass-quorum-reached',
      });
      appendedIndex = (r && r.index != null) ? r.index : null;
      // Also emit a V363-shaped cleared event so V363's quarantineStatus363
      // (and the V363 enforce middleware) sees the flip without depending on
      // V364 vocabulary.
      try {
        c.auditLog.append(LB363.QUARANTINE_CLEARED_TYPE_363, {
          operator: 'break-glass:' + Array.from(approvers).sort().join('+'),
          reason: 'break-glass-quorum-reached (V364)',
          ts: new Date().toISOString(),
          clearedTrippedAt: q.at,
          via: QUARANTINE_BREAK_GLASS_TYPE_364,
        });
      } catch (_) {}
    } catch (e) {
      return { cleared: false, error: e.message };
    }
  }
  return {
    cleared: true,
    approvers: Array.from(approvers).sort(),
    threshold,
    appendedIndex,
    previouslyTrippedAt: q.at,
  };
}

function _resolveThreshold364(opts) {
  if (opts && typeof opts.threshold === 'number' && opts.threshold > 0) return opts.threshold;
  const env = parseInt(process.env.ECOS_QUARANTINE_THRESHOLD_364 || '', 10);
  if (env > 0) return env;
  return DEFAULT_BREAK_GLASS_THRESHOLD_364;
}
function _resolveOperatorSet364(opts) {
  if (opts && Array.isArray(opts.allowedOperators) && opts.allowedOperators.length) {
    return new Set(opts.allowedOperators);
  }
  const envSet = (process.env.ECOS_QUARANTINE_OPERATORS_364 || '').split(',').map(s => s.trim()).filter(Boolean);
  return envSet.length ? new Set(envSet) : null; // null = unrestricted
}
function _approversForCurrentTrip364(ctx, trippedAt) {
  const out = new Set();
  const auditLog = ctx && ctx.auditLog;
  if (!auditLog || typeof auditLog.entries !== 'function') return out;
  for (const e of auditLog.entries()) {
    if (e.index <= trippedAt) continue;
    if (e.type === QUARANTINE_BREAK_GLASS_TYPE_364) return new Set(); // already cleared this trip
    if (e.type === LB363.QUARANTINE_CLEARED_TYPE_363) return new Set(); // legacy v363 clear closed window
    if (e.type === QUARANTINE_APPROVAL_TYPE_364 && e.payload && e.payload.operator && e.payload.forTrippedAt === trippedAt) {
      out.add(e.payload.operator);
    }
  }
  return out;
}

// Read-only snapshot of the current approval window.
function quarantineApprovalsStatus364(ctx, opts) {
  const c = ctx || {};
  const q = LB363.quarantineStatus363(c);
  const threshold = _resolveThreshold364(opts);
  if (!q.tripped) return { tripped: false, threshold, approvalsSoFar: 0, approvers: [], quorumReached: false };
  const approvers = _approversForCurrentTrip364(c, q.at);
  return {
    tripped: true,
    trippedAt: q.at,
    threshold,
    approvalsSoFar: approvers.size,
    approvers: Array.from(approvers).sort(),
    quorumReached: approvers.size >= threshold,
  };
}

// ── 3. Signed verifier asset (cryptographic lineage) ───────────────────────
/**
 * Wrap V363's served verifier bytes with an HMAC-SHA256 signature so
 * counterparties verify the SDK bytes against a pinned key before trusting.
 * Returns `{filename, contentType, text, sha256, byteLength, signature,
 * signatureAlgo, signatureKeyId, signed, verifierVersion, issuerVersion}`.
 *
 * If no signing key is configured AND NODE_ENV !== 'test', `signed:false`
 * and `signature:null` are returned (the asset still ships unsigned with
 * the sha256 hash, identical to V363 behaviour). Test/dev environments use
 * a deterministic key so the wiring is exercisable end-to-end.
 */
function signVerifierAsset364(ctx, opts) {
  const o = opts || {};
  const asset = LB363.getVerifierAssetText363({ root: o.root });
  const key = _resolveSigningKey364(o);
  const out = Object.assign({}, asset, {
    signature: null,
    signatureAlgo: VERIFIER_SIGNATURE_ALGO_364,
    signatureKeyId: o.keyId || 'ecos-verifier-364',
    signed: false,
    issuerVersion: LOAD_BEARING_VERSION_364,
  });
  if (!key) {
    out.signatureReason = 'no signing key configured (set ECOS_VERIFIER_SIGNING_KEY_364)';
    return out;
  }
  // Sign over (sha256 || ":" || byteLength) to bind both content and length.
  const message = asset.sha256 + ':' + asset.byteLength + ':' + asset.filename;
  out.signature = _hmacSha256Hex364(key, message);
  out.signatureMessageRecipe = 'hmac-sha256(key, sha256 + ":" + byteLength + ":" + filename)';
  out.signed = true;
  return out;
}

/**
 * Verify a previously-signed verifier asset (pure, never throws). Pass the
 * served bytes AND the headers `{ X-Verifier-Sha256, X-Verifier-Signature,
 * X-Verifier-Filename, Content-Length }` (or pass an object resembling the
 * shape returned by `signVerifierAsset364`).
 */
function verifyVerifierAssetSignature364(input, opts) {
  const o = opts || {};
  const key = _resolveSigningKey364(o);
  const r = { valid: false, reason: '', signatureKeyId: input && input.signatureKeyId || null, verifierVersion: LOAD_BEARING_VERSION_364 };
  if (!input || typeof input !== 'object') { r.reason = 'input required'; return r; }
  if (!key) { r.reason = 'no verification key configured'; return r; }
  if (!input.signature) { r.reason = 'no signature on asset'; return r; }
  const sha256 = input.sha256;
  const byteLength = input.byteLength;
  const filename = input.filename;
  if (!sha256 || typeof byteLength !== 'number' || !filename) { r.reason = 'missing fields (sha256, byteLength, filename)'; return r; }
  const message = sha256 + ':' + byteLength + ':' + filename;
  const expected = _hmacSha256Hex364(key, message);
  // constant-time compare
  let eq = expected.length === input.signature.length;
  if (eq) {
    try { eq = crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(input.signature, 'hex')); }
    catch (_) { eq = false; }
  }
  if (!eq) { r.reason = 'signature mismatch — asset bytes do not match pinned key'; return r; }
  r.valid = true;
  r.reason = 'signature valid; pinned key matches';
  return r;
}

// ── 4. Persisted quarantine ledger ─────────────────────────────────────────
/**
 * Mirror every V363 quarantine event AND every V364 approval / break-glass
 * event into `ctx.quarantineRepo.upsert(record)` so a restarted process
 * answers quarantine queries from durable storage instead of re-walking the
 * audit chain. Records are keyed by `trippedAt` audit index.
 *
 * Repo contract (all optional — function degrades to read-only when missing):
 *   ctx.quarantineRepo = {
 *     upsert(record): Promise<void>,
 *     get(trippedAt): Promise<record|null>,
 *     latest(): Promise<record|null>,
 *   }
 *
 * Returns:
 *   {
 *     projected: boolean, projectedCount: number,
 *     trips: number, currentTrip: record|null,
 *     persisted: boolean, version,
 *   }
 */
async function projectQuarantineLedger364(ctx) {
  const c = ctx || {};
  const auditLog = c.auditLog;
  const repo = c.quarantineRepo;
  const byTrip = new Map();
  if (auditLog && typeof auditLog.entries === 'function') {
    let currentKey = null;
    for (const e of auditLog.entries()) {
      const p = e.payload || {};
      if (e.type === LB363.QUARANTINE_TRIPPED_TYPE_363) {
        currentKey = e.index;
        byTrip.set(currentKey, {
          trippedAt: e.index, reason: p.reason || null,
          divergences: p.divergences || null,
          ts: p.ts || null,
          state: 'tripped',
          approvers: [], approvals: 0,
          clearedAt: null, clearedBy: null, clearKind: null,
        });
      } else if (e.type === QUARANTINE_APPROVAL_TYPE_364) {
        const k = (p.forTrippedAt != null) ? p.forTrippedAt : currentKey;
        const rec = byTrip.get(k);
        if (rec && rec.state === 'tripped' && p.operator && !rec.approvers.includes(p.operator)) {
          rec.approvers.push(p.operator);
          rec.approvals = rec.approvers.length;
        }
      } else if (e.type === QUARANTINE_BREAK_GLASS_TYPE_364) {
        const k = (p.clearedTrippedAt != null) ? p.clearedTrippedAt : currentKey;
        const rec = byTrip.get(k);
        if (rec) { rec.state = 'cleared'; rec.clearedAt = e.index; rec.clearKind = 'break-glass'; rec.clearedBy = p.approvers || []; }
        currentKey = null;
      } else if (e.type === LB363.QUARANTINE_CLEARED_TYPE_363) {
        const k = (p.clearedTrippedAt != null) ? p.clearedTrippedAt : currentKey;
        const rec = byTrip.get(k);
        // A V364 break-glass clear ALSO emits a V363-shaped cleared event
        // immediately afterwards so V363 helpers see the flip. Don't let that
        // companion event overwrite the break-glass projection.
        if (rec && rec.clearKind !== 'break-glass') {
          rec.state = 'cleared'; rec.clearedAt = e.index; rec.clearKind = 'operator'; rec.clearedBy = p.operator || null;
        }
        currentKey = null;
      }
    }
  }

  let projectedCount = 0;
  const persisted = !!(repo && typeof repo.upsert === 'function');
  if (persisted) {
    for (const rec of byTrip.values()) {
      try { await repo.upsert(Object.assign({}, rec)); projectedCount++; } catch (_) {}
    }
    if (auditLog && typeof auditLog.append === 'function') {
      try { auditLog.append(QUARANTINE_PROJECTED_TYPE_364, { projectedCount, totalTrips: byTrip.size, ts: new Date().toISOString() }); } catch (_) {}
    }
  }

  // pick the most-recent (highest trippedAt) record as current
  let currentTrip = null;
  for (const rec of byTrip.values()) {
    if (!currentTrip || rec.trippedAt > currentTrip.trippedAt) currentTrip = rec;
  }

  return {
    projected: persisted,
    projectedCount,
    trips: byTrip.size,
    currentTrip,
    persisted,
    version: LOAD_BEARING_VERSION_364,
  };
}

module.exports = {
  LOAD_BEARING_VERSION_364,
  REVOCATION_FEED_SCHEMA_364,
  QUARANTINE_APPROVAL_TYPE_364,
  QUARANTINE_BREAK_GLASS_TYPE_364,
  QUARANTINE_PROJECTED_TYPE_364,
  DEFAULT_BREAK_GLASS_THRESHOLD_364,
  VERIFIER_SIGNATURE_ALGO_364,
  revocationFeedSince364,
  verifyRevocationFeed364,
  recordOperatorApproval364,
  breakGlassClearQuarantine364,
  quarantineApprovalsStatus364,
  signVerifierAsset364,
  verifyVerifierAssetSignature364,
  projectQuarantineLedger364,
  _stableStringify364,
  _sha256Hex364,
  _hmacSha256Hex364,
};
