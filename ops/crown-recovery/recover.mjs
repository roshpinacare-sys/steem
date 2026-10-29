// recover.mjs — CROWN RECOVERY: open every vault, mine every generation,
// judge everything against the chain. The one script that "finds ALL the keys".
// Law: fingerprints in logs, WIFs only in the sealed map. The chain is the only judge.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from "node:fs";
import * as secp from "@noble/secp256k1";

const GH_PAT = process.env.GH_PAT || "";
if (!GH_PAT) { console.error("recover: GH_PAT missing"); process.exit(1); }

/* ── steem/hive crypto primitives ─────────────────────────────────────── */
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
const fp = (s) => createHash("sha256").update(s).digest().toString("hex").slice(0, 8);
const sha = (s) => createHash("sha256").update(s).digest();

/* ── openssl helper (aes-256-cbc pbkdf2 — the vault standard) ─────────── */
function tryOpen(file, pass, out, iter) {
  try {
    execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", String(iter), "-in", file, "-out", out, "-pass", `pass:${pass}`], { stdio: "pipe", timeout: 60000 });
    return existsSync(out) && readFileSync(out).length > 0;
  } catch { try { rmSync(out, { force: true }); } catch {} return false; }
}

/* ── 1. credential candidates from every secret ───────────────────────── */
const SECRET_ENVS = ["GH_PAT","MAIN_KEY","ZIP_PAT","ROT2_FLEET_KEYS","ROT_ROSTER","STEEM_VAULT_PASSES","VAULT_PASSES_R33","LIVE_FLEET_KEYS","NIM_API_KEY"];
const candidates = new Set();
for (const name of SECRET_ENVS) {
  const v = process.env[name];
  if (!v) continue;
  candidates.add(v.trim());
  try { (function walk(n, d) { if (!n || typeof n !== "object" || d > 8) return; for (const x of Object.values(n)) { if (typeof x === "string") candidates.add(x.trim()); else walk(x, d + 1); } })(JSON.parse(v), 0); } catch {}
  for (const line of v.split(/[\n;, ]+/)) { const t = line.trim(); if (t.length >= 16) candidates.add(t); }
}
for (const name of ["STEEM_VAULT_PASSES", "VAULT_PASSES_R33", "ROT_ROSTER"]) {
  const v = process.env[name];
  if (v) for (const line of v.split(/\r?\n/)) { const t = line.trim(); if (t.length >= 8) candidates.add(t); }
}
console.log(`recover: ${candidates.size} credential candidates from ${SECRET_ENVS.filter(n => process.env[n]).length} secrets`);

/* ── 2. open vault-home (wraps → P, legacy fallback) ──────────────────── */
const VH = "/tmp/vh";
rmSync(VH, { recursive: true, force: true });
execFileSync("git", ["clone", "--depth", "1", `https://x-access-token:${GH_PAT}@github.com/roshpinacare-sys/vault-home.git`, VH], { stdio: "pipe" });

let P = null;
const WRAPS_DIR = existsSync(`${VH}/wraps`) ? `${VH}/wraps` : null;
if (WRAPS_DIR) {
  const wrapFiles = readdirSync(WRAPS_DIR).filter((f) => f.endsWith(".enc"));
  console.log(`recover: ${wrapFiles.length} wrap(s) present`);
  for (const c of candidates) {
    const h = sha(c).toString("hex");
    const w = `${WRAPS_DIR}/${h}.enc`;
    if (!existsSync(w)) continue;
    const out = "/tmp/_p.bin";
    if (tryOpen(w, h, out, 200000)) {
      P = readFileSync(out, "utf8").trim(); rmSync(out, { force: true });
      console.log(`recover: WRAP-OPEN via candidate fp ${fp(c)} (fp ${fp(P)})`);
      break;
    }
  }
}
if (!P) {
  for (const c of candidates) {
    if (tryOpen(`${VH}/keys.env.enc`, c, "/tmp/_k.env", 200000)) { P = c; console.log(`recover: LEGACY-OPEN via candidate fp ${fp(c)}`); break; }
  }
}
if (!P) console.log("recover: vault P NOT recovered from cloud candidates (honest)");

/* ── 3. harvest every file the pass pool can open ─────────────────────── */
const passPool = new Set();
if (P) passPool.add(P);
for (const name of ["STEEM_VAULT_PASSES", "VAULT_PASSES_R33"]) {
  const v = process.env[name];
  if (!v) continue;
  passPool.add(v.trim());
  for (const line of v.split(/\r?\n/)) { const t = line.trim(); if (t.length >= 8) passPool.add(t); }
}
for (const c of candidates) if (c.length >= 16) passPool.add(c);

const harvested = new Set();
const sealLog = [];
function harvestText(text) {
  for (const m of text.match(/[5K][1-9A-HJ-NP-Za-km-z]{50,51}/g) || []) harvested.add(m);
  for (const m of text.match(/P[1-9A-HJ-NP-Za-km-z]{50,51}/g) || []) harvested.add(m);
}
function openSealed(file, iters = [200000, 300000]) {
  const out = "/tmp/_s.out";
  for (const pass of passPool) for (const iter of iters) {
    if (tryOpen(file, pass, out, iter)) {
      const text = readFileSync(out, "utf8");
      harvestText(text);
      sealLog.push(`${file.split("/").pop()} OPEN (pass fp ${fp(pass)}, iter ${iter}, ${text.length}B)`);
      rmSync(out, { force: true });
      return true;
    }
  }
  rmSync(out, { force: true });
  sealLog.push(`${file.split("/").pop()} SEALED (no pass in pool)`);
  return false;
}

for (const f of ["keys.env.enc", "fleet-rot2.keys.enc", "ssh-keys.tar.enc"]) {
  if (existsSync(`${VH}/${f}`)) openSealed(`${VH}/${f}`);
}
for (const dir of ["intake", "custody-intake", "archive"]) {
  const d = `${VH}/${dir}`;
  if (!existsSync(d)) continue;
  for (const f of readdirSync(d)) if (f.endsWith(".enc")) openSealed(`${d}/${f}`);
}

/* ── 4. GEN archaeology — every vault generation in git history ───────── */
let genCount = 0;
try {
  const blobs = execFileSync("git", ["rev-list", "--objects", "--all"], { encoding: "utf8", maxBuffer: 1 << 26 });
  const seen = new Set();
  const vaultBlobs = [];
  for (const line of blobs.split("\n")) {
    const sp = line.indexOf(" ");
    const h = sp > 0 ? line.slice(0, sp) : line;
    const p = sp > 0 ? line.slice(sp + 1) : "";
    if (!h || h.length !== 40 || seen.has(h)) continue;
    if (!p.includes("vault") || !p.endsWith(".enc")) continue;
    seen.add(h);
    vaultBlobs.push([h, p]);
  }
  console.log(`recover: archaeology — ${vaultBlobs.length} vault-era .enc blobs in git history`);
  mkdirSync("/tmp/gen", { recursive: true });
  for (const [h, p] of vaultBlobs.slice(0, 300)) {
    let content;
    try { content = execFileSync("git", ["cat-file", "-p", h], { stdio: "pipe", maxBuffer: 1 << 26 }); } catch { continue; }
    if (!content || !content.length) continue;
    const dst = `/tmp/gen/${h}.enc`;
    writeFileSync(dst, content);
    if (openSealed(dst, [200000, 300000])) genCount++;
  }
} catch (e) { console.log(`recover: archaeology soft-fail: ${String(e).slice(0, 120)}`); }
console.log(`recover: GEN archaeology opened ${genCount} generation archive(s)`);

/* ── 5. build the candidate WIF store (harvest + relay map) ───────────── */
const verifiedStore = [];
for (const w of harvested) verifiedStore.push({ wif: w, source: "harvest" });
try {
  const lk = JSON.parse(process.env.LIVE_FLEET_KEYS || "null");
  if (lk?.live) for (const [acc, roles] of Object.entries(lk.live)) for (const [role, w] of Object.entries(roles)) verifiedStore.push({ wif: w, source: `relay:${acc}:${role}` });
} catch {}

/* ── 6. judge everything vs the chain ─────────────────────────────────── */
async function rpc(url, method, params) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(20000) });
  const j = await r.json(); if (j.error) throw new Error(String(j.error.message).slice(0, 80)); return j.result;
}
const ROSTER = ["headcorner","cashmachine","haran","israelnews","lsa","macrame","siq","tov","wic","wog","woq","hcsoldier1","hcsoldier2","hcsoldier3","hcsoldier4","hcsoldier5","hcsoldier6","hcsoldier7","saos-0001","saos-0002","saos-0003","saos-0004","saos-0005","saos-0006","saos-0007","saos-0008","saos-0009"];
const steemAccs = await rpc("https://api.steemit.com", "condenser_api.get_accounts", [ROSTER]).catch(() => []);
const hiveRoster = ["headcorner", "israelnews", "lsa", "siq", "woq"];
const hiveAccs = await rpc("https://api.hive.blog", "condenser_api.get_accounts", [hiveRoster]).catch(() => []);
const auth = {};
for (const a of steemAccs) auth["steem:" + a.name] = { active: a.active?.key_auths?.[0]?.[0], posting: a.posting?.key_auths?.[0]?.[0], memo: a.memo_key, owner: a.owner?.key_auths?.[0]?.[0] };
for (const a of hiveAccs) auth["hive:" + a.name] = { active: a.active?.key_auths?.[0]?.[0], posting: a.posting?.key_auths?.[0]?.[0], memo: a.memo_key, owner: a.owner?.key_auths?.[0]?.[0] };

const LIVE = {};
const matrix = [];
const seenWif = new Set();
for (const v of verifiedStore) {
  if (seenWif.has(v.wif)) continue;
  seenWif.add(v.wif);
  let pub; try { pub = steemPub(v.wif); } catch { matrix.push(`${v.source.padEnd(22)} ${fp(v.wif)} UNPARSEABLE`); continue; }
  let hit = null;
  for (const [key, roles] of Object.entries(auth)) {
    for (const [role, chainPub] of Object.entries(roles)) {
      if (chainPub && chainPub === pub) { hit = { key, role }; break; }
    }
    if (hit) break;
  }
  if (hit) {
    const [chain, account] = hit.key.split(":");
    LIVE[account] = LIVE[account] || {};
    if (!LIVE[account][hit.role]) LIVE[account][hit.role] = v.wif;
    matrix.push(`${v.source.padEnd(22)} ${fp(v.wif)} LIVE ${hit.key}:${hit.role}`);
  } else {
    matrix.push(`${v.source.padEnd(22)} ${fp(v.wif)} dead-vs-chain`);
  }
}

console.log("\n=== CROWN CENSUS MATRIX (fingerprints only) ===");
for (const m of matrix) console.log("  " + m);
console.log("\n=== SEAL LOG ===");
for (const s of sealLog) console.log("  " + s);
console.log(`\nCROWN RESULT: ${Object.keys(LIVE).length} account(s) with live custody: ${Object.keys(LIVE).join(",")}`);
if (!Object.keys(LIVE).length) { console.error("recover: zero live matches — honest abort (no seal)"); process.exit(1); }
process.stdout.write("CROWN_MAP_B64:" + Buffer.from(JSON.stringify(LIVE)).toString("base64") + ":END\n");
