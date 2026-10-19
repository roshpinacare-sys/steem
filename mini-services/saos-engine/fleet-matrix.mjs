/* ─────────────────────────────────────────────────────────────────────────
 * W12 · FLEET MATRIX — the activation board of the whole estate.
 *
 * The owner's W12 order (2026-10-19): "קודם וודא הפעלה מרבית של כל הצי" —
 * first ensure the MAXIMUM ACTIVATION of the whole fleet. The board below is
 * the measured answer: per account — custody (engine state, chain-judged),
 * balances, RC tank, 24h chain-truth activity (orders + votes), and the
 * activation class. NO claims: every number is a live chain read, every
 * custody verdict is the engine's own state (never invented).
 *
 * LAWS (all inherited, none new):
 *  - READ-ONLY: zero keys, zero broadcasts. The matrix MEASURES; the rails ACT.
 *  - chain-truth: activity counts come from get_account_history rows only
 *    (the R297 node-diversity + R298 freshness laws ride on rpcCall).
 *  - custody of record: signer.custodyOf() + state/army-custody.json — the
 *    same evidence the think-gate enforces. A keyless account is reported
 *    FROZEN-NO-CUSTODY, never "planned" or "coming soon" (T-80 honesty).
 *  - the R269 probe legacy: this is the CYCLE-INTEGRATED successor of
 *    probe-r269-fleet-matrix.mjs (same estate, added: 24h activity + class
 *    + gap list), written every cycle so the cockpit and the rebalance rail
 *    always read a fresh board.
 * ───────────────────────────────────────────────────────────────────────── */

import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall, accountState } from "./measure.mjs";
import { custodyOf } from "./signer.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
export const STATE_DIR = path.join(DIR, "state");
const MATRIX_FILE = path.join(STATE_DIR, "fleet-matrix.json");

/* the estate of record — exactly the 14 accounts the engine's custody and
 * doctrine files track (army-custody.json roster + the doctrine account). */
export const FLEET_ESTATE = [
  "headcorner",
  "cashmachine", "haran", "israelnews", "lsa", "macrame",
  "siq", "tov", "wic", "wog", "woq",
  "hcsoldier4", "hcsoldier5", "hcsoldier6",
];

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };

/* ── pure classifier (selftested) ──────────────────────────────────────── */
/* class law: custody first (T-80 — a keyless body is FROZEN whatever it
 * once did), then the 24h chain-truth activity. GRID-ACTIVE beats
 * CURATE-ONLY (market presence is the deeper activation). */
export function classifyAccount({ custody, orders24h, votes24h }) {
  const verified = custody === "verified" || custody === "master-verified"
    || custody === "era-verified" || custody === "master-era-verified";
  if (!verified) return "FROZEN-NO-CUSTODY";
  if (Number(orders24h) > 0) return "GRID-ACTIVE";
  if (Number(votes24h) > 0) return "CURATE-ONLY";
  return "DORMANT";
}

/* activation = any on-chain work in 24h (grid or curation). Frozen bodies
 * count as inactive — honest rate, never padded by wishful custody. */
export function activationRateOf(rows) {
  const total = rows.length;
  const active = rows.filter((r) => r.class === "GRID-ACTIVE" || r.class === "CURATE-ONLY").length;
  const grid = rows.filter((r) => r.class === "GRID-ACTIVE").length;
  return { rate: total ? Math.round((active / total) * 100) / 100 : 0, active, grid, total };
}

/* per-account 24h chain-truth counters over real history rows */
export function count24hActivity(historyRows, nowMs = Date.now()) {
  const dayAgo = nowMs - 24 * 3600_000;
  let orders = 0, votes = 0, fills = 0, lastAt = null;
  for (const row of historyRows) {
    const op = row?.op ?? null; // [opName, body]
    const ts = row?.timestamp ? Date.parse(row.timestamp + "Z") : NaN;
    if (!op || !Number.isFinite(ts) || ts < dayAgo) continue;
    const [name, body] = op;
    if (name === "limit_order_create") orders += 1;
    else if (name === "fill_order") fills += 1;
    else if (name === "vote") votes += 1;
    else continue;
    if (!lastAt || ts > Date.parse(lastAt + "Z")) lastAt = row.timestamp;
  }
  return { orders24h: orders, votes24h: votes, fills24h: fills, lastActivityAt: lastAt };
}

/* era-custody: the journaled, chain-judged adoption evidence. The LIVE
 * process memory dies with the process and a failed local revival would
 * clobber state/army-custody.json (measured live 2026-10-19T08:03) — but
 * state/exec-log.jsonl keeps every `army-custody-adopted` VERIFIED verdict
 * (the journal IS the custody history). Read the tail only; freshness
 * window 3 days; per account keep the newest VERIFIED verdict. */
export function journaledCustody({ logFile = path.join(STATE_DIR, "exec-log.jsonl"), windowMs = 3 * 24 * 3600_000, tailBytes = 2_000_000, nowMs = Date.now() } = {}) {
  const verdicts = {};
  let raw = "";
  try {
    const fd = fs.openSync(logFile, "r");
    const size = fs.fstatSync(fd).size;
    const buf = Buffer.alloc(Math.min(tailBytes, size));
    fs.readSync(fd, buf, 0, buf.length, size - buf.length);
    fs.closeSync(fd);
    raw = buf.toString("utf8");
  } catch { return verdicts; }
  for (const line of raw.split("\n")) {
    if (!line.includes("army-custody-adopted")) continue;
    let d = null;
    try { d = JSON.parse(line); } catch { continue; }
    if (d?.tag !== "army-custody-adopted") continue;
    const v = String(d?.verdict ?? "");
    if (!v.includes("VERIFIED") || v.includes("REFUSED")) continue;
    const ts = Date.parse(String(d?.at ?? "") + (String(d?.at ?? "").endsWith("Z") ? "" : "Z"));
    if (!Number.isFinite(ts) || nowMs - ts > windowMs) continue;
    const acct = d?.account;
    if (!acct) continue;
    const prev = verdicts[acct];
    if (!prev || ts > prev.ts) verdicts[acct] = { ts, verdict: v };
  }
  return verdicts;
}

/* ── the measured board ────────────────────────────────────────────────── */
export async function measureFleetMatrix({ now = new Date().toISOString(), persist = true } = {}) {
  const custodyState = readJson(path.join(STATE_DIR, "army-custody.json"), null);
  const custodyAt = custodyState?.at ?? null;
  const custodyVerified = custodyState?.after?.verified ?? null;
  const custodyTotal = custodyState?.after?.total ?? null;
  /* era-custody: journaled chain-judged adoptions (restart-proof) UNION the
   * state-file verdicts when the latest revival actually succeeded */
  const eraVerified = new Set(
    (custodyState?.adopted ?? [])
      .filter((a) => String(a?.verdict ?? "").includes("VERIFIED") && !String(a?.verdict).includes("REFUSED"))
      .map((a) => a.account),
  );
  const journal = journaledCustody();
  for (const acct of Object.keys(journal)) eraVerified.add(acct);

  /* one batched RC read for the whole estate (single RPC, node-diverse) */
  let rcByAccount = {};
  try {
    const rc = await rpcCall("rc_api.find_rc_accounts", { accounts: FLEET_ESTATE }, 12000);
    for (const a of rc?.result?.rc_accounts ?? []) {
      const cur = Number(a.rc_manabar?.current_mana ?? 0);
      const max = Number(a.max_rc ?? 0);
      rcByAccount[a.account] = {
        rcMax: max,
        rcPct: max > 0 ? Math.round((100 * cur / max) * 10) / 10 : null,
      };
    }
  } catch { /* honest absence below */ }

  /* headcorner's classic vesting delegations OUT (the mutual-support map) */
  let delegationsOut = [];
  try {
    const d = await rpcCall("condenser_api.get_vesting_delegations", ["headcorner", null, 100], 12000);
    delegationsOut = (d?.result ?? []).map((x) => ({
      to: x.delegatee, vests: x.vesting_shares, since: x.min_delegation_time,
    }));
  } catch { delegationsOut = null; }

  /* chain economics for the SP conversion (vests → SP) */
  let vestsPerSp = null;
  try {
    const gp = await rpcCall("condenser_api.get_dynamic_global_properties", [], 12000);
    const tvs = Number(String(gp?.result?.total_vesting_shares ?? "0").split(" ")[0]);
    const tvf = Number(String(gp?.result?.total_vesting_fund_steem ?? "0").split(" ")[0]);
    if (tvf > 0) vestsPerSp = Math.round((tvs / tvf) * 100) / 100;
  } catch { vestsPerSp = null; }

  const rows = [];
  for (const name of FLEET_ESTATE) {
    const isMaster = name === "headcorner";
    const live = custodyOf(name);
    const custody = isMaster
      ? (live === "master-verified" ? live : (eraVerified.has(name) ? "master-era-verified" : (live ?? "unverified")))
      : (live === "verified" ? "verified" : (eraVerified.has(name) ? "era-verified" : (live ?? "unverified")));

    let bal = { ok: false };
    try { bal = await accountState(name); } catch { bal = { ok: false }; }

    let hist = [];
    const h = await rpcCall("condenser_api.get_account_history", [name, -100, 100], 12000);
    hist = Array.isArray(h?.result) ? h.result : [];
    const histRows = hist.map(([, x]) => ({ op: x?.op ?? null, timestamp: x?.timestamp ?? null }));
    const activity = count24hActivity(histRows);

    rows.push({
      name,
      class: classifyAccount({ custody, orders24h: activity.orders24h, votes24h: activity.votes24h }),
      custody,
      steem: bal.ok ? Math.round((bal.steem ?? 0) * 1000) / 1000 : null,
      sbd: bal.ok ? Math.round((bal.sbd ?? 0) * 1000) / 1000 : null,
      sp: bal.ok ? Math.round(bal.spTotal ?? 0) : null,
      spOwn: bal.ok ? Math.round(bal.spOwn ?? 0) : null,
      spReceived: bal.ok ? Math.round((bal.spReceived ?? 0) * 10) / 10 : null,
      spEffective: bal.ok ? Math.round((bal.spEffective ?? 0) * 10) / 10 : null,
      rcMax: rcByAccount[name]?.rcMax ?? null,
      rcPct: rcByAccount[name]?.rcPct ?? null,
      ...activity,
    });
  }

  const rate = activationRateOf(rows);
  const gaps = rows
    .filter((r) => r.class !== "GRID-ACTIVE")
    .map((r) => ({
      name: r.name, class: r.class,
      gap:
        r.class === "FROZEN-NO-CUSTODY" ? "active-key custody missing — vault-era probe (Actions lane) or owner-side recovery; until then: frozen per T-80"
        : r.class === "CURATE-ONLY" ? "votes but zero 24h orders — grid lane idle (RC/liquidity or policy); rebalance ladder targets this"
        : "no 24h activity — check custody freshness + RC tank + liquidity",
    }));

  const board = {
    schema: "fleet-matrix-v1",
    at: now,
    estate: FLEET_ESTATE.length,
    activation: rate,
    custody: { at: custodyAt, verified: custodyVerified, total: custodyTotal },
    vestsPerSp,
    delegationsOutCount: Array.isArray(delegationsOut) ? delegationsOut.length : null,
    delegationsOutVests: Array.isArray(delegationsOut)
      ? delegationsOut.reduce((s, x) => s + Number(String(x.vests).split(" ")[0] || 0), 0)
      : null,
    delegationsOutRows: Array.isArray(delegationsOut) ? delegationsOut : null,
    totals: {
      orders24h: rows.reduce((s, r) => s + r.orders24h, 0),
      votes24h: rows.reduce((s, r) => s + r.votes24h, 0),
      fills24h: rows.reduce((s, r) => s + r.fills24h, 0),
      steem: Math.round(rows.reduce((s, r) => s + (r.steem ?? 0), 0) * 1000) / 1000,
      sbd: Math.round(rows.reduce((s, r) => s + (r.sbd ?? 0), 0) * 1000) / 1000,
    },
    rows, gaps,
  };
  if (persist) writeJson(MATRIX_FILE, board);
  return board;
}

export function readFleetMatrix() {
  return readJson(MATRIX_FILE, null);
}
