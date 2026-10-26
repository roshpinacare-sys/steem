/* ── T-59 · RECLAIM INSTRUMENT — plan-only, operator-gated ───────────────────
 * Measured basis (2026-10-03 chain probe, trace 1a1032bcd540d035):
 *  - 320.17 SP delegated OUT in 10 rows (9×30SP + 50SP powerspan); the probe
 *    measured the delegatees' only output = self-vote dust on rep-0 posts.
 *  - The promoted-posts market in tag "steem" is nearly EMPTY: the top slot
 *    costs 0.001 SBD and outranks posts carrying 4.19e13 rshares — the
 *    cheapest measured visibility on the chain.
 *  BOTH faces are irreversible (delegate undelegation window, transfer-to-null)
 *  → the constitution keeps execution with the operator. This module only
 *  MEASURES and PLANS: it never broadcasts, never signs, never asks a key.
 *  Every number is chain-measured at the same cycle; nothing is invented. */

import { rpcCall } from "./measure.mjs";
import { assetAmountLaw } from "./lib.mjs";

import * as fs from "node:fs";
import * as path from "node:path";
const STATE = path.join(path.dirname(new URL(import.meta.url).pathname), "state");
const FILE = path.join(STATE, "reclaim.json");
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };
const appendLine = (p, obj) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(obj) + "\n"); };

/* rep floor: a Steem account's reputation raw below 1e9 has never earned a
 * content-reward event (rep 25 = the seeded floor, raw 1e9 the boundary).
 * The law classifies on the RAW chain measure, never on a guess. */
export const RECLAIM_REP_RAW_FLOOR = 1e9;

/* the display score the chain UI shows: raw → (log10(raw)−9)×9+25 above the
 * floor, 25 below it (if the account ever touched the chain), 0 for raw 0. */
export function repScore(rawRep) {
  const r = Number(rawRep);
  if (!Number.isFinite(r) || r <= 0) return 0;
  if (r <= RECLAIM_REP_RAW_FLOOR) return 25;
  const s = Math.round((Math.log10(r) - 9) * 9 + 25);
  return Number.isFinite(s) ? Math.max(25, s) : 25;
}

/* ── pure laws ────────────────────────────────────────────────────────────── */

/* the chain's own honest SP ratio: SP = vests × totalVestingFund/totalVestingShares */
export function vestsToSp(vests, totalVestingShares, totalVestingFund) {
  const v = Number(vests), s = Number(totalVestingShares), f = Number(totalVestingFund);
  if (!Number.isFinite(v) || v <= 0 || !Number.isFinite(s) || s <= 0 || !Number.isFinite(f) || f <= 0) return null;
  const sp = (v * f) / s;
  return Number.isFinite(sp) && sp > 0 ? Math.round(sp * 1e6) / 1e6 : null;
}

/* the dead-delegation lane: candidates measured, classified by the delegatee's
 * own measured reputation. Plan-only verdict — execution is an operator face. */
export function deadDelegationLaw({ rows, accounts, totalVestingShares = null, totalVestingFund = null } = {}) {
  if (!Array.isArray(rows)) return { verdict: "READ-FAILED", candidates: [], note: "delegations unread — never guessed" };
  const rep = new Map();
  for (const a of Array.isArray(accounts) ? accounts : []) {
    if (a && typeof a.name === "string") rep.set(a.name, assetAmountLaw(a.reputation));
  }
  const candidates = [];
  let totalVests = 0;
  for (const r of rows) {
    const delegatee = typeof r?.delegatee === "string" ? r.delegatee : null;
    if (!delegatee) continue;
    const vests = assetAmountLaw(r.vesting_shares);
    totalVests += vests;
    const reputation = rep.has(delegatee) ? rep.get(delegatee) : null;
    const sp = vestsToSp(vests, totalVestingShares, totalVestingFund);
    const score = reputation != null ? repScore(reputation) : null;
    candidates.push({ delegatee, vests: Math.round(vests * 1e6) / 1e6, sp, reputation, repScore: score, class: reputation != null && reputation < RECLAIM_REP_RAW_FLOOR ? "inert-candidate" : "active-measured" });
  }
  candidates.sort((x, y) => y.vests - x.vests);
  const totalSp = vestsToSp(totalVests, totalVestingShares, totalVestingFund);
  return {
    verdict: "PLAN-ONLY-OPERATOR-GATED",
    candidates,
    totalVests: Math.round(totalVests * 1e6) / 1e6,
    totalSp,
    inertCount: candidates.filter((c) => c.class === "inert-candidate").length,
    note: "חזרה-שליטה: הצעה-בלבד — ביטול-הענקה הוא פנים-בלתי-הפיך ונשאר אצל המפעיל (חוקה)",
    law: "ריבונות נמדדת: כל-מועמד נושא את-המוניטין שנמדד-עבורו; לא נבנה דבר מעבר לתוכנית",
  };
}

/* the promoted-slot plan: cheapest measured slot for OUR latest permlink.
 * transfer-to-null is irreversible → plan-only, operator-gated. */
export function promotedPlanLaw({ rows, ourPermlink = null, capSbd = 1 } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return { verdict: "no-rows", slotCostSbd: null, note: "no promoted market measured this cycle" };
  let cheapest = null;
  for (const r of rows) {
    const p = assetAmountLaw(r?.promoted);
    if (p > 0 && (cheapest === null || p < cheapest)) cheapest = p;
  }
  if (cheapest === null) return { verdict: "no-price", slotCostSbd: null, note: "promoted rows carried no parseable SBD price" };
  if (!ourPermlink) return { verdict: "no-permlink", slotCostSbd: cheapest, note: "no own permlink measured this cycle" };
  return {
    verdict: cheapest <= capSbd ? "PLAN-ONLY-OPERATOR-GATED" : "above-cap",
    slotCostSbd: Math.round(cheapest * 1e6) / 1e6,
    permlink: ourPermlink,
    capSbd,
    note: "חשיפה נמדדה: הסלוט הזול-ביותר בטאג — ההעברה אל null בלתי-הפיכה ונשארת אצל המפעיל (חוקה)",
  };
}

/* ── IO (read-only chain probes, fail-open per probe) ─────────────────────── */

export async function measureReclaim(account) {
  const [deleg, props, promoted, mine] = await Promise.all([
    rpcCall("condenser_api.get_vesting_delegations", [account, "outgoing", 100]).catch(() => ({ ok: false })),
    rpcCall("condenser_api.get_dynamic_global_properties", []).catch(() => ({ ok: false })),
    rpcCall("condenser_api.get_discussions_by_promoted", [{ tag: "steem", limit: 10 }]).catch(() => ({ ok: false })),
    rpcCall("condenser_api.get_discussions_by_author_before_date", [account, "", new Date().toISOString().replace(/\.\d+Z$/, ""), 1]).catch(() => ({ ok: false })),
  ]);
  const rows = deleg.ok ? (deleg.result ?? []) : null;
  const tvs = assetAmountLaw(props.result?.total_vesting_shares);
  const tvf = assetAmountLaw(props.result?.total_vesting_fund_steem);
  const delegatees = [...new Set((Array.isArray(rows) ? rows : []).map((r) => r?.delegatee).filter(Boolean))];
  let accounts = null;
  if (delegatees.length > 0) {
    const acc = await rpcCall("condenser_api.get_accounts", [delegatees]).catch(() => ({ ok: false }));
    if (acc.ok && Array.isArray(acc.result)) accounts = acc.result;
  }
  const delegation = deadDelegationLaw({ rows, accounts, totalVestingShares: tvs > 0 ? tvs : null, totalVestingFund: tvf > 0 ? tvf : null });
  const permlink = mine.ok && Array.isArray(mine.result) && mine.result[0]?.permlink ? mine.result[0].permlink : null;
  const promotedPlan = promotedPlanLaw({ rows: promoted.ok ? promoted.result ?? null : null, ourPermlink: permlink });
  return { delegation, promotedPlan, node: deleg.node ?? promoted.node ?? props.node ?? null };
}

/* ── state ────────────────────────────────────────────────────────────────── */
export function reclaimState() { return readJson(FILE, null); }

export async function runReclaim({ account, now = new Date().toISOString() } = {}) {
  let out;
  try {
    out = await measureReclaim(account);
  } catch {
    out = { delegation: { verdict: "READ-FAILED", candidates: [], note: "delegations unread — never guessed" }, promotedPlan: { verdict: "no-rows", slotCostSbd: null }, node: null };
  }
  const state = { at: now, account, ...out, law: "plan-only · operator-gated · the chain measures, the constitution executes" };
  writeJson(FILE, state);
  appendLine(path.join(STATE, "events.jsonl"), { type: "reclaim.planned", at: now, delegation: out.delegation?.verdict, inert: out.delegation?.inertCount ?? null, totalSp: out.delegation?.totalSp ?? null, promoted: out.promotedPlan?.verdict, slotCostSbd: out.promotedPlan?.slotCostSbd ?? null });
  return state;
}
