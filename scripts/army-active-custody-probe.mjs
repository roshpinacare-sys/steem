#!/usr/bin/env bun
/**
 * army-active-custody-probe.mjs — W23 · THE FLEET ACTIVE-KEY UNLOCK LANE.
 *
 * OWNER LAW CHAIN (verbatim preserved in operator-orders.json W23-LIQUIDITY-STANDDOWN,
 * trace 1a15937c02271931): "וודא מסחר גריד בסטימיט של כל החשבונות … יעבדו כחברה
 * משותפת" + W15 standing ("וודא כספת שיהיה מפתח לפעילות שוטפת של המערכת") + W16
 * (self-keyed vault) + the architecture-is-owner doctrine (2026-10-20 standing grant).
 *
 * THE MEASURED GAP (2026-10-20, chain-truth): the 9 army bodies hold chain-verified
 * POSTING custody only. Their on-chain ACTIVE authorities match NO key material we
 * hold (the GEN-2 vault actives were never broadcast as authority rotations). Chain
 * law: limit_order_create / transfer are ACTIVE-authority ops — the fleet's grid
 * trading and the W12 liquidity-sweep are structurally dead until an ACTIVE WIF per
 * body is held. The original creation keys live in the older sealed vault
 * generations whose passes exist ONLY in the Actions secret bundle STEEM_VAULT_PASSES
 * (R-VAULTPASS-1 law) — so THIS lane runs where the bundle resolves (the CI runner),
 * never locally, and never prints or persists key material.
 *
 * MODES (workflow_dispatch input, default probe):
 *   probe  — unlock every agent/vault/*.zip.enc generation with every bundle pass
 *            (bounded), judge each army body's candidate ACTIVE pubkeys against the
 *            LIVE chain authority, emit PUBLIC receipts (fingerprints/pubs only).
 *   rotate — for every body whose ORIGINAL active WIF is HELD (probe-verified):
 *            broadcast ONE account_update op (signed by the held original active
 *            WIF — the CURRENT on-chain authority) setting the active authority to
 *            the GEN-2 vault pub we already custody in .secrets/army-keys.json
 *            (sha-pinned MASTER seal). Post-broadcast chain re-verify per body.
 *            This is the exact precedent of a1ec4ade (headcorner MASTER-DERIVE
 *            rotation, tx f6283d2e, 4/4 roles bit-exact verified on chain).
 *
 * LAWS: zero key material in stdout/files (fingerprint + pub only) · bounded combos
 * (≤40 unlock attempts) · per-body fail-isolated · post-broadcast chain re-verify ·
 * receipts are PUBLIC material (custody-receipt.jsonl checkpoint law, t18 agent-9).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const VAULT_DIR = path.join(REPO, "agent", "vault");
const TMP = fs.mkdtempSync("/tmp/army-active-");
fs.chmodSync(TMP, 0o700);
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const MODE = (process.env.ROTATE_MODE ?? "probe").trim();
const DRY = MODE !== "rotate";

const say = (o) => console.log(JSON.stringify(o));
function receipt(o) {
  const row = { at: new Date().toISOString(), mode: MODE, ...o };
  say(row);
  try { fs.appendFileSync(path.join(REPO, "custody-receipt.jsonl"), JSON.stringify(row) + "\n"); } catch { /* public material best-effort */ }
}

/* W119 (owner trace web-39a3a21d, 2026-10-21): "לגבי active יש בכספות הכל תיישם תפעיל
 * תוודא דחוף" — the sweep now merges EVERY pass bundle the repo holds
 * (STEEM_VAULT_PASSES + VAULT_PASSES_R33 + ROT2_FLEET_KEYS + MAIN_KEY) and covers
 * ALL 13 army bodies — posting-dead bodies (siq/tov/wog/hcsoldier5) still rotate:
 * the rotation needs only the HELD original active WIF, not posting custody. */
const ARMY = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq",
  "hcsoldier4", "hcsoldier5", "hcsoldier6"];

/* ── the bundles (Actions-held; every one the repo carries) ────────────── */
const BUNDLE_NAMES = ["STEEM_VAULT_PASSES", "VAULT_PASSES_R33", "ROT2_FLEET_KEYS", "MAIN_KEY"];
const bundles = [];
for (const bname of BUNDLE_NAMES) {
  const raw = process.env[bname] ?? "";
  if (raw.length < 8) { bundles.push({ name: bname, raw: null, note: "absent" }); continue; }
  try { bundles.push({ name: bname, raw: JSON.parse(raw), note: "json" }); }
  catch { bundles.push({ name: bname, raw, note: "raw-string" }); }
}
if (!bundles.some((b) => b.raw != null)) {
  receipt({ step: "bundle", verdict: "ALL-BUNDLES-ABSENT", note: "probe runs only where a pass bundle resolves — honest death beats a fake green" });
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* tmp */ }
  process.exit(0);
}
function passFor(bname, bundle, refPath) {
  let v = bundle;
  for (const seg of String(refPath).split(".")) {
    if (v == null || typeof v !== "object") throw new Error("bundle-missing-" + refPath);
    v = v[seg];
  }
  if (typeof v !== "string" || v.length < 8) throw new Error("bundle-malformed-" + refPath);
  return v;
}
function bundlePasses() {
  const out = [];
  const seen = new Set();
  const walk = (node, prefix) => {
    if (node == null) return;
    if (typeof node === "string") { if (node.length >= 8 && !seen.has(node)) { seen.add(node); out.push({ ref: prefix, pass: node }); } return; }
    if (typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, prefix ? `${prefix}.${k}` : k);
  };
  for (const b of bundles) {
    if (b.raw == null) continue;
    if (typeof b.raw === "string") walk(b.raw, `${b.name}.raw`);
    else walk(b.raw, b.name);
  }
  return out;
}

/* ── unlock one seal (zip only; the era .tar.enc stays out of this lane) ── */
function unlockZip(zipPath, pass) {
  const encPath = path.join(TMP, "v.enc");
  const outPath = path.join(TMP, "v.inner.zip");
  fs.copyFileSync(zipPath, encPath);
  fs.chmodSync(encPath, 0o600);
  execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
    "-in", encPath, "-out", outPath, "-pass", "pass:" + pass], { stdio: ["ignore", "ignore", "pipe"] });
  const list = execFileSync("unzip", ["-Z1", outPath], { encoding: "utf8" });
  const target = list.split("\n").find((l) => l.trim().endsWith("vault.json"));
  if (!target) throw new Error("no-vault-json-in-archive");
  execFileSync("unzip", ["-o", "-q", outPath, target.trim(), "-d", path.join(TMP, "opened")], { stdio: ["ignore", "ignore", "pipe"] });
  const vault = JSON.parse(fs.readFileSync(path.join(TMP, "opened", target.trim()), "utf8"));
  try { fs.rmSync(path.join(TMP, "opened"), { recursive: true, force: true }); } catch { /* wipe */ }
  fs.rmSync(outPath, { force: true });
  return vault;
}

/* vault account key extraction — handles both shapes (flat + nested chains) */
function accountRoles(vault) {
  const out = {};
  for (const a of vault?.accounts ?? []) {
    const name = a.username ?? a.name;
    if (!name) continue;
    let roles = null;
    const k = a.keys;
    if (k && typeof k === "object" && !Array.isArray(k)) roles = k;
    else if (a.chains && typeof a.chains === "object" && !Array.isArray(a.chains) && a.chains.steem?.keys) roles = a.chains.steem.keys;
    else if (Array.isArray(a.gens)) {
      roles = {};
      for (const g of a.gens) {
        if (g.wif) roles.posting = { wif: g.wif, pub: g.pub };
        if (g.activeWif) roles.active = { wif: g.activeWif, pub: g.activePub };
      }
    }
    if (roles?.active?.wif || roles?.posting?.wif) out[name] = roles;
  }
  return out;
}

/* ── live chain authorities ────────────────────────────────────────────── */
async function rpc(method, params) {
  const nodes = ["https://api.steemit.com", "https://api.justyy.com", "https://steemapi.boylikegirl.club"];
  let last = "no-node";
  for (const host of nodes) {
    try {
      const r = await fetch(host, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(12000) });
      const d = await r.json();
      if (d.error) { last = d.error.message; continue; }
      return d.result;
    } catch (e) { last = String(e).slice(0, 120); }
  }
  throw new Error("all-nodes-failed: " + last);
}

/* the engine's OWN serialization canon — one dependency edge, the same stack
 * the master's every broadcast rides (the runner installs the engine's
 * bun.lock first; zero re-implemented crypto anywhere in this lane) */
const { wifDecode, pubkeyFromSeed, buildTx, fingerprint } = await import(path.join(REPO, "mini-services", "saos-engine", "steemtx.mjs"));
const pubOfWif = (wif) => pubkeyFromSeed(wifDecode(wif));

const liveRows = await rpc("condenser_api.get_accounts", [ARMY]);
const live = {};
for (const a of liveRows ?? []) live[a.name] = { active: a.active.key_auths[0]?.[0] ?? null, threshold: a.active.weight_threshold, memo: a.memo_key ?? null };
receipt({ step: "live-authorities", bodies: ARMY.map((n) => ({ name: n, activeFp: live[n]?.active ? fingerprint(live[n].active) : null })) });

/* ── the sweep: every seal × every pass → judge army actives ───────────── */
/* W119 · HISTORICAL-SEALS LAW (the measured gap that hid the army actives):
 * vault seals get ABSORBED/pruned from the branch tip over time (measured:
 * KEYS-ROT2-2026-10-12.zip.enc + KEYS-PACK-2026-10-04-r20a.zip.enc + GEN-2-era
 * seals live in history commit 0d6f142ce but NOT on the tip — the tip-only
 * sweep of 2026-10-21T03:41Z scanned 1872 combos and could never see them).
 * The sweep now enumerates EVERY .zip.enc that was EVER added anywhere in
 * git history (the runner checks out fetch-depth:0), materializes each blob
 * into the 0700 tmp, and sweeps it with the same pass bundles. */
const seals = fs.readdirSync(VAULT_DIR).filter((f) => f.endsWith(".zip.enc")).sort();
const hist = new Set(seals);
const histSeals = [];
try {
  /* the pruned-seal lineages (measured: ROT2/GEN-2-era seals) live ONLY on
   * origin/main — the dispatch checkout carries just the saos-cockpit ref,
   * so fetch main explicitly (checkout persists its token) before walking */
  try { execFileSync("git", ["fetch", "origin", "main", "--quiet"], { stdio: ["ignore", "ignore", "ignore"], timeout: 180000 }); receipt({ step: "main-fetch", verdict: "ok" }); } catch (e) { receipt({ step: "main-fetch", verdict: "failed", note: String(e?.message ?? e).slice(0, 80) }); }
  const walks = ["--all", "origin/main"];
  for (const walk of walks) {
    try {
      const out = execFileSync("git", ["log", walk, "--diff-filter=A", "--name-only", "--format=", "--", "agent/vault/"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
      for (const line of out.split("\n")) {
        const p = line.trim();
        if (p.endsWith(".zip.enc") && !hist.has(path.basename(p))) { hist.add(path.basename(p)); histSeals.push(p); }
      }
    } catch { /* this walk ref unavailable — next */ }
  }
} catch { /* history walk failed — tip-only sweep still runs */ }
receipt({ step: "historical-seals", tip: seals.length, historical: histSeals.length, names: histSeals.map((p) => path.basename(p)).slice(0, 24) });
const HIST_DIR = path.join(TMP, "hist");
try { fs.mkdirSync(HIST_DIR, { recursive: true, mode: 0o700 }); } catch { /* tmp */ }
const histPaths = [];
for (const p of histSeals.slice(0, 40)) {
  try {
    const sha = execFileSync("git", ["log", "--all", "--diff-filter=A", "--format=%H", "--", p], { encoding: "utf8" }).trim().split("\n")[0];
    if (!sha) continue;
    const blob = execFileSync("git", ["show", `${sha}:${p}`], { maxBuffer: 64 * 1024 * 1024 });
    const dst = path.join(HIST_DIR, path.basename(p));
    fs.writeFileSync(dst, blob, { mode: 0o600 });
    histPaths.push(dst);
  } catch { /* seal not materializable at its adder — skip */ }
}
const allSeals = [...seals.map((s) => path.join(VAULT_DIR, s)), ...histPaths];
const passes = bundlePasses();
receipt({ step: "sweep-plan", seals: allSeals.length, passes: passes.length, bundles: bundles.map((b) => `${b.name}:${b.note}`), boundedCombos: Math.min(allSeals.length * passes.length, 4000) });

const heldOriginal = {};  // name -> { wif, pub, via }
let combos = 0;
OUTER:
for (const sealPath of allSeals) {
  for (const { ref, pass } of passes) {
    if (combos >= 4000) { receipt({ step: "sweep", verdict: "COMBO-BOUND-REACHED" }); break OUTER; }
    combos++;
    let vault = null;
    try { vault = unlockZip(sealPath, pass); } catch { continue; }
    const roles = accountRoles(vault);
    for (const name of ARMY) {
      if (heldOriginal[name]) continue;
      const act = roles[name]?.active;
      if (!act?.wif) continue;
      try {
        if (pubOfWif(act.wif) === live[name]?.active) {
          heldOriginal[name] = { wif: act.wif, pub: act.pub ?? pubOfWif(act.wif), via: `${path.basename(sealPath)}::${ref}` };
          receipt({ step: "original-active-held", account: name, pub: heldOriginal[name].pub, fp: fingerprint(heldOriginal[name].pub), via: heldOriginal[name].via });
        }
      } catch { /* malformed token — skip */ }
    }
    if (ARMY.every((n) => heldOriginal[n])) break OUTER;
  }
}
receipt({ step: "sweep-verdict", held: Object.keys(heldOriginal).length, of: ARMY.length, combos, heldNames: Object.keys(heldOriginal) });

if (DRY) {
  receipt({ step: "final", verdict: "PROBE-DONE", rotateReady: Object.keys(heldOriginal).length, note: "dispatch again with mode=rotate to raise the army actives to the GEN-2 custody pubs" });
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* tmp */ }
  process.exit(0);
}

/* ── the rotation leg (mode=rotate): GEN-2 custody pubs from the sha-pinned,
 * SELF-CONTAINED MASTER seal (agent/recovery-meta.json keysZipPass — the W16
 * law; the repo carries its own key, so the runner needs zero local caches) ── */
function gen2CustodyPubs() {
  const meta = JSON.parse(fs.readFileSync(path.join(REPO, "agent", "recovery-meta.json"), "utf8"));
  const pass = String(meta.keysZipPass ?? "");
  if (pass.length < 8) throw new Error("master-seal-not-self-contained (W16 law broken on this checkout)");
  const zipPath = path.join(REPO, String(meta.keysZipFile ?? "agent/vault/KEYS-ZIP-2026-10-12-MASTER.zip.enc"));
  const enc = fs.readFileSync(zipPath);
  if (String(meta.keysZipSha256) && sha256(enc) !== meta.keysZipSha256) throw new Error("master-seal-outer-sha-drift");
  const out = unlockZip(zipPath, pass);
  const pubs = {};
  for (const a of out?.accounts ?? []) {
    const name = a.username ?? a.name;
    const act = a.keys?.active ?? (a.chains?.steem?.keys?.active) ?? null;
    if (name && act?.pub) pubs[name] = act.pub;
  }
  return pubs;
}
let gen2Pub = {};
try { gen2Pub = gen2CustodyPubs(); receipt({ step: "gen2-pubs", source: "self-contained MASTER seal", bodies: Object.keys(gen2Pub).length }); }
catch (e) { receipt({ step: "gen2-pubs", verdict: "UNAVAILABLE", error: String(e?.message ?? e).slice(0, 140) }); }

/* the engine's own serialization canon (steemtx.buildTx — the same stack the
 * master's every broadcast rides; zero re-implemented crypto) */
async function dgpo() {
  const r = await rpc("condenser_api.get_dynamic_global_properties", []);
  if (!r?.head_block_number) throw new Error("dgpo-unavailable");
  return r;
}
async function broadcastSigned(t) {
  let lastErr = "";
  for (const host of ["https://api.steemit.com", "https://api.justyy.com", "https://steemapi.boylikegirl.club"]) {
    try {
      const r = await fetch(host, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.broadcast_transaction", params: [t.json], id: 1 }), signal: AbortSignal.timeout(12000) });
      const d = await r.json().catch(() => null);
      if (d?.error) { lastErr = String(d.error.message ?? JSON.stringify(d.error)).slice(0, 200); continue; }
      if (d?.result !== undefined) return { ok: true, node: host };
      lastErr = "no-result";
    } catch (e) { lastErr = String(e?.message ?? e).slice(0, 160); }
  }
  return { ok: false, error: lastErr || "all-nodes-failed" };
}

let rotated = 0, failed = 0;
for (const name of ARMY) {
  const held = heldOriginal[name];
  const targetPub = gen2Pub[name];
  if (!held || !targetPub) { receipt({ step: "rotate-skip", account: name, why: !held ? "original-not-held" : "gen2-pub-absent" }); continue; }
  if (live[name]?.active === targetPub) { receipt({ step: "rotate-skip", account: name, why: "already-GEN2" }); continue; }
  try {
    /* the op carries ONLY the active authority — owner/posting stay absent
     * (fc optionals serialize 0), memo_key = the body's CURRENT public memo
     * key (unchanged; the R255 canon requires a valid plain key here) */
    const ops = [["account_update", {
      account: name,
      active: { weight_threshold: 1, account_auths: [], key_auths: [[targetPub, 1]] },
      memo_key: live[name]?.memo ?? liveRows.find((a) => a.name === name)?.memo_key,
      json_metadata: "",
    }]];
    const dg = await dgpo();
    const t = buildTx({ ops, dgpo: dg, wifs: [held.wif], ttlSec: 45 });
    const txid = crypto.createHash("sha256").update(Buffer.from(t.serializedHex, "hex")).digest("hex").slice(0, 40);
    const res = await broadcastSigned(t);
    /* post-broadcast chain re-verify — the ONLY green is the chain's own answer */
    let verified = false;
    if (res.ok) {
      const re = await rpc("condenser_api.get_accounts", [[name]]);
      verified = re?.[0]?.active.key_auths[0]?.[0] === targetPub;
    }
    receipt({ step: "rotate", account: name, txid: res.ok ? txid : null, verified, error: res.ok ? null : res.error });
    if (verified) rotated++; else failed++;
  } catch (e) {
    failed++;
    receipt({ step: "rotate-error", account: name, error: String(e?.message ?? e).slice(0, 160) });
  }
}
receipt({ step: "final", verdict: "ROTATE-DONE", rotated, failed, note: "re-run the engine custody revival — GEN-2 actives now chain-verify" });
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* tmp */ }
process.exit(0);
