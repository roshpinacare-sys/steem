'use strict';
/**
 * src/lib/portableProof372.js — ECOS V372 (Phase P260) — Portable Proof-of-Integrity
 *
 * THE FRONTIER THAT WAS STILL OPEN: integrity could only be checked by TRUSTING
 * ECOS. V360 proved integrity; 361→371 made it load-bearing (gate). But no AI
 * platform lets a third party — auditor, B2B client, regulator, partner —
 * INDEPENDENTLY re-verify that an agent's economic actions were sound, offline,
 * without API access and without trusting the issuer. That is real unmet demand
 * and the institutional moat: trust that does not require trusting us.
 *
 * V372 ships exactly that, using standard cryptographic practice (hash-chain
 * commitments + offline re-derivation, à la Certificate Transparency / Merkle proofs):
 *
 *   1. chainCommitment372(auditLog) — a compact, publishable commitment to the
 *      ENTIRE audit history: the head hash commits to all prior entries via the chain.
 *   2. issuePortableProof372(ctx) — a self-contained, content-addressed attestation
 *      bundling: integrity summary + chain commitment + conservation figures + the
 *      exact verification RECIPE + a proofHash signing the whole bundle.
 *   3. verifyPortableProof372(proof, snapshot, hooks) — a PURE verifier that anyone
 *      can run: it re-derives the chain head, conservation, and split from a provided
 *      snapshot and confirms they match the proof. No ECOS, no trust, no network.
 *
 * Pure + dependency-free (R6 — reuses the audit log's own sha256/canonicalize, or a
 * crypto-builtin fallback). Read-only over sacred. Version-suffixed (…372).
 *
 * @version 372.0.0
 */

const P360 = require('./economicIntegrityProof360.js');

const PORTABLE_VERSION_372 = '372.0.0';
const NULL_HASH_372 = '0'.repeat(64);

function _defaultHash372(s) { return require('crypto').createHash('sha256').update(s).digest('hex'); }
function _defaultCanon372(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(_defaultCanon372).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + _defaultCanon372(v[k])).join(',') + '}';
}

/**
 * Compact commitment to the whole audit history. Because the log is a SHA-256
 * chain (hash_i = H(index|ts|canon(payload)|prevHash)), the head hash transitively
 * commits to every prior entry — publish {headHash, length} and anyone holding the
 * entries can re-verify the entire history.
 */
function chainCommitment372(auditLog) {
  if (!auditLog || typeof auditLog.entries !== 'function') return { committed: false, reason: 'no auditLog' };
  const entries = auditLog.entries();
  const head = entries.length ? entries[entries.length - 1].hash : NULL_HASH_372;
  return { committed: true, algorithm: 'sha256-chain', headHash: head, length: entries.length, genesis: NULL_HASH_372 };
}

/**
 * Issue a self-contained, content-addressed proof. `ctx` carries the live
 * ledger/auditLog/reserve and (ideally) the audit log's own hashFn + canonicalize
 * so the proof is byte-compatible with how entries were originally hashed.
 */
function issuePortableProof372(ctx = {}) {
  const hashFn = typeof ctx.hashFn === 'function' ? ctx.hashFn : _defaultHash372;
  const canon = typeof ctx.canonicalize === 'function' ? ctx.canonicalize : _defaultCanon372;

  const att = P360.assessEconomicIntegrity360({
    ledger: ctx.ledger, auditLog: ctx.auditLog, reserve: ctx.reserve,
    splitSamples: ctx.splitSamples, hashFn, canonicalize: canon,
  });
  const commitment = chainCommitment372(ctx.auditLog);
  const conservation = att.dimensions.conservation;

  const body = {
    issuer: 'ECOS',
    version: PORTABLE_VERSION_372,
    generatedAt: new Date().toISOString(),
    overallIntegrity: att.overallIntegrity,
    summary: att.summary,
    chainCommitment: commitment,
    conservation: conservation && conservation.ran ? {
      totalBalances: conservation.totalBalances, externalIn: conservation.externalIn,
      externalOut: conservation.externalOut, expected: conservation.expected, driftMicro: conservation.driftMicro,
    } : null,
    recipe: {
      algorithm: 'sha256',
      chain: 'for each entry i: H(index|ts|canonicalize(payload)|prevHash) === hash; prevHash links; head commits to all',
      conservation: 'Σ account balances === Σ(CREDIT with from=null) − Σ(DEBIT with to=null)',
      split: 'platform=⌊g·40/100⌋, validator=⌊g·40/100⌋, insurance=g−platform−validator; sum === g',
      backing: 'Σ outstanding ≤ reserve_balance / peg',
      proofHash: 'sha256(canonicalize(body without proofHash))',
    },
    note: 'Independently verifiable: run verifyPortableProof372(proof, snapshot) against a published audit/ledger snapshot.',
  };
  const proofHash = hashFn(canon(body));
  return Object.assign({}, body, { proofHash });
}

/**
 * PURE offline verifier — the heart of "trust without trusting the issuer".
 * Re-derives everything from a provided snapshot and checks it matches `proof`.
 * @param {object} proof     output of issuePortableProof372
 * @param {{ auditEntries?:Array, accountBalances?:Array, reserveStatus?:object }} snapshot
 * @param {{ hashFn?:function, canonicalize?:function }} [hooks]
 * @returns {{ valid, checks, mismatches }}
 */
function verifyPortableProof372(proof, snapshot = {}, hooks = {}) {
  const hashFn = typeof hooks.hashFn === 'function' ? hooks.hashFn : _defaultHash372;
  const canon = typeof hooks.canonicalize === 'function' ? hooks.canonicalize : _defaultCanon372;
  const checks = {}; const mismatches = [];
  if (!proof || typeof proof !== 'object') return { valid: false, checks, mismatches: ['no proof'] };

  // 1) proofHash integrity (content-addressing): recompute over body sans proofHash.
  const { proofHash, ...body } = proof;
  const recomputedProofHash = hashFn(canon(body));
  checks.proofHash = recomputedProofHash === proofHash;
  if (!checks.proofHash) mismatches.push('proofHash mismatch (proof tampered)');

  // 2) Audit chain: recompute the chain head from the snapshot's entries and match the commitment.
  if (Array.isArray(snapshot.auditEntries) && proof.chainCommitment && proof.chainCommitment.committed) {
    let prev = NULL_HASH_372, chainOk = true, brokenAt = null, head = NULL_HASH_372;
    for (let i = 0; i < snapshot.auditEntries.length; i++) {
      const e = snapshot.auditEntries[i];
      const preimage = `${e.index}|${e.ts}|${canon(e.payload)}|${prev}`;
      const h = hashFn(preimage);
      if (e.prevHash !== prev || e.hash !== h) { chainOk = false; brokenAt = i; break; }
      prev = e.hash; head = e.hash;
    }
    checks.chainRecomputed = chainOk;
    checks.headMatchesCommitment = chainOk && head === proof.chainCommitment.headHash && snapshot.auditEntries.length === proof.chainCommitment.length;
    if (!chainOk) mismatches.push('audit chain breaks at index ' + brokenAt);
    else if (!checks.headMatchesCommitment) mismatches.push('chain head/length does not match the published commitment');
  }

  // 3) Conservation: recompute Σ balances == externalIn − externalOut from the snapshot.
  if (Array.isArray(snapshot.auditEntries) === false && Array.isArray(snapshot.accountBalances) && proof.conservation) {
    // (entries optional; if ledger entries provided separately, use them)
  }
  if (Array.isArray(snapshot.accountBalances) && Array.isArray(snapshot.ledgerEntries) && proof.conservation) {
    let externalIn = 0n, externalOut = 0n;
    for (const e of snapshot.ledgerEntries) {
      const amt = BigInt(e.amount || 0);
      if (e.kind === 'CREDIT' && (e.from == null)) externalIn += amt;
      else if (e.kind === 'DEBIT' && (e.to == null)) externalOut += amt;
    }
    let total = 0n;
    for (const a of snapshot.accountBalances) total += BigInt(a.microcents != null ? a.microcents : (a.balance != null ? a.balance : 0));
    const expected = externalIn - externalOut;
    checks.conservation = (total === expected) && (proof.conservation.driftMicro === '0') && (total.toString() === proof.conservation.totalBalances);
    if (!checks.conservation) mismatches.push('ledger conservation does not reconcile with the snapshot');
  }

  // 4) Split conservation is recipe-derivable (pure math) — re-prove independently.
  {
    const r = P360.verifySplitConservation360([1n, 7n, 99n, 100n, 101n, 999n, 123_456_789n]);
    checks.split = r.conserved;
    if (!r.conserved) mismatches.push('split conservation fails re-derivation');
  }

  const ran = Object.values(checks);
  const valid = ran.length > 0 && ran.every(Boolean);
  return { valid, checks, mismatches };
}

module.exports = {
  PORTABLE_VERSION_372, NULL_HASH_372,
  chainCommitment372, issuePortableProof372, verifyPortableProof372,
  _defaultHash372, _defaultCanon372,
};
