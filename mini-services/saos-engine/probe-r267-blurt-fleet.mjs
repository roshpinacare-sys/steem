/**
 * probe-r267-blurt-fleet.mjs — FLEET-WIDE BLURT CUSTODY MATRIX (memory-only, READ-ONLY).
 *
 * R267 measured: headcorner's GEN-1 keys.steem.* verify 4/4 against the LIVE
 * BLURT authorities (posting+active+owner+memo) — the operator's cross-chain
 * identity law, proven. Blurt is the 2020 fork snapshot: every Steem account
 * that existed pre-fork was cloned there with its 2020-era authorities.
 *
 * This probe: unlock BOTH seal generations (sha-pinned, memory-only) → for
 * ALL 15 vault accounts collect every WIF candidate → ask Blurt which of the
 * 15 exist → judge every existing account's live authorities (all roles)
 * against every candidate. The whole army might have sleeping 2020-era
 * bodies on Blurt — or only headcorner. Either answer is measured, not
 * guessed. Verdicts → state/r267-blurt-fleet.json. Zero key bytes leave
 * memory; zero broadcasts.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { pubkeyFromSeed as pubFromSeed, wifDecode as wifDec, b58decode } from "./steemtx.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.join(DIR, "..", "..");
const GEN1_COMMIT = "1c9f00d0";
const GEN1_ZIP = "agent/vault/KEYS-ZIP-2026-09-10.zip.enc";
const META = "agent/recovery-meta.json";
const TMP = path.join(REPO, ".secrets", "r267-fleet-tmp");
const BLURT_NODES = ["https://blurt-rpc.saboin.com", "https://rpc.blurt.world"];
const WIF_RE = /^[1-9A-HJ-NP-Za-km-z]{51,52}$/;
const ROLES = ["posting", "active", "owner", "memo"];
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

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

function unlockVault({ ref, zip }) {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true, mode: 0o700 });
  try {
    const meta = JSON.parse(execFileSync("git", ["show", `${ref}:${META}`], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 }).toString("utf8"));
    const zipPath = String(meta.keysZipFile ?? zip);
    const enc = execFileSync("git", ["show", `${ref}:${zipPath}`], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 });
    if (sha256(enc) !== String(meta.keysZipSha256 ?? "")) throw new Error(`outer-sha@${ref.slice(0, 6)}`);
    fs.writeFileSync(path.join(TMP, "k.enc"), enc, { mode: 0o600 });
    execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
      "-in", path.join(TMP, "k.enc"), "-out", path.join(TMP, "inner.zip"),
      "-pass", `pass:${meta.keysZipPass}`], { stdio: ["ignore", "ignore", "pipe"] });
    const inner = fs.readFileSync(path.join(TMP, "inner.zip"));
    if (sha256(inner) !== String(meta.keysZipInnerSha256 ?? "")) throw new Error(`inner-sha@${ref.slice(0, 6)}`);
    fs.writeFileSync(path.join(TMP, "inner.zip"), inner, { mode: 0o600 });
    execFileSync("unzip", ["-o", "-q", path.join(TMP, "inner.zip"), "agent/keys/vault.json", "-d", path.join(TMP, "o")]);
    return JSON.parse(fs.readFileSync(path.join(TMP, "o", "agent", "keys", "vault.json"), "utf8"));
  } finally { fs.rmSync(TMP, { recursive: true, force: true }); }
}

function pointOfPub(pub) {
  try { const d = b58decode(String(pub).slice(3)); return d.length === 37 ? Buffer.from(d.slice(0, 33)) : (d.length === 33 ? Buffer.from(d) : null); }
  catch { return null; }
}
function pointOf(wif) {
  try { return pointOfPub(pubFromSeed(wifDec(String(wif).trim()))); } catch { return null; }
}

async function blurtRpc(method, params) {
  for (const n of BLURT_NODES) {
    try {
      const res = await fetch(n, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(12000) });
      const j = await res.json();
      if (j?.result !== undefined) return j.result;
      if (j?.error) return { __err: j.error.message?.slice(0, 80) };
    } catch { /* next */ }
  }
  return null;
}

const out = { at: new Date().toISOString(), law: "fleet-wide Blurt custody (R267): which pre-fork bodies exist and whose keys open them", accounts: [] };
try {
  const cur = unlockVault({ ref: "HEAD", zip: "agent/vault/KEYS-ZIP-2026-10-08.zip.enc" });
  let gen1 = null;
  try { gen1 = unlockVault({ ref: GEN1_COMMIT, zip: GEN1_ZIP }); } catch { /* GEN-1 optional */ }
  const allNames = [...new Set([...(cur.accounts ?? []), ...((gen1?.accounts ?? []))].map((a) => a.username))].filter(Boolean);
  out.vaultAccounts = allNames;

  /* who exists on Blurt (the 2020 snapshot only carries pre-fork bodies) */
  const live = await blurtRpc("condenser_api.get_accounts", [allNames]);
  const liveList = Array.isArray(live) ? live : [];
  out.existingOnBlurt = liveList.map((a) => a.name);
  out.absentOnBlurt = allNames.filter((n) => !out.existingOnBlurt.includes(n));

  for (const acc of liveList) {
    const cands = [];
    for (const [srcName, vault] of [["seal-cur", cur], ["seal-gen1", gen1]]) {
      if (!vault) continue;
      const rec = (vault.accounts ?? []).find((a) => a.username === acc.name);
      if (rec) harvestWifs(rec, srcName, cands);
    }
    const row = { account: acc.name, created: acc.created, vesting: acc.vesting_shares, balance: acc.balance, roles: {} };
    for (const role of ROLES) {
      const auths = role === "memo" ? [acc.memo_key].filter(Boolean) : (acc[role]?.key_auths ?? []).map((k) => k[0]);
      const livePts = auths.map(pointOfPub).filter(Boolean);
      if (!livePts.length) { row.roles[role] = "NO-LIVE-AUTHORITY"; continue; }
      const hits = cands.filter((c) => { const p = pointOf(c.val); return p && livePts.some((lp) => lp.equals(p)); }).map((c) => c.label);
      row.roles[role] = hits.length ? `CANDIDATE-MATCH:${hits.join(",")}` : "NO-MATCH";
    }
    const vals = Object.values(row.roles);
    row.verdict = vals.filter((v) => v.startsWith("CANDIDATE-MATCH")).length === vals.filter((v) => v !== "NO-LIVE-AUTHORITY").length && vals.some((v) => v.startsWith("CANDIDATE-MATCH"))
      ? "FULL-ACCESS" : (vals.some((v) => v.startsWith("CANDIDATE-MATCH")) ? "PARTIAL" : "NO-ACCESS");
    out.accounts.push(row);
  }
  out.verdict = out.accounts.some((a) => a.verdict === "FULL-ACCESS") ? "BLURT-BODIES-UNDER-CUSTODY" : (out.accounts.length ? "BODIES-EXIST-KEYS-ELSEWHERE" : "NO-BLURT-BODIES");
} catch (e) {
  out.error = String(e?.message ?? e).slice(0, 140);
  out.verdict = "PROBE-ERROR";
}
writeFileSync(path.join(DIR, "state", "r267-blurt-fleet.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
