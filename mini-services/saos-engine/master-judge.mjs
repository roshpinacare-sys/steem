// master-judge.mjs — THE ONE LOCAL JUDGE (owner law: the chain is the only judge).
// Reads steem/.secrets/custody-vault/*.json (0600), derives pubkeys, judges vs LIVE
// chain authorities (steem+hive), writes custody-manifest.json (verdicts, NO material)
// + appends receipts/custody-patrol.jsonl. Fingerprints only in stdout. Never prints WIFs.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import * as secp from "@noble/secp256k1";

const ROOT = new URL("..", import.meta.url).pathname; // engine dir -> repo root? engine is mini-services/saos-engine
const REPO = new URL("../../", import.meta.url).pathname; // repo root
const VAULT = `${REPO}.secrets/custody-vault`;
const MANIFEST = `${REPO}.secrets/custody-manifest.json`;
const RECEIPTS = `${REPO}receipts`;

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58d(s) { let n = 0n; for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error("b58char"); n = n * 58n + BigInt(i); } let h = n.toString(16); if (h.length % 2) h = "0" + h; return Buffer.from(h, "hex"); }
function b58e(buf) { let n = BigInt("0x" + buf.toString("hex") || "0"), out = ""; while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; } for (const b of buf) { if (b === 0) out = "1" + out; else break; } return out; }
function wifSeed(wif) {
  const d = b58d(wif);
  let body, chk;
  if (d.length === 38) { body = d.subarray(0, 34); chk = d.subarray(34); if (body[0] !== 0x80 || body[33] !== 0x01) throw new Error("wif-format"); }
  else if (d.length === 37) { body = d.subarray(0, 33); chk = d.subarray(33); if (body[0] !== 0x80) throw new Error("wif-format"); }
  else throw new Error("wif-length");
  const c = createHash("sha256").update(createHash("sha256").update(body).digest()).digest().subarray(0, 4);
  if (!c.equals(chk)) throw new Error("wif-checksum");
  return Buffer.from(body.subarray(1, 33));
}
function steemPub(wif) {
  const pub = Buffer.from(secp.getPublicKey(wifSeed(wif), true));
  const chk = createHash("ripemd160").update(pub).digest().subarray(0, 4);
  return "STM" + b58e(Buffer.concat([pub, chk]));
}
function hivePub(wif) {
  const pub = Buffer.from(secp.getPublicKey(wifSeed(wif), true));
  const chk = createHash("ripemd160").update(pub).digest().subarray(0, 4);
  return "TST" + b58e(Buffer.concat([pub, chk]));
}
const fp = (s) => createHash("sha256").update(s).digest().toString("hex").slice(0, 8);

async function rpc(url, method, params) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(20000) });
  const j = await r.json(); if (j.error) throw new Error(String(j.error.message).slice(0, 100)); return j.result;
}
async function rpcRetry(url, method, params, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await rpc(url, method, params); } catch (e) { lastErr = e; if (i < tries - 1) await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
  throw lastErr;
}

const WIF_RE = /^[5K][1-9A-HJ-NP-Za-km-z]{50,51}$/;
function collectWifs(node, out, path = "") {
  if (!node || typeof node !== "object") {
    if (typeof node === "string" && WIF_RE.test(node.trim())) out.push({ wif: node.trim(), path });
    return;
  }
  for (const [k, v] of Object.entries(node)) collectWifs(v, out, path ? `${path}.${k}` : k);
}

async function main() {
  if (!existsSync(VAULT)) { console.error(`judge: no custody-vault at ${VAULT}`); process.exit(1); }
  const files = readdirSync(VAULT).filter((f) => f.endsWith(".json"));
  const held = [];
  for (const f of files) {
    try { collectWifs(JSON.parse(readFileSync(`${VAULT}/${f}`, "utf8")), held, f.replace(".json", "")); } catch {}
  }
  // also census-verified cache if present
  const cv = `${REPO}.secrets/census-verified.json`;
  if (existsSync(cv)) { try { collectWifs(JSON.parse(readFileSync(cv, "utf8")), held, "census-verified"); } catch {} }

  // dedupe
  const seen = new Set(); const cands = held.filter((h) => (seen.has(h.wif) ? false : (seen.add(h.wif), true)));
  console.log(`judge: ${cands.length} held WIF candidate(s) from ${files.length} vault file(s)`);

  const ROSTER = ["headcorner","cashmachine","haran","israelnews","lsa","macrame","siq","tov","wic","wog","woq","hcsoldier1","hcsoldier2","hcsoldier3","hcsoldier4","hcsoldier5","hcsoldier6","hcsoldier7","saos-0001","saos-0002","saos-0003","saos-0004","saos-0005","saos-0006","saos-0007","saos-0008","saos-0009"];
  let steemUnreachable = false, hiveUnreachable = false;
  const steemAccs = await rpcRetry("https://api.steemit.com", "condenser_api.get_accounts", [ROSTER]).catch(() => { steemUnreachable = true; return []; });
  const hiveRoster = ["headcorner", "israelnews", "lsa", "siq", "woq"];
  const hiveAccs = await rpcRetry("https://api.hive.blog", "condenser_api.get_accounts", [hiveRoster]).catch(() => { hiveUnreachable = true; return []; });
  const auth = {};
  for (const a of steemAccs) auth["steem:" + a.name] = { active: a.active?.key_auths?.[0]?.[0], posting: a.posting?.key_auths?.[0]?.[0], memo: a.memo_key, owner: a.owner?.key_auths?.[0]?.[0] };
  for (const a of hiveAccs) auth["hive:" + a.name] = { active: a.active?.key_auths?.[0]?.[0], posting: a.posting?.key_auths?.[0]?.[0], memo: a.memo_key, owner: a.owner?.key_auths?.[0]?.[0] };

  const manifest = { at: new Date().toISOString(), judge: "master-judge.mjs", live: {}, matrix: [] };
  for (const c of cands) {
    let pubS; try { pubS = steemPub(c.wif); } catch { manifest.matrix.push(`${c.path} ${fp(c.wif)} UNPARSEABLE`); continue; }
    const pubH = hivePub(c.wif);
    let hit = null;
    for (const [key, roles] of Object.entries(auth)) {
      for (const [role, chainPub] of Object.entries(roles)) {
        if (chainPub && (chainPub === pubS || chainPub === pubH)) { hit = { key, role }; break; }
      }
      if (hit) break;
    }
    if (hit) {
      const [chain, account] = hit.key.split(":");
      manifest.live[account] = manifest.live[account] || {};
      if (!manifest.live[account][hit.role]) manifest.live[account][hit.role] = { fp: fp(c.wif), from: c.path, chain };
      manifest.matrix.push(`${c.path.padEnd(24)} ${fp(c.wif)} LIVE ${hit.key}:${hit.role}`);
    } else {
      const reach = steemUnreachable || hiveUnreachable
        ? `chain-unreachable(${steemUnreachable ? "steem" : ""}${steemUnreachable && hiveUnreachable ? "+" : ""}${hiveUnreachable ? "hive" : ""})`
        : null;
      manifest.matrix.push(`${c.path.padEnd(24)} ${fp(c.wif)} ${reach || "dead-vs-chain"}`);
    }
  }
  const nAcc = Object.keys(manifest.live).length;
  console.log(`judge: ${nAcc} account(s) live: ${Object.keys(manifest.live).map((a) => `${a}(${Object.keys(manifest.live[a]).join("+")})`).join(", ")}`);
  for (const m of manifest.matrix) console.log("  " + m);

  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + "\n", { mode: 0o600 });
  mkdirSync(RECEIPTS, { recursive: true });
  writeFileSync(`${RECEIPTS}/custody-patrol.jsonl`,
    JSON.stringify({ at: manifest.at, liveAccounts: nAcc, accounts: Object.keys(manifest.live), ok: nAcc > 0 }) + "\n",
    { flag: "a" });
  console.log(`judge: manifest written (0600) + patrol receipt appended. VERDICT: ${nAcc > 0 ? "CUSTODY-ALIVE" : "CUSTODY-EMPTY"}`);
  process.exit(nAcc > 0 ? 0 : 2);
}
main();
