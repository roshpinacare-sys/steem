'use strict';
/**
 * lib/economicIntegrityLoadBearing361.js — ECOS V361 (Phase P249)
 *
 * STRATEGIC THESIS — Make integrity LOAD-BEARING, not just observable.
 * V360 produced a continuously-signed integrity attestation but nothing required
 * it: a `compromised` proof was advisory. V361 wires the proof into the four
 * leverage points the V360 hand-off identified:
 *
 *   1. requireIntegrityVerified361(ctx, opts)
 *        Gate function callers invoke BEFORE any ledger write, payout, or
 *        reward issuance. Returns { allowed, attestation, reason }. If
 *        attestation is `compromised`, returns allowed=false → caller halts.
 *
 *   2. scheduleIntegrityAttestation361(ctx, opts)
 *        Periodically (and on demand, e.g. after settlement) computes the
 *        attestation and APPENDS it to the audit log as event
 *        'integrity.attested361'. The integrity record itself becomes
 *        auditable over time (self-referential trust).
 *
 *   3. verifyPersistedAuditChain361(auditRepo)
 *        Wraps db/auditRepo.verifyAudit() so tamper-evidence covers the
 *        durable, DB-persisted chain — not only the in-memory chain V360
 *        verified.
 *
 *   4. buildExternalAttestation361(ctx)
 *        Produces a portable, signed JSON envelope plus a verification
 *        RECIPE that a B2B client can independently re-check. This is the
 *        institutional trust artifact: the attestation a counterparty can
 *        archive and replay.
 *
 * Pure + dependency-free (R3, R6 — reuses crypto + V360 primitives only).
 * Every public identifier ends with 361 (R2). Sacred files untouched (R1).
 *
 * @version 361.0.0
 */

const P360 = require('./economicIntegrityProof360.js');

const LOAD_BEARING_VERSION_361 = '361.0.0';
const INTEGRITY_EVENT_TYPE_361 = 'integrity.attested361';
const DEFAULT_ATTEST_INTERVAL_MS_361 = 60_000; // once a minute by default

// ── 1. Gate economic mutation on integrity ─────────────────────────────────
/**
 * Hard gate: a single proven failure (`failClosed`) HALTS the caller. If the
 * proof is `partial` (some dimensions unavailable), callers may opt in to
 * strict mode (`requireFullProof=true`) to halt on partial as well.
 *
 * Usage:
 *   const g = requireIntegrityVerified361(ctx);
 *   if (!g.allowed) throw new Error('integrity gate: ' + g.reason);
 */
function requireIntegrityVerified361(ctx, opts = {}) {
  const att = P360.assessEconomicIntegrity360(ctx || {});
  const requireFull = !!opts.requireFullProof;
  if (att.failClosed) {
    return { allowed: false, attestation: att, reason: 'compromised: ' + _firstFailure361(att) };
  }
  if (requireFull && att.overallIntegrity !== 'verified') {
    return { allowed: false, attestation: att, reason: 'partial proof not accepted in strict mode' };
  }
  return { allowed: true, attestation: att, reason: 'ok:' + att.overallIntegrity };
}

function _firstFailure361(att) {
  const d = att && att.summary ? att.summary : {};
  for (const k of ['chain', 'conservation', 'split', 'backing']) {
    if (d[k] === false) return k;
  }
  return 'unknown';
}

// ── 2. Periodic attestation → audit log ────────────────────────────────────
/**
 * Append a signed attestation to the audit log. Returns the attestation +
 * the audit entry's index (when known). Pure aside from the audit append.
 */
function appendAttestationToAudit361(ctx) {
  const att = P360.assessEconomicIntegrity360(ctx || {});
  const auditLog = ctx && ctx.auditLog;
  let appended = null;
  if (auditLog && typeof auditLog.append === 'function') {
    const payload = {
      v: att.version,
      overall: att.overallIntegrity,
      failClosed: att.failClosed,
      dims: att.summary,
      attestationHash: att.attestationHash,
      generatedAt: att.generatedAt,
    };
    try {
      const r = auditLog.append(INTEGRITY_EVENT_TYPE_361, payload);
      appended = (r && (r.index != null ? r.index : (r.seq != null ? r.seq - 1 : null)));
    } catch (e) {
      appended = null;
    }
  }
  return { attestation: att, appendedIndex: appended, eventType: INTEGRITY_EVENT_TYPE_361 };
}

/**
 * Schedule periodic attestations. Returns a controller:
 *   { start(), stop(), triggerNow(), isRunning(), lastAttestation }.
 *
 * - intervalMs: cadence in ms (default 60 s).
 * - onSettlement: callers can also invoke controller.triggerNow() after each
 *   settlement to make the cadence event-driven as well as time-driven.
 * - The scheduler NEVER throws; if the audit log is unavailable the
 *   attestation is still computed and exposed on `lastAttestation`.
 */
function scheduleIntegrityAttestation361(ctx, opts = {}) {
  const intervalMs = Math.max(1_000, Number(opts.intervalMs) || DEFAULT_ATTEST_INTERVAL_MS_361);
  let timer = null;
  const state = { lastAttestation: null, lastAppendedIndex: null, runs: 0 };
  function tick() {
    try {
      const r = appendAttestationToAudit361(ctx);
      state.lastAttestation = r.attestation;
      state.lastAppendedIndex = r.appendedIndex;
      state.runs += 1;
      if (typeof opts.onAttest === 'function') {
        try { opts.onAttest(r); } catch (_) {}
      }
    } catch (_) { /* never throw from the scheduler */ }
  }
  return {
    start() {
      if (timer) return false;
      tick(); // immediate baseline attestation
      timer = setInterval(tick, intervalMs);
      if (timer && typeof timer.unref === 'function') timer.unref();
      return true;
    },
    stop() {
      if (!timer) return false;
      clearInterval(timer); timer = null; return true;
    },
    triggerNow() { tick(); return state.lastAttestation; },
    isRunning() { return timer != null; },
    get lastAttestation() { return state.lastAttestation; },
    get lastAppendedIndex() { return state.lastAppendedIndex; },
    get runs() { return state.runs; },
    intervalMs,
  };
}

// ── 3. Persisted-chain verification (DB-backed) ────────────────────────────
/**
 * Wrap db/auditRepo.verifyAudit() in the same shape V360 uses for the
 * in-memory chain. Async because the underlying call is async. Returns
 *   { ran, valid, brokenAtIndex, reason, entryCount, persisted: true }.
 */
async function verifyPersistedAuditChain361(auditRepo) {
  if (!auditRepo || typeof auditRepo.verifyAudit !== 'function') {
    return { ran: false, valid: null, reason: 'no persisted auditRepo provided', persisted: true };
  }
  let r;
  try { r = await auditRepo.verifyAudit(); }
  catch (e) { return { ran: true, valid: false, reason: 'verifyAudit threw: ' + e.message, persisted: true }; }
  const valid = !!(r && r.ok === true);
  const brokenAtIndex = (r && r.brokenAt != null) ? r.brokenAt : null;
  const entryCount = r && (r.length != null ? r.length : null);
  return { ran: true, valid, brokenAtIndex, reason: r && r.reason, entryCount, persisted: true };
}

// ── 4. External attestation export ─────────────────────────────────────────
/**
 * Build a portable attestation envelope + verification recipe a B2B client
 * can re-check independently. The envelope is itself signed (envelopeHash is
 * a sha256 over the canonical envelope minus the envelopeHash field) so a
 * counterparty can detect any tampering in transit.
 */
function buildExternalAttestation361(ctx) {
  const att = P360.assessEconomicIntegrity360(ctx || {});
  const envelope = {
    schema: 'ecos.integrity.attestation/v361',
    issuer: 'ECOS',
    version: LOAD_BEARING_VERSION_361,
    proofVersion: att.version,
    generatedAt: att.generatedAt,
    overallIntegrity: att.overallIntegrity,
    failClosed: att.failClosed,
    dimensions: att.summary,                      // boolean-per-dimension summary
    detail: _publicDetail361(att.dimensions),     // public, non-sensitive numerics
    attestationHash: att.attestationHash,         // V360 inner hash
  };
  const canonical = _stableStringify361(envelope);
  const envelopeHash = require('crypto').createHash('sha256').update(canonical).digest('hex');
  const signed = Object.assign({}, envelope, { envelopeHash });
  return {
    envelope: signed,
    recipe: _externalVerificationRecipe361(),
  };
}

function _publicDetail361(dims) {
  const d = dims || {};
  return {
    chain: d.chain ? { ran: d.chain.ran, valid: d.chain.valid, entryCount: d.chain.entryCount, brokenAtIndex: d.chain.brokenAtIndex } : null,
    conservation: d.conservation ? {
      ran: d.conservation.ran, conserved: d.conservation.conserved,
      externalIn: d.conservation.externalIn, externalOut: d.conservation.externalOut,
      totalBalances: d.conservation.totalBalances, driftMicro: d.conservation.driftMicro,
    } : null,
    split: d.split ? { ran: d.split.ran, conserved: d.split.conserved, checked: d.split.checked, leakCount: d.split.leaks ? d.split.leaks.length : 0 } : null,
    backing: d.backing ? { ran: d.backing.ran, backed: d.backing.backed, backingRatio: d.backing.backingRatio } : null,
  };
}

function _externalVerificationRecipe361() {
  return {
    description: 'Independent verification recipe for ECOS V361 external attestations.',
    steps: [
      '1. Strip the `envelopeHash` field from the received envelope.',
      '2. Stable-stringify the remaining object with keys sorted lexicographically at every depth (UTF-8).',
      '3. Compute sha256(hex) of that canonical string.',
      '4. Compare with the supplied `envelopeHash`. If different → envelope tampered in transit.',
      '5. If `overallIntegrity` is "compromised" or `failClosed` is true → halt any economic action that depends on this attestation.',
      '6. (Optional) Re-derive the inner `attestationHash` from { version, generatedAt, overallIntegrity, dimensions-summary } using the same procedure (V360 spec).',
    ],
    canonicalization: 'sort object keys lexicographically; arrays preserve order; numbers serialized as-is; strings UTF-8.',
    hash: 'sha256-hex',
  };
}

// Stable JSON stringify — sorts object keys at every depth so the envelope
// hash is reproducible regardless of insertion order.
function _stableStringify361(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(_stableStringify361).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + _stableStringify361(value[k])).join(',') + '}';
}

module.exports = {
  LOAD_BEARING_VERSION_361,
  INTEGRITY_EVENT_TYPE_361,
  DEFAULT_ATTEST_INTERVAL_MS_361,
  requireIntegrityVerified361,
  appendAttestationToAudit361,
  scheduleIntegrityAttestation361,
  verifyPersistedAuditChain361,
  buildExternalAttestation361,
  _stableStringify361,
  _firstFailure361,
  _publicDetail361,
  _externalVerificationRecipe361,
};
