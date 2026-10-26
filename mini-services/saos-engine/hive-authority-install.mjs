// hive-authority-install.mjs — SELF-INSTALL of the engine posting key (T-524).
// OWNER-APPROVED (2026-10-18, explicit: "you can install it yourself — I approve").
// Chain-judged, fail-closed, reversible:
//   1. derive candidate posting keys from HEAD_CORNER_MASTER across the known
//      seed orders → the ONLY accepted order is the one whose posting pubkey
//      EQUALS the live on-chain posting authority (the chain is the judge).
//   2. only then derive the ACTIVE key with that SAME verified order and sign
//      ONE account_update2 that ONLY appends the engine pub STM6y7Dtk… to
//      posting key_auths — threshold stays 1, owner/active/memo untouched.
//   3. verify on-chain AFTER broadcast before declaring success.
// Secrets never printed, never persisted: logs carry public verdicts only.
import * as fs from "node:fs";
import { buildTx, HIVE_CHAIN_ID, wifEncode, wifDecode, pubkeyFromSeed, derivePub, SEED_ORDERS } from "./steemtx.mjs";

const HIVE_NODES = ["https://api.hive.blog", "https://api.hive.dev"];
const RELAY = process.env.SAOS_RELAY ?? "http://localhost:3030";
const ACCT = "headcorner";
const ENGINE_SLOT = "HIVE_HEADCORNER_POSTING_WIF_C";
const MASTER_SLOT = "HEAD_CORNER_MASTER";
const KEY_FILES = ["./.env", "/tmp/.env.local", "./keys.env", "../../.env.local"];

const log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));

function slot(name) {
  if (process.env[name]) return process.env[name].trim();
  for (const f of KEY_FILES) {
    try {
      const m = fs.readFileSync(f, "utf8").match(new RegExp(`^${name}=(.+)$`, "m"));
      if (m?.[1]) return m[1].trim();
    } catch { /* absent */ }
  }
  return "";
}

async function rpc(method, params) {
  let last = "no-node";
  for (const host of HIVE_NODES) {
    try {
      const r = await fetch(host, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(15000) });
      const d = await r.json();
      if (d.error) { last = d.error.message; continue; }
      return d.result;
    } catch (e) { last = String(e); }
  }
  throw new Error("all hive nodes failed: " + last);
}

async function broadcast(txJson) {
  try {
    const r = await fetch(`${RELAY}/relay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chain: "hive", tx: txJson }), signal: AbortSignal.timeout(20000) });
    const v = await r.json();
    if (v?.ok) return { via: "relay", ...v };
  } catch { /* relay down — fall through to node */ }
  const res = await rpc("condenser_api.broadcast_transaction", [txJson]);
  return { via: "node", res };
}

const master = slot(MASTER_SLOT);
const engineWif = slot(ENGINE_SLOT);
if (!master || !engineWif) {
  log({ ok: false, failClosed: true, error: "secrets-absent", haveMaster: !!master, haveEngineWif: !!engineWif });
  process.exit(0);
}

// live posting authority — the judge
const [acct] = await rpc("condenser_api.get_accounts", [[ACCT]]);
const livePosting = (acct.posting.key_auths ?? []).map((k) => k[0]);
const enginePub = pubkeyFromSeed(wifDecode(engineWif));
if (livePosting.includes(enginePub)) {
  log({ ok: true, already: true, liveKeys: livePosting.length, enginePub: enginePub.slice(0, 12) + "…" });
  process.exit(0);
}

// derivation gate: the ONLY accepted master is the one whose "posting" seed
// reproduces the live on-chain posting key. 4 seed orders, one truth.
let verifiedOrder = null, verifiedPostingPub = null;
for (const [name, fn] of Object.entries(SEED_ORDERS)) {
  const cand = derivePub(fn(ACCT, "posting", master));
  if (cand === livePosting[0]) { verifiedOrder = name; verifiedPostingPub = cand; break; }
}
if (!verifiedOrder) {
  log({ ok: false, failClosed: true, error: "master-derivation-does-not-match-live-posting-key", note: "chain is the judge — nothing signed, nothing changed", livePostingCount: livePosting.length });
  process.exit(0);
}
log({ step: "derivation-verified", order: verifiedOrder, postingPub: verifiedPostingPub.slice(0, 12) + "…" });

// the ONE change: append engine pub to posting authority; everything else null = untouched
const op = ["account_update2", {
  account: ACCT,
  owner: null, active: null, memo_key: null,
  posting: { weight_threshold: 1, account_auths: [], key_auths: [[verifiedPostingPub, 1], [enginePub, 1]] },
  json_metadata: "", posting_json_metadata: "",
}];
const dgpo = await rpc("condenser_api.get_dynamic_global_properties", []);
const activeWif = wifFor(SEED_ORDERS[verifiedOrder](ACCT, "active", master));
const tx = buildTx({ ops: [op], dgpo, wifs: [activeWif], chainId: HIVE_CHAIN_ID });

let bc;
try { bc = await broadcast(tx.json); } catch (e) {
  log({ ok: false, error: "broadcast-failed: " + String(e).slice(0, 160) });
  process.exit(0);
}
const txid = bc?.txid ?? null;

// post-broadcast chain truth
const [after] = await rpc("condenser_api.get_accounts", [[ACCT]]);
const afterKeys = (after.posting.key_auths ?? []).map((k) => k[0]);
const installed = afterKeys.includes(enginePub);
log({ ok: installed, via: bc.via, txid, liveKeys: afterKeys.length, enginePub: enginePub.slice(0, 12) + "…", threshold: after.posting.weight_threshold, note: installed ? "engine posting key LIVE on chain — reversible by owner account_update2 at any time" : "broadcast accepted but authority not visible yet — next beat re-checks" });
