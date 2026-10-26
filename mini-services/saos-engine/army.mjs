/**
 * army.mjs — THE ARMY CURATION RAIL (T-83).
 *
 * WHY THIS RAIL EXISTS (all measured 2026-10-05):
 *  - the operator restored/equalized delegations to the 10 active-army
 *    accounts (T-82, txid fcf347d5) — 10 × 48,393.301791 VESTS ≈ 30 SP each
 *    (TRUE ratio tvs/tvf = 1,613.04 VESTS/SP — the T-81 worklog "unit law
 *    5,460" was a circular artifact and is RETIRED).
 *  - chain history shows the army WORKED (56-71 votes/account) until the
 *    2026-10-04 ~16:00 environment death — the loop died with the old
 *    sandbox and was never rebuilt. Delegated SP sat idle = activity the
 *    delegations exist FOR was missing.
 *  - the operator's standing order (T-82): "אני רוצה פעילות אבל תקינה" —
 *    proper activity. This rail IS that activity: one judgment body with
 *    the master curator (same candidate stream, same doctrine shape),
 *    bounded per account.
 *
 * HONESTY & DOCTRINE CONTRACT:
 *  - custody: every account must pass verifyRoles (direct-WIF vault mode,
 *    chain-mapped 4/4) via the think-gate inside executeAs — keyless
 *    accounts are never signed for (T-80 law, zero exceptions).
 *  - posting authority ONLY — a vote op can never move funds.
 *  - per-account day-cap 3 (chain-truth aware, T-18 law: max(state, chain)),
 *    VP floor 80%, age-decayed weights 50%→20%, no self/fleet votes,
 *    bandwagon + anti-spam filters — the SAME planner as the master
 *    curator (filterCandidates), one judgment body, ten voters.
 *  - fail-isolated per account: one dead account never kills nine.
 *  - collision law carried from the curator: an "already voted" rejection
 *    (the second signer holds our master credential) is a DEDUP event,
 *    counted honestly, never a crash.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall } from "./measure.mjs";
import { executeAs, masterAccount, armedConf, execPaused, verifyRoles, custodyOf } from "./signer.mjs";
import { fetchCandidates, filterCandidates, weightForAge, vpEffPct, dayKeyOf, curatorPolicy } from "./curator.mjs";
import { countDayVotesFromHistory } from "./lib.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const ARMY_FILE = path.join(STATE, "army.json");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

/* the 10 ACTIVE army accounts — exactly the delegation targets the operator
 * ordered equalized (T-82, chain-verified). hcsoldier1/2/3 stay EXCLUDED
 * (keyless, T-80 law); hcsoldier4/5/6 stay EXCLUDED (undeployed, T-76 gate);
 * ynet stays EXCLUDED (no WIFs; posting delegated to headcorner). */
export const ARMY_ROSTER = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"];

export function armyPolicy() {
  return {
    enabled: true,
    maxPerDay: 3,          // per account — 10 accounts × 3 = ≤30 votes/day total
    baseWeightPct: 50,
    minWeightPct: 20,
    minVpEffPct: 80,       // army accounts are rested reserves — protect the battery
    maxPerAuthorPerDay: 1,
    ageMinMinutes: 10,
    ageMaxMinutes: 1200,
    minBodyChars: 600,
    maxPendingSbd: 30,
    tags: ["steem", "crypto", "defi", "trading", "technology", "ai"],
    excludeAccounts: ["headcorner", "hcsoldier1", "hcsoldier2", "hcsoldier3", ...ARMY_ROSTER],
  };
}

/* effective vests = own + received − delegatedOut (army accounts: own is
 * dust, received is the delegation — the manabar regenerates on effective) */
export function effectiveVests(acc) {
  const V = (s) => Number(String(s ?? "0").split(" ")[0]) || 0;
  return Math.max(0, V(acc.vesting_shares) + V(acc.received_vesting_shares) - V(acc.delegated_vesting_shares));
}

/* THE PURE PER-ACCOUNT PLANNER — deterministic, selftestable, zero network.
 * Returns the vote plan for ONE account given the shared candidate stream. */
export function planAccountVotes({ posts, account, policy, nowMs, votedPermlinks = [], chainDayCount = 0, authorsToday = {} }) {
  const budget = Math.max(0, policy.maxPerDay - chainDayCount);
  if (budget <= 0) return { selected: [], rejected: [], budget: 0, verdict: "DAY-CAP" };
  const plan = filterCandidates({ posts, voter: account, policy, nowMs, votedPermlinks, votesToday: chainDayCount, authorsToday });
  const selected = plan.selected.slice(0, budget);
  return { selected, rejected: plan.rejected, budget, verdict: selected.length ? "PLAN" : "NO-CANDIDATE" };
}

export async function runArmy({ now = new Date().toISOString() } = {}) {
  const conf = armedConf();
  const p = { ...armyPolicy(), ...(conf.army ?? {}) };
  const day = dayKeyOf(now);
  const nowMs = Date.parse(now);
  const master = masterAccount();

  const prev = readJson(ARMY_FILE, { day: null, accounts: {}, totalVotes: 0 });
  const carried = prev.day === day ? prev.accounts : {};

  const base = { enabled: p.enabled, at: now, day, maxPerDay: p.maxPerDay };
  if (!p.enabled) return { ...base, verdict: "DISABLED" };
  if (execPaused()) return { ...base, verdict: "OPERATOR-PAUSED" };

  /* one candidate stream for the whole army — one judgment body, ten voters */
  const { posts, ok: streamOk } = await fetchCandidates(p, master, nowMs);
  if (!streamOk) return { ...base, verdict: "NO-CANDIDATE-STREAM" };

  const results = {};
  let broadcasted = 0;
  for (const account of ARMY_ROSTER) {
    const st = carried[account] ?? { votesToday: [], authorsToday: {}, totalVotes: 0, history: [] };
    const out = { ...st, votesToday: st.votesToday ?? [], authorsToday: st.authorsToday ?? {} };
    try {
      /* custody: keyed-unverified must prove on-chain THIS run (think-gate law) */
      const custody = custodyOf(account);
      if (custody === "no-custody") { out.verdict = "REFUSED-NO-CUSTODY"; results[account] = out; continue; }
      const ver = await verifyRoles(account);
      if (!ver.ok) { out.verdict = "CUSTODY-UNPROVEN"; out.custody = custody; results[account] = out; continue; }

      /* VP floor — chain truth on the account's own manabar */
      const accR = await rpcCall("condenser_api.get_accounts", [[account]]);
      const acc = accR.ok ? accR.result?.[0] : null;
      if (!acc) { out.verdict = "NO-ACCOUNT-READ"; results[account] = out; continue; }
      const mana = Number(acc.voting_manabar?.current_mana ?? "0");
      const vpEff = vpEffPct(mana, effectiveVests(acc));
      out.vpEff = vpEff;
      if (vpEff == null || vpEff < p.minVpEffPct) { out.verdict = "VP-FLOOR"; results[account] = out; continue; }

      /* chain-truth day budget (T-18 law, per account) */
      let chainDayCount = 0;
      try {
        const histR = await rpcCall("condenser_api.get_account_history", [account, -1, 100]);
        if (histR.ok) chainDayCount = countDayVotesFromHistory(histR.result, account, day);
      } catch { /* state count only */ }
      out.chainDayCount = chainDayCount;

      const votedPermlinks = out.votesToday.map((v) => `${v.author}/${v.permlink}`);
      const plan = planAccountVotes({ posts, account, policy: p, nowMs, votedPermlinks, chainDayCount, authorsToday: out.authorsToday });
      if (!plan.selected.length) { out.verdict = plan.verdict; results[account] = out; continue; }

      /* broadcast — posting authority, think-gate inside executeAs */
      let voted = 0;
      for (const v of plan.selected) {
        const voteOp = [["vote", { voter: account, author: v.author, permlink: v.permlink, weight: v.weight }]];
        let res = await executeAs(account, voteOp, { tag: "army-curate", role: "posting" });
        if (!res.ok && /MIN_VOTE_INTERVAL|Can only vote once every 3 seconds/i.test(String(res.error ?? ""))) {
          await new Promise((r) => setTimeout(r, 3500));
          res = await executeAs(account, voteOp, { tag: "army-curate", role: "posting" });
        }
        if (res.ok) {
          out.votesToday.push({ author: v.author, permlink: v.permlink, weight: v.weight, at: now, txid: res.txid ?? null });
          out.authorsToday[v.author] = (out.authorsToday[v.author] ?? 0) + 1;
          out.totalVotes = (out.totalVotes ?? 0) + 1;
          voted++; broadcasted++;
        } else if (/already voted in a similar way|You have already voted/i.test(String(res.error ?? ""))) {
          out.votesToday.push({ author: v.author, permlink: v.permlink, weight: v.weight, at: now, txid: null, dedup: true });
        } else {
          out.error = String(res.error ?? "unknown").slice(0, 160);
          break; /* real failure — fail-closed for THIS account only */
        }
      }
      out.verdict = voted > 0 ? "VOTED" : (out.error ? "FAIL-CLOSED" : "NO-CHANGE");
    } catch (e) {
      out.verdict = "ERROR";
      out.error = String(e?.message ?? e).slice(0, 160);
    }
    results[account] = out;
  }

  const verdicts = Object.values(results).map((r) => r.verdict);
  const summary = broadcasted > 0 ? "ARMY-ACTIVE" : (verdicts.some((v) => ["VOTED", "PLAN"].includes(v)) ? "ARMY-ARMED" : "ARMY-IDLE");
  const out = {
    ...base, verdict: summary, policy: { maxPerDay: p.maxPerDay, minVpEffPct: p.minVpEffPct },
    accounts: results, totalVotes: Object.values(results).reduce((s, r) => s + (r.totalVotes ?? 0), 0),
    broadcasted,
  };
  writeJson(ARMY_FILE, out);
  if (broadcasted > 0) {
    appendLine(path.join(STATE, "events.jsonl"), { type: "army.votes", at: now, day, broadcasted, accounts: Object.entries(results).filter(([, r]) => r.verdict === "VOTED").map(([n]) => n) });
  }
  return out;
}
