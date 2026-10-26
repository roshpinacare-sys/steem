// hive-posting-sign.mjs — HIVE POSTING RESUMED (Option B, T-518).
// Reads the engine-held WIF (vault slot HIVE_HEADCORNER_POSTING_WIF_C),
// verifies the LIVE chain actually grants it headcorner posting authority
// (fail-closed: refuses to sign otherwise), signs ONE posting-only
// saos.weave.v1 heartbeat, and pushes the signed tx through the public
// non-custodial relay (transport only, zero keys server-side).
// Output = public material only (verdict + txid). WIF never printed/written.
import * as fs from "node:fs";
import { buildTx, HIVE_CHAIN_ID, pubkeyFromSeed, wifDecode } from "./steemtx.mjs";

const log = (o) => console.log(JSON.stringify(o));

const HIVE_NODES = ["https://api.hive.blog", "https://api.hive.dev"];
async function rpc(method, params) {
  let last = "no-node";
  for (const host of HIVE_NODES) {
    try {
      const r = await fetch(host, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(12000) });
      const d = await r.json();
      if (d.error) { last = d.error.message; continue; }
      return d.result;
    } catch (e) { last = String(e); }
  }
  throw new Error("all hive nodes failed: " + last);
}

// ---- 1) load WIF from env or the vault-deployed files (fail-closed) --------
const CANDIDATE_FILES = ["./.env", "/tmp/.env.local", "../../.env.local", "./keys.env"];
let wif = process.env.HIVE_HEADCORNER_POSTING_WIF_C ?? "";
if (!wif) {
  for (const f of CANDIDATE_FILES) {
    try {
      const m = fs.readFileSync(f, "utf8").match(/^HIVE_HEADCORNER_POSTING_WIF_C=(.+)$/m);
      if (m?.[1]) { wif = m[1].trim(); break; }
    } catch { /* absent */ }
  }
}
if (!/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{50,52}$/.test(wif)) {
  log({ ok: false, error: "hive-wif-absent (vault slot HIVE_HEADCORNER_POSTING_WIF_C not deployed)" });
  process.exit(1);
}
let seed32;
try { seed32 = wifDecode(wif); } catch { log({ ok: false, error: "wif-format" }); process.exit(1); }
const pub = pubkeyFromSeed(seed32);

// ---- 2) live chain authority check (fail-closed) ----------------------------
const [acct] = await rpc("condenser_api.get_accounts", [["headcorner"]]);
const auths = acct.posting.key_auths.map((k) => k[0]);
log({ step: "live-authority-check", newPubFp: pub.slice(0, 12), authorityKeyCount: auths.length, newPubInAuthority: auths.includes(pub) });
if (!auths.includes(pub)) {
  log({ ok: false, error: "owner-has-not-installed-authority-yet", note: "engine holds the key; headcorner Hive posting authority does not include it — nothing signed (fail-closed)", awaiting: "owner account_update2 (revival pack)" });
  process.exit(1);
}

// ---- 3) sign ONE posting-only weave heartbeat --------------------------------
const payload = {
  protocol: "saos.weave.v1",
  kind: "hive-custody-resumed",
  note: "Hive posting sovereignty resumed via Option B: engine-generated keypair, owner-installed authority, public non-custodial relay transport",
  authorizedBy: "owner 2026-10-17",
  newPub,
  t: Math.floor(Date.now() / 1000),
};
const op = ["custom_json", { required_auths: [], required_posting_auths: ["headcorner"], id: "saos.weave.v1", json: JSON.stringify(payload) }];
const dgpo = await rpc("condenser_api.get_dynamic_global_properties", []);
const tx = buildTx({ ops: [op], dgpo, wifs: [wif], chainId: HIVE_CHAIN_ID });

// ---- 4) push through the public relay (transport only) -----------------------
const RELAY = process.env.SAOS_RELAY ?? "http://localhost:3030";
let verdict;
try {
  const r = await fetch(`${RELAY}/relay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chain: "hive", tx: tx.json }) });
  verdict = await r.json();
} catch (e) {
  verdict = { relayError: String(e), signedTxB64: Buffer.from(JSON.stringify(tx.json)).toString("base64") };
}
log({ ok: !!verdict?.ok, signed: true, role: "posting", sigs: tx.json.signatures.length, expiration: tx.json.expiration, verdict });
