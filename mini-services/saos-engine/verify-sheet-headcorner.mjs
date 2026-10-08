/**
 * verify-sheet-headcorner.mjs — R265 THE OPERATOR'S SHEET (memory-only).
 *
 * The operator uploaded the 2018 master sheet line for headcorner (steem+hive,
 * 4 roles each) with the order "שיהיה בכספת הכל". House law before anything
 * touches a vault or a chain: derive every pubkey, compare against the LIVE
 * authority on the LIVE chain, fail-closed. This script prints VERDICTS and
 * PUBLIC keys only — never a WIF, never a seed, never a pass.
 *
 * Outcomes land in state/r265-sheet-verify.json:
 *   hivePosting/hiveActive = VERIFIED-VS-HIVE-CHAIN | REFUSED:reason
 *   steemPosting/steemActive = LIVE-KEY (matches current authority) |
 *                              DEAD-KEY (rotated history, recorded as such)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pubkeyFromSeed, wifDecode } from "./steemtx.mjs";

const SHEET = "/home/z/my-project/upload/הדקור.txt";
const ACCOUNT = "headcorner";

async function rpc(node, method, params) {
  const r = await fetch(node, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    signal: AbortSignal.timeout(12000),
  });
  const j = await r.json();
  return j?.result;
}

async function liveAuthority(chain, role) {
  if (chain === "hive") {
    const g = await rpc("https://api.hive.blog", "condenser_api.get_accounts", [[ACCOUNT]]);
    return g?.[0]?.[role]?.key_auths?.[0]?.[0] ?? null;
  }
  const nodes = ["https://api.steemit.com", "https://api.stem.fans", "https://steemapi.boylikegirl.club"];
  for (const n of nodes) {
    try { const g = await rpc(n, "condenser_api.get_accounts", [[ACCOUNT]]); const k = g?.[0]?.[role]?.key_auths?.[0]?.[0]; if (k) return k; } catch { /* next node */ }
  }
  return null;
}

/* parse the sheet — 8 lines of ROLE = WIF under two sections */
const raw = readFileSync(SHEET, "utf8");
const section = (name) => {
  const idx = raw.toUpperCase().indexOf(name);
  if (idx < 0) return {};
  const slice = raw.slice(idx);
  const stop = slice.search(/\n\s*\n\s*\n|\n[A-Z]{4,}\s*$/m);
  const out = {};
  for (const m of slice.matchAll(/^\s*(OWNER|ACTIVE|POSTING|MEMO)\s*=\s*(\S+)\s*$/gim)) out[m[1].toLowerCase()] = m[2];
  return out;
};
const steemKeys = section("STEEMIT");
const hiveKeys = section(/^HIVE/m.test(raw.toUpperCase()) ? "HIVE" : "HIVE");
/* the sheet layout: steem block first, then a HIVE heading — split manually */
const hiveIdx = raw.search(/^\s*HIVE\s*$/m);
const steemBlock = hiveIdx > 0 ? raw.slice(0, hiveIdx) : raw;
const hiveBlock = hiveIdx > 0 ? raw.slice(hiveIdx) : "";
const parseKeys = (block) => {
  const out = {};
  for (const m of block.matchAll(/^\s*(OWNER|ACTIVE|POSTING|MEMO)\s*=\s*(\S+)\s*$/gim)) out[m[1].toLowerCase()] = m[2];
  return out;
};
const SK = parseKeys(steemBlock), HK = parseKeys(hiveBlock);

const verdict = { at: new Date().toISOString(), account: ACCOUNT, sheetFound: { steem: Object.keys(SK), hive: Object.keys(HK) } };
const check = async (chain, role, wif, mode) => {
  if (!wif) return `REFUSED:no-${role}-wif-in-sheet`;
  let pub = null;
  try { pub = pubkeyFromSeed(wifDecode(String(wif).trim())); } catch { return "REFUSED:wif-decode-fail"; }
  const live = await liveAuthority(chain, role);
  if (!live) return "REFUSED:no-live-authority";
  if (pub !== live) return mode === "strict" ? "REFUSED:authority-mismatch" : "DEAD-KEY";
  return mode === "strict" ? "VERIFIED-VS-LIVE-CHAIN" : "LIVE-KEY";
};
verdict.hivePosting = await check("hive", "posting", HK.posting, "strict");
verdict.hiveActive = await check("hive", "active", HK.active, "strict");
verdict.steemPosting = await check("steem", "posting", SK.posting, "lenient");
verdict.steemActive = await check("steem", "active", SK.active, "lenient");
verdict.steemOwner = await check("steem", "owner", SK.owner, "lenient");
verdict.hiveOwner = await check("hive", "owner", HK.owner, "strict");
verdict.whaleUnlocked = verdict.hivePosting === "VERIFIED-VS-LIVE-CHAIN" && verdict.hiveActive === "VERIFIED-VS-LIVE-CHAIN";
writeFileSync(new URL("./state/r265-sheet-verify.json", import.meta.url), JSON.stringify(verdict, null, 1));
console.log(JSON.stringify(verdict, null, 1));
