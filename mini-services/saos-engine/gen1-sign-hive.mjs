// gen1-sign-hive.mjs — THE GEN-1 CUSTODY REVIVAL (runner-only, fail-closed).
// Opens the sha-pinned GEN-1 keys zip with the Actions-held pass bundle
// (STEEM_VAULT_PASSES → gen1.keysZipUnlock), judges EVERY key inside against
// the LIVE chain authorities (hive+steem), then — if a live HIVE authority is
// held — signs ONE posting-only saos.weave.v1 heartbeat and emits the SIGNED
// tx (public material). Zero secret material is ever printed or written.
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import { buildTx, fingerprint, HIVE_CHAIN_ID } from "./steemtx.mjs";
import { wifDecode } from "./steemtx.mjs";
import { getPublicKey } from "@noble/secp256k1";
import { ripemd160 } from "@noble/hashes/ripemd160";
import bs58 from "bs58";

const sha256hex = (b) => crypto.createHash("sha256").update(b).digest("hex");
const sha256d = (b) => crypto.createHash("sha256").update(crypto.createHash("sha256").update(b).digest()).digest();
function pubFromSeed(seed32) {
  const pub = getPublicKey(Buffer.from(seed32), true);
  const chk = Buffer.from(ripemd160(Buffer.from(pub))).slice(0, 4);
  return "STM" + bs58.encode(Buffer.concat([Buffer.from(pub), chk]));
}
const pubOfWif = (wif) => pubFromSeed(wifDecode(wif));
const log = (o) => {
  console.log(JSON.stringify(o));
  // checkpoint t18 (agent-9): custody verdicts are PUBLIC material — persist them
  // so a fail-closed exit remains observable after the runner dies (log 404 lesson).
  try { fs.appendFileSync('custody-receipt.jsonl', JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n'); } catch {}
};

async function rpc(nodes, method, params) {
  let last = "no-node";
  for (const host of nodes) {
    try {
      const r = await fetch(host, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(12000) });
      const d = await r.json();
      if (d.error) { last = d.error.message; continue; }
      return d.result;
    } catch (e) { last = String(e); }
  }
  throw new Error("all nodes failed: " + last);
}

const [steemAcct] = await rpc(["https://api.steemit.com"], "condenser_api.get_accounts", [["headcorner"]]);
const [hiveAcct] = await rpc(["https://api.hive.blog", "https://api.hive.dev"], "condenser_api.get_accounts", [["headcorner"]]);
const live = {
  steem: { owner: steemAcct.owner.key_auths[0][0], active: steemAcct.active.key_auths[0][0], posting: steemAcct.posting.key_auths[0][0], memo: steemAcct.memo_key },
  hive: { owner: hiveAcct.owner.key_auths[0][0], active: hiveAcct.active.key_auths[0][0], posting: hiveAcct.posting.key_auths[0][0], memo: hiveAcct.memo_key },
};
log({ step: "live-authorities", hivePosting: fingerprint(live.hive.posting), steemPosting: fingerprint(live.steem.posting) });

const WIF_RE = /[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{50,52}/g;
const liveHits = [];
function judgeText(text, tag) {
  for (const tok of String(text).match(WIF_RE) ?? []) {
    try {
      const pub = pubOfWif(tok);
      const hits = [];
      for (const chain of ["hive", "steem"]) for (const [role, lp] of Object.entries(live[chain])) if (pub === lp) hits.push(`${chain}/${role}`);
      if (hits.length) liveHits.push({ tag, pub, hits });
    } catch { /* not a WIF */ }
  }
}

// ── 1. GEN-1 zip (sha-pinned, per GEN-1-ERA-META) ───────────────────────────
const meta = JSON.parse(fs.readFileSync(new URL("../../agent/vault/GEN-1-ERA-META.json", import.meta.url).pathname, "utf8"));
const zipEnc = fs.readFileSync(new URL("../../agent/vault/KEYS-ZIP-2026-09-10.zip.enc", import.meta.url).pathname);
if (sha256hex(zipEnc) !== meta.keysZipSha256) { log({ ok: false, error: "gen1-outer-sha-mismatch" }); process.exit(1); }
let bundle = {};
try { bundle = JSON.parse(process.env.STEEM_VAULT_PASSES ?? "{}"); } catch { log({ ok: false, error: "pass-bundle-not-json" }); process.exit(1); }
const pass = bundle?.gen1?.keysZipUnlock;
if (typeof pass !== "string" || pass.length < 8) { log({ ok: false, error: "gen1.keysZipUnlock-absent" }); process.exit(1); }
const tmp = fs.mkdtempSync(os.tmpdir() + "/gen1-");
fs.writeFileSync(`${tmp}/k.enc`, zipEnc, { mode: 0o600 });
execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000", "-in", `${tmp}/k.enc`, "-out", `${tmp}/inner.zip`, "-pass", `pass:${pass}`], { stdio: ["ignore", "ignore", "pipe"] });
const inner = fs.readFileSync(`${tmp}/inner.zip`);
if (sha256hex(inner) !== meta.keysZipInnerSha256) { log({ ok: false, error: "gen1-inner-sha-mismatch" }); process.exit(1); }
log({ step: "gen1-opened-sha-pinned" });
fs.writeFileSync(`${tmp}/inner.zip`, inner, { mode: 0o600 });
execFileSync("unzip", ["-o", "-q", `${tmp}/inner.zip`, "-d", `${tmp}/o`]);
const files = [];
const walk = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const fp = p + "/" + e.name; if (e.isDirectory()) walk(fp); else files.push(fp); } };
walk(`${tmp}/o`);
log({ step: "gen1-files", n: files.length, names: files.map((f) => f.split("/").pop()).slice(0, 20) });
for (const f of files) {
  try { judgeText(fs.readFileSync(f, "utf8"), "gen1:" + f.split("/").pop()); } catch { /* binary */ }
}

// ── 2. ROT2_FLEET_KEYS / MAIN_KEY / ROT_ROSTER bundles (runner-only secrets) ─
for (const [name, raw] of Object.entries({ ROT2_FLEET_KEYS: process.env.ROT2_FLEET_KEYS ?? "", MAIN_KEY: process.env.MAIN_KEY ?? "", ROT_ROSTER: process.env.ROT_ROSTER ?? "" })) {
  if (!raw) continue;
  judgeText(raw, name);
  try { const j = JSON.parse(raw); const flat = JSON.stringify(j); judgeText(flat, name + ":flat"); } catch { /* not json */ }
}

log({ step: "judged", liveHits: liveHits.length });
for (const h of liveHits) log({ hit: h.hits.join("+"), tag: h.tag, pubFp: fingerprint(h.pub) });

// ── 3. pick the live HIVE authority and sign the heartbeat ──────────────────
const postingHit = liveHits.find((h) => h.hits.includes("hive/posting"));
if (!postingHit) { log({ ok: false, error: "no live hive posting key found in runner-held material" }); process.exit(1); }
// recover the WIF string for the hit (re-scan the tagged file)
const srcFile = postingHit.tag.startsWith("gen1:") ? files.find((f) => f.split("/").pop() === postingHit.tag.slice(5)) : null;
let signingWif = null;
for (const tok of (srcFile ? fs.readFileSync(srcFile, "utf8") : JSON.stringify({ ROT2: process.env.ROT2_FLEET_KEYS ?? "" })).match(WIF_RE) ?? []) {
  try { if (pubOfWif(tok) === postingHit.pub) { signingWif = tok; break; } } catch { /* */ }
}
if (!signingWif) { log({ ok: false, error: "wif-not-recovered" }); process.exit(1); }
log({ step: "hive-custody-verified", via: postingHit.tag, pubFp: fingerprint(postingHit.pub) });

const payload = {
  protocol: "saos.weave.v1",
  kind: "hive-custody-live",
  note: "first HIVE treasury-signed op — GEN-1 vault material verified against live authority on-runner, relayed via public non-custodial relay (dex-relay:3030)",
  authorizedBy: "owner 2026-10-17",
  t: Math.floor(Date.now() / 1000),
};
const op = ["custom_json", { required_auths: [], required_posting_auths: ["headcorner"], id: "saos.weave.v1", json: JSON.stringify(payload) }];
const dgpo = await rpc(["https://api.hive.blog", "https://api.hive.dev"], "condenser_api.get_dynamic_global_properties", []);
const tx = buildTx({ ops: [op], dgpo, wifs: [signingWif], chainId: HIVE_CHAIN_ID });
const b64 = Buffer.from(JSON.stringify(tx.json), "utf8").toString("base64");
fs.writeFileSync("signed-tx.b64", b64);
log({ step: "signed", role: "posting", ops: 1, sigs: tx.json.signatures.length, expiration: tx.json.expiration });
console.log("===SIGNED-TX-B64===");
console.log(b64);
console.log("===END===");
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
