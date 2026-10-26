// authority-probe.mjs — read-only control-census (T-524/G13).
// Local derivation ONLY; compares against PUBLIC chain authorities;
// prints match verdicts only — zero key material, zero non-matching pubs.
import * as fs from "node:fs";
import { wifDecode, pubkeyFromSeed, derivePub, wifFor, SEED_ORDERS } from "../steemtx.mjs";

const ENGINE = new URL("../", import.meta.url).pathname;
const KEY_FILES = [ENGINE + ".env", "/tmp/.env.local", ENGINE + "keys.env", ENGINE + "../../.env.local"];
const ACCT = "headcorner";
const HIVE_NODES = ["https://api.hive.blog", "https://api.hive.dev"];
const STEEM_NODES = ["https://api.steemit.com", "https://steemapi.boylikegirl.club"];

const slots = {};
for (const f of KEY_FILES) {
  try {
    for (const m of fs.readFileSync(f, "utf8").matchAll(/^([A-Z0-9_]+)=(.+)$/gm)) {
      if (!slots[m[1]]) slots[m[1]] = m[2].trim().replace(/^"|"$/g, "");
    }
  } catch { /* absent */ }
}

async function rpc(nodes, method, params) {
  for (const host of nodes) {
    try {
      const r = await fetch(host, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(15000) });
      const d = await r.json();
      if (!d.error) return d.result;
    } catch { /* next */ }
  }
  return null;
}

const [hive] = await rpc(HIVE_NODES, "condenser_api.get_accounts", [[ACCT]]) ?? [];
const [steem] = await rpc(STEEM_NODES, "condenser_api.get_accounts", [[ACCT]]) ?? [];

const targets = [];
for (const [chain, a] of [["hive", hive], ["steem", steem]]) {
  if (!a) continue;
  for (const role of ["owner", "active", "posting"]) {
    for (const [pub] of (a[role]?.key_auths ?? [])) targets.push({ chain, role, pub });
  }
  if (a.memo_key) targets.push({ chain, role: "memo", pub: a.memo_key });
}

const candidates = [];
const WIF_SLOTS = ["HIVE_HEADCORNER_POSTING_WIF_C", "STEEM_POSTING_WIF_A", "STEEM_POSTING_WIF_B", "STEEM_ACTIVE_WIF_A", "STEEM_ACTIVE_WIF_B", "STEEM_OWNER_WIF_A", "STEEM_OWNER_WIF_B", "STEEM_MEMO_WIF_A", "STEEM_MEMO_WIF_B"];
for (const s of WIF_SLOTS) {
  if (!slots[s]) continue;
  try { candidates.push({ slot: s, pub: pubkeyFromSeed(wifDecode(slots[s])) }); } catch { candidates.push({ slot: s, pub: null, bad: true }); }
}
const MASTER = slots["HEAD_CORNER_MASTER"];
if (MASTER) {
  for (const role of ["owner", "active", "posting", "memo"]) {
    for (const [name, fn] of Object.entries(SEED_ORDERS)) {
      candidates.push({ slot: `MASTER:${role}:${name}`, pub: derivePub(fn(ACCT, role, MASTER)) });
    }
  }
}

const out = { t: new Date().toISOString(), account: ACCT, hiveLive: !!hive, steemLive: !!steem, targets: targets.length, candidates: candidates.length, matches: [], unmatchedSlots: [] };
const matchedSlots = new Set();
for (const c of candidates) {
  if (!c.pub) { out.unmatchedSlots.push({ slot: c.slot, note: "bad-wif" }); continue; }
  const hit = targets.find((t) => t.pub === c.pub);
  if (hit) { out.matches.push({ slot: c.slot, chain: hit.chain, role: hit.role }); matchedSlots.add(c.slot); }
}
for (const c of candidates) if (!matchedSlots.has(c.slot) && !c.bad) out.unmatchedSlots.push({ slot: c.slot });

// verdict: highest control proven
const rank = { "hive:owner": 5, "hive:active": 4, "steem:owner": 3, "steem:active": 2, "hive:posting": 1, "steem:posting": 1, "hive:memo": 0, "steem:memo": 0 };
out.best = out.matches.reduce((b, m) => (rank[`${m.chain}:${m.role}`] ?? 0) > (rank[`${b?.chain}:${b?.role}`] ?? -1) ? m : b, null);
console.log(JSON.stringify(out, null, 1));
