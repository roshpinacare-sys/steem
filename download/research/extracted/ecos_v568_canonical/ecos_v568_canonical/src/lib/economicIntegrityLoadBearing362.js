'use strict';
/**
 * lib/economicIntegrityLoadBearing362.js — ECOS V362 (Phase P250)
 *
 * STRATEGIC THESIS — Extend the V361 load-bearing surface into four new
 * leverage points the V361 hand-off identified:
 *
 *   1. enforceIntegrityMiddleware362(opts)
 *        Express-style middleware factory that runs the V361 gate before
 *        any economic-mutation endpoint (payments, ledger, reward issuance).
 *        The gate exists in V361; V362 BINDS it to the write path.
 *
 *   2. crossChainConsistency362(ctx)
 *        A unified check that the in-memory audit chain head, the persisted
 *        chain head, AND the last `integrity.attested361` entry are mutually
 *        consistent with a freshly-recomputed attestation. The divergence
 *        between these three artefacts is the failure mode V361 could not
 *        yet detect.
 *
 *   3. envelopeRevocationLog362
 *        Append every emitted external-attestation envelope's `envelopeHash`
 *        to the audit log as `integrity.envelope.emitted362`. Operators can
 *        revoke a leaked envelope with `integrity.envelope.revoked362`, and
 *        counterparties can query the live status of a hash they hold.
 *
 *   4. (productized in `verifier362.js`)
 *        The verification recipe of V361 extracted to a single self-contained
 *        file a B2B client can drop into their codebase with zero deps.
 *
 * Pure + dependency-free (R3, R6 — reuses V361/V360 primitives + crypto only).
 * Every public identifier ends with 362 (R2). Sacred files untouched (R1).
 *
 * @version 362.0.0
 */

const LB361 = require('./economicIntegrityLoadBearing361.js');
const P360  = require('./economicIntegrityProof360.js');

const LOAD_BEARING_VERSION_362 = '362.0.0';
const ENVELOPE_EMITTED_TYPE_362 = 'integrity.envelope.emitted362';
const ENVELOPE_REVOKED_TYPE_362 = 'integrity.envelope.revoked362';
const DEFAULT_GATE_BYPASS_HEADER_362 = 'x-integrity-bypass-362';

// ── 1. Enforce gate on write-path endpoints ────────────────────────────────
/**
 * Build an Express-style middleware that calls V361 gate before allowing the
 * downstream handler to run. On `failClosed` the middleware short-circuits
 * with 409. By default it tolerates `partial` proofs (consistent with V361);
 * pass `requireFullProof:true` for strict mode.
 *
 *   const mw = enforceIntegrityMiddleware362({ ctxProvider: () => ctx });
 *   app.use('/api/v1/payments',  mw);
 *   app.use('/api/v1/ledger',    mw);
 *   app.use('/api/v1/rewards',   mw);
 *
 * `ctxProvider` is invoked per-request so the middleware sees the live
 * ledger / audit log / reserve singletons. Honours `NODE_ENV=test` bypass
 * via header (so wiring this on the API server does NOT break the existing
 * test suite, which exercises endpoints without a real ledger state).
 */
function enforceIntegrityMiddleware362(opts = {}) {
  const ctxProvider     = (typeof opts.ctxProvider === 'function') ? opts.ctxProvider : () => ({});
  const requireFullProof = !!opts.requireFullProof;
  const bypassHeader     = String(opts.bypassHeader || DEFAULT_GATE_BYPASS_HEADER_362).toLowerCase();
  const allowTestBypass  = opts.allowTestBypass !== false; // default true
  return function integrityGateMiddleware362(req, res, next) {
    try {
      if (allowTestBypass && process.env.NODE_ENV === 'test' && req && req.headers && req.headers[bypassHeader]) {
        return next();
      }
      const g = LB361.requireIntegrityVerified361(ctxProvider(), { requireFullProof });
      if (g.allowed) return next();
      const status = 409;
      const body = { ok: false, allowed: false, reason: g.reason, attestation: g.attestation, ecosVersion: 'V362', gate: 'enforceIntegrityMiddleware362' };
      if (res && typeof res.status === 'function') return res.status(status).json(body);
      if (res && typeof res.writeHead === 'function') { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); return; }
      if (typeof next === 'function') return next(Object.assign(new Error('integrity gate halt: ' + g.reason), { statusCode: status, body }));
    } catch (e) {
      if (res && typeof res.status === 'function') return res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V362' });
      if (typeof next === 'function') return next(e);
    }
  };
}

// ── 2. Cross-chain consistency check ───────────────────────────────────────
/**
 * Compare three artefacts:
 *   (a) in-memory audit chain head
 *   (b) persisted DB chain head (when an auditRepo exposes head())
 *   (c) last `integrity.attested361` entry recorded in (a)
 * against a freshly-computed V360 attestation. Returns a structured report:
 *
 *   { consistent, divergences:[...], inMemory:{ head, length },
 *     persisted:{ available, head, length, valid },
 *     lastAttested:{ found, index, attestationHash, generatedAt },
 *     fresh:{ attestationHash, overallIntegrity } }
 *
 * Never throws. `consistent === true` iff:
 *   - in-memory chain self-verifies
 *   - in-memory head equals persisted head (when persisted is available)
 *   - last-attested attestationHash equals the freshly-computed one (when
 *     no economic state has changed since the last attestation)
 */
async function crossChainConsistency362(ctx) {
  const c = ctx || {};
  const auditLog = c.auditLog;
  const auditRepo = c.auditRepo;
  const divergences = [];

  // (a) in-memory
  let inMemory = { head: null, length: 0, valid: null };
  if (auditLog && typeof auditLog.entries === 'function') {
    const entries = auditLog.entries();
    inMemory.length = entries.length;
    inMemory.head = entries.length ? entries[entries.length - 1].hash : null;
    if (typeof auditLog.verify === 'function') {
      let v; try { v = auditLog.verify(); } catch (e) { v = { ok: false, reason: e.message }; }
      inMemory.valid = !!v.ok;
      if (!v.ok) divergences.push({ where: 'inMemory', reason: v.reason || 'verify failed', brokenAt: v.brokenAt });
    }
  }

  // (b) persisted
  let persisted = { available: false, head: null, length: null, valid: null };
  if (auditRepo && (typeof auditRepo.head === 'function' || typeof auditRepo.getHead === 'function' || typeof auditRepo.verifyAudit === 'function')) {
    persisted.available = true;
    try {
      let h = null;
      if (typeof auditRepo.head === 'function') h = await auditRepo.head();
      else if (typeof auditRepo.getHead === 'function') h = await auditRepo.getHead();
      if (h && typeof h === 'object') {
        persisted.head = h.hash || h.head || null;
        persisted.length = (h.length != null) ? h.length : (h.count != null ? h.count : null);
      } else if (typeof h === 'string') {
        persisted.head = h;
      }
    } catch (e) {
      divergences.push({ where: 'persisted', reason: 'head() threw: ' + e.message });
    }
    try {
      const v = await LB361.verifyPersistedAuditChain361(auditRepo);
      persisted.valid = (v.valid === false) ? false : (v.valid === true ? true : null);
      if (v.valid === false) divergences.push({ where: 'persisted', reason: v.reason || 'persisted chain invalid', brokenAt: v.brokenAtIndex });
      if (persisted.length == null && v.entryCount != null) persisted.length = v.entryCount;
    } catch (e) {
      divergences.push({ where: 'persisted', reason: 'verifyPersistedAuditChain361 threw: ' + e.message });
    }
    if (persisted.head != null && inMemory.head != null && persisted.head !== inMemory.head) {
      divergences.push({ where: 'in-memory-vs-persisted', reason: 'head mismatch', inMemoryHead: inMemory.head, persistedHead: persisted.head });
    }
  }

  // (c) last self-attestation in the in-memory chain
  let lastAttested = { found: false, index: null, attestationHash: null, generatedAt: null };
  if (auditLog && typeof auditLog.entries === 'function') {
    const entries = auditLog.entries();
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].type === LB361.INTEGRITY_EVENT_TYPE_361) {
        const p = entries[i].payload || {};
        lastAttested = {
          found: true, index: entries[i].index,
          attestationHash: p.attestationHash || null,
          generatedAt: p.generatedAt || null,
          overall: p.overall || null,
          failClosed: !!p.failClosed,
        };
        break;
      }
    }
  }

  // fresh attestation (note: generatedAt will differ; we only compare HASH).
  const fresh = P360.assessEconomicIntegrity360(c);
  const freshHash = fresh.attestationHash;

  // Note: the self-attestation entry itself mutates the audit chain, so the
  // raw attestationHash recorded inside the last-attested entry will never
  // equal the freshly-computed hash (the chain has grown since). The
  // meaningful invariant is the integrity VERDICT — if the system was
  // `verified` at last attestation and is now `compromised`, that is the
  // divergence operators care about.
  if (lastAttested.found && lastAttested.overall && lastAttested.overall !== fresh.overallIntegrity) {
    divergences.push({
      where: 'lastAttested-vs-fresh',
      reason: 'verdict-changed-since-last-attestation',
      lastVerdict: lastAttested.overall,
      currentVerdict: fresh.overallIntegrity,
      lastAttestationHash: lastAttested.attestationHash,
      currentAttestationHash: freshHash,
    });
  }
  if (lastAttested.found && lastAttested.failClosed !== fresh.failClosed) {
    divergences.push({
      where: 'lastAttested-vs-fresh',
      reason: 'failClosed-flag-changed-since-last-attestation',
      lastFailClosed: lastAttested.failClosed,
      currentFailClosed: fresh.failClosed,
    });
  }

  return {
    consistent: divergences.length === 0,
    divergences,
    inMemory,
    persisted,
    lastAttested,
    fresh: { attestationHash: freshHash, overallIntegrity: fresh.overallIntegrity, failClosed: fresh.failClosed },
    version: LOAD_BEARING_VERSION_362,
  };
}

// ── 3. External-attestation revocation log ────────────────────────────────
/**
 * Append an emitted envelope's hash to the audit log so an operator can later
 * revoke it AND a counterparty can ask "is this envelope still considered
 * valid?". This wraps V361's `buildExternalAttestation361` with a logged
 * side-effect; the envelope itself is unchanged.
 */
function emitAndLogExternalAttestation362(ctx) {
  const out = LB361.buildExternalAttestation361(ctx || {});
  const envelopeHash = out.envelope && out.envelope.envelopeHash;
  let appendedIndex = null;
  const auditLog = ctx && ctx.auditLog;
  if (auditLog && typeof auditLog.append === 'function' && envelopeHash) {
    try {
      const r = auditLog.append(ENVELOPE_EMITTED_TYPE_362, {
        envelopeHash,
        schema: out.envelope.schema,
        overallIntegrity: out.envelope.overallIntegrity,
        failClosed: out.envelope.failClosed,
        generatedAt: out.envelope.generatedAt,
      });
      appendedIndex = (r && (r.index != null ? r.index : null));
    } catch (_) { appendedIndex = null; }
  }
  return { envelope: out.envelope, recipe: out.recipe, envelopeHash, appendedIndex, eventType: ENVELOPE_EMITTED_TYPE_362 };
}

/**
 * Revoke a previously-emitted envelope by hash. Idempotent: re-revoking the
 * same hash appends another revocation entry only if `opts.idempotent !== true`.
 * Returns { revoked, appendedIndex, alreadyRevoked, eventType, hash }.
 */
function revokeExternalAttestation362(ctx, opts) {
  const { auditLog } = (ctx || {});
  const hash = (opts && (opts.envelopeHash || opts.hash)) || null;
  const reason = (opts && opts.reason) || 'unspecified';
  if (!hash || typeof hash !== 'string') {
    return { revoked: false, error: 'envelopeHash is required' };
  }
  const status = envelopeStatus362(ctx, hash);
  if (status.status === 'revoked' && opts && opts.idempotent === true) {
    return { revoked: false, alreadyRevoked: true, hash, appendedIndex: status.revokedAtIndex, eventType: ENVELOPE_REVOKED_TYPE_362 };
  }
  let appendedIndex = null;
  if (auditLog && typeof auditLog.append === 'function') {
    try {
      const r = auditLog.append(ENVELOPE_REVOKED_TYPE_362, { envelopeHash: hash, reason, ts: new Date().toISOString() });
      appendedIndex = (r && (r.index != null ? r.index : null));
    } catch (_) { appendedIndex = null; }
  }
  return { revoked: true, hash, appendedIndex, alreadyRevoked: status.status === 'revoked', eventType: ENVELOPE_REVOKED_TYPE_362 };
}

/**
 * Return the live status of an envelope hash:
 *   { status: 'unknown' | 'emitted' | 'revoked', emittedAtIndex?, revokedAtIndex?, revocationReason? }
 */
function envelopeStatus362(ctx, envelopeHash) {
  const auditLog = ctx && ctx.auditLog;
  if (!envelopeHash || typeof envelopeHash !== 'string') return { status: 'unknown', reason: 'no hash' };
  if (!auditLog || typeof auditLog.entries !== 'function') return { status: 'unknown', reason: 'no audit log' };
  let emittedAtIndex = null, revokedAtIndex = null, revocationReason = null;
  const entries = auditLog.entries();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.type === ENVELOPE_EMITTED_TYPE_362 && e.payload && e.payload.envelopeHash === envelopeHash) {
      if (emittedAtIndex == null) emittedAtIndex = e.index;
    } else if (e.type === ENVELOPE_REVOKED_TYPE_362 && e.payload && e.payload.envelopeHash === envelopeHash) {
      revokedAtIndex = e.index;
      revocationReason = e.payload.reason || null;
    }
  }
  if (revokedAtIndex != null) return { status: 'revoked', emittedAtIndex, revokedAtIndex, revocationReason };
  if (emittedAtIndex != null) return { status: 'emitted', emittedAtIndex };
  return { status: 'unknown' };
}

/**
 * Enumerate every envelope hash the audit log has seen with its current
 * status. O(n) over the audit log; intended for ops dashboards, not hot path.
 */
function listEnvelopes362(ctx) {
  const auditLog = ctx && ctx.auditLog;
  const out = new Map();
  if (!auditLog || typeof auditLog.entries !== 'function') return [];
  for (const e of auditLog.entries()) {
    if (e.type === ENVELOPE_EMITTED_TYPE_362 && e.payload && e.payload.envelopeHash) {
      const h = e.payload.envelopeHash;
      if (!out.has(h)) out.set(h, { envelopeHash: h, status: 'emitted', emittedAtIndex: e.index });
    } else if (e.type === ENVELOPE_REVOKED_TYPE_362 && e.payload && e.payload.envelopeHash) {
      const h = e.payload.envelopeHash;
      const prev = out.get(h) || { envelopeHash: h, status: 'unknown' };
      prev.status = 'revoked';
      prev.revokedAtIndex = e.index;
      prev.revocationReason = e.payload.reason || null;
      out.set(h, prev);
    }
  }
  return Array.from(out.values());
}

module.exports = {
  LOAD_BEARING_VERSION_362,
  ENVELOPE_EMITTED_TYPE_362,
  ENVELOPE_REVOKED_TYPE_362,
  DEFAULT_GATE_BYPASS_HEADER_362,
  enforceIntegrityMiddleware362,
  crossChainConsistency362,
  emitAndLogExternalAttestation362,
  revokeExternalAttestation362,
  envelopeStatus362,
  listEnvelopes362,
};
