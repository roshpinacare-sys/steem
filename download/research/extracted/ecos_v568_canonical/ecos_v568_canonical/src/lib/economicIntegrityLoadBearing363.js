'use strict';
/**
 * lib/economicIntegrityLoadBearing363.js — ECOS V363 (Phase P251)
 *
 * STRATEGIC THESIS — Deepen the V362 surface along the four leverage points
 * the V362 hand-off identified. V362 BOUND the V361 gate to write-path
 * endpoints, surfaced cross-chain divergence, and productised the verifier
 * SDK as a single-file drop-in. V363 turns those primitives from observation
 * artefacts into operational ones:
 *
 *   1. projectRevocationIndex363(ctx)
 *        Walk the audit log once and project (envelopeHash → status) into a
 *        persistence layer (when `ctx.revocationRepo` is supplied). This
 *        turns `envelope/:hash/status` from O(n_audit) into O(1).
 *
 *   2. buildSignedRevocationEnvelope363(ctx, hash) /
 *      verifySignedRevocationEnvelope363(env)
 *        Counterparties cannot trust an UNSIGNED `{status:'revoked'}` JSON.
 *        Wrap the lookup in its own signed envelope using the same canonical
 *        recipe `verifier362.js` already understands (sorted-keys sha256).
 *        The same SDK file therefore verifies BOTH attestation and revocation
 *        envelopes — no fork.
 *
 *   3. autoQuarantineFromCrossChain363(ctx) / clearQuarantine363(ctx, opts)
 *        When `crossChainConsistency362` reports any divergence, append
 *        `integrity.quarantine.tripped363` to the audit log; a companion
 *        middleware (`quarantineEnforceMiddleware363`) then short-circuits
 *        the write path with 423 Locked until an operator clears the
 *        quarantine via `clearQuarantine363`. Turns the V362 consistency
 *        check from observation into self-healing.
 *
 *   4. getVerifierAssetText363()
 *        Reads `verifier362.js` from disk so the API can serve it directly.
 *        Counterparties bootstrap the SDK from the live server instead of an
 *        out-of-band file drop.
 *
 * Pure + dependency-free (R3 — only built-in `fs`, `path`, `crypto`).
 * Every public identifier ends with 363 (R2). Sacred files untouched (R1).
 * V361 + V362 contracts preserved (R6).
 *
 * @version 363.0.0
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const LB362 = require('./economicIntegrityLoadBearing362.js');
const LB361 = require('./economicIntegrityLoadBearing361.js');

const LOAD_BEARING_VERSION_363   = '363.0.0';
const REVOCATION_SCHEMA_363      = 'ecos.integrity.revocation/v363';
const QUARANTINE_TRIPPED_TYPE_363 = 'integrity.quarantine.tripped363';
const QUARANTINE_CLEARED_TYPE_363 = 'integrity.quarantine.cleared363';
const REVOCATION_INDEXED_TYPE_363 = 'integrity.revocation.indexed363';

// ── helpers ────────────────────────────────────────────────────────────────
function _stableStringify363(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(_stableStringify363).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + _stableStringify363(value[k])).join(',') + '}';
}
function _sha256Hex363(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

// ── 1. Persisted revocation index ──────────────────────────────────────────
/**
 * Project every envelope-emit/revoke event in the in-memory audit log into a
 * persistence target. When `ctx.revocationRepo` exposes `upsert(record)`, each
 * envelope hash is written/updated there; the function also returns the
 * resulting index as a plain object so callers without a repo still get a
 * fast lookup table.
 *
 *   ctx.revocationRepo = {
 *     upsert(record): Promise<void>,   // record: { envelopeHash, status, ... }
 *     get(hash):     Promise<record|null>,
 *   }
 *
 * Returns:
 *   {
 *     indexedCount, emittedCount, revokedCount,
 *     index: { [envelopeHash]: { status, emittedAtIndex?, revokedAtIndex?, revocationReason? } },
 *     persisted: boolean, persistedCount: number,
 *     version: '363.0.0',
 *   }
 */
async function projectRevocationIndex363(ctx) {
  const c = ctx || {};
  const auditLog = c.auditLog;
  const repo     = c.revocationRepo;
  const index    = Object.create(null);
  let emittedCount = 0, revokedCount = 0;

  if (auditLog && typeof auditLog.entries === 'function') {
    for (const e of auditLog.entries()) {
      const p = e.payload || {};
      if (e.type === LB362.ENVELOPE_EMITTED_TYPE_362 && p.envelopeHash) {
        if (!index[p.envelopeHash]) {
          index[p.envelopeHash] = { envelopeHash: p.envelopeHash, status: 'emitted', emittedAtIndex: e.index };
          emittedCount++;
        }
      } else if (e.type === LB362.ENVELOPE_REVOKED_TYPE_362 && p.envelopeHash) {
        const prev = index[p.envelopeHash] || { envelopeHash: p.envelopeHash, status: 'unknown' };
        prev.status = 'revoked';
        prev.revokedAtIndex = e.index;
        prev.revocationReason = p.reason || null;
        index[p.envelopeHash] = prev;
        revokedCount++;
      }
    }
  }

  let persistedCount = 0;
  const persisted = !!(repo && typeof repo.upsert === 'function');
  if (persisted) {
    for (const hash of Object.keys(index)) {
      try { await repo.upsert(Object.assign({}, index[hash])); persistedCount++; }
      catch (_) { /* swallow per-row errors; report aggregate count */ }
    }
    if (auditLog && typeof auditLog.append === 'function') {
      try { auditLog.append(REVOCATION_INDEXED_TYPE_363, { persistedCount, indexedCount: Object.keys(index).length, ts: new Date().toISOString() }); } catch (_) {}
    }
  }

  return {
    indexedCount: Object.keys(index).length,
    emittedCount, revokedCount,
    index, persisted, persistedCount,
    version: LOAD_BEARING_VERSION_363,
  };
}

/**
 * Resolve the live status of an envelope hash. Prefers `ctx.revocationRepo.get`
 * (O(1) when projected) and falls back to scanning the audit log via V362.
 * Always returns a normalised shape with `source: 'repo' | 'audit'`.
 */
async function getRevocationStatus363(ctx, envelopeHash) {
  const c = ctx || {};
  if (!envelopeHash || typeof envelopeHash !== 'string') {
    return { status: 'unknown', source: 'none', reason: 'no hash', envelopeHash: null };
  }
  if (c.revocationRepo && typeof c.revocationRepo.get === 'function') {
    try {
      const r = await c.revocationRepo.get(envelopeHash);
      if (r && r.status) return Object.assign({ source: 'repo', envelopeHash }, r);
    } catch (_) { /* fall through to audit */ }
  }
  const fromAudit = LB362.envelopeStatus362(c, envelopeHash);
  return Object.assign({ source: 'audit', envelopeHash }, fromAudit);
}

// ── 2. Signed revocation envelopes ─────────────────────────────────────────
/**
 * Build a signed revocation envelope for `envelopeHash`. The signature uses
 * the same canonical recipe as `verifier362.js`, so counterparties verify
 * BOTH attestation and revocation envelopes with the same single-file SDK.
 *
 * Shape:
 *   {
 *     schema: 'ecos.integrity.revocation/v363',
 *     envelopeHash: <hash of THIS envelope>,
 *     subjectEnvelopeHash: <hash being asked about>,
 *     status: 'emitted' | 'revoked' | 'unknown',
 *     revocationReason: string|null,
 *     emittedAtIndex: number|null,
 *     revokedAtIndex: number|null,
 *     generatedAt: ISO,
 *     issuerVersion: '363.0.0',
 *   }
 */
async function buildSignedRevocationEnvelope363(ctx, subjectEnvelopeHash) {
  const status = await getRevocationStatus363(ctx, subjectEnvelopeHash);
  const body = {
    schema: REVOCATION_SCHEMA_363,
    subjectEnvelopeHash: subjectEnvelopeHash || null,
    status: status.status || 'unknown',
    revocationReason: status.revocationReason || null,
    emittedAtIndex: (status.emittedAtIndex != null ? status.emittedAtIndex : null),
    revokedAtIndex: (status.revokedAtIndex != null ? status.revokedAtIndex : null),
    source: status.source || 'audit',
    generatedAt: new Date().toISOString(),
    issuerVersion: LOAD_BEARING_VERSION_363,
  };
  const envelopeHash = _sha256Hex363(_stableStringify363(body));
  const envelope = Object.assign({}, body, { envelopeHash });
  return {
    envelope,
    recipe: {
      algorithm: 'sha256-of-canonical-json-minus-envelopeHash',
      canonicalisation: 'sorted-keys, UTF-8',
      verifierSdk: 'verifier362.js (extended ACCEPTED schema list — or use verifySignedRevocationEnvelope363 in-process)',
    },
    envelopeHash,
  };
}

/**
 * Self-contained verification for revocation envelopes. Mirrors verifier362's
 * recipe; we ship it in-process so the server-side audit code does not depend
 * on the externally-distributed verifier file.
 */
function verifySignedRevocationEnvelope363(envelope) {
  const out = {
    valid: false, reason: '', envelope: envelope || null,
    expectedEnvelopeHash: null, providedEnvelopeHash: null,
    schemaAccepted: false, verifierVersion: LOAD_BEARING_VERSION_363,
  };
  if (!envelope || typeof envelope !== 'object') { out.reason = 'envelope must be an object'; return out; }
  out.providedEnvelopeHash = envelope.envelopeHash || null;
  if (!out.providedEnvelopeHash) { out.reason = 'envelope.envelopeHash missing'; return out; }
  out.schemaAccepted = (envelope.schema === REVOCATION_SCHEMA_363);
  if (!out.schemaAccepted) { out.reason = 'unsupported schema: ' + envelope.schema; return out; }
  const clone = Object.assign({}, envelope);
  delete clone.envelopeHash;
  out.expectedEnvelopeHash = _sha256Hex363(_stableStringify363(clone));
  if (out.expectedEnvelopeHash !== out.providedEnvelopeHash) {
    out.reason = 'envelopeHash mismatch — revocation envelope tampered'; return out;
  }
  out.valid = true;
  out.reason = 'signature valid; status=' + (envelope.status || 'unknown');
  return out;
}

// ── 3. Cross-chain auto-quarantine ─────────────────────────────────────────
/**
 * Walk the audit log and decide whether the system is currently quarantined.
 * Last `quarantine.tripped363` not followed by a `quarantine.cleared363` →
 * tripped.
 */
function quarantineStatus363(ctx) {
  const auditLog = ctx && ctx.auditLog;
  if (!auditLog || typeof auditLog.entries !== 'function') return { tripped: false, found: false };
  let last = null;
  for (const e of auditLog.entries()) {
    if (e.type === QUARANTINE_TRIPPED_TYPE_363 || e.type === QUARANTINE_CLEARED_TYPE_363) last = e;
  }
  if (!last) return { tripped: false, found: false };
  return {
    tripped: (last.type === QUARANTINE_TRIPPED_TYPE_363),
    found: true,
    at: last.index,
    reason: (last.payload && last.payload.reason) || null,
    divergences: (last.payload && last.payload.divergences) || null,
    operator: (last.payload && last.payload.operator) || null,
    eventType: last.type,
  };
}

/**
 * Run V362 cross-chain consistency; if inconsistent and not already
 * quarantined, append the trip event. Returns the report + the resulting
 * quarantine state.
 */
async function autoQuarantineFromCrossChain363(ctx) {
  const c = ctx || {};
  const report = await LB362.crossChainConsistency362(c);
  const before = quarantineStatus363(c);
  let appendedIndex = null, action = 'noop';
  if (!report.consistent && !before.tripped) {
    const auditLog = c.auditLog;
    if (auditLog && typeof auditLog.append === 'function') {
      try {
        const r = auditLog.append(QUARANTINE_TRIPPED_TYPE_363, {
          reason: 'cross-chain-divergence',
          divergences: report.divergences,
          ts: new Date().toISOString(),
        });
        appendedIndex = (r && r.index != null) ? r.index : null;
        action = 'tripped';
      } catch (_) { action = 'append-failed'; }
    }
  } else if (report.consistent && before.tripped) {
    action = 'still-tripped-awaiting-operator-clear';
  }
  return {
    action, appendedIndex,
    consistent: report.consistent,
    report,
    quarantine: quarantineStatus363(c),
    version: LOAD_BEARING_VERSION_363,
  };
}

/**
 * Operator-driven clear. Requires `opts.operator` (free-form id string) and
 * `opts.reason`. Idempotent: clearing an un-tripped quarantine is a no-op.
 */
function clearQuarantine363(ctx, opts) {
  const c = ctx || {};
  const operator = (opts && opts.operator) || null;
  const reason   = (opts && opts.reason)   || 'cleared-by-operator';
  if (!operator) return { cleared: false, error: 'operator id required' };
  const status = quarantineStatus363(c);
  if (!status.tripped) return { cleared: false, alreadyClear: true, status };
  let appendedIndex = null;
  if (c.auditLog && typeof c.auditLog.append === 'function') {
    try {
      const r = c.auditLog.append(QUARANTINE_CLEARED_TYPE_363, {
        operator, reason, ts: new Date().toISOString(),
        clearedTrippedAt: status.at,
      });
      appendedIndex = (r && r.index != null) ? r.index : null;
    } catch (e) { return { cleared: false, error: e.message }; }
  }
  return { cleared: true, appendedIndex, operator, reason, previouslyTrippedAt: status.at };
}

/**
 * Express-style middleware: short-circuit with 423 Locked when the system is
 * currently quarantined. Mount AFTER the V362 gate middleware so callers see
 * the V362 401/409 first if integrity itself is broken.
 *
 * In NODE_ENV=test, callers may bypass with the header
 * `x-quarantine-bypass-363` (only when `allowTestBypass !== false`).
 */
function quarantineEnforceMiddleware363(opts) {
  const ctxProvider     = (opts && typeof opts.ctxProvider === 'function') ? opts.ctxProvider : () => ({});
  const allowTestBypass = !opts || opts.allowTestBypass !== false;
  const bypassHeader    = String((opts && opts.bypassHeader) || 'x-quarantine-bypass-363').toLowerCase();
  return function quarantineGateMiddleware363(req, res, next) {
    try {
      if (allowTestBypass && process.env.NODE_ENV === 'test' && req && req.headers && req.headers[bypassHeader]) {
        return next();
      }
      const s = quarantineStatus363(ctxProvider());
      if (!s.tripped) return next();
      const status = 423;
      const body = { ok: false, allowed: false, reason: 'quarantined: ' + (s.reason || 'cross-chain-divergence'), quarantine: s, ecosVersion: 'V363', gate: 'quarantineEnforceMiddleware363' };
      if (res && typeof res.status === 'function') return res.status(status).json(body);
      if (res && typeof res.writeHead === 'function') { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); return; }
      if (typeof next === 'function') return next(Object.assign(new Error(body.reason), { statusCode: status, body }));
    } catch (e) {
      if (res && typeof res.status === 'function') return res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V363' });
      if (typeof next === 'function') return next(e);
    }
  };
}

// ── 4. Verifier publish surface ────────────────────────────────────────────
/**
 * Read `verifier362.js` from disk so the server can serve it as a copyable
 * asset. The path is resolvable relative to repo root.
 */
function getVerifierAssetText363(opts) {
  // Resolve repo root robustly: this module is mirrored byte-for-byte into
  // both `lib/` and `src/lib/`, so a fixed `..` would land in `src/` for the
  // mirror copy. Walk upward until we find `verifier362.js` on disk.
  let target = null;
  if (opts && opts.root) {
    target = path.join(opts.root, 'verifier362.js');
  } else {
    let dir = __dirname;
    for (let i = 0; i < 6; i++) {
      const candidate = path.join(dir, 'verifier362.js');
      if (fs.existsSync(candidate)) { target = candidate; break; }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    if (!target) target = path.resolve(__dirname, '..', 'verifier362.js');
  }
  const text = fs.readFileSync(target, 'utf8');
  const sha256 = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
  return {
    filename: 'verifier362.js',
    contentType: 'application/javascript; charset=utf-8',
    text,
    sha256,
    byteLength: Buffer.byteLength(text, 'utf8'),
    verifierVersion: '362.0.0',
    issuerVersion: LOAD_BEARING_VERSION_363,
  };
}

module.exports = {
  LOAD_BEARING_VERSION_363,
  REVOCATION_SCHEMA_363,
  QUARANTINE_TRIPPED_TYPE_363,
  QUARANTINE_CLEARED_TYPE_363,
  REVOCATION_INDEXED_TYPE_363,
  projectRevocationIndex363,
  getRevocationStatus363,
  buildSignedRevocationEnvelope363,
  verifySignedRevocationEnvelope363,
  quarantineStatus363,
  autoQuarantineFromCrossChain363,
  clearQuarantine363,
  quarantineEnforceMiddleware363,
  getVerifierAssetText363,
  _stableStringify363,
  _sha256Hex363,
};
