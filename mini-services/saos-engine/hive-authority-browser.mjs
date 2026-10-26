// hive-authority-browser.mjs — BROWSER-VAULT SELF-INSTALL BRIDGE (T-524).
// Doctrine completion: engine prepares (serialize only, zero secrets) → the
// OWNER's browser signs the digest locally (WIF never leaves the browser) →
// this script verifies BY THE CHAIN that the signature comes from a key in
// the LIVE active/owner authority before broadcasting. Fail-closed at every
// step; the node's accept/reject is the only byte oracle (R255 doctrine).
//
//   prepare   → prints public JSON: chainId, serialized unsigned tx, header
//   complete  ← stdin JSON {refBlockNum, refBlockPrefix, expiration, signatureHex}
//               → recovers signer → chain-judges authority → broadcasts →
//               verifies on-chain posting authority → public verdict
import * as fs from "node:fs";
import { sha256 } from "@noble/hashes/sha256";
import { ripemd160 } from "@noble/hashes/ripemd160";
import * as secp from "@noble/secp256k1";
import { serializeTx, HIVE_CHAIN_ID, b58encode, wifDecode, pubkeyFromSeed, pubkeyBytes } from "./steemtx.mjs";

const HIVE_NODES = ["https://api.hive.blog", "https://api.hive.dev"];
const RELAY = process.env.SAOS_RELAY ?? "http://localhost:3030";
const ACCT = "headcorner";
const ENGINE_SLOT = "HIVE_HEADCORNER_POSTING_WIF_C";
const KEY_FILES = ["./.env", "/tmp/.env.local", "./keys.env", "../../.env.local"];

const log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));
const slot = (name) => {
  if (process.env[name]) return process.env[name].trim();
  for (const f of KEY_FILES) {
    try {
      const m = fs.readFileSync(f, "utf8").match(new RegExp(`^${name}=(.+)$`, "m"));
      if (m?.[1]) return m[1].trim();
    } catch { /* absent */ }
  }
  return "";
};
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
const stmEncode = (key33) => {
  const chk = Buffer.from(ripemd160(Buffer.from(key33))).slice(0, 4);
  return "STM" + b58encode(Buffer.concat([Buffer.from(key33), chk]));
};

function buildHeaderOps({ refBlockNum, refBlockPrefix, expiration, livePostingPub, enginePub }) {
  const op = ["account_update2", {
    account: ACCT,
    owner: null, active: null, memo_key: null,
    posting: { weight_threshold: 1, account_auths: [], key_auths: [[livePostingPub, 1], [enginePub, 1]] },
    json_metadata: "", posting_json_metadata: "",
  }];
  return { ref_block_num: refBlockNum, ref_block_prefix: refBlockPrefix, expiration, operations: [op], extensions: [] };
}

const mode = process.argv[2];

if (mode === "prepare") {
  const engineWif = slot(ENGINE_SLOT);
  if (!engineWif) { log({ ok: false, failClosed: true, error: "engine-slot-absent" }); process.exit(0); }
  const enginePub = pubkeyFromSeed(wifDecode(engineWif));
  const [acct] = await rpc("condenser_api.get_accounts", [[ACCT]]);
  const livePosting = (acct.posting.key_auths ?? []).map((k) => k[0]);
  if (livePosting.includes(enginePub)) { log({ ok: true, already: true, liveKeys: livePosting.length }); process.exit(0); }
  const dgpo = await rpc("condenser_api.get_dynamic_global_properties", []);
  const headNum = dgpo.head_block_number;
  const idBytes = Buffer.from(String(dgpo.head_block_id), "hex");
  const refBlockNum = headNum & 0xffff;
  const refBlockPrefix = idBytes.length >= 8 ? idBytes.readUInt32LE(4) : 0;
  const expiration = Math.floor(Date.now() / 1000) + 120;
  const body = buildHeaderOps({ refBlockNum, refBlockPrefix, expiration, livePostingPub: livePosting[0], enginePub });
  const serializedHex = serializeTx(body).toString("hex");
  log({
    ok: true, mode: "prepare",
    chainIdHex: HIVE_CHAIN_ID.toString("hex"),
    serializedHex, refBlockNum, refBlockPrefix, expiration,
    account: ACCT,
    livePostingPub: livePosting[0], enginePub, threshold: acct.posting.weight_threshold,
    note: "public material only — browser signs sha256(chainId||tx) locally",
  });
} else if (mode === "complete") {
  const stdin = await new Promise((res) => { let b = ""; process.stdin.on("data", (d) => (b += d)); process.stdin.on("end", () => res(b)); });
  let input; try { input = JSON.parse(stdin); } catch { log({ ok: false, error: "bad-json" }); process.exit(0); }
  const { refBlockNum, refBlockPrefix, expiration, signatureHex } = input ?? {};
  if (!Number.isInteger(refBlockNum) || !Number.isInteger(refBlockPrefix) || !Number.isInteger(expiration) || typeof signatureHex !== "string" || !/^[0-9a-fA-F]{130}$/.test(signatureHex)) {
    log({ ok: false, failClosed: true, error: "malformed-complete-input" }); process.exit(0);
  }
  const engineWif = slot(ENGINE_SLOT);
  if (!engineWif) { log({ ok: false, failClosed: true, error: "engine-slot-absent" }); process.exit(0); }
  const enginePub = pubkeyFromSeed(wifDecode(engineWif));
  const [acct] = await rpc("condenser_api.get_accounts", [[ACCT]]);
  const livePosting = (acct.posting.key_auths ?? []).map((k) => k[0]);
  if (livePosting.includes(enginePub)) { log({ ok: true, already: true }); process.exit(0); }

  // rebuild ops from CURRENT chain truth (browser never dictates op content)
  const body = buildHeaderOps({ refBlockNum, refBlockPrefix, expiration, livePostingPub: livePosting[0], enginePub });
  const bin = serializeTx(body);
  const digest = Buffer.from(sha256(Buffer.concat([Buffer.from(HIVE_CHAIN_ID), bin])));

  // chain-judge the signer: recover pub from sig, require it in live active/owner
  const sig65 = Buffer.from(signatureHex, "hex");
  const rec = sig65[0] - 31;
  if (rec < 0 || rec > 3) { log({ ok: false, failClosed: true, error: "bad-recovery-id" }); process.exit(0); }
  let signerStm = null;
  try {
    /* גל-100 · מדוד מול @noble/secp256k1@1.7.2 (אותו-שורש-מהתיקון-ב-steemtx):
     * Signature.addRecoveryBit אינו-קיים-ב-1.7.2 (1.6.x-API) · recoverPublicKey
     * עליון: recoverPublicKey(hash, compact64, rec) · מחזיר 0x04-לא-דחוס →
     * דחיסה-חובה לפני ה-STM-קידוד. נמדד round-trip: match:true. */
    const raw65 = secp.recoverPublicKey(digest, sig65.slice(1, 65), rec);
    if (!raw65) throw new Error("no-recovery");
    const comp33 = secp.Point.fromHex(Buffer.from(raw65).toString("hex")).toRawBytes(true); // 1.7.2: fromHex (fromBytes אינו-קיים — נמדד)
    signerStm = stmEncode(Buffer.from(comp33));
  } catch (e) { log({ ok: false, failClosed: true, error: "signature-unrecoverable", why: String(e).slice(0, 80) }); process.exit(0); }
  const liveActive = (acct.active.key_auths ?? []).map((k) => k[0]);
  const liveOwner = (acct.owner.key_auths ?? []).map((k) => k[0]);
  const role = liveActive.includes(signerStm) ? "active" : liveOwner.includes(signerStm) ? "owner" : null;
  if (!role) {
    log({ ok: false, failClosed: true, error: "signer-not-in-live-active-or-owner-authority", signerFp: signerStm.slice(0, 12) + "…", note: "chain is the judge — nothing broadcast, nothing changed" });
    process.exit(0);
  }
  log({ step: "signer-verified-by-chain", role, signerFp: signerStm.slice(0, 12) + "…" });

  const txJson = { ...body, expiration: new Date(expiration * 1000).toISOString().slice(0, 19), signatures: [signatureHex.toLowerCase()] };
  let via = "node", txid = null;
  try {
    const r = await fetch(`${RELAY}/relay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chain: "hive", tx: txJson }), signal: AbortSignal.timeout(20000) });
    const v = await r.json();
    if (v?.ok) { via = "relay"; txid = v.txid ?? null; }
  } catch { /* relay down */ }
  if (!txid) {
    try { await rpc("condenser_api.broadcast_transaction", [txJson]); } catch (e) {
      log({ ok: false, error: "broadcast-rejected: " + String(e).slice(0, 200) }); process.exit(0);
    }
  }
  const [after] = await rpc("condenser_api.get_accounts", [[ACCT]]);
  const afterKeys = (after.posting.key_auths ?? []).map((k) => k[0]);
  const installed = afterKeys.includes(enginePub);
  log({ ok: installed, via, txid, signerRole: role, liveKeys: afterKeys.length, enginePubFp: enginePub.slice(0, 12) + "…", note: installed ? "engine posting key LIVE — reversible by owner account_update2 anytime" : "broadcast accepted; authority visibility pending next check" });
} else {
  log({ ok: false, error: "mode required: prepare | complete" });
}
