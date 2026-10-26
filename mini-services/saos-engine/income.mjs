/**
 * income.mjs — T-29 · THE INCOME-PROOF INSTRUMENT.
 *
 * The operator's bar is explicit: "<1¢/day is not acceptable — prove real
 * income." Until now income was INVISIBLE (realized=0 by the basis law,
 * curation vests=0 inside a 4h scan window) — invisible income cannot be
 * proven, grown, or defended. This step measures, once per cycle, from chain
 * truth only:
 *   · claims   — reward claims (7d window, select_ops scan, defensive filter)
 *   · posts    — account-level publish truth (today's non-reply comment ops)
 *   · trading  — reuses observe.pnl (realized/proceeds) + the ledger window
 *   · pending  — unclaimed rewards + author pending (face value, labeled)
 * → income.json: ONE number the cockpit renders (usdPerDay7d) + every class
 * separated, never merged (measured vs face vs estimate).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rpcCall } from "./measure.mjs";
import { incomeRollup, countPostsFromHistory, opTypeName } from "./lib.mjs";

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };
const num = (x) => Number(String(x ?? "0").split(" ")[0]) || 0;

const DIR = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(DIR, "state");
const FILE = path.join(STATE, "income.json");
const EVENTS = path.join(STATE, "events.jsonl");

export function incomeState() { return readJson(FILE, null); }

const DAY_MS = 24 * 3600_000;
const SCAN_LIMIT = 10000;

/* claims scan: select_ops first (defensive filter — some nodes ignore it,
 * proven live in payouts.mjs), condenser fallback bounded */
async function claimsOps(account) {
  let r = await rpcCall("account_history_api.get_account_history", {
    account, start: -1, limit: SCAN_LIMIT, select_ops: ["claim_reward_balance"],
  }).catch(() => ({ ok: false }));
  if (r.ok) {
    const rows = (r.result?.history ?? []).filter(([, e]) => opTypeName(e?.op) === "claim_reward_balance");
    return { rows, api: "ah_api" };
  }
  r = await rpcCall("condenser_api.get_account_history", [account, -1, 1000]).catch(() => ({ ok: false }));
  if (r.ok) {
    const rows = (r.result ?? []).filter(([, e]) => opTypeName(e?.op) === "claim_reward_balance");
    return { rows, api: "condenser" };
  }
  return { rows: [], api: null };
}

/* posts scan: the account-level publish truth (comments ops, replies excluded) */
async function postOps(account) {
  let r = await rpcCall("account_history_api.get_account_history", {
    account, start: -1, limit: SCAN_LIMIT, select_ops: ["comment"],
  }).catch(() => ({ ok: false }));
  if (r.ok) return { rows: r.result?.history ?? [], api: "ah_api" };
  r = await rpcCall("condenser_api.get_account_history", [account, -1, 1000]).catch(() => ({ ok: false }));
  if (r.ok) return { rows: r.result ?? [], api: "condenser" };
  return { rows: [], api: null };
}

export async function runIncome({ now = new Date().toISOString(), account = null } = {}) {
  const acc = account || process.env.SAOS_ACCOUNT || "headcorner";
  const day = now.slice(0, 10);

  const [a, dyn, claims, posts] = await Promise.all([
    rpcCall("condenser_api.get_accounts", [[acc]]),
    rpcCall("condenser_api.get_dynamic_global_properties", []),
    claimsOps(acc),
    postOps(acc),
  ]);
  const row = a.ok ? a.result?.[0] : null;
  if (!row) {
    const out = { day, at: now, account: acc, verdict: "READ-FAILED", income: null };
    writeJson(FILE, out);
    return out;
  }

  /* chain conversion truth: VESTS → STEEM */
  const tvs = num(dyn.ok ? dyn.result?.total_vesting_shares : 0);
  const tvf = num(dyn.ok ? dyn.result?.total_vesting_fund_steem : 0);
  const vestsPerSteem = tvs > 0 && tvf > 0 ? tvs / tvf : null;

  /* claims within 7d — the earned-and-banked rail */
  const cutoff = Date.parse(now) - 7 * DAY_MS;
  let cl = { steem: 0, sbd: 0, vests: 0 }, oldestClaimMs = null;
  for (const [, e] of claims.rows) {
    const ts = Date.parse(String(e?.timestamp ?? "").includes("T") ? e.timestamp : `${e?.timestamp ?? ""}Z`);
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    const v = Array.isArray(e?.op) ? e.op[1] ?? {} : e?.op?.value ?? {};
    cl.steem += num(v.reward_steem);
    cl.sbd += num(v.reward_sbd);
    cl.vests += num(v.reward_vests);
    if (oldestClaimMs == null || ts < oldestClaimMs) oldestClaimMs = ts;
  }
  const claimsWindowDays = oldestClaimMs ? Math.round((Date.parse(now) - oldestClaimMs) / DAY_MS * 100) / 100 + 1 : (cl.steem + cl.sbd + cl.vests > 0 ? 7 : null);

  /* account-level publish truth */
  const postsToday = countPostsFromHistory(posts.rows, day);
  const postsByDay = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.parse(now) - i * DAY_MS).toISOString().slice(0, 10);
    postsByDay[d] = countPostsFromHistory(posts.rows, d) ?? 0;
  }

  /* trading: reuse the observe step's pnl (computed once this cycle) */
  const obs = readJson(path.join(STATE, "observe.json"), null);
  const pnl = obs?.pnl ?? null;
  const ledger = readJson(path.join(STATE, "fills-ledger.json"), null);
  const fillAts = Array.isArray(ledger?.fills) ? ledger.fills.map((f) => Number(f?.at)).filter(Number.isFinite) : [];
  const tradingWindowDays = fillAts.length ? Math.max(0.01, Math.round((Date.parse(now) - Math.min(...fillAts)) / DAY_MS * 100) / 100 + 0.01) : null;

  /* pending author (face value) — own posts pending_payout sum from the probe */
  let pendingAuthorSbd = null;
  try {
    const d = await rpcCall("condenser_api.get_discussions_by_author_before_date", [acc, "", "2100-01-01T00:00:00", 20]);
    if (d.ok && Array.isArray(d.result)) {
      pendingAuthorSbd = Math.round(d.result.reduce((s, p) => s + num(p.pending_payout_value), 0) * 1e4) / 1e4;
    }
  } catch { /* face-pending stays unknown, never guessed */ }

  const steemUsd = obs?.steemUsd ?? null;
  const sbdUsd = obs?.sbdUsd ?? null;

  const income = incomeRollup({
    claims: { ...cl, windowDays: claimsWindowDays },
    trading: { realizedSbd: pnl?.realizedSbd ?? 0, proceedsSbd: pnl?.proceedsSbd ?? 0, windowDays: tradingWindowDays },
    pendingAuthorSbd,
    unclaimed: { vests: num(row.reward_vesting_balance), sbd: num(row.reward_sbd_balance), steem: num(row.reward_steem_balance) },
    steemUsd, sbdUsd, vestsPerSteem,
  });

  const out = {
    day, at: now, account: acc,
    verdict: income.usdPerDay7d != null ? "MEASURED" : "WINDOW-WAITING",
    income,
    publishTruth: { postsToday, postsByDay, accountCap: 4, source: `account_history ${posts.api ?? "unavailable"}` },
    laws: [
      "מחלקות-הכנסה לעולם לא מתמזגות: claims מדוד / trading realized / פנדינג-פאייאוט face / הערכה — כל כיתוב נושא את מחלקתו",
      "usdPerDay מחושב רק על יממה-מלאה של כל-המקורות — חלון-חלקי לא מחלקים (חוק-היום-המלא, T-25)",
      "ספירת-פוסטים = אמת-שרשרת ברמת-החשבון (כל-הפסים), לא ה-state",
    ],
  };
  writeJson(FILE, out);
  appendLine(EVENTS, { type: "income.done", at: now, usdPerDay7d: income.usdPerDay7d, claimsUsd: income.claims?.usd ?? null, postsToday });
  return out;
}
