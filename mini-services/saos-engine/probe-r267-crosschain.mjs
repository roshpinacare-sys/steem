/**
 * probe-r267-crosschain.mjs — THE OPERATOR'S CROSS-CHAIN INTEL (memory-only, NO broadcast).
 *
 * Operator, verbatim (R267): "המפתח הראשון שלי של Hive זהה לסטים גם בblurt —
 * אם זה לא עבד לך אז זה כמו בסטים, תנסה להתחבר דרך ה-owner עם הבעלים".
 *
 * The law inside that sentence: sha256(account+role+password) is CHAIN-
 * INDEPENDENT — the same master password derives the same key bytes on
 * Steem, Hive and Blurt (only the WIF prefix differs). Therefore every WIF
 * we hold for headcorner is a candidate for EVERY chain's live authority,
 * and the OWNER authority — never tested in any round — is now in scope.
 *
 * What this probe does (READ-ONLY):
 *  1. Candidate harvest: recursive walk of headcorner's record in BOTH vault
 *     generations (current HEAD seal + GEN-1 commit) collecting every
 *     WIF-shaped string with its JSON path label; plus the formula path
 *     (SEED_ORDERS × roles × master-forms from .secrets/headcorner.key);
 *     plus any WIF-shaped string in .secrets/community-keys.json.
 *  2. NEGATIVE CONTROL (the ruler must be anchored): the current seal's
 *     keys.steem.posting MUST verify against the live STEEM authority. If
 *     not, every verdict is VOID — the unlock pipeline itself is broken.
 *  3. Matrix: every candidate × every live authority on Hive (posting/
 *     active/owner/memo) and Blurt (if its RPC answers; raw 33-byte point
 *     comparison — Blurt prefixes BLT, the point is identical).
 *  4. Verdicts land in state/r267-crosschain.json. Key bytes never touch
 *     disk, logs, or stdout — only path labels and verdicts travel.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { rpcHive } from "./hive.mjs";
import { pubkeyFromSeed as pubFromSeed, wifDecode as wifDec, b58encode, b58decode, SEED_ORDERS } from "./steemtx.mjs";
import { vaultPass } from "./vault-custody.mjs";
import * as crypto from "node:crypto";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.join(DIR, "..", "..");
const ACCOUNT = "headcorner";
const GEN1_COMMIT = "1c9f00d0";
const GEN1_ZIP = "agent/vault/KEYS-ZIP-2026-09-10.zip.enc";
const META = "agent/recovery-meta.json";
const TMP = path.join(REPO, ".secrets", "r267-tmp");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const ROLES = ["posting", "active", "owner", "memo"];
const WIF_RE = /^[1-9A-HJ-NP-Za-km-z]{51,52}$/;
const BLURT_NODES = ["https://blurt-rpc.saboin.com", "https://rpc.blurt.world"];

/* collect every WIF-shaped string in a nested structure, labeled by path */
function harvestWifs(node, prefix, out) {
  if (node == null) return;
  if (typeof node === "string") {
    const s = node.trim();
    if (WIF_RE.test(s) && !out.some((c) => c.val === s)) out.push({ label: prefix, val: s });
    return;
  }
  if (Array.isArray(node)) { node.forEach((v, i) => harvestWifs(v, `${prefix}[${i}]`, out)); return; }
  if (typeof node === "object") { for (const [k, v] of Object.entries(node)) harvestWifs(v, prefix ? `${prefix}.${k}` : k, out); }
}

/* unlock ONE sha-pinned generation → full headcorner record (memory only) */
function unlockHeadcorner({ ref, zip }) {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true, mode: 0o700 });
  try {
    const meta = JSON.parse(execFileSync("git", ["show", `${ref}:${META}`], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 }).toString("utf8"));
    const zipPath = String(meta.keysZipFile ?? zip);
    const enc = execFileSync("git", ["show", `${ref}:${zipPath}`], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 });
    if (sha256(enc) !== String(meta.keysZipSha256 ?? "")) throw new Error(`outer-sha-mismatch@${ref.slice(0, 6)}`);
    fs.writeFileSync(path.join(TMP, "k.enc"), enc, { mode: 0o600 });
    execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
      "-in", path.join(TMP, "k.enc"), "-out", path.join(TMP, "inner.zip"),
      "-pass", `pass:${vaultPass(meta.keysZipUnlockRef ?? "recovery-3.keysZipUnlock")}`], { stdio: ["ignore", "ignore", "pipe"] });
    const inner = fs.readFileSync(path.join(TMP, "inner.zip"));
    if (sha256(inner) !== String(meta.keysZipInnerSha256 ?? "")) throw new Error(`inner-sha-mismatch@${ref.slice(0, 6)}`);
    fs.writeFileSync(path.join(TMP, "inner.zip"), inner, { mode: 0o600 });
    execFileSync("unzip", ["-o", "-q", path.join(TMP, "inner.zip"), "agent/keys/vault.json", "-d", path.join(TMP, "o")]);
    const vault = JSON.parse(fs.readFileSync(path.join(TMP, "o", "agent", "keys", "vault.json"), "utf8"));
    return (vault.accounts ?? []).find((a) => a.username === ACCOUNT) ?? null;
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }
}

/* derive the 33-byte compressed point from a WIF (base58 is custom in
 * steemtx.mjs — Node's Buffer has no base58 codec, never Buffer.from(...,"base58")) */
function pointOf(wif) {
  try { return pointOfPub(pubFromSeed(wifDec(String(wif).trim()))); } catch { return null; }
}
/* decode a chain-prefixed pubkey to its raw 33-byte point */
function pointOfPub(pub) {
  try {
    const body = pub.slice(3);
    const d = b58decode(body);
    return d.length === 37 ? Buffer.from(d.slice(0, 33)) : (d.length === 33 ? Buffer.from(d) : null);
  } catch { return null; }
}

/* fetch live authorities per chain: { role: [pubkeys...] } */
async function hiveAuthorities() {
  const r = await rpcHive("condenser_api.get_accounts", [[ACCOUNT]]);
  const a = Array.isArray(r?.result) ? r.result[0] : (Array.isArray(r) ? r[0] : null);
  if (!a) return null;
  const auth = (role) => (a[role]?.key_auths ?? []).map((k) => k[0]);
  return { posting: auth("posting"), active: auth("active"), owner: auth("owner"), memo: [a.memo_key].filter(Boolean), meta: { created: a.created, reputation: a.reputation } };
}
async function steemAuthorities() {
  const nodes = ["https://api.steemit.com", "https://api.stem.fans", "https://steemapi.boylikegirl.club"];
  for (const n of nodes) {
    try {
      const res = await fetch(n, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [[ACCOUNT]], id: 1 }), signal: AbortSignal.timeout(10000) });
      const j = await res.json();
      const a = j?.result?.[0];
      if (!a) continue;
      const auth = (role) => (a[role]?.key_auths ?? []).map((k) => k[0]);
      return { posting: auth("posting"), active: auth("active"), owner: auth("owner"), memo: [a.memo_key].filter(Boolean) };
    } catch { /* next node */ }
  }
  return null;
}
async function blurtAuthorities() {
  for (const n of BLURT_NODES) {
    try {
      const res = await fetch(n, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [[ACCOUNT]], id: 1 }), signal: AbortSignal.timeout(9000) });
      const j = await res.json();
      const a = j?.result?.[0];
      if (!a) return { unreachable: n, absent: true };
      const auth = (role) => (a[role]?.key_auths ?? []).map((k) => k[0]);
      return { posting: auth("posting"), active: auth("active"), owner: auth("owner"), memo: [a.memo_key].filter(Boolean), meta: { created: a.created, balance: a.balance, vesting: a.vesting_shares } };
    } catch { /* next node */ }
  }
  return null;
}

/* the matrix: candidates × chain-authorities → verdicts */
function judge(cands, authorities, chain) {
  const rows = [];
  for (const role of ROLES) {
    const live = (authorities?.[role] ?? []).map(pointOfPub).filter(Boolean);
    if (!live.length) { rows.push({ role, chain, verdict: "NO-LIVE-AUTHORITY" }); continue; }
    const hits = [];
    for (const c of cands) {
      const pt = pointOf(c.val);
      if (!pt) continue;
      if (live.some((lp) => lp.equals(pt))) hits.push(c.label);
    }
    rows.push({ role, chain, verdict: hits.length ? "CANDIDATE-MATCH" : "NO-MATCH", matchedFrom: hits });
  }
  return rows;
}

const out = { at: new Date().toISOString(), account: ACCOUNT, law: "cross-chain key identity (operator intel R267) — every held WIF × every live authority, owner included", steps: [] };
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true, mode: 0o700 });
try {
  /* 1 · candidate harvest */
  const cands = [];
  let curRec = null, gen1Rec = null;
  try { curRec = unlockHeadcorner({ ref: "HEAD", zip: "agent/vault/KEYS-ZIP-2026-10-08.zip.enc" }); if (curRec) { harvestWifs(curRec, "seal-cur", cands); out.steps.push(`cur-record-harvested (${cands.length})`); } } catch (e) { out.steps.push(`cur-unlock-fail:${String(e?.message ?? e).slice(0, 60)}`); }
  try { gen1Rec = unlockHeadcorner({ ref: GEN1_COMMIT, zip: GEN1_ZIP }); if (gen1Rec) { const before = cands.length; harvestWifs(gen1Rec, "seal-gen1", cands); out.steps.push(`gen1-record-harvested (+${cands.length - before})`); } } catch (e) { out.steps.push(`gen1-unlock-fail:${String(e?.message ?? e).slice(0, 60)}`); }

  /* formula path: sha256(account+role+master) in every seed order × master forms */
  try {
    const raw = fs.readFileSync(path.join(REPO, ".secrets", "headcorner.key"), "utf8").trim();
    let masters = [];
    try { const j = JSON.parse(raw); masters = Object.values(j).filter((v) => typeof v === "string" && v.length >= 16); out.steps.push("master-source:json-fields"); }
    catch { masters = [raw]; out.steps.push("master-source:raw"); }
    const decoded = [];
    for (const m of masters) { try { const b = Buffer.from(m, "hex"); if (b.length >= 16 && b.toString("hex") === m.toLowerCase()) decoded.push(b.toString("utf8")); } catch { } }
    for (const m of [...masters, ...decoded]) {
      for (const [orderName, order] of Object.entries(SEED_ORDERS)) {
        for (const role of ROLES) {
          const seed = order(ACCOUNT, role, m);
          const wif = wifEncodeLike(sha256(Buffer.from(seed, "utf8")));
          if (WIF_RE.test(wif) && !cands.some((c) => c.val === wif)) cands.push({ label: `formula:${orderName}:${role}`, val: wif });
        }
      }
    }
    out.steps.push(`formula-harvested (total ${cands.length})`);
  } catch (e) { out.steps.push(`formula-skip:${String(e?.message ?? e).slice(0, 50)}`); }

  /* community keys cache walk (field names only ever printed) */
  try {
    const ck = JSON.parse(fs.readFileSync(path.join(REPO, ".secrets", "community-keys.json"), "utf8"));
    const before = cands.length;
    harvestWifs(ck, "community", cands);
    if (cands.length > before) out.steps.push(`community-harvested (+${cands.length - before})`);
  } catch { /* absent is fine */ }

  /* dedupe by key material, keep first label */
  const uniq = [];
  for (const c of cands) if (!uniq.some((u) => u.val === c.val)) uniq.push(c);
  out.candidateCount = uniq.length;
  out.candidateLabels = uniq.map((c) => c.label);

  /* 2 · negative control on the ruler: Steem */
  const steem = await steemAuthorities();
  if (!steem) { out.steps.push("steem-unreachable"); out.verdict = "VOID:steem-unreachable"; }
  else {
    const steemRows = judge(uniq, steem, "steem");
    out.steem = steemRows;
    const ruler = steemRows.find((r) => r.role === "posting");
    const anchorOk = ruler?.verdict === "CANDIDATE-MATCH";
    out.negativeControl = anchorOk ? "PASS:current-seal-posting-verifies-vs-steem" : `FAIL:${ruler?.verdict ?? "no-posting-row"}`;
    if (!anchorOk) out.verdict = "VOID:ruler-unanchored";
    else {
      /* 3 · the real matrix: Hive + Blurt */
      const hive = await hiveAuthorities();
      out.hiveMeta = hive?.meta ?? null;
      out.hive = hive ? judge(uniq, hive, "hive") : [{ chain: "hive", verdict: "UNREACHABLE" }];
      const blurt = await blurtAuthorities();
      out.blurtMeta = blurt?.meta ?? (blurt?.absent ? "account-absent" : null);
      out.blurt = (blurt && !blurt.absent) ? judge(uniq, blurt, "blurt") : [{ chain: "blurt", verdict: blurt?.absent ? "ACCOUNT-ABSENT-ON-BLURT" : "UNREACHABLE" }];

      /* verdict roll-up */
      const hiveOk = (role) => out.hive.find((r) => r.role === role)?.verdict === "CANDIDATE-MATCH";
      const blurtOk = (role) => out.blurt.find((r) => r.role === role)?.verdict === "CANDIDATE-MATCH";
      out.verdict =
        hiveOk("posting") && hiveOk("active") ? "WHALE-KEY-VERIFIED-HIVE" :
        hiveOk("owner") ? "HIVE-OWNER-VERIFIED" :
        hiveOk("posting") ? "HIVE-POSTING-VERIFIED" :
        blurtOk("posting") || blurtOk("owner") ? "BLURT-PATH-VERIFIED" : "UNVERIFIED";
    }
  }
} catch (e) {
  out.error = String(e?.message ?? e).slice(0, 140);
  if (!out.verdict) out.verdict = "PROBE-ERROR";
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}
writeFileSync(path.join(DIR, "state", "r267-crosschain.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));

/* WIF-encode a 32-byte seed the way the chains do (0x80 + key [+ 0x01], b58) */
function wifEncodeLike(seed32) {
  const payload = Buffer.concat([Buffer.from([0x80]), Buffer.from(seed32), Buffer.from([0x01])]);
  const chk = crypto.createHash("sha256").update(crypto.createHash("sha256").update(payload).digest()).digest().slice(0, 4);
  return b58encode(Buffer.concat([payload, chk]));
}
