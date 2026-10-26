/**
 * booklaw.mjs — T-29 · THE BOOK-COVERAGE LAW (the account's own risk desk).
 *
 * Live-caught 2026-10-02: the chain held 15 open orders promising 6.305 STEEM
 * (vs a 4.886 balance) and 78.145 SBD of bids (vs a 1.168 balance). On Steem
 * limit orders are checked against the balance ONLY at creation — they never
 * escrow — so phantom notional lives forever: no lane owns it, no law cancels
 * it, and a single fill would demand capital the account does not have.
 * Worse: the peg budget law multiplied the phantom INTO its own budget
 * (0.6 × (1.168 + 78.145) = 47.6 SBD of "budget" on a 1.168 balance).
 *
 * This runner: partition (hyper-lane untouchable) → coverage measure →
 * cancel the worst-price overflow (our id-space only) → journal everything.
 * The peg budget base gets the same truth via lib.pegDeployBase.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { masterAccount, execPaused } from "./signer.mjs";

/* ═══ THE PLAN — self-contained since 2026-10-16 (measured resurrection) ═══
 * History: booklawPlan used to live in lib.mjs; a lib refactor removed it and
 * the orphaned import made THIS module unloadable — the account's risk desk
 * was dead code nobody called, while the chain measured phantom bid overflow.
 * The law now lives HERE (one file = one law), immune to future lib churn.
 *
 * LAWS (T-29, unchanged):
 *  · the book never promises more than the balance — coverage measured every
 *    cycle (asks ≤ steem×0.95, bids ≤ (sbd − bidReserveSbd)×0.95)
 *  · the hyper-grid band is untouchable: ids in [2.1e9, 4.29e9] are measured
 *    but never cancelled here
 *  · ORPHANS FIRST (2026-10-16 extension, disease-targeting): an order no
 *    living lane manages (absent from the registry) dies before a registry-
 *    owned order at equal wrongness — orphaned fat tranches are exactly how
 *    capital got stuck; then worst-price first: most expensive asks, cheapest
 *    bids — the least-likely-to-fill promise the most time (unit DESC:
 *    for asks unit=SBD/STEEM high=far ask; for bids unit=STEEM/SBD high=far
 *    below market). Oct-2 evidence consistent.
 *  · everything journaled — a cancel is a measured decision, never a vibe.
 */
export function booklawPlan({ orders = null, steem = null, sbd = null, registryIds = null, bidReserveSbd = 0.5, coveragePct = 0.95, maxCancels = 20 } = {}) {
  if (!Array.isArray(orders) || orders.length === 0 || steem == null || sbd == null) {
    return { verdict: "NO-DATA", lanes: {}, coverage: {}, cancelIds: [], cancelWhy: [] };
  }
  const HYPER_LO = 2_100_000_000, HYPER_HI = 4_290_000_000;
  const ours = new Set((Array.isArray(registryIds) ? registryIds : []).map((x) => (typeof x === "object" && x !== null ? x.id : x)));
  const baseAmt = (s) => Number(String(s ?? "0").split(" ")[0]) || 0;
  const rows = orders
    .map((o) => ({ id: o.orderid, side: o.side, amt: baseAmt(o.base), unit: Number(o.unit) || 0 }))
    .filter((o) => o.amt > 0 && !(o.id >= HYPER_LO && o.id <= HYPER_HI));
  const cancelable = (side) => rows
    .filter((o) => o.side === side)
    .sort((a, b) => (ours.has(a.id) ? 1 : 0) - (ours.has(b.id) ? 1 : 0) || b.unit - a.unit); /* orphans first, then worst-price */
  const asks = cancelable("ask");
  const bids = cancelable("bid");
  const askSum = rows.filter((o) => o.side === "ask").reduce((s, o) => s + o.amt, 0);
  const bidSum = rows.filter((o) => o.side === "bid").reduce((s, o) => s + o.amt, 0);
  const askCap = Math.max(0, steem) * coveragePct;
  const bidCap = Math.max(0, sbd - bidReserveSbd) * coveragePct;
  const askOver = Math.max(0, askSum - askCap);
  const bidOver = Math.max(0, bidSum - bidCap);
  const cancelIds = [];
  const cancelWhy = [];
  const take = (pool, over) => {
    let freed = 0;
    for (const o of pool) {
      if (cancelIds.length >= maxCancels || freed >= over) break;
      cancelIds.push(o.id);
      cancelWhy.push({ id: o.id, side: o.side, amt: o.amt, unit: o.unit, freed: Math.round(o.amt * 1e6) / 1e6, orphan: !ours.has(o.id) });
      freed += o.amt;
    }
    return freed;
  };
  take(asks, askOver);
  take(bids, bidOver);
  const verdict = cancelIds.length > 0 ? "REPAIRED" : "COVERED";
  return {
    verdict,
    lanes: { hyper: orders.filter((o) => o.orderid >= HYPER_LO && o.orderid <= HYPER_HI).length, cancelableAsks: asks.length, cancelableBids: bids.length, orphans: rows.filter((o) => !ours.has(o.id)).length },
    coverage: { askSum: Math.round(askSum * 1e6) / 1e6, askCap: Math.round(askCap * 1e6) / 1e6, askOver: Math.round(askOver * 1e6) / 1e6, bidSum: Math.round(bidSum * 1e6) / 1e6, bidCap: Math.round(bidCap * 1e6) / 1e6, bidOver: Math.round(bidOver * 1e6) / 1e6 },
    cancelIds,
    cancelWhy,
  };
}

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(__dirname, "state");
const FILE = path.join(STATE, "booklaw.json");
const EVENTS = path.join(STATE, "events.jsonl");

export function booklawState() { return readJson(FILE, null); }

/**
 * Run the coverage law against the freshest observe data.
 * @param {object} p
 * @param {object|null} p.observe  — the observe step's data (orders + inventory)
 * @param {boolean} p.persist      — write state/events
 * @param {string} p.now           — ISO timestamp
 * @param {(ops: array, tag: string) => Promise<{ok: boolean, txid?: string, error?: string}>} p.exec
 *        — active-authority broadcaster (executeAs wrapper); optional: without
 *          it the law still measures and journals, cancels stay PENDING.
 */
export async function runBooklaw({ observe = null, persist = true, now = new Date().toISOString(), exec = null, registryIds = null } = {}) {
  const orders = Array.isArray(observe?.orders) ? observe.orders : null;
  const steem = observe?.inventory?.steem ?? null;
  const sbd = observe?.inventory?.sbd ?? null;
  const plan = orders ? booklawPlan({ orders, steem, sbd, registryIds }) : { verdict: "NO-DATA", lanes: {}, coverage: {}, cancelIds: [], cancelWhy: [] };

  const out = {
    at: now,
    verdict: plan.verdict,
    lanes: plan.lanes ?? {},
    coverage: plan.coverage ?? {},
    cancelIds: plan.cancelIds ?? [],
    cancelWhy: plan.cancelWhy ?? [],
    broadcast: null,
    laws: [
      "הספר לעולם לא מבטיח יותר מהיתרה — כיסוי נמדד כל מחזור (asks ≤ יתרת STEEM × 0.95, bids ≤ (יתרת SBD − 0.5 רזרבה) × 0.95)",
      "פס-ההיפר-גריד נגע-בלבד: ids ‎[2.1e9, 4.29e9]‎ נמדדים אך לעולם לא מבוטלים כאן",
      "ביטולים במחיר-הגרוע ראשון: asks היקרים ביותר, bids הזולים ביותר — הפחות-מתמלאים מבטיחים הכי הרבה זמן",
      "בלי אישור-חתימה: החוק מודד ומתעד CANCEL-PENDING — הסיכון נרשם, לא נשקר",
    ],
  };

  if (plan.verdict === "REPAIRED" && Array.isArray(plan.cancelIds) && plan.cancelIds.length > 0) {
    if (execPaused()) {
      out.verdict = "OPERATOR-PAUSED";
      out.broadcast = { ok: false, error: "paused" };
    } else if (typeof exec === "function") {
      const owner = masterAccount();
      const ops = plan.cancelIds.slice(0, 20).map((orderid) => ["limit_order_cancel", { owner, orderid }]);
      try {
        const res = await exec(ops, "booklaw");
        out.broadcast = { ok: !!res?.ok, txid: res?.txid ?? null, error: res?.error ?? null, count: ops.length };
        if (!res?.ok) out.verdict = "CANCEL-FAILED";
      } catch (e) {
        out.broadcast = { ok: false, error: String(e?.message ?? e).slice(0, 140) };
        out.verdict = "CANCEL-FAILED";
      }
    } else {
      out.broadcast = { ok: false, pending: true, note: "CANCEL-PENDING — אין משדר-פעיל במחזור זה" };
    }
  }

  if (persist) {
    writeJson(FILE, out);
    appendLine(EVENTS, { type: "booklaw.done", at: now, verdict: out.verdict, cancels: plan.cancelIds?.length ?? 0, askOver: plan.coverage?.askOver ?? null, bidOver: plan.coverage?.bidOver ?? null });
  }
  return out;
}
