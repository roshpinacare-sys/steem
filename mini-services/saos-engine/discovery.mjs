/**
 * discovery.mjs — T-14 growth-option scanner (המפעיל דרש: "גילוי אופציות
 * גדילה והתפתחות נוספים על הרשת").
 *
 * HONESTY CONTRACT:
 *  - every opportunity carries a potentialClass:
 *      measured  — computed from numbers THIS account already produced
 *      estimated — computed from public chain math (inputs shown as evidence)
 *      potential — structural option, no number promised
 *  - discovery NEVER executes anything: it ranks options, the doctrine gates
 *    decide. Learning may consume discovery's measured tag ranking (additive,
 *    clamped) — that is the only consumer.
 *  - cadence-gated by the caller (15 min default — T-15 throughput order) — network reads are not free.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall } from "./measure.mjs";
import { scanBookDepth } from "./intel.mjs";
import { learningState } from "./learning.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const DISC_FILE = path.join(STATE, "discovery.json");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); }; /* R235: atomic — rename is the commit point */
const num = (s) => Number(String(s ?? "0").split(" ")[0]) || 0;

/* ── pure core ─────────────────────────────────────────────────────────── */

/** trending-tags rows → ranked board by total payout (deterministic tiebreak) */
export function rankTags(rows, { max = 12 } = {}) {
  const parsed = (rows ?? [])
    .map((r) => ({ tag: String(r?.name ?? ""), payouts: num(r?.total_payouts) }))
    .filter((x) => x.tag.length > 0);
  parsed.sort((a, b) => (b.payouts - a.payouts) || a.tag.localeCompare(b.tag));
  return parsed.slice(0, max).map((x) => ({ tag: x.tag, payoutsSbd: Math.round(x.payouts * 1e3) / 1e3 }));
}

/** curation share math from the public reward fund (estimated-class, inputs shown) */
export function curationShareEstimate(rewardFund, voteVestsShare) {
  if (!rewardFund || !(rewardFund.rewardBalanceSteem > 0)) return null;
  const dailyPool = rewardFund.rewardBalanceSteem / rewardFund.windowDays; // linear approximation, honest label
  const share = dailyPool * (voteVestsShare ?? 0);
  return {
    dailyPoolSteem: Math.round(dailyPool * 1e3) / 1e3,
    voteVestsShare: voteVestsShare ?? 0,
    estimatedSteemPerDay: Math.round(share * 1e4) / 1e4,
    note: "linear approx over reward-fund window — ESTIMATED class, never claimed as measured",
  };
}

/** opportunities from evidence — ranked, honest classes, never executed */
export function scoreOpportunities({ tagBoard, depth, vpEff, curationEst, bookFills, soldiers }) {
  const ops = [];
  if (tagBoard?.length) {
    const top = tagBoard[0];
    ops.push({
      id: "tags-realloc",
      kind: "curation-tags",
      potentialClass: "measured",
      evidence: `top trending tag "${top.tag}" carries ${top.payoutsSbd} SBD total payouts (get_trending_tags)`,
      potential: "better vote placement inside the SAME 10-vote/day quota",
      gate: "learning may add ≤1 tag, total ≤8 — daily caps & VP floor untouched",
      effort: "already wired via learning tunings",
    });
  }
  if (curationEst) {
    ops.push({
      id: "curation-share",
      kind: "curation-yield",
      potentialClass: "estimated",
      evidence: `reward-fund pool ${curationEst.dailyPoolSteem} STEEM/window · our vests share ${(curationEst.voteVestsShare * 100).toFixed(4)}% → ~${curationEst.estimatedSteemPerDay} STEEM/day`,
      potential: curationEst.estimatedSteemPerDay,
      gate: "measured truth only lands via curation_reward ops (measureAll) — estimator never claims payout",
      effort: "rail live since T-13",
    });
  }
  if (depth?.ok && depth.spreadBps != null) {
    ops.push({
      id: depth.spreadBps > 150 ? "spread-wide" : "spread-normal",
      kind: "book-spread",
      potentialClass: "measured",
      evidence: `spread ${depth.spreadBps}bps (bestAsk ${depth.bestAsk} / bestBid ${depth.bestBid})`,
      potential: depth.spreadBps > 150 ? "wide spread = richer maker margins for the ladder" : "spread inside normal band — hold shape",
      gate: "VF1 floor law: never sell below external value",
      effort: "dragK already intel-fed",
    });
  }
  if (soldiers?.deployed && (soldiers.accounts?.length ?? 0) < 6) {
    ops.push({
      id: "fleet-growth",
      kind: "soldier-fleet",
      potentialClass: "potential",
      evidence: `${soldiers.accounts?.length ?? 0}/6 lanes live · measured account cost 3 STEEM (paid account_create, T-12)`,
      potential: "more lanes = more grid coverage once liquid STEEM returns",
      gate: "X-2 liquidity law: deploy ≤60%, reserves first",
      effort: "one op per soldier when master liquid >40",
    });
  }
  if (bookFills?.lastFillAt) {
    const ageH = Math.round(((Date.now() - Date.parse(bookFills.lastFillAt)) / 3600000) * 10) / 10;
    if (ageH > 24) {
      ops.push({
        id: "book-cold",
        kind: "fills-velocity",
        potentialClass: "measured",
        evidence: `last fill ${ageH}h ago (${bookFills.fills} fills in measured window)`,
        potential: "cold book → review placement breadth, not price floor",
        gate: "price law untouched — breadth within per-cycle caps only",
        effort: "monitor",
      });
    }
  }
  const w = { measured: 3, estimated: 2, potential: 1 };
  ops.sort((a, b) => (w[b.potentialClass] - w[a.potentialClass]) || a.id.localeCompare(b.id));
  return ops;
}

export function discoveryState() { return readJson(DISC_FILE, null); }

/* ── the IO pass (cadence-gated) ───────────────────────────────────────── */
export async function runDiscovery({ now = new Date().toISOString(), persist = true, minIntervalMs = 15 * 60_000 } = {}) {
  const prev = readJson(DISC_FILE, null);
  if (prev?.lastFullScanAt && Date.now() - Date.parse(prev.lastFullScanAt) < minIntervalMs) {
    // T-15: a cadence-skip is ITSELF recorded output — touch the file (fresh
    // `at`, keep lastFullScanAt) so the fleet registry can tell "lawfully
    // waiting" apart from "dead". A silent skip looks exactly like rot.
    const touched = { ...prev, verdict: prev.verdict ?? "FRESH-CACHED", at: now, freshCached: true };
    if (persist) writeJson(DISC_FILE, touched);
    return { ...touched, verdict: "FRESH-CACHED" };
  }

  const [tagsR, depth, fundR, accR, soldiers] = await Promise.all([
    rpcCall("condenser_api.get_trending_tags", ["", 50]),
    scanBookDepth().catch(() => ({ ok: false })),
    rpcCall("condenser_api.get_reward_fund", ["post"]),
    rpcCall("condenser_api.get_accounts", [[process.env.SAOS_ACCOUNT || "headcorner"]]),
    Promise.resolve(readJson(path.join(STATE, "soldiers.json"), null)),
  ]);

  const tagBoard = tagsR.ok ? rankTags(tagsR.result, { max: 12 }) : [];
  let curationEst = null;
  let vpEff = null;
  if (accR.ok && accR.result?.[0] && fundR.ok) {
    const acc = accR.result[0];
    const vests = num(acc.vesting_shares);
    vpEff = vests > 0 && acc.voting_manabar?.current_mana != null
      ? Math.round((Number(acc.voting_manabar.current_mana) / (vests * 1e6)) * 1000) / 10
      : null;
    const rf = fundR.result ?? {};
    const rewardBalanceSteem = num(rf.reward_balance);
    const recentClaims = num(rf.recent_claims);
    if (rewardBalanceSteem > 0 && recentClaims > 0 && vests > 0) {
      // our claim share ≈ our vests / network claims (vests×1e6 mana-scale vs claims units differ by a constant ×1e6 — the ratio is scale-invariant ONLY if both use the same units; recent_claims IS in vests×1e6 units)
      const share = (vests * 1e6) / recentClaims;
      curationEst = curationShareEstimate(
        { rewardBalanceSteem, windowDays: 1 },
        Math.min(share, 1),
      );
    }
  }

  const bookFills = readJson(path.join(STATE, "observe.json"), null);
  const opportunities = scoreOpportunities({
    tagBoard, depth, vpEff, curationEst,
    bookFills: { fills: bookFills?.fills ?? 0, lastFillAt: bookFills?.lastFillAt ?? null },
    soldiers: soldiers ? { deployed: !!soldiers.deployed, accounts: soldiers.accounts ?? [] } : null,
  });

  const out = {
    at: now,
    lastFullScanAt: now,
    verdict: opportunities.length ? "OPTIONS-FOUND" : "NO-NETWORK-READ",
    tagBoard,
    curationEst,
    vpEff,
    opportunities,
    learningConsumer: learningState()?.tuningsApplied ?? [],
    honesty: "ranked options, zero execution · classes: measured>estimated>potential · gates own the decisions",
  };
  if (persist) {
    writeJson(DISC_FILE, out);
    fs.appendFileSync(path.join(STATE, "events.jsonl"), JSON.stringify({
      type: "discover.done", at: now, verdict: out.verdict,
      tags: tagBoard.length, opportunities: opportunities.map((o) => o.id),
    }) + "\n");
  }
  return out;
}
