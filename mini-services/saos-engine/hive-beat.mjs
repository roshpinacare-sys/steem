// hive-beat.mjs — SOVEREIGN HIVE BEAT (Option B completion, T-519).
// A machine-resident loop that keeps Hive custody alive autonomously:
//   every BEAT_MIN minutes → check the LIVE headcorner Hive posting authority
//   → if the engine-held key (vault slot HIVE_HEADCORNER_POSTING_WIF_C) is
//   installed by the owner → sign ONE posting-only saos.weave.v1 heartbeat
//   → push via the public non-custodial relay → log verdict (public material
//   only, WIF never printed/persisted by this process).
// Fail-closed at every step: absent key, absent authority, relay down —
// honest log, no crash, next beat retries. The chain is the judge.
import * as fs from "node:fs";
import { buildTx, HIVE_CHAIN_ID, pubkeyFromSeed, wifDecode } from "./steemtx.mjs";
import { dbCustodySnapshot } from "./db-custody.mjs";

const HIVE_NODES = ["https://api.hive.blog", "https://api.hive.dev"];
const RELAY = process.env.SAOS_RELAY ?? "http://localhost:3030";
const SLOT = "HIVE_HEADCORNER_POSTING_WIF_C";
const BEAT_MIN = Number(process.env.BEAT_MIN ?? 30);
const KEY_FILES = ["./.env", "/tmp/.env.local", "./keys.env", "../../.env.local"];

const log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));

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

function loadWif() {
  if (process.env[SLOT]) return process.env[SLOT];
  for (const f of KEY_FILES) {
    try {
      const m = fs.readFileSync(f, "utf8").match(new RegExp(`^${SLOT}=(.+)$`, "m"));
      if (m?.[1]) return m[1].trim();
    } catch { /* absent */ }
  }
  return "";
}

let beat = 0;
async function runBeat() {
  beat++;
  try {
    const wif = loadWif();
    // Bytebase-pattern schema custody: every beat fingerprints live DB DDL;
    // when authority is live the fingerprint rides the signed payload →
    // chain-anchored tamper evidence (unannounced schema change between
    // beats becomes provable). Local log carries it even without authority.
    const dbSnap = await dbCustodySnapshot();
    const dbLog = { dbVerdict: dbSnap.verdict, dbFp: dbSnap.liveDdlFp ? dbSnap.liveDdlFp.slice(0, 16) : null };
    if (!wif) return log({ beat, ok: false, error: "wif-absent", note: "vault slot not deployed — run vault auto-unseal first (boot-services)", ...dbLog });
    const pub = pubkeyFromSeed(wifDecode(wif));

    const [acct] = await rpc("condenser_api.get_accounts", [["headcorner"]]);
    const auths = acct.posting.key_auths.map((k) => k[0]);
    if (!auths.includes(pub)) return log({ beat, ok: false, error: "authority-not-installed-yet", liveKeys: auths.length, awaiting: "owner account_update2", ...dbLog });

    const payload = {
      protocol: "saos.weave.v1",
      kind: "hive-custody-beat",
      note: "autonomous sovereign beat — engine-held posting key, owner-installed authority, public relay transport",
      beat, newPub: pub, t: Math.floor(Date.now() / 1000),
      ...(dbSnap.liveDdlFp ? { dbFp: dbSnap.liveDdlFp, dbDrift: dbSnap.drift } : {}),
    };
    const op = ["custom_json", { required_auths: [], required_posting_auths: ["headcorner"], id: "saos.weave.v1", json: JSON.stringify(payload) }];
    const dgpo = await rpc("condenser_api.get_dynamic_global_properties", []);
    const tx = buildTx({ ops: [op], dgpo, wifs: [wif], chainId: HIVE_CHAIN_ID });
    const r = await fetch(`${RELAY}/relay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chain: "hive", tx: tx.json }) });
    const verdict = await r.json();
    log({ beat, ok: !!verdict?.ok, authority: "live", sigs: tx.json.signatures.length, txid: verdict?.txid ?? null, verdictError: verdict?.error ?? null, ...dbLog });
  } catch (e) {
    log({ beat, ok: false, error: String(e).slice(0, 200) });
  }
}

await runBeat();
setInterval(runBeat, BEAT_MIN * 60 * 1000);
log({ started: true, beatMin: BEAT_MIN, relay: RELAY });
