/**
 * ECOS State Root & Delta Engine (v3.3)
 * --------------------------------------
 * Two-phase cryptographic proof around every balance mutation:
 *
 *   Phase 1  beginDeltaCommit(client)
 *            — captures a SHA-256 root of all account balances BEFORE mutation.
 *
 *   Phase 2  sealDeltaCommit(client, domain, mutations, { preStateRoot })
 *            — captures the post-mutation root, builds a domain-separated
 *              trace hash, and returns a sealed delta object for the audit chain.
 *
 * The caller passes the Phase 1 root into Phase 2 via options.preStateRoot so
 * the pre/post roots are always bound to different DB snapshots. Without this,
 * both scans run after mutation and produce identical roots (v3.2 regression,
 * fixed here and in CONCURRENCY_HARDENING.patch).
 *
 * Known limitation (Stage 2):
 *   calculateStateRoot() does a full account-table scan — O(N) with N = total
 *   accounts. This is the dominant scalability limiter at high account counts.
 *   Upgrade path: incremental Merkle Patricia trie (see PRAGMATIC_ROADMAP.md §2.2).
 */

'use strict';

const crypto = require('node:crypto');
const { canonicalize, sha256Hex } = require('./auditLog');

/**
 * Calculates the Canonical State Root from the full accounts table.
 * Deterministic: lexicographic sort on account_id, BigInt-safe string format.
 *
 * @param {object} client  Active Postgres transaction client.
 * @returns {Promise<string>}  64-char SHA-256 hex string.
 */
async function calculateStateRoot(client) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('calculateStateRoot: requires an active transaction client');
  }
  const { rows } = await client.query(
    `SELECT id, balance_micro FROM accounts ORDER BY id ASC`
  );
  const stateBuffer = rows.map(r => `${r.id}:${r.balance_micro}`).join('\n');
  return sha256Hex(stateBuffer);
}

/**
 * Phase 1 of the two-phase state-root protocol.
 * Call BEFORE any balance mutations in the transaction.
 *
 * @param {object} client  Active Postgres transaction client.
 * @returns {Promise<string>}  preStateRoot hex string.
 */
async function beginDeltaCommit(client) {
  return calculateStateRoot(client);
}

/**
 * Phase 2 of the two-phase state-root protocol.
 * Call AFTER balance mutations on the same transaction client.
 *
 * @param {object} client           Active Postgres transaction client.
 * @param {string} domain           Settlement domain label (e.g. 'ECOS_B2B_BILLING').
 * @param {Array<{accountId, deltaMicro}>} mutations  What changed.
 * @param {object} [options]
 * @param {string} [options.preStateRoot]  Pre-mutation root from beginDeltaCommit().
 *                                          If omitted, a fresh scan runs (less accurate).
 * @returns {Promise<object>}  Sealed delta: { deltaId, preStateRoot, postStateRoot, traceHash, payload }
 */
async function sealDeltaCommit(client, domain, mutations, options = {}) {
  if (!domain || typeof domain !== 'string') {
    throw new TypeError('sealDeltaCommit: domain string is required');
  }
  if (!Array.isArray(mutations) || mutations.length === 0) {
    throw new TypeError('sealDeltaCommit: mutations array cannot be empty');
  }

  const { preStateRoot: suppliedPreStateRoot = null } = options || {};

  // Use the caller-supplied pre-mutation root (Phase 1 result).
  // If not supplied, fall back to a fresh scan — but log a warning because
  // this means pre and post roots may be identical (no proof of change).
  const preStateRoot = suppliedPreStateRoot || await calculateStateRoot(client);
  if (!suppliedPreStateRoot) {
    console.warn(
      '[stateRoot] sealDeltaCommit called without preStateRoot — ' +
      'pre/post roots may be identical. Pass beginDeltaCommit() result via options.preStateRoot.'
    );
  }

  // Serialize per-domain trace head to prevent concurrent settlements from
  // forking the DELTA_COMMIT chain within the same domain.
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
    [domain]
  );

  // Fetch previous domain trace hash for chain continuity
  const lastTraceRes = await client.query(
    `SELECT last_audit_hash FROM delta_trace_heads WHERE domain = $1`,
    [domain]
  );
  const prevTraceHash = lastTraceRes.rowCount === 0
    ? '0'.repeat(64)
    : lastTraceRes.rows[0].last_audit_hash;

  // Build sealed delta
  const deltaId = 'dl_' + crypto.randomBytes(8).toString('hex');
  const sanitizedMutations = mutations.map(m => ({
    accountId: m.accountId,
    deltaMicro: m.deltaMicro.toString(),
  }));

  const preimage = `${deltaId}|${domain}|${canonicalize(sanitizedMutations)}|${prevTraceHash}`;
  const traceHash = sha256Hex(preimage);

  const postStateRoot = await calculateStateRoot(client);

  if (preStateRoot === postStateRoot) {
    // This is expected in test/simulation environments where mutations are
    // mocked. In production it signals that mutations were applied outside
    // this transaction or that beginDeltaCommit was not called first.
    console.warn(
      `[stateRoot] pre/post state roots are identical for delta ${deltaId} (domain: ${domain}). ` +
      'Verify that mutations ran inside this transaction after beginDeltaCommit().'
    );
  }

  return {
    deltaId,
    preStateRoot,
    postStateRoot,
    traceHash,
    payload: {
      deltaId,
      domain,
      mutations: sanitizedMutations,
      preStateRoot,
      postStateRoot,
      prevTraceHash,
      traceHash,
    },
  };
}

module.exports = {
  calculateStateRoot,
  beginDeltaCommit,
  sealDeltaCommit,
};
