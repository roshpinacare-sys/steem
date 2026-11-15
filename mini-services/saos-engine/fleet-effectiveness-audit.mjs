#!/usr/bin/env node
// fleet-effectiveness-audit.mjs — operator order 2026-11-02 (recurring, never one-shot).
// Rebuilt 2026-11-02 after the previous copy was lost to a wipe without ever being
// committed anywhere durable (durable-loss lesson). Measures per-account:
//   net SP vs delegation floors · RC manabar · key custody (fp only) ·
//   treasury power-down trajectory · overdue revisit items.
// Verdict line: EFFECTIVENESS-AUDIT <FLAGS-PRESENT|CLEAN> accounts=N flags=[..] treasuryDaysToFloor=N revisitOpen=N revisitOverdue=N
// If ZERO-SP or BELOW-FLOOR appears, the patrol runs: node treasury-replan.mjs delegate
// (R314e: op SETS totals, treasury keep 1000 SP). Never prints key material — fingerprints only.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "fs";
import { createRequire } from "module";
import { execSync } from "child_process";
const require2 = createRequire(import.meta.url);
const steem = require2("/home/z/my-project/fleet/steem/mini-services/saos-engine/node_modules/steem");
const SECRETS = "/home/z/my-project/fleet/steem/.secrets";
const RECEIPTS = "/home/z/my-project/fleet/steem/receipts";
const STATE = "/home/z/my-project/fleet/steem/state";
const API = "https://api.steemit.com";
const TREASURY_KEEP_SP = 1000;
const DEFAULT_FLOOR_SP = 30; // documented default; override via state/floors.json

const rpc = async (method, params) => {
  const res = await fetch("https://api.steemit.com", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`rpc ${method}: ${String(j.error.message || "").slice(0, 120)}`);
  return j.result;
};

const vestToSp = (vests, g) => parseFloat(vests) * (parseFloat(g.total_vesting_fund_steem) / parseFloat(g.total_vesting_shares)); // condenser asset strings are direct VESTS/STEEM units — no ×1e6 (calibrated live 2026-11-02: headcorner ≈ 4189.5 SP)

// accounts under custody: crown-map/1 nests accounts under `accounts` (R365 fix: the old
// top-level scan treated metadata keys format/at/source/chainJudgedAtMaterialize as accounts,
// which manufactured fake ZERO-SP flags). census-verified roster is unioned in.
const crownMap = JSON.parse(readFileSync(`${SECRETS}/custody-vault/crown-map.json`, "utf8"));
const MAP_META = new Set(["format", "at", "source", "chainJudgedAtMaterialize", "_master"]);
const acctRoot = crownMap && crownMap.accounts && typeof crownMap.accounts === "object" ? crownMap.accounts : crownMap;
const names = new Set(Object.keys(acctRoot).filter(k => !MAP_META.has(k)));
try {
  const census = JSON.parse(readFileSync(`${SECRETS}/census-verified.json`, "utf8"));
  if (typeof census === "object" && !Array.isArray(census)) for (const k of Object.keys(census)) if (k !== "_master") names.add(k);
  else for (const a of census) names.add(typeof a === "string" ? a : a.name);
} catch {}
const ACCOUNTS = [...names].filter(Boolean).sort();
if (!ACCOUNTS.length) { console.log("EFFECTIVENESS-AUDIT ERROR accounts=0 no-census"); process.exit(1); }

const g = await rpc("condenser_api.get_dynamic_global_properties", []);
const chain = await rpc("condenser_api.get_accounts", [ACCOUNTS]);
const rcByAcct = {};
// R365 fix (2026-11-15): condenser_api.find_rc_accounts is dead on every probed node
// (10 nodes probed 2026-11-15: -32002 assert / 5xx). rc_api.find_rc_accounts still serves
// on api.steemit.com et al. — params as {accounts:[...]} and result.rc_accounts.
const RC_NODES = ["https://api.steemit.com", "https://api.justyy.com", "https://steemapi.boylikegirl.club", "https://api.steem.fans"];
for (const node of RC_NODES) {
  try {
    const res = await fetch(node, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "rc_api.find_rc_accounts", params: { accounts: ACCOUNTS }, id: 1 }) });
    const j = await res.json();
    if (j.error) throw new Error(String(j.error.message || "").slice(0, 80));
    // rc_api puts max_rc as a SIBLING of rc_manabar (measured) — merge it or the ratio is null
    for (const r of ((j.result && j.result.rc_accounts) || [])) rcByAcct[r.account] = { ...r.rc_manabar, max_rc: r.max_rc };
    console.log(`rc_api via ${node}: ${Object.keys(rcByAcct).length} accounts`);
    break;
  } catch (e) { console.log(`rc_api ${node} unavailable (${String(e.message || e).slice(0, 60)})`); }
}
if (!Object.keys(rcByAcct).length) console.log("GAP rc_api unavailable on all known nodes — RC column marked unknown");

// key custody: harvest WIFs from unsealed vault material → derived pubkeys (fp only)
// R365 fix (2026-11-15): steem-js wifToPublic fails on compressed WIFs ("Expecting 32 bytes,
// instead got 33") → soldier keys were falsely reported none-matched. Same noble derivation
// as master-judge.mjs — single source of truth for WIF→pub.
const crypto = await import("crypto");
const secp = await import("@noble/secp256k1");
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58d(s) { let n = 0n; for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error("b58char"); n = n * 58n + BigInt(i); } let h = n.toString(16); if (h.length % 2) h = "0" + h; return Buffer.from(h, "hex"); }
function b58e(buf) { let n = BigInt("0x" + buf.toString("hex") || "0"), out = ""; while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; } for (const b of buf) { if (b === 0) out = "1" + out; else break; } return out; }
function wifSeed(wif) {
  const d = b58d(wif);
  let body, chk;
  if (d.length === 38) { body = d.subarray(0, 34); chk = d.subarray(34); if (body[0] !== 0x80 || body[33] !== 0x01) throw new Error("wif-format"); }
  else if (d.length === 37) { body = d.subarray(0, 33); chk = d.subarray(33); if (body[0] !== 0x80) throw new Error("wif-format"); }
  else throw new Error("wif-length");
  const c = crypto.createHash("sha256").update(crypto.createHash("sha256").update(body).digest()).digest().subarray(0, 4);
  if (!c.equals(chk)) throw new Error("wif-checksum");
  return Buffer.from(body.subarray(1, 33));
}
function steemPub(wif) {
  const pub = Buffer.from(secp.getPublicKey(wifSeed(wif), true));
  const chk = crypto.createHash("ripemd160").update(pub).digest().subarray(0, 4);
  return "STM" + b58e(Buffer.concat([pub, chk]));
}
const WIF_RE = new RegExp("^[5LK][1-9A-HJ-NP-Za-km-z]{50,51}$");
const held = [];
function harvest(node, path) {
  if (node === null || node === undefined) return;
  if (typeof node === "string") {
    if (WIF_RE.test(node.trim())) { try { const w = node.trim(); const pub = steemPub(w); held.push({ path, pub, fp: crypto.createHash("sha256").update(pub).digest("hex").slice(0, 8) }); } catch {} }
    return;
  }
  if (typeof node === "object") for (const [k, v] of Object.entries(node)) { if (path === "" && k === "_master") continue; harvest(v, path ? `${path}.${k}` : k); }
}
try { harvest(crownMap, "crown-map"); } catch (e) { console.log("GAP crown-map harvest partial:", String(e.message || e).slice(0, 120)); }

// floors + revisit registry (tolerant: both are runtime state that wipes may remove)
let floors = {};
try { floors = JSON.parse(readFileSync(`${STATE}/floors.json`, "utf8")); } catch {}
let revisitOpen = 0, revisitOverdue = 0;
const revisitPath = `${STATE}/revisit-registry.jsonl`;
if (existsSync(revisitPath)) {
  const now = Date.now();
  for (const line of readFileSync(revisitPath, "utf8").split("\n").filter(Boolean)) {
    try { const r = JSON.parse(line); if ((r.status || "open") !== "done") { revisitOpen++; if (r.due && Date.parse(r.due) < now) revisitOverdue++; } } catch {}
  }
}

const flags = [];
const rows = [];
let treasuryDaysToFloor = null;
for (const a of chain) {
  const vest = parseFloat(a.vesting_shares);
  const del = parseFloat(a.delegated_vesting_shares);
  const recv = parseFloat(a.received_vesting_shares);
  const toW = Number(a.to_withdraw) / 1e6;   // raw µVESTS → VESTS
  const withdrawn = Number(a.withdrawn) / 1e6;
  const netSp = vestToSp(vest - del + recv, g);
  const ownSp = vestToSp(vest - del, g);
  const floor = Number(floors[a.name] ?? DEFAULT_FLOOR_SP);
  const rc = rcByAcct[a.name];
  const rcRatio = rc && rc.max_rc > 0 ? rc.current_mana / rc.max_rc : null;
  // key custody fp: which roles does our unsealed material control?
  const roles = [];
  for (const role of ["owner", "active", "posting"]) {
    const ks = (a[role] && a[role].key_auths) || [];
    if (ks.some(([k]) => held.some(h => h.pub === k))) roles.push(role);
  }
  // treasury trajectory (headcorner): remaining withdrawable VESTS / weekly slice (1/13 per week)
  // R365 fix (2026-11-15): the note used to be pushed as a SECOND same-name row without netSp,
  // which made treasury-replan's rows.find() pick it and fail with "no treasury measurement".
  // The note now rides on the one real row.
  let note = null;
  if (a.name === "headcorner" && toW > withdrawn) {
    const weeklyVests = Math.min(vest, toW - withdrawn) / 13;
    const remainingSp = vestToSp(toW - withdrawn, g);
    treasuryDaysToFloor = Math.max(0, (ownSp - TREASURY_KEEP_SP) / (vestToSp(weeklyVests, g) / 7));
    note = `powerdown remaining=${remainingSp.toFixed(1)} SP`;
  }
  let flag = null;
  if (netSp < 0.001) flag = "ZERO-SP";
  else if (netSp < floor) flag = "BELOW-FLOOR";
  if (flag) flags.push(`${a.name}:${flag}`);
  else if (a.name === "headcorner" && toW > withdrawn) flags.push(`${a.name}:POWERDOWN-ACTIVE`);
  if (roles.length === 0 && a.name !== "headcorner") flags.push(`${a.name}:NO-KEYS-IN-CENSUS`);
  rows.push({ name: a.name, netSp: Number(netSp.toFixed(3)), floor, rc: rcRatio === null ? "unknown" : Number(rcRatio.toFixed(3)), keys: roles.join("+") || "none-matched", flag: flag || "-", note });
}
const rcDead = rows.filter(r => typeof r.rc === "number" && r.rc < 0.01).length;
console.log("== PER-ACCOUNT (net SP vs floor | RC ratio | key custody fp-matched roles) ==");
for (const r of rows) if (r.netSp !== undefined) console.log(`${r.name.padEnd(12)} net_sp=${String(r.netSp).padStart(8)} floor=${String(r.floor).padStart(4)} rc=${String(r.rc).padStart(8)} keys=${r.keys} ${r.flag !== "-" ? "FLAG:" + r.flag : ""}${r.note ? " · " + r.note : ""}`);
const tdt = treasuryDaysToFloor === null ? "n/a" : treasuryDaysToFloor.toFixed(1);
const verdict = `EFFECTIVENESS-AUDIT ${flags.length ? "FLAGS-PRESENT" : "CLEAN"} accounts=${chain.length} flags=[${flags.join(",")}] treasuryDaysToFloor=${tdt} revisitOpen=${revisitOpen} revisitOverdue=${revisitOverdue} rcDeadAccounts=${rcDead}`;
console.log(verdict);
try {
  mkdirSync(RECEIPTS, { recursive: true });
  appendFileSync(`${RECEIPTS}/effectiveness-audit.jsonl`, JSON.stringify({ ts: new Date().toISOString(), verdict, rows, treasuryDaysToFloor: tdt, revisitOpen, revisitOverdue }) + "\n");
  writeFileSync(`${RECEIPTS}/effectiveness-audit-last.json`, JSON.stringify({ ts: new Date().toISOString(), verdict, rows }, null, 1) + "\n");
} catch (e) { console.log("receipt-write error:", String(e.message || e).slice(0, 160)); }
