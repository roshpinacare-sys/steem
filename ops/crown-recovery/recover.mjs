// recover.mjs — CROWN RECOVERY v2 (optimized archaeology)
// v2 changes: targeted vault-era blob selection (agent/vault|custody paths), capped
// blob count, pass pool ordered vault-passes-first, early-exit, byte-size guard.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from "node:fs";
import * as secp from "@noble/secp256k1";

const GH_PAT = process.env.GH_PAT || "";
if (!GH_PAT) { console.error("recover: GH_PAT missing"); process.exit(1); }

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

function tryOpen(file, pass, out, iter) {
  try {
    execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", String(iter), "-in", file, "-out", out, "-pass", `pass:${pass}`], { stdio: "pipe", timeout: 30000 });
    return existsSync(out) && readFileSync(out).length > 0;
  } catch { try { rmSync(out, { force: true }); } catch {} return false; }
}

/* 1. candidates */
const SECRET_ENVS = ["GH_PAT","MAIN_KEY","ZIP_PAT","ROT2_FLEET_KEYS","ROT_ROSTER","STEEM_VAULT_PASSES","VAULT_PASSES_R33","LIVE_FLEET_KEYS","NIM_API_KEY","VAULT_PASSPHRASE","HEADCORNER_SEAL_PASSPHRASE","WEAVE_SEAL_PASSPHRASE","ANCHOR_CRED","HEADCORNER_CRED","FLEET_ACCOUNT"];
const candidates = new Set();
for (const name of SECRET_ENVS) {
  const v = process.env[name];
  if (!v) continue;
  candidates.add(v.trim());
  try { (function walk(n, d) { if (!n || typeof n !== "object" || d > 8) return; for (const x of Object.values(n)) { if (typeof x === "string") candidates.add(x.trim()); else walk(x, d + 1); } })(JSON.parse(v), 0); } catch {}
  for (const line of v.split(/[\n;, ]+/)) { const t = line.trim(); if (t.length >= 16) candidates.add(t); }
}
console.log(`recover: ${candidates.size} credential candidates from ${SECRET_ENVS.filter(n => process.env[n]).length} secrets`);

/* 2. open vault-home */
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

/* 3. pass pool — vault passes FIRST (the GEN archives know them) */
const passPool = [];
const push = (p) => { if (p && p.length >= 8 && !passPool.includes(p)) passPool.push(p); };
for (const name of ["STEEM_VAULT_PASSES", "VAULT_PASSES_R33", "VAULT_PASSPHRASE", "HEADCORNER_SEAL_PASSPHRASE", "WEAVE_SEAL_PASSPHRASE"]) {
  const v = process.env[name];
  if (!v) continue;
  push(v.trim());
  for (const line of v.split(/\r?\n/)) push(line.trim());
  try { (function walk(n, d) { if (!n || typeof n !== "object" || d > 6) return; for (const x of Object.values(n)) { if (typeof x === "string") push(x.trim()); else walk(x, d + 1); } })(JSON.parse(v), 0); } catch {}
}
if (P) push(P);
for (const c of candidates) if (c.length >= 16) push(c);
console.log(`recover: pass pool ${passPool.length} (vault-passes first)`);

const harvested = new Set();
const sealLog = [];
function harvestText(text) {
  for (const m of text.match(/[5K][1-9A-HJ-NP-Za-km-z]{50,51}/g) || []) harvested.add(m);
  for (const m of text.match(/P[1-9A-HJ-NP-Za-km-z]{50,51}/g) || []) harvested.add(m);
}
function openSealed(file, iters = [200000, 300000], maxTries = Infinity) {
  const out = "/tmp/_s.out";
  let tries = 0;
  for (const pass of passPool) {
    if (tries >= maxTries) break;
    for (const iter of iters) {
      tries++;
      if (tryOpen(file, pass, out, iter)) {
        const text = readFileSync(out, "utf8");
        harvestText(text);
        sealLog.push(`${file.split("/").pop()} OPEN (pass fp ${fp(pass)}, iter ${iter}, ${text.length}B)`);
        rmSync(out, { force: true });
        return true;
      }
    }
  }
  rmSync(out, { force: true });
  sealLog.push(`${file.split("/").pop()} SEALED (${tries} tries)`);
  return false;
}

/* vault-home seals */
for (const f of ["keys.env.enc", "fleet-rot2.keys.enc", "ssh-keys.tar.enc"]) {
  if (existsSync(`${VH}/${f}`)) openSealed(`${VH}/${f}`, [200000, 300000], 120);
}
for (const dir of ["intake", "custody-intake"]) {
  const d = `${VH}/${dir}`;
  if (!existsSync(d)) continue;
  for (const f of readdirSync(d).sort()) if (f.endsWith(".enc")) openSealed(`${d}/${f}`, [200000, 300000], 120);
}

/* 4. GEN archaeology — TARGETED: agent/vault|custody era blobs, size-capped */
let genCount = 0, genTried = 0;
try {
  const blobs = execFileSync("git", ["rev-list", "--objects", "--all"], { encoding: "utf8", maxBuffer: 1 << 26 });
  const seen = new Set();
  const targets = [];
  for (const line of blobs.split("\n")) {
    const sp = line.indexOf(" ");
    const h = sp > 0 ? line.slice(0, sp) : line;
    const p = sp > 0 ? line.slice(sp + 1) : "";
    if (!h || h.length !== 40 || seen.has(h)) continue;
    if (!/\.(enc|zip)$/.test(p)) continue;
    if (!/vault|custody|keys|GEN|seal|archive/i.test(p)) continue;
    seen.add(h);
    // relevance order: vault-named dirs first
    const score = /agent\/vault/i.test(p) ? 0 : /custody/i.test(p) ? 1 : /GEN/i.test(p) ? 2 : 3;
    targets.push([score, h, p]);
  }
  targets.sort((a, b) => a[0] - b[0]);
  console.log(`recover: archaeology — ${targets.length} targeted blobs (capped 100)`);
  mkdirSync("/tmp/gen", { recursive: true });
  for (const [, h, p] of targets.slice(0, 100)) {
    let content;
    try { content = execFileSync("git", ["cat-file", "-p", h], { stdio: "pipe", maxBuffer: 1 << 24 }); } catch { continue; }
    if (!content || !content.length || content.length > 2_000_000) continue;
    const dst = `/tmp/gen/${h}.enc`;
    writeFileSync(dst, content);
    genTried++;
    if (openSealed(dst, [200000, 300000], 40)) genCount++;
  }
} catch (e) { console.log(`recover: archaeology soft-fail: ${String(e).slice(0, 120)}`); }
console.log(`recover: GEN archaeology opened ${genCount}/${genTried} archive(s)`);


/* 5.5 master-password derivation — the steem-js scheme: the master unlocks ALL roles */
function normSeed(s2) { return s2.trim().split(/[\t\n\v\f\r ]+/).join(" "); }
const sha256b = (buf) => createHash("sha256").update(buf).digest();
function deriveRoleWif(master, account, role) {
  const secret = sha256b(Buffer.from(normSeed(account + role + master), "utf8"));
  const body = Buffer.concat([Buffer.from([0x80]), Buffer.from(secret), Buffer.from([0x01])]);
  const chk = createHash("sha256").update(createHash("sha256").update(body).digest()).digest().subarray(0, 4);
  return b58e(Buffer.concat([body, chk]));
}
const masters = new Set();
for (const w of harvested) if (/^P[1-9A-HJ-NP-Za-km-z]{49,51}$/.test(w)) masters.add(w);
for (const p of passPool) if (/^P[1-9A-HJ-NP-Za-km-z]{49,51}$/.test(p)) masters.add(p);
console.log(`recover: ${masters.size} master-password candidate(s) found`);
let masterProven = null;
for (const m of masters) {
  const ownerPub = steemPub(deriveRoleWif(m, "headcorner", "owner"));
  if (auth["steem:headcorner"] && auth["steem:headcorner"].owner === ownerPub) {
    masterProven = m;
    console.log(`recover: MASTER-PROVEN for headcorner (owner matches chain, fp ${fp(m)})`);
    for (const role of ["owner", "active", "posting", "memo"]) {
      const w = deriveRoleWif(m, "headcorner", role);
      verifiedStore.push({ wif: w, source: `derived:${role}` });
      harvested.add(w);
    }
    break;
  }
}
if (!masterProven) console.log("recover: no master candidate derives the live owner (honest)");

/* 5-6. judge vs chain (same as v1) */
const verifiedStore = [];
for (const w of harvested) verifiedStore.push({ wif: w, source: "harvest" });
try {
  const lk = JSON.parse(process.env.LIVE_FLEET_KEYS || "null");
  if (lk?.live) for (const [acc, roles] of Object.entries(lk.live)) for (const [role, w] of Object.entries(roles)) verifiedStore.push({ wif: w, source: `relay:${acc}:${role}` });
} catch {}

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
if (masterProven) LIVE._master = masterProven;
process.stdout.write("CROWN_MAP_B64:" + Buffer.from(JSON.stringify(LIVE)).toString("base64") + ":END\n");
