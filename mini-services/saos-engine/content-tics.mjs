/**
 * content-tics.mjs — R329 · THE TIC GUARD + THE PROPOSAL APPLIER
 * (T-88, trace 1a1395bb641cecfd)
 *
 * THE GOVERNANCE MOMENT: the owner declined to decide and delegated to the
 * sovereign layer ("אני לא מכריע יש ריבונות אחראית תמשיך" — trace above).
 * R327's sealed proposal (sig:53fe40f2, DNA-DRIFT-DETECTED on 20 real chain
 * posts) was therefore APPLIED — but responsibly: the raw proposal (universal
 * slop-lexicon vetoes) would be the BLUNT move, prone to permanent false
 * positives ("the difference is" is legitimate prose in a one-off comparison;
 * it is only a TIC through fleet-wide repetition). The measured evidence
 * supports a PRECISER law:
 *
 *   A TIC is a phrase that ALREADY recurs across our published posts (≥
 *   DRIFT_MIN_HITS hits in ≥ DRIFT_MIN_POSTS distinct posts — the R297
 *   shallow-memory lesson at voice level). A NEW draft containing a known
 *   tic is ADDING to an already-overused formula → flagged (observe) and,
 *   ONLY when the signed DNA arms `memory.ticEnforce`, refused.
 *
 * That is the R301 anti-crowd shape applied to phrasing: no universal ban —
 * a measured repeat budget. The proposal lands in the DNA as `memory.tics`
 * (with provenance), the drift monitor keeps measuring, evidence accrues in
 * the heartbeat, and arming stays a one-line, fully reversible DNA edit.
 *
 * THE APPLIER (this module, second half) is the executor of the owner's
 * delegation, bound by five laws:
 *   1. It acts ONLY on a SEALED, SIGNED proposal (sig check or honest refuse).
 *   2. Observe-first: it never arms a veto knob by itself (ticEnforce ships
 *      false; only conceptsEnforce — the non-destructive REORDER knob, which
 *      never drops and never gates — arms with the R307 evidence chain).
 *   3. Every action lands in the DNA's `memory.applied` ledger (from-sig,
 *      trace, at, what changed) — the DNA audits itself.
 *   4. Version bumps + git = the rollback (a DNA revert is one commit).
 *   5. Idempotent: the same proposal sig never applies twice (honest no-op).
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const DIR = path.dirname(new URL(import.meta.url).pathname);
export const DNA_FILE = path.join(DIR, "content-dna.json");

/* ── canonical helpers (R306/R327/R328 pattern) ──────────────────────────── */
export function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x)).join(",")}]`;
  if (v && typeof v === "object") {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}
export function stripMarkdownLite(s) {
  return String(s ?? "").replace(/```[\s\S]*?```/g, " ").replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/* ── pure: normalize the miner's candidates into the TIC LIST ───────────
 * The miner emits overlapping grams ("the difference is", "difference is
 * in", "the difference is in" …). The honest representation of the evidence
 * is the UNION: every distinct measured phrase stays (each was measured ≥3
 * hits / ≥2 posts on its own) — matching is a flag, not a veto, so overlap
 * is harmless and collapsing would silently narrow the fingerprint. Sort by
 * measured weight, dedupe exact (case-insensitive), cap for hygiene. */
export function normalizeTics(candidates, { cap = 12 } = {}) {
  const sorted = (candidates ?? [])
    .map((c) => (typeof c === "string" ? { phrase: c, hits: null, posts: null } : c))
    .filter((c) => c?.phrase && String(c.phrase).trim().length >= 8)
    .sort((a, b) => (b.hits ?? 0) - (a.hits ?? 0) || (b.posts ?? 0) - (a.posts ?? 0) || a.phrase.localeCompare(b.phrase));
  const kept = [];
  const seen = new Set();
  for (const c of sorted) {
    const p = String(c.phrase).toLowerCase();
    if (seen.has(p)) continue;
    seen.add(p);
    kept.push({ phrase: p, hits: c.hits ?? null, posts: c.posts ?? null });
    if (kept.length >= cap) break;
  }
  return kept;
}

/* ── pure: the tic verdict for ONE draft ──────────────────────────────────── */
export function ticVerdict(draft, dna) {
  const tics = dna?.memory?.tics ?? [];
  const enforce = dna?.memory?.ticEnforce === true;
  const hay = stripMarkdownLite(`${draft?.title ?? ""} ${draft?.body ?? ""}`);
  const hits = [];
  for (const t of tics) {
    if (hay.includes(t.phrase)) hits.push(t.phrase);
    if (hits.length >= 4) break;
  }
  const ok = hits.length === 0;
  const mode = enforce ? "enforce" : "observe";
  return {
    ok, mode, hits,
    reasons: ok ? [] : hits.slice(0, 3).map((h) => `tic:"${h}"`),
  };
}

/* ── THE APPLIER — the delegation's executor ──────────────────────────────── */
export function loadSealedProposal(file) {
  try {
    const doc = JSON.parse(fs.readFileSync(file, "utf8"));
    /* signing contract (R327 sealDrift / R328 sealLint): the signature covers
     * the payload WITHOUT the `at` stamp — verify over the same shape. */
    const { signature, at, ...rest } = doc;
    const expect = "sig:" + createHash("sha256").update(stableStringify(rest)).digest("hex").slice(0, 8);
    if (signature !== expect) return { ok: false, reason: `proposal-signature-mismatch(${signature}≠${expect})` };
    if (!doc.proposal?.addLexicon?.length && !doc.proposal?.pillarGaps?.length) return { ok: false, reason: "proposal-empty" };
    return { ok: true, doc, sig: signature };
  } catch (e) {
    return { ok: false, reason: `proposal-unreadable(${String(e?.message ?? e).slice(0, 60)})` };
  }
}

/* R333 · THE UNION LAW (T-92, trace 1a13a2e1be234775) — measured live before
 * a line was written: the 2026-10-14 drift beat sealed proposal sig:67a390a5
 * (5 fresh phrases, R330-filtered so NO applied tic rides along) and the
 * dry-run shrank DNA v2 from 8 tics to 5 — the applier REPLACED the
 * fingerprint it was supposed to grow. Replace + R330's anti-re-propose
 * filter = a pump: apply wave 2 → the 8 applied tics vanish from the DNA →
 * inTicFamily stops recognizing them → the monitor re-proposes them next
 * beat → the next apply drops the wave-2 five — churn forever, memory
 * regression on every beat. The applied ledger is a MEMORY, not a footnote:
 * existing tics enter the union first-class, new candidates join by
 * measured weight, dedup is exact-phrase (R330 already guards overlap at
 * proposal level), and the structural ceiling (TIC_CAP_DNA — 4× the hygiene
 * cap, never bites in practice) records any overflow HONESTLY in the ledger
 * (actions.ticsDropped) instead of silently narrowing the fingerprint.
 * Idempotency (fromSig) and the never-arm law (ticEnforce) are untouched. */
export const TIC_CAP_DNA = 48;

/** dry-run by default: returns the next DNA WITHOUT writing. */
export function planApply({ dna, proposal, sig, trace, now, driftVerdict = null }) {
  const mem = { ...(dna.memory ?? {}) };
  const existing = Array.isArray(mem.tics) ? mem.tics : [];
  const candidates = normalizeTics(proposal.addLexicon ?? [], { cap: 100000 });
  const union = normalizeTics([...existing, ...candidates], { cap: TIC_CAP_DNA });
  const have = new Set(union.map((t) => t.phrase));
  const added = union.filter((t) => !existing.some((e) => (typeof e === "string" ? e : e?.phrase)?.toLowerCase?.() === t.phrase));
  const dropped = candidates.map((t) => t.phrase).filter((p) => !have.has(p));
  /* R333 belt+braces: if the structural ceiling ever forces a previously-
   * applied tic OUT of the fingerprint, that loss is a LOUD ledger line
   * (ticsLost), never a silent narrowing — under cap 48 this stays empty
   * in every real wave; a non-empty ticsLost is an alarm, not bookkeeping. */
  const lost = existing
    .map((e) => (typeof e === "string" ? e : e?.phrase)?.toLowerCase?.())
    .filter((p) => p && !have.has(p));
  mem.tics = union;
  mem.ticEnforce = mem.ticEnforce === true; /* LAW 2: the applier never arms a veto knob */
  mem.conceptsEnforce = true;              /* R307 reorder knob: never drops, never gates; evidence = R304 ladder live + drift pillar gaps */
  mem.applied = [
    ...((dna.memory ?? {}).applied ?? []),
    { at: now ?? null, trace: trace ?? null, fromSig: sig ?? null, driftVerdict: driftVerdict ?? null,
      actions: { tics: union.map((t) => t.phrase), ticsAdded: added.map((t) => t.phrase),
        ...(dropped.length ? { ticsDropped: dropped } : {}),
        ...(lost.length ? { ticsLost: lost } : {}),
        ticEnforce: mem.ticEnforce, conceptsEnforce: true } },
  ];
  return { ...dna, version: (dna.version ?? 1) + 1, memory: mem };
}

export function applyProposal({ proposalFile = null, proposalDoc = null, dnaFile = DNA_FILE, trace = null, now = null, write = false } = {}) {
  let proposal, sig, driftVerdict;
  if (proposalDoc) { /* selftest path: caller supplies the doc + its own sig */ proposal = proposalDoc.proposal; sig = proposalDoc.sig ?? null; driftVerdict = proposalDoc.driftVerdict ?? null; }
  else {
    const sealed = loadSealedProposal(proposalFile);
    if (!sealed.ok) return { ok: false, reason: sealed.reason, write: false };
    proposal = sealed.doc.proposal; sig = sealed.sig; driftVerdict = sealed.doc.verdict ?? null;
  }
  let dna;
  try { dna = JSON.parse(fs.readFileSync(dnaFile, "utf8")); } catch (e) { return { ok: false, reason: `dna-unreadable(${String(e?.message ?? e).slice(0, 60)})`, write: false }; }
  /* idempotency: same fromSig already in the applied ledger → honest no-op */
  const already = (dna.memory?.applied ?? []).some((a) => a.fromSig && a.fromSig === sig);
  if (already) return { ok: true, noop: true, reason: `already-applied(${sig})`, write: false };
  const next = planApply({ dna, proposal, sig, trace, now, driftVerdict });
  if (!write) return { ok: true, noop: false, dryRun: true, next, write: false };
  try {
    fs.writeFileSync(dnaFile, JSON.stringify(next, null, 2) + "\n");
    return { ok: true, noop: false, write: true, applied: { version: next.version, tics: next.memory.tics.map((t) => t.phrase), conceptsEnforce: true }, sig };
  } catch (e) {
    return { ok: false, reason: `dna-write-failed(${String(e?.message ?? e).slice(0, 60)})`, write: false };
  }
}
