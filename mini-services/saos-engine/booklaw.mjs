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
import { booklawPlan } from "./lib.mjs";
import { masterAccount, execPaused } from "./signer.mjs";

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
export async function runBooklaw({ observe = null, persist = true, now = new Date().toISOString(), exec = null } = {}) {
  const orders = Array.isArray(observe?.orders) ? observe.orders : null;
  const steem = observe?.inventory?.steem ?? null;
  const sbd = observe?.inventory?.sbd ?? null;
  const plan = orders ? booklawPlan({ orders, steem, sbd }) : { verdict: "NO-DATA", lanes: {}, coverage: {}, cancelIds: [], cancelWhy: [] };

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
