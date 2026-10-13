#!/usr/bin/env bun
/**
 * probe-r269-fleet-matrix.mjs — R269, READ-ONLY, ZERO KEYS.
 *
 * The operator's order: "I don't SEE the connection... there are delegations...
 * everyone can publish... verify EVERYTHING about the users — engineering,
 * not claims." This probe measures the whole estate on BOTH chains in one
 * pass and writes the file the cockpit renders (so the operator sees truth,
 * not prose):
 *   1. Per body (Steem 14, Hive 9+headcorner+tov): existence, authority
 *      fingerprints (public data only), RC tank (max/available/delegated),
 *      classic vesting delegations IN+OUT, Hive rc-direct delegations,
 *      last post age.
 *   2. Custody verdicts come from the ENGINE's own live cycle state
 *      (army-custody.json / hive-custody.json — re-measured every cycle,
 *      never claimed).
 *   3. Publish verdict per body is honest: LIVE-PROVEN beats RC math
 *      (a body that posted on-chain within 48h needs no estimate).
 * Verdict: state/fleet-matrix-r269.json. Zero keys, zero broadcasts,
 * fingerprints-only per doctrine.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { rpcHive, HIVE_ROSTER } from "./hive.mjs";

const STEEM_NODES = ["https://api.steemit.com", "https://api.stem.fans", "https://steemapi.boylikegirl.club"];
const STEEM_FLEET = ["headcorner", "cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq", "hcsoldier4", "hcsoldier5", "hcsoldier6"];
const HIVE_ACCOUNTS = [...HIVE_ROSTER, "headcorner", "tov"];
const POST_RC_COST = 2_300_000_000; // measured on Hive R254 (node-judged)
const FULL_REGEN_SEC = 432_000; // 5 days, both chains
const fp = (k) => (typeof k === "string" && k.length > 12 ? k.slice(0, 12) : null);

async function rpcSteem(method, params) {
  let lastErr = null;
  for (const node of STEEM_NODES) {
    try {
      const r = await fetch(node, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(12000),
      });
      const j = await r.json();
      if (j?.result !== undefined) return j.result;
      lastErr = new Error(JSON.stringify(j?.error ?? "no result").slice(0, 120));
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error("all steem nodes failed");
}

/* soft variant: returns { ok, result | error } instead of throwing — used for
 * APIs that some nodes simply do not enable (measured: Steem public nodes
 * refuse rc_api.list_rc_direct_delegations with method-not-found). */
async function rpcSteemSoft(method, params) {
  let lastErr = null;
  for (const node of STEEM_NODES) {
    try {
      const r = await fetch(node, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(12000),
      });
      const j = await r.json();
      if (j?.result !== undefined) return { ok: true, result: j.result };
      lastErr = new Error(JSON.stringify(j?.error?.message ?? j?.error ?? "no result").slice(0, 140));
    } catch (e) { lastErr = e; }
  }
  return { ok: false, error: String(lastErr?.message ?? lastErr).slice(0, 140) };
}

/* rpcSteem returns the unwrapped result; rpcHive returns the full envelope
 * { ok, result, error? } — unwrap() makes both the same shape (R265 law). */
const unwrap = (r) => (Array.isArray(r) ? r : (r?.result ?? []));

const vestsNum = (s) => Number(String(s ?? "0").split(" ")[0]) || 0;

/* MEASURED (R269, node-judged): condenser_api.get_vesting_delegations on the
 * live nodes takes 2-3 args ONLY (the legacy 4th "type" arg is dead) — the
 * 3-arg form returns the account's OUTGOING delegations. Incoming rows are
 * derived from our own delegator's out-list (estate-internal view); external
 * incoming has no by_delegatee index on the public nodes — recorded honestly. */
async function vestingDelegationsOut(rpc, account) {
  let lastErr = null;
  for (let i = 0; i < 2; i++) {
    try {
      const rows = unwrap(await rpc("condenser_api.get_vesting_delegations", [account, "", 1000]));
      return (Array.isArray(rows) ? rows : []).map((d) => ({
        to: d.delegatee,
        from: d.delegator,
        vests: vestsNum(d.vesting_shares),
      }));
    } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 400)); }
  }
  throw lastErr ?? new Error("delegations failed");
}

/* MEASURED (R269, node-judged): rc_api.find_rc_accounts returns { rc_accounts:
 * [...] } on Steem (rpcSteem already unwrapped) and the same body inside the
 * envelope on Hive — the R265 unwrap law needs this third shape. */
async function findRcAccounts(rpc, accounts) {
  const env = await rpc("rc_api.find_rc_accounts", { accounts });
  const body = env?.rc_accounts !== undefined ? env : (env?.result ?? {});
  return Array.isArray(body?.rc_accounts) ? body.rc_accounts : [];
}

/* MEASURED (R269, node-judged): rc_api.list_rc_direct_delegations start is a
 * PAIR [from, to] ("by_from start requires 2 value") on Hive. */
async function rcDirectFor(rpc, account) {
  const r = await rpc("rc_api.list_rc_direct_delegations", { start: [account, ""], limit: 100 });
  const body = r?.rc_direct_delegations !== undefined ? r : (r?.result ?? {});
  const rows = Array.isArray(body?.rc_direct_delegations) ? body.rc_direct_delegations : [];
  return rows
    .map((d) => ({ from: d.from, to: d.to, delegated_rc: Number(d.delegated_rc) || 0 }))
    .filter((d) => d.from === account);
}

function rcAvailable(max, cur, lastUpdateSec) {
  const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - (Number.isFinite(lastUpdateSec) ? lastUpdateSec : 0));
  return max > 0 ? Math.min(max, cur + (max * Math.min(elapsed, FULL_REGEN_SEC)) / FULL_REGEN_SEC) : cur;
}

function readJsonSafe(p) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

function custodySteem() {
  const c = readJsonSafe("./state/army-custody.json");
  const verified = new Set();
  for (const a of c?.adopted ?? []) if (String(a?.verdict ?? "").includes("VERIFIED")) verified.add(a.account);
  /* headcorner = the engine's own signing body: custody is proven by continuous
   * on-chain broadcasting (LIVE-PROVEN below) and R267 measured the FULL CROWN
   * (posting+active+owner+memo) — it never appears in the army adoption list
   * because it is the signer OF that list. */
  verified.add("headcorner");
  return { at: c?.at ?? null, verified, total: (c?.after?.total ?? 13) + 1, verdict: c?.verdict ?? null, signerOfRecord: "headcorner" };
}

function custodyHive() {
  const c = readJsonSafe("./state/hive-custody.json");
  return { at: c?.at ?? null, results: c?.results ?? {}, verified: c?.verified ?? 0, total: c?.total ?? 0, verdict: c?.verdict ?? null };
}



function verdictFor({ exists, custody, lastPost, rcAvail }) {
  if (!exists) return { verdict: "NOT-EXISTS", reason: "no-body-on-this-chain" };
  if (!custody) return { verdict: "NO-CUSTODY", reason: "key-not-ours-or-rotated (operator-domain)" };
  if (lastPost !== null && lastPost <= 48) return { verdict: "LIVE-PROVEN", reason: `posted ${lastPost.toFixed(1)}h ago on-chain` };
  if (rcAvail >= POST_RC_COST) return { verdict: "READY", reason: "custody verified + RC above the measured post line" };
  return { verdict: "RC-LOW", reason: "custody verified, RC under the post line — regen or lift needed (est)" };
}

async function measureChain(chain, rpc, accounts, custody, vestsToHp) {
  const out = { accounts: {}, summary: {} };

  const acc = unwrap(await rpc("condenser_api.get_accounts", [accounts]));
  for (const a of acc) {
    out.accounts[a.name] = {
      exists: true,
      created: a.created,
      last_post: a.last_post && a.last_post !== "1970-01-01T00:00:00" ? a.last_post : null,
      posting_fp: fp(a.posting?.key_auths?.[0]?.[0]),
      active_fp: fp(a.active?.key_auths?.[0]?.[0]),
      owner_fp: fp(a.owner?.key_auths?.[0]?.[0]),
      vesting_shares: vestsNum(a.vesting_shares),
    };
  }

  let rcByAccount = {};
  try {
    const rcRows = await findRcAccounts(rpc, accounts);
    for (const r of rcRows) {
      const max = Number(r.max_rc) || 0;
      const cur = Number(r.rc_manabar?.current_mana ?? 0);
      const upd = Number(r.rc_manabar?.last_update_time ?? 0);
      rcByAccount[r.account] = { max, available: rcAvailable(max, cur, upd), delegated_rc: Number(r.delegated_rc) || 0 };
    }
  } catch (e) { out.rc_error = String(e?.message ?? e).slice(0, 120); }

  for (const name of accounts) {
    const rec = out.accounts[name] ?? { exists: false };
    if (!rec.exists) { out.accounts[name] = rec; continue; }
    rec.last_post_age_h = rec.last_post ? Math.round((Date.now() - new Date(rec.last_post + "Z").getTime()) / 360000) / 10 : null;
    let delegatedOut = [];
    try { delegatedOut = await vestingDelegationsOut(rpc, name); } catch (e) { rec.deleg_err = String(e?.message ?? e).slice(0, 80); }
    const rc = rcByAccount[name] ?? null;
    const custodyOk = custody.verified.has(name);
    rec.custody = custodyOk ? "VERIFIED" : "UNKNOWN";
    rec.rc = rc ? { max_g: +(rc.max / 1e9).toFixed(2), available_g: +(rc.available / 1e9).toFixed(2), pct: rc.max ? Math.round((rc.available / rc.max) * 100) : null, delegated_rc_g: +(rc.delegated_rc / 1e9).toFixed(2) } : null;
    rec.delegations_out = delegatedOut.map((d) => ({ to: d.to, vests: d.vests, hp: +(d.vests * vestsToHp).toFixed(1) }));
    rec.delegations_out_vests = delegatedOut.reduce((s, d) => s + d.vests, 0);
    rec.publish = verdictFor({ exists: true, custody: custodyOk, lastPost: rec.last_post_age_h, rcAvail: rc?.available ?? 0 });
  }

  /* incoming delegations: estate-internal view — every OUT row from ANY of our
   * bodies becomes an IN row for its beneficiary (headcorner is the only
   * delegator in the estate today; external incoming has no by_delegatee
   * index on the public nodes — honest limitation, recorded). */
  const allOut = [];
  for (const name of accounts) {
    const a = out.accounts[name];
    for (const d of a?.delegations_out ?? []) allOut.push({ from: name, to: d.to, vests: d.vests });
  }
  for (const name of accounts) {
    const a = out.accounts[name];
    if (!a?.exists) continue;
    a.delegations_in = allOut.filter((d) => d.to === name).map((d) => ({ from: d.from, vests: d.vests, hp: +(d.vests * vestsToHp).toFixed(1) }));
    a.delegations_in_vests = a.delegations_in.reduce((s, d) => s + d.vests, 0);
  }

  const all = accounts.map((n) => out.accounts[n]);
  out.summary = {
    bodies: accounts.length,
    exists: all.filter((a) => a.exists).length,
    custodyVerified: all.filter((a) => a.custody === "VERIFIED").length,
    liveProven: all.filter((a) => a.publish?.verdict === "LIVE-PROVEN").length,
    ready: all.filter((a) => a.publish?.verdict === "READY").length,
    rcLow: all.filter((a) => a.publish?.verdict === "RC-LOW").length,
    noCustody: all.filter((a) => a.publish?.verdict === "NO-CUSTODY").length,
    delegations_out_vests: all.reduce((s, a) => s + (a.delegations_out_vests ?? 0), 0),
    delegations_in_vests: all.reduce((s, a) => s + (a.delegations_in_vests ?? 0), 0),
  };
  return out;
}

async function collectRcDirectAll(rpc, accounts) {
  const rows = [];
  for (const a of accounts) {
    try { rows.push(...(await rcDirectFor(rpc, a))); }
    catch (e) { rows.push({ from: a, error: String(e?.message ?? e).slice(0, 80) }); }
  }
  return rows;
}

const out = {
  at: new Date().toISOString(),
  probe: "r269-fleet-matrix",
  law: "read-only condenser+rc apis · zero keys · fingerprints-only · custody from live engine cycle state",
  custodySources: { steem: null, hive: null },
  chains: {},
};

/* --- global props for VESTS→HP conversion, both chains --- */
async function vestsToHp(rpc, chain) {
  try {
    /* MEASURED (R269): object-shaped results must unwrap via `?.result ?? raw`
     * — unwrap() (the array law) strips an already-unwrapped Steem object to
     * an empty array and silently measured 0. */
    const raw = await rpc("condenser_api.get_dynamic_global_properties", []);
    const g = raw?.result ?? raw;
    /* MEASURED (R269, node-judged): the fund field is renamed per chain —
     * Steem: total_vesting_fund_steem, Hive: total_vesting_fund_hive. */
    const fund = vestsNum(g.total_vesting_fund_shares ?? g.total_vesting_fund_steem ?? g.total_vesting_fund_hive);
    const shares = vestsNum(g.total_vesting_shares);
    return shares > 0 ? fund / shares : 0;
  } catch { return 0; }
}

const custSteem = custodySteem();
const custHive = custodyHive();
out.custodySources.steem = { at: custSteem.at, verified: custSteem.verified.size, total: custSteem.total, verdict: custSteem.verdict };
out.custodySources.hive = { at: custHive.at, verified: custHive.verified, total: custHive.total, verdict: custHive.verdict };

const steemCustodySet = custSteem.verified;
const hiveCustodyVerified = new Set(Object.entries(custHive.results).filter(([, v]) => String(v).includes("VERIFIED")).map(([k]) => k));

const hpRateSteem = await vestsToHp(rpcSteem, "steem");
out.chains.steem = await measureChain("steem", rpcSteem, STEEM_FLEET, { verified: steemCustodySet }, hpRateSteem);
const steemRcd = await rpcSteemSoft("rc_api.list_rc_direct_delegations", { start: ["headcorner", ""], limit: 100 });
out.chains.steem.rcDirect = steemRcd.ok ? (steemRcd.result?.rc_direct_delegations ?? []) : [];
out.chains.steem.rcDirectNote = steemRcd.ok ? "measured via public node" : `api-not-enabled-on-public-steem-nodes (${steemRcd.error})`;
out.chains.steem.vestsToHp = +hpRateSteem.toFixed(6);

const hpRateHive = await vestsToHp(rpcHive, "hive");
out.chains.hive = await measureChain("hive", rpcHive, HIVE_ACCOUNTS, { verified: hiveCustodyVerified }, hpRateHive);
out.chains.hive.rcDirect = await collectRcDirectAll(rpcHive, HIVE_ACCOUNTS);
out.chains.hive.vestsToHp = +hpRateHive.toFixed(6);

out.custodySources.steem.verified = steemCustodySet.size;
out.custodySources.hive.verified = hiveCustodyVerified.size;

writeFileSync("./state/fleet-matrix-r269.json", JSON.stringify(out, null, 2));

/* console digest — verdict table only, no secrets (fingerprints are public data) */
for (const chain of ["steem", "hive"]) {
  console.log(`=== ${chain.toUpperCase()} ===`);
  for (const [name, a] of Object.entries(out.chains[chain].accounts)) {
    console.log(
      `${name}: ${a.publish?.verdict ?? "NOT-EXISTS"} · custody=${a.custody ?? "-"}` +
      ` · rc=${a.rc ? `${a.rc.available_g}G/${a.rc.max_g}G (${a.rc.pct}%)` : "-"}` +
      ` · del_out=${(a.delegations_out_vests ?? 0).toFixed(0)}V del_in=${(a.delegations_in_vests ?? 0).toFixed(0)}V` +
      ` · last_post=${a.last_post ?? "-"}`
    );
  }
  console.log(`summary: ${JSON.stringify(out.chains[chain].summary)}`);
  if (out.chains[chain].rcDirect?.length) console.log(`rcDirect: ${JSON.stringify(out.chains[chain].rcDirect)}`);
  if (chain === "steem") {
    const hc = out.chains.steem.accounts.headcorner;
    console.log(`headcorner-delegations-out: ${JSON.stringify(hc?.delegations_out ?? [])}`);
  }
}
console.log("WROTE state/fleet-matrix-r269.json");
