// hc-key-census-t21.mjs — KEY CENSUS · CHAIN-IS-THE-JUDGE · ZERO EXPOSURE
// Owner order (T21): "הארכיטקטורה תפעל הכל כבעלים · יש את כל המפתחות בכספות/בגיט — ודא שהיא יודעת להשתמש בהכל"
// NEVER prints private material. Prints: paths, fingerprints (sha256 prefix), derived PUBLIC keys, verdicts.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { createHash } from "node:crypto";
// CANONICAL crypto (steemtx.mjs — 1823/1823 selftest, byte-proven against live authorities)
import { wifDecode, pubkeyFromSeed, derivePub } from "./steemtx.mjs";

const VAULT = "/home/z/audit/repos/steem/.secrets";
const ROOTS = [
  "/home/z/audit/repos",
  "/home/z/my-project",
  "/home/z/coord-work",
  "/home/z/.operator",
  "/home/z/audit/bin",
];
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "content", "uploads", ".turbo", ".cache"]);
const MAX_FILE = 2_000_000;

const WIF_RE = /\b5[1-9A-HJ-NP-Za-km-z]{50}\b/g;

// canonical WIF decode (handles 38B modern + 37B uncompressed-era)
function wifToPriv(wif) {
  try { return wifDecode(wif); } catch { return null; }
}
function privToStmPub(priv, prefix = "STM") {
  try {
    const pub = pubkeyFromSeed(priv);
    return prefix === "STM" ? pub : pub; // chains share the STM prefix format
  } catch { return null; }
}
const fp = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 16);

async function getAccounts(nodes, names) {
  for (const node of nodes) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 15000);
      const r = await fetch(node, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [names], id: 1 }),
        signal: ac.signal,
      });
      clearTimeout(t);
      const j = await r.json();
      if (j?.result) return j.result;
    } catch {}
  }
  return null;
}

function authoritiesOf(acc, chain) {
  const out = {};
  for (const role of ["owner", "active", "posting"]) {
    out[role] = (acc?.[role]?.key_auths || []).map((k) => k[0]);
  }
  out.memo = acc?.memo_key ? [acc.memo_key] : [];
  out._chain = chain;
  return out;
}

// ---- 1. collect candidate secrets (never printed) ----
const candidates = new Map(); // fingerprint -> {wif, src}
function addCandidate(wif, src) {
  const f = fp(wif);
  if (!candidates.has(f)) candidates.set(f, { wif, src });
}

// army vault
let army = null;
try {
  army = JSON.parse(readFileSync(join(VAULT, "army-keys.json"), "utf8"));
  for (const a of army.accounts || []) for (const g of a.gens || []) if (g?.wif) addCandidate(g.wif, `army:${a.name}`);
} catch (e) { console.log("army-vault: ERROR", e.message); }

// engine keys.env (K=V lines)
try {
  const envTxt = readFileSync("/home/z/audit/repos/steem/mini-services/saos-engine/keys.env", "utf8");
  for (const line of envTxt.split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)=(.+)$/);
    if (m) addCandidate(m[2].trim(), `engine-env:${m[1]}`);
  }
} catch (e) { console.log("engine-env: absent"); }

// owner app key (gate key)
try { addCandidate(readFileSync("/home/z/my-project/upload/headcorner.txt", "utf8").trim(), "vault-headcorner.txt"); } catch {}
try { addCandidate(readFileSync(join(VAULT, "headcorner.key"), "utf8").replace(/\s+/g, ""), "vault-headcorner.key"); } catch {}
try { addCandidate(readFileSync(join(VAULT, "headcorner.key"), "utf8").trim(), "vault-headcorner.key-rawtrim"); } catch {}

// recursive scan for raw WIFs across roots
let scanned = 0;
function walk(dir) {
  let ents;
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); continue; }
    if (e.name === "hc-key-census-t21.mjs") continue; // never scan self-result file
    try {
      const st = statSync(p);
      if (!st.isFile() || st.size > MAX_FILE) continue;
      if ([".png", ".jpg", ".zip", ".enc", ".woff", ".woff2", ".ico", ".pdf", ".node", ".wasm"].includes(extname(e.name))) continue;
      scanned++;
      const txt = readFileSync(p, "utf8");
      for (const m of txt.matchAll(WIF_RE)) {
        if (wifToPriv(m[0])) addCandidate(m[0], `scan:${p}`);
      }
    } catch {}
  }
}
for (const r of ROOTS) walk(r);

console.log(`census: scanned ${scanned} files · ${candidates.size} unique WIF candidates (fingerprinted, never printed)`);

// ---- 2. chain authorities ----
const armyNames = (army?.accounts || []).map((a) => a.name);
const allNames = [...new Set(["headcorner", ...armyNames])];
const STEEM_NODES = ["https://api.steemit.com", "https://api.steemitdev.com", "https://steem.kenkai.wang"];
const HIVE_NODES = ["https://api.hive.blog", "https://api.openhive.network", "https://hived.emre.sh"];
const [steemAccs, hiveAccs] = await Promise.all([
  getAccounts(STEEM_NODES, allNames),
  getAccounts(HIVE_NODES, allNames),
]);
if (!steemAccs) console.log("WARN: steem nodes unreachable");
if (!hiveAccs) console.log("WARN: hive nodes unreachable");
const steemBy = new Map((steemAccs || []).map((a) => [a.name, authoritiesOf(a, "STEEM")]));
const hiveBy = new Map((hiveAccs || []).map((a) => [a.name, authoritiesOf(a, "HIVE")]));

// ---- 3. judge every candidate ----
const verdicts = [];
for (const [f, { wif, src }] of candidates) {
  const priv = wifToPriv(wif);
  for (const chain of ["STEEM", "HIVE"]) {
    const pub = privToStmPub(priv, "STM");
    if (!pub) continue;
    const authMap = chain === "STEEM" ? steemBy : hiveBy;
    for (const [acct, auths] of authMap) {
      for (const role of ["owner", "active", "posting", "memo"]) {
        if ((auths[role] || []).includes(pub)) {
          verdicts.push({ f, src, chain, acct, role, pub });
        }
      }
    }
  }
}

console.log("\n== VERDICTS (chain-is-the-judge) ==");
if (!verdicts.length) console.log("no candidate derives to any live authority");
const seen = new Set();
for (const v of verdicts) {
  const k = `${v.f}|${v.acct}|${v.role}|${v.chain}`;
  if (seen.has(k)) continue;
  seen.add(k);
  console.log(`LIVE ${v.chain} ${v.acct}.${v.role} · wif-fp=${v.f} · pub=${v.pub.slice(0, 12)}…${v.pub.slice(-4)} · src=${v.src}`);
}

// ---- 4. master-password derivation matrix (vault key + engine master) ----
function fromSeed(seed) {
  try {
    const priv = sha256(seed);
    return privToStmPub(priv, "STM");
  } catch { return null; }
}
const masterCandidates = [];
try { masterCandidates.push({ name: "vault-key", pw: readFileSync(join(VAULT, "headcorner.key"), "utf8").trim() }); } catch {}
try { masterCandidates.push({ name: "vault-key-squash", pw: readFileSync(join(VAULT, "headcorner.key"), "utf8").replace(/\s+/g, "") }); } catch {}
try {
  const envTxt = readFileSync("/home/z/audit/repos/steem/mini-services/saos-engine/keys.env", "utf8");
  const m = envTxt.match(/^HEAD_CORNER_MASTER=(.+)$/m);
  if (m) masterCandidates.push({ name: "engine-master", pw: m[1].trim() });
} catch {}
console.log("\n== MASTER-DERIVATION MATRIX ==");
const ROLE_SEEDS = ["posting", "active", "owner", "memo"];
const ORDERS = [(a, r, p) => a + r + p, (a, r, p) => r + a + p, (a, r, p) => p + a + r, (a, r, p) => p + r + a];
for (const mc of masterCandidates) {
  let hits = [];
  for (const chain of ["STEEM", "HIVE"]) {
    const authMap = chain === "STEEM" ? steemBy : hiveBy;
    for (const acct of allNames) {
      for (const role of ROLE_SEEDS) {
        for (let oi = 0; oi < ORDERS.length; oi++) {
          const pub = fromSeed(ORDERS[oi](acct, role, mc.pw));
          if (pub && (authMap.get(acct)?.[role === "memo" ? "memo" : role] || []).includes(pub)) {
            hits.push(`${chain}/${acct}/${role}/order${oi + 1}`);
          }
        }
      }
    }
  }
  console.log(`${mc.name} (fp=${fp(mc.pw)} · len=${mc.pw.length}): ${hits.length ? "LIVE-KEYS " + hits.join(" ") : "zero live derivations (4 orders × 2 chains × 4 roles × 10 accounts)"}`);
}

// ---- 5. army posting health table ----
console.log("\n== ARMY POSTING HEALTH (STEEM) ==");
for (const a of army?.accounts || []) {
  const g = (a.gens || [])[0];
  if (!g?.wif) { console.log(`${a.name}: NO-WIF`); continue; }
  const pub = privToStmPub(wifToPriv(g.wif), "STM");
  const live = (steemBy.get(a.name)?.posting || []).includes(pub);
  console.log(`${a.name}: ${live ? "POSTING-LIVE" : "not-live"} pub=${pub ? pub.slice(0, 10) + "…" + pub.slice(-4) : "?"} wif-fp=${fp(g.wif)}`);
}
console.log("\ncensus-complete");
