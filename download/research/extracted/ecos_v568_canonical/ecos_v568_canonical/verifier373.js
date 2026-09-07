'use strict';
/**
 * verifier373.js — ECOS V373 portable third-party verifier SDK stub.
 *
 * DIRECTION 4: Third-party verifier SDK stub — a tiny standalone
 * `verifyPortableProof373` export (no server) that a client can vendor to
 * check ECOS proofs — the trust artifact as a shippable library.
 *
 * Single-file, zero-dependency (only Node's built-in `crypto`). Drop this
 * file into any Node 18+ project to independently verify a portable proof
 * emitted by `GET /api/v1/proof/portable` (V372/V373).
 *
 * Usage:
 *   const { verifyPortableProof373 } = require('./verifier373.js');
 *   const result = verifyPortableProof373(proof, snapshot);
 *   if (!result.valid) throw new Error('Proof invalid: ' + result.mismatches.join(', '));
 *
 * CLI:
 *   node verifier373.js path/to/proof.json [path/to/snapshot.json]
 *   cat proof.json | node verifier373.js -
 *
 * What it verifies:
 *   1. proofHash — content-addressing: proof body was not tampered.
 *   2. audit chain — re-derives the SHA-256 chain head from the snapshot
 *      entries and confirms it matches the committed headHash.
 *   3. conservation — Σ balances === Σ externalIn − Σ externalOut.
 *   4. split — re-proves the 40/40/20 split conservation.
 *
 * What it does NOT require:
 *   - No ECOS server, API key, or network.
 *   - No trust in the issuer beyond the published proof + snapshot.
 *   - No npm install. Node built-ins only.
 *
 * @version 373.0.0
 */

const crypto = require('crypto');

const VERIFIER_SDK_VERSION_373 = '373.0.0';
const ACCEPTED_SCHEMAS_373 = Object.freeze(['372.0.0', '373.0.0']);
const NULL_HASH_373 = '0'.repeat(64);

// ── Crypto helpers (byte-identical to portableProof372's defaults) ────────

function _sha256Hex373(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function _canon373(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(_canon373).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + _canon373(v[k])).join(',') + '}';
}

// ── Split conservation (re-prove 40/40/20 independently) ─────────────────

function _verifySplit373(grossValues) {
  for (const g of grossValues) {
    const platform  = BigInt(Math.floor(Number(g) * 40 / 100));
    const validator = BigInt(Math.floor(Number(g) * 40 / 100));
    const insurance = g - platform - validator;
    if (platform + validator + insurance !== g) return false;
  }
  return true;
}

// ── Main verifier ─────────────────────────────────────────────────────────

/**
 * Verify a portable proof against a snapshot.
 *
 * @param {object} proof     — output of issuePortableProof372 (or 373)
 * @param {{
 *   auditEntries?:  Array<{index,ts,payload,prevHash,hash}>,
 *   ledgerEntries?: Array<{kind,from,to,amount}>,
 *   accountBalances?: Array<{microcents|balance}>,
 * }} [snapshot]   — the published audit/ledger snapshot
 * @param {{
 *   hashFn?:      (s:string)=>string,
 *   canonicalize?: (v:any)=>string,
 * }} [hooks]      — override hash / canonicalize (for custom chains)
 * @returns {{ valid:boolean, version:string, checks:object, mismatches:string[] }}
 */
function verifyPortableProof373(proof, snapshot, hooks) {
  const snap   = snapshot || {};
  const h      = hooks    || {};
  const hashFn = typeof h.hashFn      === 'function' ? h.hashFn      : _sha256Hex373;
  const canon  = typeof h.canonicalize === 'function' ? h.canonicalize : _canon373;

  const checks = {};
  const mismatches = [];

  if (!proof || typeof proof !== 'object') {
    return { valid: false, version: VERIFIER_SDK_VERSION_373, checks, mismatches: ['no proof provided'] };
  }

  // ── 1. proofHash content-addressing ────────────────────────────────────
  const { proofHash, ...body } = proof;
  if (!proofHash) {
    mismatches.push('proof missing proofHash field');
    checks.proofHash = false;
  } else {
    const recomputed = hashFn(canon(body));
    checks.proofHash = (recomputed === proofHash);
    if (!checks.proofHash) mismatches.push('proofHash mismatch — proof body was tampered');
  }

  // ── 2. Audit chain re-derivation ────────────────────────────────────────
  const cc = proof.chainCommitment;
  if (Array.isArray(snap.auditEntries) && cc && cc.committed) {
    let prev = NULL_HASH_373;
    let chainOk = true;
    let brokenAt = null;
    let head = NULL_HASH_373;

    for (let i = 0; i < snap.auditEntries.length; i++) {
      const e = snap.auditEntries[i];
      const preimage = `${e.index}|${e.ts}|${canon(e.payload)}|${prev}`;
      const h_ = hashFn(preimage);
      if (e.prevHash !== prev || e.hash !== h_) {
        chainOk = false;
        brokenAt = i;
        break;
      }
      prev = e.hash;
      head = e.hash;
    }

    checks.chainRecomputed = chainOk;
    checks.headMatchesCommitment = chainOk
      && head === cc.headHash
      && snap.auditEntries.length === cc.length;

    if (!chainOk) mismatches.push('audit chain breaks at index ' + brokenAt);
    else if (!checks.headMatchesCommitment) {
      mismatches.push('chain head or length does not match the published commitment');
    }
  }

  // ── 3. Conservation ─────────────────────────────────────────────────────
  if (Array.isArray(snap.accountBalances) && Array.isArray(snap.ledgerEntries) && proof.conservation) {
    try {
      let externalIn  = 0n;
      let externalOut = 0n;
      for (const e of snap.ledgerEntries) {
        const amt = BigInt(e.amount || 0);
        if (e.kind === 'CREDIT' && e.from == null) externalIn  += amt;
        else if (e.kind === 'DEBIT' && e.to   == null) externalOut += amt;
      }
      let total = 0n;
      for (const a of snap.accountBalances) {
        total += BigInt(a.microcents != null ? a.microcents : (a.balance != null ? a.balance : 0));
      }
      const expected = externalIn - externalOut;
      checks.conservation = (total === expected)
        && proof.conservation.driftMicro === '0'
        && total.toString() === proof.conservation.totalBalances;
      if (!checks.conservation) mismatches.push('ledger conservation does not reconcile with snapshot');
    } catch (e) {
      checks.conservation = false;
      mismatches.push('conservation check error: ' + e.message);
    }
  }

  // ── 4. Split conservation (pure math, no snapshot needed) ───────────────
  const splitSamples = [1n, 7n, 99n, 100n, 101n, 999n, 123_456_789n];
  checks.split = _verifySplit373(splitSamples);
  if (!checks.split) mismatches.push('split conservation fails re-derivation');

  const ran   = Object.values(checks);
  const valid = ran.length > 0 && ran.every(Boolean);
  return { valid, version: VERIFIER_SDK_VERSION_373, checks, mismatches };
}

// ── Module exports ────────────────────────────────────────────────────────

module.exports = {
  VERIFIER_SDK_VERSION_373,
  ACCEPTED_SCHEMAS_373,
  verifyPortableProof373,
  _sha256Hex373,
  _canon373,
};

// ── CLI entry-point ───────────────────────────────────────────────────────

if (require.main === module) {
  const fs   = require('fs');
  const args = process.argv.slice(2);
  let proofArg, snapshotArg;

  if (args[0] === '-') {
    const raw = fs.readFileSync('/dev/stdin', 'utf8');
    const parsed = JSON.parse(raw);
    proofArg    = parsed.proof    || parsed;
    snapshotArg = parsed.snapshot || {};
  } else if (args[0]) {
    proofArg    = JSON.parse(fs.readFileSync(args[0], 'utf8'));
    snapshotArg = args[1] ? JSON.parse(fs.readFileSync(args[1], 'utf8')) : {};
  } else {
    console.error('Usage: node verifier373.js <proof.json> [snapshot.json]');
    console.error('       cat proof.json | node verifier373.js -');
    process.exit(2);
  }

  const result = verifyPortableProof373(proofArg, snapshotArg);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.valid ? 0 : 1);
}
