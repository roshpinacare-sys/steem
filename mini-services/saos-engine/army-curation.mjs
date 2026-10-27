/* ─────────────────────────────────────────────────────────────────────────
 * R290 · ARMY CURATION RAIL — the structural multiplier, implemented.
 *
 * R289 measured the waste: 10 army accounts × 562 SP sitting at 97-100% VP
 * while headcorner's curator rail alone earns 0.578 SP/day (17.4% APR measured).
 * R289 §5.2 proposed the fix, unimplemented: THE SAME external rising posts
 * voted by the WHOLE roster — curation budget = Σ SPᵢ × 20%/day of regen, and
 * the split-SP structure is a mathematical advantage of the fleet shape.
 *
 * LAWS (all inherited, none new):
 *  - EXTERNAL CONTENT ONLY: the full 17-account roster is excluded as AUTHOR
 *    (curatorPolicy's exclusion list) — this is curation of the outside world,
 *    never ring-voting ourselves. Fleet-support stays army-social's law.
 *  - SUSTAINABLE: maxPerDay 4 × avg ~35% weight ≈ 14%/day VP burn < 20% regen
 *    → equilibrium forever; the VP floor (35%) governs the rest.
 *  - CHAIN-TRUTH DAY BUDGET per account (the T-18 law): max(state, chain) —
 *    the chain can only RAISE the count, never lower it.
 *  - ONE vote per broadcast, spaced (STEEM_MIN_VOTE_INTERVAL_SEC=3 measured).
 *  - No keys touched when custody is not green (executeAs owns the think gate).
 * ───────────────────────────────────────────────────────────────────────── */

import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall } from "./measure.mjs";
import { executeAs, armedConf, execPaused, loadCredential, custodyOf } from "./signer.mjs";
import { adoptAccountPostingWif } from "./vault-revival.mjs";
import { curatorPolicy, filterCandidates, normalizePost, fetchCandidates,
  effectiveVests, vpEffPct, weightForAge, hashSeed, dayKeyOf } from "./curator.mjs";
import { countDayVotesFromHistory } from "./lib.mjs";
import { tagRoiState, orderTagsByRoi } from "./tag-roi.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const AC_FILE = path.join(STATE, "army-curation.json");
const RECEIPTS = path.join(DIR, "receipts", "army-curation.jsonl");

export const ARMY_ROSTER = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"];

/* G78-c · VAULT-VALID CURATION ROSTER (armed law, wave G78-c-R2).
 * exec-armed.json `curate` is LAW: enabled, maxPerDay 10, baseWeightPct 50,
 * minWeightPct 20, minVpEffPct 60; RC floor = max(8, armed minRcPct) = 20
 * (enforcement owned by the signer's executeAs RC guard).
 * Roster law: only VAULT-VALID soldiers vote. haran/lsa/siq are custody
 * wounds (CUSTODY-WOUNDS.jsonl, fingerprints-only evidence) — excluded even
 * though they sit in the legacy ARMY_ROSTER; hcsoldier4/5/6 are vault-valid
 * soldiers — included. The wound filter below re-checks at every run, so a
 * fresh wound on any listed body auto-skips it without a code change. */
export const VAULT_VALID_ROSTER = ["cashmachine", "israelnews", "macrame", "tov", "wic", "wog", "woq", "hcsoldier4", "hcsoldier5", "hcsoldier6"];
const WOUNDS_FILE = process.env.STEEM_CUSTODY_WOUNDS || "/home/z/coord-work/vaults/steem-secrets/CUSTODY-WOUNDS.jsonl";

/* fingerprints-only read of the custody-wound evidence; absent/unreadable
 * file = NO exclusion evidence — never invent a wound (fail-open on absence,
 * the signer's chain-judged think gate stays the hard guard). */
export function readCustodyWounds(p = WOUNDS_FILE) {
  const out = [];
  try {
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const t = line.trim(); if (!t) continue;
      try { const w = JSON.parse(t); if (Array.isArray(w?.soldiers)) for (const s of w.soldiers) if (s) out.push(String(s)); } catch { /* broken line: not evidence */ }
    }
  } catch { /* no file = no wounds on record */ }
  return [...new Set(out)];
}

/* pure: split a roster into allowed vs custody-wounded bodies */
export function woundFilter(roster, wounded = []) {
  const skip = new Set((wounded ?? []).map(String));
  const allowed = [], wounds = [];
  for (const r of roster) (skip.has(r) ? wounds : allowed).push(r);
  return { allowed, wounded: wounds };
}

/* pure: THE ARMED CURATE LAW, validated fail-closed. The rail votes ONLY
 * inside the armed policy's bounds — missing/invalid law = no votes, ever. */
export function armedCuratePolicy(curate, minRcPct = null) {
  const c = curate && typeof curate === "object" ? curate : null;
  if (!c) return { ok: false, reasons: ["armed-curate-missing"], policy: null };
  const reasons = [];
  const int = (v) => Number.isInteger(v);
  if (typeof c.enabled !== "boolean") reasons.push("enabled-must-be-boolean");
  if (!int(c.maxPerDay) || c.maxPerDay < 1 || c.maxPerDay > 40) reasons.push("maxPerDay-out-of-range");
  if (!Number.isFinite(c.baseWeightPct) || c.baseWeightPct < 1 || c.baseWeightPct > 100) reasons.push("baseWeightPct-out-of-range");
  if (!Number.isFinite(c.minWeightPct) || c.minWeightPct < 1 || c.minWeightPct > c.baseWeightPct) reasons.push("minWeightPct-out-of-range");
  if (!Number.isFinite(c.minVpEffPct) || c.minVpEffPct < 0 || c.minVpEffPct > 100) reasons.push("minVpEffPct-out-of-range");
  if (reasons.length) return { ok: false, reasons, policy: null };
  return { ok: true, reasons: [], policy: { ...c, minRcPct: Math.max(8, Number(minRcPct ?? 20)) } };
}

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

/* ── policy (pure) ─────────────────────────────────────────────────────── */
export function armyCuratorPolicy(curateLaw = null) {
  const base = curatorPolicy();
  const p = {
    ...base,
    maxPerDay: 20,         // R290 fallback — the RUN path always passes the validated armed law, which overrides these
    baseWeightPct: 80,     // heavy early votes — curation share ∝ rshares × timing, not spread
    minWeightPct: 40,
    maxVotesPerCycle: 4,   // spread RC across the day's cycle runs
    fetchLimit: 30,        // bigger shared candidate pool for a 10-body roster
    tags: [...base.tags, "life", "photography"], // +2 measured-active community tags
    minRcPct: 20,          // G78-c RC floor = max(8, armed 20); enforcement owned by executeAs
    note: "G78-c armed-law governed: run-path clamps maxPerDay/baseWeightPct/minWeightPct/minVpEffPct/enabled from exec-armed.json curate (validated fail-closed); R290 pacing fields govern rails-internal spread only; excludeAccounts inherited = external-only law",
  };
  if (curateLaw && typeof curateLaw === "object" && curateLaw.ok === true && curateLaw.policy) {
    Object.assign(p, curateLaw.policy);
    p.armedLawApplied = true;
  } else if (curateLaw) {
    p.enabled = false; // armed law refused → the rail is disabled, never self-governed
    p.armedLawRefused = curateLaw.reasons ?? true;
  }
  return p;
}

/* pure VP-budget check — selftestable (curator measured-law: burn%/day = Σ weight%/100) */
export function armyVpSustainable(p = armyCuratorPolicy()) {
  const avgWeight = (p.baseWeightPct + p.minWeightPct) / 2;
  const burnPerDayPct = Math.round(p.maxPerDay * avgWeight) / 100;
  return { burnPerDayPct, regenPerDayPct: 20, sustainable: burnPerDayPct < 20, utilizationPct: Math.round((burnPerDayPct / 20) * 100) };
}

/* pure: filter an account out of the roster by VP floor (selftestable) */
export function vpEligible(vpEff, minVpEffPct) {
  if (vpEff == null) return false;
  return vpEff >= minVpEffPct;
}

export function armyCurationState() { return readJson(AC_FILE, null); }

/* ── runner ────────────────────────────────────────────────────────────── */
export async function runArmyCuration({ now = new Date().toISOString() } = {}) {
  const conf = armedConf();
  /* G78-c: the armed curate law governs — validated fail-closed (no law, no votes). */
  const law = armedCuratePolicy(conf?.curate ?? null, conf?.minRcPct ?? null);
  if (!law.ok) return { enabled: conf?.curate?.enabled ?? null, at: now, day: dayKeyOf(now), rail: "army-curation", verdict: "ARMED-POLICY-INVALID", reasons: law.reasons };
  const p = armyCuratorPolicy(law);
  /* R291 · measured tag-ROI ordering: the whitelist stays the universe, only
   * the ORDER follows what actually paid us (falls back to policy order when
   * data-thin — the tag-roi law). */
  const roi = tagRoiState();
  if (roi?.tags) {
    const ordered = orderTagsByRoi(p.tags, Object.values(roi.tags));
    p.tags = ordered.tags;
    p.tagsBasis = ordered.basis;
  }
  const day = dayKeyOf(now);
  const nowMs = Date.parse(now);
  const base = { enabled: p.enabled, at: now, day, rail: "army-curation" };

  if (!p.enabled) return { ...base, verdict: "DISABLED" };
  if (execPaused()) return { ...base, verdict: "OPERATOR-PAUSED" };
  try { loadCredential(); } catch (e) { return { ...base, verdict: "CREDENTIAL-MISSING", error: String(e?.message ?? e) }; }

  const prev = readJson(AC_FILE, { day: null, perAccount: {} });
  const carried = prev.day === day ? prev : { day, perAccount: {} };

  /* G78-c: VAULT-VALID roster only, minus any body currently on the wound
   * ledger (fingerprints-only). Wounded bodies are recorded, never voted. */
  const { allowed, wounded } = woundFilter(VAULT_VALID_ROSTER, readCustodyWounds());
  const results = wounded.map((account) => ({ account, verdict: "CUSTODY-WOUND" }));
  let totalVotes = 0;
  if (!allowed.length) return { ...base, verdict: "NO-ALLOWED-BODIES", accounts: results, totalVotes };

  /* ONE batched chain read for the whole (vault-valid) roster: VP + existence */
  const accR = await rpcCall("condenser_api.get_accounts", [allowed]);
  if (!accR.ok || !Array.isArray(accR.result)) return { ...base, verdict: "NO-ROSTER-READ", error: accR.error ?? "read failed" };
  const vpByAccount = {};
  for (const a of accR.result) {
    const vests = effectiveVests(a);
    vpByAccount[a.name] = vpEffPct(Number(a.voting_manabar?.current_mana ?? 0), vests);
  }

  /* ONE shared candidate fetch for the whole roster (network-economical) */
  const { posts, ok: streamOk } = await fetchCandidates(p, allowed[0], nowMs);
  if (!streamOk) return { ...base, verdict: "NO-CANDIDATE-STREAM" };

  /* G78-c · SELF-ADOPTION LAW: custody is memory-first (R312) — a fresh
   * process re-adopts each roster body from the 0600 local cache BEFORE any
   * signature, chain-judged per WIF (the chain stays the only judge). A body
   * that cannot chain-verify is refused by the think gate and recorded —
   * nothing here ever bypasses the signer's gate. */
  for (const account of allowed) {
    if (custodyOf(account) === "verified") continue;
    try { await adoptAccountPostingWif(account); } catch { /* think gate stays the guard */ }
  }

  for (const account of allowed) {
    const st = carried.perAccount[account] ?? { votesToday: [], authorsToday: {} };
    const votedPermlinks = (st.votesToday ?? []).map((v) => `${v.author}/${v.permlink}`);

    /* chain-truth day budget (T-18 law) */
    let chainDayCount = null;
    try {
      const histR = await rpcCall("condenser_api.get_account_history", [account, -1, 400]);
      if (histR.ok) chainDayCount = countDayVotesFromHistory(histR.result, account, day);
    } catch { /* fall back to state */ }
    const budgetCounted = Math.max((st.votesToday ?? []).length, chainDayCount ?? 0);
    if (chainDayCount !== null && budgetCounted >= p.maxPerDay) {
      results.push({ account, verdict: "DAY-CAP", chainDayCount, budgetCounted });
      continue;
    }

    const vpEff = vpByAccount[account] ?? null;
    if (!vpEligible(vpEff, p.minVpEffPct)) {
      results.push({ account, verdict: "VP-FLOOR", vpEff, minVpEffPct: p.minVpEffPct });
      continue;
    }

    const jitterSeed = hashSeed(`${day}|${Math.floor(nowMs / (2 * 3600_000))}|${account}`);
    const plan = filterCandidates({
      posts, voter: account, policy: p, nowMs,
      votedPermlinks, votesToday: budgetCounted, authorsToday: st.authorsToday ?? {},
      jitterSeed,
    });
    if (!plan.selected.length) {
      results.push({ account, verdict: "NO-CANDIDATES", rejectedTop: plan.rejected.slice(0, 3).map((r) => `${r.key}:${r.reason}`) });
      continue;
    }

    let landed = 0;
    for (const sel of plan.selected) {
      /* WEIGHT LAW (R290 hotfix — measured damage): weightForAge returns
       * STEEM UNITS already (3500 = 35%, proven by selftest band
       * [minWeightPct×100 .. baseWeightPct×100] and by curator's own
       * broadcast). Multiplying by 100 overflowed the u16 serialization:
       * 521700 wrapped to -2588 = a REAL DOWNVOTE on an innocent author.
       * Chain law: 0 < weight ≤ 10000 — assert before broadcast, fail-closed. */
      const weight = Math.round(weightForAge(sel.ageMinutes, p));
      if (!(weight > 0 && weight <= 10000)) {
        results.push({ account, verdict: "WEIGHT-INVALID", weight, target: `${sel.author}/${sel.permlink}` });
        break;
      }
      const ops = [["vote", { voter: account, author: sel.author, permlink: sel.permlink, weight }]];
      const res = await executeAs(account, ops, { tag: "army-curation", role: "posting" });
      if (!res.ok) {
        results.push({ account, verdict: "VOTE-FAIL", target: `${sel.author}/${sel.permlink}`, reason: res.verdict ?? res.reason ?? "broadcast-failed" });
        break; // fail-closed: first failure stops this account's run (never burn RC on a dead path)
      }
      landed += 1; totalVotes += 1;
      st.votesToday = [...(st.votesToday ?? []), { author: sel.author, permlink: sel.permlink, weight, at: now }];
      st.authorsToday = { ...(st.authorsToday ?? {}), [sel.author]: (st.authorsToday?.[sel.author] ?? 0) + 1 };
      carried.perAccount[account] = st;
      writeJson(AC_FILE, carried); // incremental state write — a mid-loop kill loses nothing
      appendLine(RECEIPTS, { at: now, account, author: sel.author, permlink: sel.permlink, weight, tag: "army-curation" });
      if (landed >= p.maxVotesPerCycle) break;
      await new Promise((r) => setTimeout(r, 3300)); // STEEM_MIN_VOTE_INTERVAL_SEC measured-law
    }
    if (landed > 0) results.push({ account, verdict: "VOTED", votes: landed });
  }

  const summary = { ...base, verdict: results.some((r) => r.verdict === "VOTED") ? "VOTED" : "IDLE", accounts: results, totalVotes, armySp: (readJson(path.join(STATE, "yield-levers.json"), null)?.steem?.armyTotals?.effectiveSp) ?? null };
  return summary;
}
