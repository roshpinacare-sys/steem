/* W17 KEY-TRUTH PROBE · verdict-only (never prints secret material).
 * Decisive test: do the WIFs inside .secrets/wallets.json derive to the LIVE
 * on-chain authorities of headcorner + hcsoldier1..6?
 * - master:headcorner match → SIGNING-REVIVAL possible (engine revival lane)
 * - soldier WIF match       → soldier NOT dead (owner's "dead" claim needs the
 *   chain-truth nuance: TRON-side wallet wif vs STEEM authority wif)
 */
import fs from "node:fs";
import { wifDecode, pubkeyFromSeed } from "./steemtx.mjs";

const RPC = "https://api.steemit.com";
const ACCOUNTS = ["headcorner", "hcsoldier1", "hcsoldier2", "hcsoldier3", "hcsoldier4", "hcsoldier5", "hcsoldier6"];

const auths = {};
for (const acct of ACCOUNTS) {
  const j = await fetch(RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [[acct]], id: 1 }),
  }).then((r) => r.json());
  const a = j.result?.[0];
  if (!a) { console.log(`${acct}: NOT-ON-CHAIN`); continue; }
  auths[acct] = {
    owner: new Set(a.owner.key_auths.map((k) => k[0])),
    active: new Set(a.active.key_auths.map((k) => k[0])),
    posting: new Set(a.posting.key_auths.map((k) => k[0])),
    memo: a.memo_key,
  };
}

const wal = JSON.parse(fs.readFileSync(new URL("../../.secrets/wallets.json", import.meta.url), "utf8"));
let revival = null;
for (const it of wal.items || []) {
  const wif = it.wif;
  if (!wif) { console.log(`${it.id}: no wif`); continue; }
  let stm = null;
  try { stm = pubkeyFromSeed(wifDecode(wif)); } catch { console.log(`${it.id}: WIF-INVALID`); continue; }
  const acctName = it.id.includes(":") ? it.id.split(":")[1] : it.id;
  const A = auths[acctName];
  if (!A) { console.log(`${it.id}: account missing on chain`); continue; }
  const roles = [];
  for (const r of ["owner", "active", "posting"]) if (A[r].has(stm)) roles.push(r);
  const memoHit = A.memo === stm ? "memo" : null;
  if (memoHit) roles.push("memo");
  console.log(`${it.id}: derived ${stm.slice(0, 12)}… → ${roles.length ? "MATCH roles=" + roles.join(",") : "no-match (TRON-side sibling?)"}`);
  if (acctName === "headcorner" && roles.length) revival = { roles };
}
console.log(revival ? `VERDICT: MASTER-REVIVABLE via ${revival.roles.join(",")}` : "VERDICT: master wif does NOT match chain authorities");
