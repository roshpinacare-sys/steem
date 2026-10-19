/**
 * exchange-import.mjs — W17 · THE EXCHANGE IMPORT RAIL (HTX→headcorner).
 *
 * Operator order 2026-10-19 (IM trace 1a1556c780544431, verbatim core):
 * "תעשה פעילות דרך steem sbd עמלות משיכה די נמוכות שם אפשר להשתמש בזה חשוב
 * להעביר רק מטבעות אלו בנתיים" — the withdrawal-cheap coins (STEEM/SBD) are
 * THE lawful channel for exchange liquidity to enter our network. The rail
 * ends at MY flows gate (G27/G28): every confirmed withdrawal is posted to
 * POST /api/sovereign/flows (venue HTX · kind transfer) so the sovereign
 * ledger materializes it as an ext-deposit with the G28 routing (25% pool ·
 * 75% vault) — "שהכסף יעבור טוב יותר".
 *
 * MEASURED TRUTH (W17 census, state/exchange-custody.json w17Recheck):
 *  - the NEW (rotated) pair is LIVE — SIGNED-PROOF-OK, spot 73986225
 *  - withdraw permission PRESENT for steem+sbd (quota endpoint, huge headroom)
 *  - the ACCOUNT tier gates execution until the operator completes L3
 *    Advanced Verification (measured: v2 withdraw 404-not-found, legacy
 *    endpoint api-base-operation-forbidden) — every attempt records the
 *    honest refusal class; nothing is guessed, nothing is stranded
 *  - trade leg REGION-BLOCKED for our network class (order-trade-forbidden,
 *    re-measured with the NEW pair) — the venue's own wall, nothing to arm
 *  - deposit-address endpoint unusable (500) — no headcorner→HTX leg until
 *    measured; NO-STRANDING law: never park fleet money we cannot return
 *  - the currencies endpoint leaves withdrawFee null — the REAL fee is
 *    measured from the first executed withdrawal (htxWithdrawHistory)
 *
 * TWO-KEY DOCTRINE (both must agree or the tick is PLAN-ONLY):
 *   1. state/operator-orders.json → orders["W17-STEEM-SBD-IMPORT"].armed
 *      (the LAWFUL ORDER — the owner's verbatim words + trace)
 *   2. .secrets/exec-armed.json → policy.exchangeImport.enabled (the LIVE ARM)
 *
 * Coin whitelist: STEEM/SBD ONLY (the operator's explicit scope — "חשוב
 * להעביר רק מטבעות אלו בנתיים"). Destination allowlist: measured headcorner
 * (our own network account) only. Caps: maxWithdrawsPerDay per coin,
 * minNetUsdt dust floor, 0.1% fee buffer until the real fee is measured.
 * Zero secret material in state/stdout — amounts, verdicts, fingerprints.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  htxAccounts, htxBalance, htxWithdraw, htxWithdrawHistory, htxLastPrice, nonzeroBalances,
} from "./htx.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(DIR, "..", "..");
const STATE = path.join(DIR, "state");
const ORDERS = path.join(STATE, "operator-orders.json");
const FLAG = path.join(REPO, ".secrets", "exec-armed.json");
const EXEC_LOG = path.join(STATE, "exec-log.jsonl");
const IMPORT_STATE = path.join(STATE, "exchange-import.json");
/* my flows gate (G27/G28, console repo) — the key lives in the fleet vault */
const FLOWS_KEY = "/home/z/audit/fleet-economy/.secrets/ext-flow.key";
const FLOWS_GATE = "http://127.0.0.1:3000/api/sovereign/flows";

const COINS = [
  { currency: "sbd", chain: "sbd1", minWithdraw: 0.001, priceSymbol: "sbdusdt" }, /* deep book, dust-min — first */
  { currency: "steem", chain: "steem1", minWithdraw: 4, priceSymbol: "steemusdt" },
];

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };
const journal = (v) => { try { fs.appendFileSync(EXEC_LOG, JSON.stringify(v) + "\n"); } catch {} };
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const dayKey = () => new Date().toISOString().slice(0, 10);
const floor3 = (x) => Math.floor(x * 1000) / 1000;

let booted = false;
let st = readJson(IMPORT_STATE, null) ?? {
  schema: "exchange-import-v1",
  bootedAt: null, lastTickAt: null, lastVerdict: "never-ticked",
  counters: { ticks: 0, withdrawAttempts: 0, withdrawOk: 0, gatePosted: 0, refusals: {} },
  day: { key: dayKey(), perCoin: {} },
  lastCensus: null, pending: [], executed: [],
};

function persist() { writeJson(IMPORT_STATE, st); }
function refusalClass(why, errMsg) {
  const e = String(errMsg ?? "") + " " + String(why ?? "");
  if (/L3|Advanced Verification|base-operation-forbidden/i.test(e)) return "L3-VERIFICATION-GATE";
  if (/country or region|trade-forbidden/i.test(e)) return "REGION-GATE";
  if (/not-found|404/i.test(e)) return "L3-GATED-V2-ENDPOINT";
  if (/no-credentials/i.test(e)) return "NO-CREDENTIALS";
  return `OTHER:${String(why ?? "unknown").slice(0, 32)}`;
}
function dayCount(coin, delta = 0) {
  if (st.day.key !== dayKey()) st.day = { key: dayKey(), perCoin: {} };
  st.day.perCoin[coin] = (st.day.perCoin[coin] ?? 0) + delta;
  return st.day.perCoin[coin];
}

/** TWO-KEY: the lawful order AND the live arm must agree. */
export function twoKeyArmed() {
  const order = readJson(ORDERS, {})?.orders?.["W17-STEEM-SBD-IMPORT"];
  const flag = readJson(FLAG, {})?.policy?.exchangeImport;
  if (!order || order.armed !== true) return { ok: false, why: "order-not-recorded-or-disarmed" };
  if (!flag || flag.enabled !== true) return { ok: false, why: "live-flag-disarmed (PLAN-ONLY)" };
  return { ok: true, orderRef: order.orderRef?.slice(0, 80) ?? "W17-STEEM-SBD-IMPORT", flag };
}

/** Post a CONFIRMED withdrawal into the sovereign flows gate (G27/G28).
 * Gate sealed (key absent) → honest skip, the rail continues. */
async function postToFlowsGate(row) {
  let key;
  try { key = fs.readFileSync(FLOWS_KEY, "utf8").trim(); } catch { return { posted: false, why: "gate-sealed-no-key" }; }
  try {
    const res = await fetch(FLOWS_GATE, {
      method: "POST",
      headers: { "content-type": "application/json", "x-flow-key": key },
      body: JSON.stringify({
        venue: "HTX", kind: "transfer",
        ref: row.ref, amountUsd: row.amountUsd,
        txid: row.txid ?? "", agent: "agent-2-exchange-import",
        note: `W17 import ${row.currency} ${row.amount} → headcorner (fee ${row.feeMeasured ?? "measured-at-exec"})`,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const j = await res.json().catch(() => ({}));
    return { posted: res.status === 202, status: res.status, why: j?.why ?? null };
  } catch (e) {
    return { posted: false, why: String(e?.message ?? e).slice(0, 60) };
  }
}

async function tick() {
  st.counters.ticks++;
  st.lastTickAt = now();
  const arm = twoKeyArmed();
  if (!arm.ok) {
    st.lastVerdict = `PLAN-ONLY (${arm.why}) — two-key doctrine holds`;
    persist();
    return;
  }
  const cap = arm.flag;
  const coins = Array.isArray(cap.coins) && cap.coins.length ? cap.coins : COINS.map((c) => c.currency);

  /* census: spot balances */
  const acc = await htxAccounts({});
  const spot = acc.ok ? (acc.data ?? []).find((a) => a.type === "spot") : null;
  if (!spot) {
    st.lastVerdict = `census-failed ${acc.why ?? "no-spot"}`;
    persist();
    return;
  }
  const bal = await htxBalance(spot.id, {});
  const rows = bal.ok ? nonzeroBalances(bal.data) : [];
  const avail = new Map(rows.filter((r) => r.currency && r.available != null).map((r) => [r.currency, r.available]));
  st.lastCensus = { at: now(), nonZero: rows.map((r) => ({ currency: r.currency, available: r.available })) };

  /* confirm pending withdrawals (balance drop ≈ amount next tick; the venue's
   * history endpoint is L3-gated — the balance delta is the honest witness) */
  for (const p of st.pending) {
    const before = p.availableBefore ?? null;
    const after = avail.get(p.currency) ?? 0;
    if (before != null && before - after >= p.amount * 0.9) {
      p.confirmedAt = now();
      p.amountUsd = Number((p.amount * (p.priceAtExec ?? 0)).toFixed(4));
      const g = await postToFlowsGate(p);
      if (g.posted) st.counters.gatePosted++;
      journal({ at: now(), op: "exchange-import-confirmed", currency: p.currency, amount: p.amount, ref: p.ref, gate: g });
      st.executed.push({ at: p.confirmedAt, currency: p.currency, amount: p.amount, ref: p.ref, gatePosted: !!g.posted });
      p.done = true;
    }
  }
  st.pending = st.pending.filter((p) => !p.done).slice(-24);
  st.executed = st.executed.slice(-48);

  /* execute withdrawals for whitelisted coins above the dust floor */
  const verdicts = [];
  for (const c of COINS) {
    if (!coins.includes(c.currency)) { verdicts.push(`${c.currency}:not-whitelisted`); continue; }
    if (dayCount(c.currency) >= (cap.maxWithdrawsPerDay ?? 12)) { verdicts.push(`${c.currency}:day-cap`); continue; }
    const a = avail.get(c.currency) ?? 0;
    if (a < c.minWithdraw) { verdicts.push(`${c.currency}:below-min (${a} < ${c.minWithdraw})`); continue; }
    const px = await htxLastPrice(c.priceSymbol);
    const price = px.ok ? px.close : null;
    const usdVal = price ? a * price : null;
    if (usdVal != null && usdVal < (cap.minNetUsdt ?? 0.02)) { verdicts.push(`${c.currency}:dust ($${usdVal.toFixed(4)})`); continue; }
    /* 0.1% fee buffer until the REAL fee is measured from the first execution */
    const amount = floor3(a * 0.999);
    if (amount < c.minWithdraw) { verdicts.push(`${c.currency}:buffer-below-min`); continue; }
    st.counters.withdrawAttempts++;
    const w = await htxWithdraw({ currency: c.currency, address: cap.destination ?? "headcorner", amount: amount.toFixed(3), chain: c.chain }, {});
    if (w.ok) {
      dayCount(c.currency, 1);
      st.counters.withdrawOk++;
      const row = {
        ref: `w17imp-${Date.now().toString(36)}`, currency: c.currency, amount,
        chain: c.chain, priceAtExec: price, availableBefore: a, withdrawId: w.data ?? null,
        requestedAt: now(),
      };
      st.pending.push(row);
      journal({ at: now(), op: "exchange-withdraw-requested", currency: c.currency, amount, chain: c.chain, dest: cap.destination ?? "headcorner", withdrawId: w.data ?? null });
      verdicts.push(`${c.currency}:WITHDRAW-REQUESTED ${amount}`);
    } else {
      const cls = refusalClass(w.why, w.errMsg);
      st.counters.refusals[cls] = (st.counters.refusals[cls] ?? 0) + 1;
      journal({ at: now(), op: "exchange-withdraw-refused", currency: c.currency, class: cls, why: w.why ?? null });
      verdicts.push(`${c.currency}:REFUSED ${cls}`);
      /* the measured fee may live in the history once L3 opens — try cheaply */
      if (cls === "L3-VERIFICATION-GATE" || cls === "L3-GATED-V2-ENDPOINT") {
        const h = await htxWithdrawHistory(c.currency, {});
        if (h.ok && Array.isArray(h.data) && h.data[0]?.fee != null) st.lastFeeMeasured = { currency: c.currency, fee: h.data[0].fee, at: now() };
      }
    }
  }
  st.lastVerdict = `tick-ok [${verdicts.join(" · ")}]`;
  persist();
}

/** Boot the importer organ (single instance; 5min cadence, fail-soft). */
export function startExchangeImporter({ tickMs = 300000 } = {}) {
  if (booted) return exchangeImportState();
  booted = true;
  st.bootedAt = now();
  persist();
  Promise.resolve().then(tick).catch((e) => { st.lastVerdict = `tick-error ${String(e?.message ?? e).slice(0, 80)}`; persist(); });
  setInterval(() => { Promise.resolve().then(tick).catch(() => {}); }, tickMs).unref?.();
  return exchangeImportState();
}

/** Public state (zero secrets — amounts, verdicts, counters). */
export function exchangeImportState() {
  return {
    ok: true, organ: "exchange-import", rail: "HTX→headcorner (STEEM/SBD only)",
    armed: twoKeyArmed().ok,
    lastTickAt: st.lastTickAt, lastVerdict: st.lastVerdict,
    counters: st.counters, day: st.day,
    lastCensus: st.lastCensus, lastFeeMeasured: st.lastFeeMeasured ?? null,
    pending: st.pending?.length ?? 0, executed: st.executed ?? [],
    gates: { flowsGate: "G27/G28 (POST /api/sovereign/flows · routing 25/75)", key: "fleet .secrets/ext-flow.key (fingerprint-only usage)" },
  };
}
