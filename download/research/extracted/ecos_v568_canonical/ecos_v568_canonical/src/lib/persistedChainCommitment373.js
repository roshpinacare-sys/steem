'use strict';
/**
 * src/lib/persistedChainCommitment373.js — ECOS V373 (Phase P261)
 *
 * DIRECTION 2: Extend chainCommitment to the DB-persisted audit_log
 * (db/auditRepo.js), so the commitment covers durable storage, not just
 * the in-memory chain.
 *
 * The in-memory chainCommitment372 commits only to what is currently in
 * the in-process AuditLog. For durable storage we need to commit to the
 * DB head, so a third party can verify the commitment covers persisted data.
 *
 * Exports:
 *   chainCommitmentPersisted373(opts) — async. Returns the same shape as
 *     chainCommitment372 but reads the head from db/auditRepo.getHead().
 *     Falls back to NULL_HASH_372 if DB is unavailable (non-fatal, noted).
 *
 *   issuePersistedPortableProof373(ctx, opts) — async. Composes
 *     issuePortableProof372 with a persisted chain commitment, so the proof
 *     includes BOTH the in-memory AND the durable commitment.
 *
 * Pure shape (R3 — no new npm deps). All new identifiers end with 373 (R2).
 * Sacred untouched (R1). Zero mutations to auditRepo (R6).
 *
 * @version 373.0.0
 */

const PP = require('./portableProof372.js');

const PERSISTED_COMMITMENT_VERSION_373 = '373.0.0';
const PERSISTED_COMMITMENT_SCHEMA_373  = 'ecos.integrity.chain.commitment.persisted/v373';

/**
 * Async. Reads the DB head hash + count from auditRepo.getHead() and
 * returns a commitment in the same shape as chainCommitment372.
 *
 * @param {{ auditRepo: object, domain?: string }} opts
 */
async function chainCommitmentPersisted373(opts = {}) {
  const { auditRepo, domain = 'default_domain' } = opts;
  if (!auditRepo || typeof auditRepo.getHead !== 'function') {
    return {
      committed: false,
      reason: 'no auditRepo with getHead()',
      schema: PERSISTED_COMMITMENT_SCHEMA_373,
      source: 'db',
    };
  }
  let head;
  try { head = await auditRepo.getHead(domain); } catch (e) {
    return {
      committed: false,
      reason: 'auditRepo.getHead error: ' + e.message,
      schema: PERSISTED_COMMITMENT_SCHEMA_373,
      source: 'db',
    };
  }
  if (!head) {
    return {
      committed: true,
      algorithm: 'sha256-chain',
      headHash: PP.NULL_HASH_372,
      length: 0,
      genesis: PP.NULL_HASH_372,
      schema: PERSISTED_COMMITMENT_SCHEMA_373,
      source: 'db',
      domain,
    };
  }
  // Also read the count
  let length = head.index + 1; // index is 0-based (seq-1)
  if (opts.auditRepo && typeof opts.auditRepo.size === 'function') {
    try { length = await opts.auditRepo.size(); } catch (_) {}
  }
  return {
    committed: true,
    algorithm: 'sha256-chain',
    headHash: head.hash,
    length,
    genesis: PP.NULL_HASH_372,
    schema: PERSISTED_COMMITMENT_SCHEMA_373,
    source: 'db',
    domain,
    headEntry: { seq: head.seq, ts: head.ts, type: head.type },
  };
}

/**
 * Async. Issues a portable proof that includes BOTH the in-memory chain
 * commitment and the persisted (DB) chain commitment, so auditors can
 * cross-verify that durable storage matches the proof.
 *
 * ctx — same as issuePortableProof372 ctx
 * opts — { auditRepo, domain? }
 */
async function issuePersistedPortableProof373(ctx = {}, opts = {}) {
  // Issue the base proof (synchronous)
  const base = PP.issuePortableProof372(ctx);

  // Read the persisted commitment (async)
  const persistedCommitment = await chainCommitmentPersisted373({
    auditRepo: opts.auditRepo,
    domain: opts.domain,
  });

  // Rebuild the body with both commitments; re-derive proofHash.
  const hashFn = typeof ctx.hashFn === 'function' ? ctx.hashFn : PP._defaultHash372;
  const canon  = typeof ctx.canonicalize === 'function' ? ctx.canonicalize : PP._defaultCanon372;

  const { proofHash: _oldHash, ...bodyWithout } = base;
  const extended = Object.assign({}, bodyWithout, {
    version: '373.0.0',
    persistedChainCommitment: persistedCommitment,
    recipe: Object.assign({}, base.recipe, {
      persistedCommitment: 'DB audit_log head hash via auditRepo.getHead(); cross-verify by re-running chainCommitmentPersisted373',
    }),
  });
  const proofHash373 = hashFn(canon(extended));
  return Object.assign({}, extended, { proofHash: proofHash373 });
}

module.exports = {
  PERSISTED_COMMITMENT_VERSION_373,
  PERSISTED_COMMITMENT_SCHEMA_373,
  chainCommitmentPersisted373,
  issuePersistedPortableProof373,
};
