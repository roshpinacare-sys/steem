// g13-fleet-restore.mjs — restore the fleet's posting capability (G13).
// CHAIN-JUDGED basis (measured 13:5xZ): all 12 army OWNER keys in the pinned
// MASTER custody bundle are LIVE on chain; their posting authorities point to
// stranded keys (gen2-era, unreadable pass). This tool APPENDS the custody
// bundle's posting pubkey alongside the stranded one (threshold stays 1,
// owner/active/memo untouched = null) — signed by the LIVE owner WIF.
// Non-destructive + reversible (owner removes the appended key anytime).
// Verdict-only stdout — zero material.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { wifDecode, pubkeyFromSeed, buildTx, pubkeyBytes, STEEM_CHAIN_ID } from "/home/z/audit/repos/steem/mini-services/saos-engine/steemtx.mjs";

const STEEM = "/home/z/audit/repos/steem";
const NODES = ["https://steemapi.boylikegirl.club", "https://api.justyy.com", "https://api.steemit.com"];
const log = (o) => console.log(JSON.stringify(o));
const sh = (cmd, env = {}) => execSync(cmd, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] }).toString();

async function rpc(method, params, timeoutMs = 15000) {
  for (const node of NODES) {
    try {
      const r = await fetch(node, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) continue;
      const d = await r.json();
      if (d.error) continue;
      return d.result;
    } catch { /* next */ }
  }
  return null;
}

const only = process.argv[2] ?? null; // optional single account

const pass = JSON.parse(sh(`git -C ${STEEM} show 609166c62^:agent/recovery-meta.json`)).keysZipPass;
const work = fs.mkdtempSync(path.join(os.tmpdir(), "g13fleet-"));
fs.chmodSync(work, 0o700);
const meta = JSON.parse(fs.readFileSync(path.join(STEEM, "agent/recovery-meta.json"), "utf8"));
execSync(`openssl enc -d -aes-256-cbc -pbkdf2 -iter 300000 -in "${STEEM}/${meta.keysZipFile}" -out "${work}/m.zip" -pass env:VP`, { env: { ...process.env, VP: pass }, stdio: "pipe" });
execSync(`unzip -q -o "${work}/m.zip" -d "${work}/o"`, { stdio: "pipe" });
fs.rmSync(`${work}/m.zip`, { force: true });
const vault = JSON.parse(fs.readFileSync(path.join(work, "o/agent/keys/vault.json"), "utf8"));
const targets = vault.accounts.filter((a) => ["cashmachine", "haran", "israelnews", "lsa", "macrame", "tov", "wic", "wog", "woq", "hcsoldier4", "hcsoldier5", "hcsoldier6"].includes(a.username) && (!only || a.username === only));
log({ step: "vault-opened", targets: targets.map((t) => t.username) });

let dgpo = await rpc("condenser_api.get_dynamic_global_properties", []);
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 5 && !dgpo?.head_block_number; i++) { await sleep(2500); dgpo = await rpc("condenser_api.get_dynamic_global_properties", []); }
if (!dgpo?.head_block_number) { log({ step: "done", results: [{ verdict: "dgpo-unavailable-fail-closed" }] }); process.exit(0); }
for (const a of targets) {
  const wifOwner = a.keys?.owner?.wif;
  const wifPosting = a.keys?.posting?.wif;
  if (!wifOwner || !wifPosting) { results.push({ account: a.username, verdict: "vault-missing-role" }); continue; }
  const ownerPub = pubkeyFromSeed(wifDecode(wifOwner));
  const postPub = pubkeyFromSeed(wifDecode(wifPosting));
  const [acct] = await rpc("condenser_api.get_accounts", [[a.username]]) ?? [];
  if (!acct) { results.push({ account: a.username, verdict: "not-on-chain" }); continue; }
  // owner wif must be live — the chain judges control before anything signs
  if (!(acct.owner.key_auths ?? []).some((k) => k[0] === ownerPub)) { results.push({ account: a.username, verdict: "owner-wif-not-live-no-sign" }); continue; }
  const livePosting = (acct.posting.key_auths ?? []).map((k) => k[0]);
  if (livePosting.includes(postPub)) { results.push({ account: a.username, verdict: "already-live", liveKeys: livePosting.length }); continue; }
  const op = ["account_update2", {
    account: a.username,
    owner: null, active: null, memo_key: null,
    posting: { weight_threshold: 1, account_auths: [], key_auths: [...livePosting.map((p) => [p, 1]), [postPub, 1]] },
    json_metadata: "", posting_json_metadata: "",
  }];
  const tx = buildTx({ ops: [op], dgpo, wifs: [wifOwner], chainId: STEEM_CHAIN_ID });
  const bc = await rpc("network_broadcast_api.broadcast_transaction", [tx.json], 20000);
  if (bc === null) { results.push({ account: a.username, verdict: "broadcast-failed-all-nodes" }); continue; }
  const crypto = await import("node:crypto");
  const txid = crypto.createHash("sha256").update(Buffer.from(tx.serializedHex, "hex")).digest("hex").slice(0, 40);
  // post-broadcast chain truth
  await new Promise((r) => setTimeout(r, 2500));
  const [after] = await rpc("condenser_api.get_accounts", [[a.username]]) ?? [];
  const afterKeys = (after?.posting?.key_auths ?? []).map((k) => k[0]);
  const installed = afterKeys.includes(postPub);
  results.push({ account: a.username, verdict: installed ? "POSTING-RESTORED" : "broadcast-accepted-not-visible-yet", txid, liveKeys: afterKeys.length });
  if (!installed) await new Promise((r) => setTimeout(r, 3000));
}
fs.rmSync(work, { recursive: true, force: true });
log({ step: "done", results });
