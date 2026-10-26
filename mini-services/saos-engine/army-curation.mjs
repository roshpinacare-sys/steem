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
import { executeAs, armedConf, execPaused, loadCredential } from "./signer.mjs";
import { curatorPolicy, filterCandidates, normalizePost, fetchCandidates,
  effectiveVests, vpEffPct, weightForAge, hashSeed, dayKeyOf } from "./curator.mjs";
import { countDayVotesFromHistory } from "./lib.mjs";
import { tagRoiState, orderTagsByRoi } from "./tag-roi.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const AC_FILE = path.join(STATE, "army-curation.json");
const RECEIPTS = path.join(DIR, "receipts", "army-curation.jsonl");

export const ARMY_ROSTER = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"];

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

/* ── policy (pure) ─────────────────────────────────────────────────────── */
export function armyCuratorPolicy() {
  const base = curatorPolicy();
  return {
    ...base,
    maxPerDay: 20,         // T-36 STEP-UP (measured): 12/day burned 7.2%/day vs 20% regen while soldiers sat at VP 87-89% (t36-rails.json) — regen spilled to the floor. 20 × ~60% = 12%/day < 20% regen; the "step-up after a measured day" this comment promised is now measured & taken
    baseWeightPct: 80,     // heavy early votes — curation share ∝ rshares × timing, not spread
    minWeightPct: 40,
    maxVotesPerCycle: 4,   // spread RC across the day's cycle runs
    fetchLimit: 30,        // bigger shared candidate pool: 10 accounts × 20 votes/day needs it (T-36 step-up)
    tags: [...base.tags, "life", "photography"], // +2 measured-active community tags
    note: "R290 structural multiplier: Σ SPᵢ × regen deployed on the same external candidates; excludeAccounts inherited = external-only law; VP floor 35 governs",
  };
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
  const p = armyCuratorPolicy();
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

  /* ONE batched chain read for the whole roster: VP + existence */
  const accR = await rpcCall("condenser_api.get_accounts", [ARMY_ROSTER]);
  if (!accR.ok || !Array.isArray(accR.result)) return { ...base, verdict: "NO-ROSTER-READ", error: accR.error ?? "read failed" };
  const vpByAccount = {};
  for (const a of accR.result) {
    const vests = effectiveVests(a);
    vpByAccount[a.name] = vpEffPct(Number(a.voting_manabar?.current_mana ?? 0), vests);
  }

  /* ONE shared candidate fetch for the whole roster (network-economical) */
  const { posts, ok: streamOk } = await fetchCandidates(p, ARMY_ROSTER[0], nowMs);
  if (!streamOk) return { ...base, verdict: "NO-CANDIDATE-STREAM" };

  const results = [];
  let totalVotes = 0;
  for (const account of ARMY_ROSTER) {
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
