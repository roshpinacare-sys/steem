/**
 * ECOS Audit Repo
 * ---------------
 * Persists the SHA-256 chained audit log to Postgres synchronously.
 *
 * Serialization model:
 *   Every append acquires a transaction-scoped advisory lock
 *   (pg_advisory_xact_lock) BEFORE reading the previous hash. This makes
 *   the chain head a single, monotonic resource: two concurrent appends
 *   strictly queue, eliminating the classic
 *      tx_A: SELECT head -> get H_n
 *      tx_B: SELECT head -> get H_n      (same!)
 *      tx_A: INSERT H_n+1
 *      tx_B: INSERT H_n+1                (fork!)
 *   race that would otherwise be possible under READ COMMITTED.
 *
 * The hash preimage and canonical JSON layout MUST stay byte-identical
 * to src/lib/auditLog.js so an in-memory snapshot and a DB snapshot are
 * cryptographically interchangeable.
 *
 *   preimage = `${seq-1}|${ts}|${canonicalize(safePayload)}|${prevHash}`
 *
 * (We use seq-1 to keep the same 0-based index semantics as the in-memory
 * AuditLog; BIGSERIAL counts from 1, so we subtract one.)
 */

'use strict';

const crypto = require('node:crypto');
const { withTx, getPool } = require('./pool');
const { canonicalize, sha256Hex, NULL_HASH } = require('../lib/auditLog');
const { calculateStateRoot } = require('../lib/stateRoot');

// Stable, project-wide advisory-lock identifier. Picked once and frozen.
// Any process that appends to audit_log MUST use this same key.
const AUDIT_LOCK_KEY = 0x4543_4f53; // 'ECOS' as a 32-bit literal -> 1163018579

function _stripBigInts(payload) {
  // Mirror the in-memory log's safePayload step so BigInt round-trips
  // are consistent (BigInt -> decimal string).
  return JSON.parse(
    JSON.stringify(payload ?? {}, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
  );
}

/**
 * Append a single chained audit entry.
 *
 * @param {string} type     Non-empty event tag, e.g. 'APPROVAL_CREATED'
 * @param {object} payload  JSON-serializable payload (BigInts allowed; coerced)
 * @returns {Promise<{
 *   seq: number, index: number, ts: string, type: string,
 *   payload: object, prevHash: string, hash: string
 * }>}
 */
async function _appendAuditUsingClient(client, type, payload = {}, domain = 'default_domain', { lock = true } = {}) {
  if (typeof type !== 'string' || !type) {
    throw new TypeError('appendAudit: type must be a non-empty string');
  }
  if (typeof domain !== 'string' || !domain) {
    throw new TypeError('appendAudit: domain must be a non-empty string');
  }
  const safePayload = _stripBigInts(payload);
  if (lock) {
    // Serialize ALL appenders behind a single advisory lock so the
    // chain head is a strict, single-writer resource.
    await client.query('SELECT pg_advisory_xact_lock($1)', [AUDIT_LOCK_KEY]);
  }
  const postStateRoot = await calculateStateRoot(client);
  safePayload.stateRoot = postStateRoot;
  const headRes = await client.query(
    'SELECT last_audit_seq AS seq, last_audit_hash AS hash FROM delta_trace_heads WHERE domain = $1',
    [domain]
  );
  const prevHash = headRes.rowCount === 0 ? NULL_HASH : headRes.rows[0].hash;
  // Next seq is monotonic and gap-free under the advisory-lock discipline.
  // (BIGSERIAL itself may have gaps if a tx rolls back, but inside this
  // lock we never roll back after computing the hash -- the INSERT below
  // is the last statement that can fail, and if it does we ROLLBACK and
  // the seq is simply never consumed. The next successful append will
  // recompute against the still-current head.)
  const nextSeq = headRes.rowCount === 0 ? 1 : Number(headRes.rows[0].seq) + 1;
  const index   = nextSeq - 1;
  const ts      = new Date().toISOString();
  const canon   = canonicalize(safePayload);
  const preimage = `${index}|${ts}|${canon}|${prevHash}`;
  const hash     = sha256Hex(preimage);
  const ins = await client.query(
    `INSERT INTO audit_log (seq, ts, type, domain, payload, prev_hash, hash)
     VALUES ($1, $2::timestamptz, $3, $4, $5::jsonb, $6, $7)
     RETURNING seq, hash`,
    [String(nextSeq), ts, type, domain, JSON.stringify(safePayload), prevHash, hash]
  );
  const seq = Number(ins.rows[0].seq);
  const newHash = ins.rows[0].hash;

  // Keep the BIGSERIAL sequence in sync with our manually-managed seq counter.
  // Without this, any future INSERT that omits seq (e.g. a raw DB migration tool)
  // would collide on seq=1 because the sequence never advanced past its start value.
  await client.query(
    `SELECT setval(pg_get_serial_sequence('audit_log', 'seq'), $1, true)`,
    [seq]
  );

  // Update delta_trace_heads with the new head for this domain
  await client.query(
    `INSERT INTO delta_trace_heads (domain, last_audit_seq, last_audit_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (domain) DO UPDATE SET
       last_audit_seq = EXCLUDED.last_audit_seq,
       last_audit_hash = EXCLUDED.last_audit_hash,
       updated_at = now()`,
    [domain, seq, newHash]
  );

  return Object.freeze({
    seq, index, ts, type, payload: safePayload, prevHash, hash: newHash,
  });
}

async function appendAudit(type, payload = {}, domain = 'default_domain') {
  return withTx(async (client) => _appendAuditUsingClient(client, type, payload, domain));
}

async function appendAuditOnClient(client, type, payload = {}, domain = 'default_domain') {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('appendAuditOnClient requires an active transaction client');
  }
  return _appendAuditUsingClient(client, type, payload, domain);
}

/**
 * Verify the entire chain. Returns { ok: true, length } on success or
 * { ok: false, brokenAt, reason } on the first inconsistency.
 *
 * Verification is read-only and does NOT take the advisory lock. If new
 * rows are appended mid-verification, they simply aren't seen -- the
 * historical chain remains intact.
 */
async function verifyAudit() {
  const { rows } = await getPool().query(
    `SELECT seq, ts, type, payload, prev_hash AS "prevHash", hash
     FROM audit_log ORDER BY seq ASC`
  );
  let expectedPrev = NULL_HASH;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.prevHash !== expectedPrev) {
      return { ok: false, brokenAt: i, seq: Number(r.seq), reason: 'prevHash mismatch' };
    }
    // Re-derive the ISO timestamp the SAME way the writer did. pg returns
    // `ts` as a JS Date; we MUST format with .toISOString() to recover
    // the byte-identical preimage.
    const tsIso = r.ts instanceof Date ? r.ts.toISOString() : new Date(r.ts).toISOString();
    const canon = canonicalize(r.payload);
    const preimage = `${i}|${tsIso}|${canon}|${r.prevHash}`;
    const recomputed = sha256Hex(preimage);
    if (recomputed !== r.hash) {
      return { ok: false, brokenAt: i, seq: Number(r.seq), reason: 'hash mismatch' };
    }
    expectedPrev = r.hash;
  }
  return { ok: true, length: rows.length, head: expectedPrev };
}

async function getHead(domain = 'default_domain') {
  const { rows } = await getPool().query(
    `SELECT last_audit_seq AS seq, last_audit_hash AS hash
     FROM delta_trace_heads WHERE domain = $1`,
    [domain]
  );
  if (!rows.length) return null;
  const { rows: auditRows } = await getPool().query(
    `SELECT seq, ts, type, domain, payload, prev_hash AS "prevHash", hash
     FROM audit_log WHERE seq = $1 AND hash = $2`,
    [rows[0].seq, rows[0].hash]
  );
  if (!auditRows.length) return null; // Should not happen if FKs are correct
  const r = auditRows[0];
  return {
    seq: Number(r.seq),
    index: Number(r.seq) - 1,
    ts: r.ts instanceof Date ? r.ts.toISOString() : new Date(r.ts).toISOString(),
    type: r.type,
    domain: r.domain,
    payload: r.payload,
    prevHash: r.prevHash,
    hash: r.hash,
  };
}

async function size() {
  const { rows } = await getPool().query('SELECT count(*)::bigint AS c FROM audit_log');
  return Number(rows[0].c);
}

module.exports = { appendAudit, appendAuditOnClient, verifyAudit, getHead, size, AUDIT_LOCK_KEY };
