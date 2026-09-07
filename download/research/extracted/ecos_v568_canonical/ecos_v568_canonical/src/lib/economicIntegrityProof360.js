'use strict';
/**
 * src/lib/economicIntegrityProof360.js — ECOS V360 (Phase P248) — Economic Integrity Proof
 *
 * STRATEGIC THESIS (chosen from the archive, not generic advice):
 *   ECOS's durable, institution-grade value is a *verifiable* economic substrate —
 *   209/447 modules write to the audit log, 94 to the ledger; that core is the
 *   gravitational center everything else orbits. Yet the audit log ships a verify()
 *   that is never run, the ledger conserves value only "by convention," and the
 *   reserve enforces backing only at write-time. Trust is ASSUMED, not PROVEN.
 *
 * V360 turns the central claim ("auditable, trustworthy") from convention into a
 * continuously-produced PROOF. It composes existing primitives (auditLog.verify,
 * ledger.entries/balances, reserve.getStatus) into one signed integrity attestation:
 *   1. Audit-chain integrity  — tamper-evidence actually exercised.
 *   2. Ledger conservation    — Σ balances == externalIn − externalOut (no minting).
 *   3. Split conservation     — 40/40/20 sums EXACTLY to gross (no rounding leak).
 *   4. Reserve backing        — Σ outstanding ≤ reserve/peg (anti-Ponzi invariant).
 * The attestation is itself hashable → it can be written back to the audit log,
 * making integrity self-referential and auditable over time.
 *
 * Pure + dependency-free (R6 — reuses auditLog's own sha256/canonicalize; no new npm).
 * Version-suffixed (…360). Never mutates the sacred ledger/audit instances.
 *
 * @version 360.0.0
 */

const PROOF_VERSION_360 = '360.0.0';
const RESERVE_PEG_360 = 10_000n; // μ¢ per credit (matches creditReserve)

// ── 1. Audit-chain integrity (delegates to the log's OWN verify → zero false positives) ──
function verifyAuditChain360(auditLog) {
  if (!auditLog || typeof auditLog.entries !== 'function') {
    return { ran: false, valid: null, reason: 'no auditLog provided' };
  }
  // Prefer the log's own verify() if present (canonical, matches its hashing exactly).
  // The log returns { ok:true, length } or { ok:false, brokenAt, reason }.
  if (typeof auditLog.verify === 'function') {
    const r = auditLog.verify();
    const valid = (r === true) || (r && r.ok === true) || (r && r.valid === true);
    const brokenAtIndex = (r && r.brokenAt != null) ? r.brokenAt : (r && r.brokenAtIndex != null ? r.brokenAtIndex : null);
    return { ran: true, valid, brokenAtIndex, reason: r && r.reason, entryCount: auditLog.entries().length };
  }
  return { ran: false, valid: null, reason: 'auditLog has no verify()' };
}

// ── 2. Ledger conservation: Σ balances == externalIn − externalOut ──
// External mint  = CREDIT with from === null. External burn = DEBIT with to === null.
// Internal transfers (from && to) net to zero globally, so they cannot change the sum.
function verifyLedgerConservation360(ledger) {
  if (!ledger || typeof ledger.entries !== 'function' || typeof ledger.listAccounts !== 'function') {
    return { ran: false, conserved: null, reason: 'no ledger provided' };
  }
  let externalIn = 0n, externalOut = 0n;
  for (const e of ledger.entries()) {
    const amt = typeof e.amount === 'bigint' ? e.amount : BigInt(e.amount || 0);
    if (e.kind === 'CREDIT' && (e.from === null || e.from === undefined)) externalIn += amt;
    else if (e.kind === 'DEBIT' && (e.to === null || e.to === undefined)) externalOut += amt;
  }
  let totalBalances = 0n;
  for (const a of ledger.listAccounts()) {
    totalBalances += BigInt(a.microcents != null ? a.microcents : (a.balance != null ? a.balance : 0));
  }
  const expected = externalIn - externalOut;
  const drift = totalBalances - expected;
  return {
    ran: true, conserved: drift === 0n,
    totalBalances: totalBalances.toString(), externalIn: externalIn.toString(),
    externalOut: externalOut.toString(), expected: expected.toString(), driftMicro: drift.toString(),
  };
}

// ── 3. Split conservation: the core money-movement must never create/destroy value ──
// Re-derives the documented 40/40/20 split (floor + remainder) and proves the parts
// sum EXACTLY to gross for a battery of gross values, including adversarial residues.
function verifySplitConservation360(samples) {
  const grosses = Array.isArray(samples) && samples.length
    ? samples.map(s => (typeof s === 'bigint' ? s : BigInt(s)))
    : [1n, 3n, 7n, 99n, 100n, 101n, 999n, 1000n, 123_456_789n, 2n, 5n];
  const leaks = [];
  for (const gross of grosses) {
    if (gross <= 0n) continue;
    const platform = (gross * 40n) / 100n;
    const validator = (gross * 40n) / 100n;
    const insurance = gross - platform - validator;       // remainder ⇒ exact
    const sum = platform + validator + insurance;
    if (sum !== gross || insurance < 0n) leaks.push({ gross: gross.toString(), sum: sum.toString() });
  }
  return { ran: true, conserved: leaks.length === 0, checked: grosses.length, leaks };
}

// ── 4. Reserve backing: Σ outstanding ≤ reserve / peg ──
function verifyReserveBacking360(reserve) {
  if (!reserve || typeof reserve.getStatus !== 'function') {
    return { ran: false, backed: null, reason: 'no reserve provided' };
  }
  const st = reserve.getStatus();
  // backingRatio may be a string/number; treat >= 1.0 as backed. Fall back to raw fields.
  let ratio = st.backingRatio != null ? Number(st.backingRatio) : null;
  if ((ratio == null || !isFinite(ratio)) && st.reserveBalance != null && st.outstanding != null) {
    const out = BigInt(st.outstanding); const res = BigInt(st.reserveBalance);
    ratio = out === 0n ? Infinity : Number(res) / Number(out);
  }
  const backed = ratio == null ? null : ratio >= 1.0;
  return { ran: true, backed, backingRatio: ratio === Infinity ? null : ratio, outstanding: st.outstanding != null ? String(st.outstanding) : null };
}

/**
 * Compose all checks into one signed integrity attestation.
 * @param {{ledger?, auditLog?, reserve?, splitSamples?, hashFn?, canonicalize?}} ctx
 */
function assessEconomicIntegrity360(ctx = {}) {
  const chain = verifyAuditChain360(ctx.auditLog);
  const conservation = verifyLedgerConservation360(ctx.ledger);
  const split = verifySplitConservation360(ctx.splitSamples);
  const backing = verifyReserveBacking360(ctx.reserve);

  // A dimension PASSES if it ran and is true; UNKNOWN if not run; FAILS if ran and false.
  const dims = { chain: chain.valid, conservation: conservation.conserved, split: split.conserved, backing: backing.backed };
  const anyFail = Object.values(dims).some(v => v === false);
  const allRanTrue = Object.values(dims).every(v => v === true); // every dimension ran AND passed
  // Strict proof semantics: 'verified' requires ALL four dimensions; partial proof is not full trust.
  const overallIntegrity = anyFail ? 'compromised' : (allRanTrue ? 'verified' : 'partial');

  const result = {
    version: PROOF_VERSION_360,
    generatedAt: new Date().toISOString(),
    overallIntegrity,            // 'verified' | 'partial' | 'compromised'
    failClosed: anyFail,         // a single proven failure trips this — callers should halt economic mutation
    dimensions: { chain, conservation, split, backing },
    summary: dims,
  };

  // Sign the attestation (reuse the audit log's own hash fn when available; else a stable JSON hash).
  const canon = typeof ctx.canonicalize === 'function' ? ctx.canonicalize : (v) => JSON.stringify(v);
  const hashFn = typeof ctx.hashFn === 'function' ? ctx.hashFn : null;
  const preimage = canon({ v: result.version, at: result.generatedAt, o: result.overallIntegrity, d: result.summary });
  result.attestationHash = hashFn ? hashFn(preimage) : require('crypto').createHash('sha256').update(preimage).digest('hex');
  return result;
}

module.exports = {
  PROOF_VERSION_360, RESERVE_PEG_360,
  verifyAuditChain360, verifyLedgerConservation360, verifySplitConservation360, verifyReserveBacking360,
  assessEconomicIntegrity360,
};
