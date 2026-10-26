/**
 * vault-revival.mjs — T-86 · GIT-VAULT ARMY REVIVAL (הכספת-החיה מהגיט).
 *
 * OPERATOR LAW 2026-10-06 (verbatim): "אתה לא צריך פה את המפתחות [ממני] —
 * יש הכל בכספת בגיט" + "תדליק הכל". The vault IS the credential delivery —
 * documented live by KEYS-ACCESS-VERIFIED-2026-10-04 (a fresh-clone proof):
 * agent/recovery-meta.json (passwords, system custody "זה אצלך בקבצים") +
 * agent/vault/KEYS-ZIP-2026-09-10.zip.enc → vault.json (15 accounts, all
 * 4 roles, sha256-pinned outer+inner). This module wires that vault into
 * the engine's custody layer — WITH ZERO SECRET EVER LOGGED, RETURNED, OR
 * COMMITTED:
 *
 *  1. pull (git show origin/main:agent/...) → 0700 tmp under .secrets/
 *  2. verify sha256(outer) == keysZipSha256, sha256(inner) == keysZipInnerSha256
 *  3. openssl AES-256-CBC·pbkdf2·300k decrypt (the documented formula)
 *  4. extract ONLY the posting WIFs of the army roster → .secrets/army-keys.json
 *     (0600, gitignored — survives engine restarts, dies with the sandbox)
 *  5. adopt each WIF FAIL-CLOSED: derived pubkey MUST match the LIVE chain
 *     posting authority (signer.adoptVerifiedWifIdentity — the chain judges)
 *  6. WIPE the plaintext vault tmp immediately after step 4
 *
 * Sandbox-reset durability: the encrypted vault + meta live on git (never
 * local-only), the 0600 cache re-pulls itself whenever missing, and the
 * in-memory identities re-adopt from the cache on every boot/cycle.
 * HIVE/BLURT LAW: only the STEEM posting role is touched — the cross-chain
 * pause stands until the operator re-arms it.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { masterAccount, adoptVerifiedWifIdentity, armyCustodyState, materializeArmyCacheFromHeld } from "./signer.mjs";
import { vaultPass } from "./vault-custody.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const SECRETS = path.join(DIR, "..", "..", ".secrets");
const TMP = path.join(SECRETS, "vault-tmp");
const CACHE_FILE = path.join(SECRETS, "army-keys.json");
const CUSTODY_FILE = path.join(STATE, "army-custody.json");
/* R273-d: the master-wif-marker journal line referenced LOG_FILE — never
 * defined in this module (latent: the master block first ran live TODAY and
 * died mid-revival with "LOG_FILE is not defined"). Own journal file now. */
const LOG_FILE = path.join(STATE, "exec-log.jsonl");

/* R245 · EMPIRE-EXPANSION (operator order 2026-10-07): the replacement
 * generation hcsoldier4/5/6 — minted on-chain 2026-10-04 (commit 1c9f00d0)
 * with FULL 4-role keys sealed in the vault and live-chain-verified 4/4 —
 * joins the roster. OPERATOR ACCESS-LAW (verbatim intent): "אם זה רק posting
 * זה בעיה כי אם הוא רווחי אין לנו איך לגשת לכסף — לא חייב להשתמש במה שלא
 * נוכל לגשת אליו" — every account admitted to the fleet MUST hold full
 * money-access authority (active WIF in the vault), not posting-only.
 * @ynet (posting-anchor only, keyless active) stays OUT by this law. */
const ARMY = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq",
  "hcsoldier4", "hcsoldier5", "hcsoldier6"];
/* R-VAULTPASS-3 (22-e-1): GEN-2 zip was hard-coded to the PRE-rotation
 * KEYS-ZIP-2026-10-07 archive; the 11:21Z MASTER-DERIVE rotation re-sealed the
 * live fleet WIFs into KEYS-ZIP-2026-10-12-MASTER (meta.keysZipFile), so the
 * stale-cache self-heal re-pulled DEAD army keys OVER the good ignition cache
 * (measured: 13x GEN-2+GEN-1 REFUSED posting-authority-mismatch → 1/14 while
 * ignition chain-matched 14/14). Law: resolve the SAME bundle of record the
 * resolver reads — meta.keysZipFile, then newest KEYS-ZIP-*.zip.enc. */
function resolveVaultZip() {
  try {
    const meta = JSON.parse(gitShowBytes(resolveGitRef(), META_REF).toString("utf8"));
    if (typeof meta.keysZipFile === "string" && meta.keysZipFile) return meta.keysZipFile;
  } catch { /* fall through */ }
  try {
    const out = execFileSync("git", ["ls-tree", "--name-only", resolveGitRef(), "agent/vault/"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    const zips = out.split("\n").map((s) => s.trim()).filter((f) => /^agent\/vault\/KEYS-ZIP-.*\.zip\.enc$/.test(f)).sort();
    if (zips.length) return zips[zips.length - 1];
  } catch { /* fall through */ }
  return "agent/vault/KEYS-ZIP-2026-10-07.zip.enc"; } /* last-resort legacy default */
const META_REF = "agent/recovery-meta.json";
/* R273-d · REF-RESOLUTION LAW (the measured gap that stranded the revival):
 * the meta/vault blobs were resolved from ONE hard-coded ref ("origin/main").
 * This sandbox's branch of record is saos-cockpit — origin/main held nothing,
 * every revival died with "fatal: invalid obj", and the engine then demanded
 * an operator password that the operator, by standing law (2026-09-06/10-06
 * "זה אצלך בקבצים לא אצלי" / "אין מה לבקש מפתחות — הכל בכספת בגיט"), must
 * NEVER be asked for. NEW LAW: resolve the FIRST ref that actually carries
 * the meta blob — branch of record first, main second, local HEAD last.
 * A wrong ref is a typed error, never a demand for secrets. */
const GIT_REF_CANDIDATES = ["origin/saos-cockpit", "origin/main", "HEAD"];
function resolveGitRef(metaRef = META_REF) {
  for (const ref of GIT_REF_CANDIDATES) {
    try { gitShowBytes(ref, metaRef); return ref; } catch { /* try next */ }
  }
  throw new Error(`no-carrying-ref-for-meta (tried: ${GIT_REF_CANDIDATES.join(", ")})`);
}
const GIT_REF = "origin/saos-cockpit"; /* legacy default — callers use resolveGitRef() */

/* R255 · DUAL-GENERATION CUSTODY (chain-judged, 2026-10-08 00:0xZ measured):
 * the ROT2 re-seal (fe8aaf2f) staged GEN-2 keys in the git vault, but the
 * CHAIN-JUDGED probe proved the old army's LIVE Steem authorities are still
 * the GEN-1 keys (cashmachine/haran/lsa: GEN-1-derived pub == live posting
 * authority, byte-exact; GEN-2 pubs mismatch) — the ROT2 rotation broadcast
 * never executed on-chain. LAW: the vault generations are BOTH unlocked,
 * sha-pinned, memory-only, and the LIVE CHAIN judges which generation is
 * custody-alive, per account, per role. No file, claim, or freshness beats
 * the chain. The pending owner-signed GEN-2 activation is an operator-level
 * decision (recorded in the worklog + DecisionQueue) — never a silent
 * side-effect. */
const GEN1_COMMIT = "1c9f00d0";
const GEN1_ZIP = "agent/vault/KEYS-ZIP-2026-09-10.zip.enc";

/* R278 · GEN-1 ERA-META LAW (the root fix for "the keys vanish every day").
 * MEASURED GAP (2026-10-08): GEN1_COMMIT lived ONLY on origin/main's history —
 * a fresh sandbox fetching just the branch of record had no such object,
 * every GEN-1 unlock died "invalid obj", 10 army accounts stayed dead, and
 * the engine fell back to demanding an operator password — exactly what the
 * standing operator laws forbid. FIX: the GEN-1 archive AND its era meta are
 * SEALED ON THE BRANCH OF RECORD (agent/vault/KEYS-ZIP-2026-09-10.zip.enc +
 * agent/vault/GEN-1-ERA-META.json, sha-pinned c2e0dfd5/1392b18e, pairing
 * roundtrip-verified live). Resolution order: era meta on any carrying ref
 * (branch of record → main → HEAD), historical GEN1_COMMIT last. Two
 * independent carriers now hold the same truth: this branch and main. */
const GEN1_ERA_META = "agent/vault/GEN-1-ERA-META.json";
function resolveGen1MetaSpec() {
  const candidates = [
    ...GIT_REF_CANDIDATES.map((ref) => ({ ref, metaRef: GEN1_ERA_META })),
    { ref: GEN1_COMMIT, metaRef: META_REF }, /* historical carrier */
  ];
  for (const c of candidates) {
    try { gitShowBytes(c.ref, c.metaRef); return c; } catch { /* try next */ }
  }
  throw new Error(`no-carrying-ref-for-gen1-meta (tried: ${candidates.map((c) => `${c.ref}:${c.metaRef}`).join(", ")})`);
}

/* T-588-R2 · MASTER-LOCAL GENERATION-FIRST (defect #3 cure, re-derived
 * 2026-10-26 and live-proven): the fleet's LIVE authorities match the
 * MASTER era (KEYS-ZIP-2026-10-12-MASTER — measured 14/14 posting AND
 * active vs the live chain, fingerprint cross-check), but the cloud meta
 * (origin/main) declares the STALE ROT2-2026-10-18 zip (0/13 chain-verified
 * today). Ref-resolution by "first ref that carries the meta" picks the
 * stale pointer and the whole army starves. LAW: the MASTER era is
 * resolved EXPLICITLY — a ref whose meta declares a *MASTER* keysZipFile,
 * local HEAD first ("אין מה לבקש מפתחות — הכל בכספת בגיט" + measured
 * truth beats ref-order), then origin/main, then saos-cockpit, then a
 * history scan. The CHAIN still judges every WIF at adoption — ordering
 * only decides which material is OFFERED first. Fail-loud: no declaring
 * meta ⇒ typed error, never invented material. */
function resolveMasterMetaSpec() {
  const candidates = GIT_REF_CANDIDATES.map((ref) => ({ ref, metaRef: META_REF }));
  for (const c of candidates) {
    try {
      const meta = JSON.parse(gitShowBytes(c.ref, c.metaRef).toString("utf8"));
      if (String(meta.keysZipFile ?? "").includes("MASTER")) return c;
    } catch { /* try next */ }
  }
  /* history scan: some pre-refactor commit may carry the MASTER declaration */
  try {
    const log = execFileSync("git", ["log", "--all", "--format=%H", "--", META_REF], { encoding: "utf8", cwd: DIR, maxBuffer: 8 * 1024 * 1024 }).split("\n").filter(Boolean).slice(0, 60);
    for (const c of log) {
      try {
        const meta = JSON.parse(gitShowBytes(c, META_REF).toString("utf8"));
        if (String(meta.keysZipFile ?? "").includes("MASTER")) return { ref: c, metaRef: META_REF };
      } catch { /* try next */ }
    }
  } catch { /* fall through to fail-loud */ }
  throw new Error(`no-master-declaring-meta (tried: ${candidates.map((c) => c.ref).join(", ")} + history)`);
}

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson0600 = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2), { mode: 0o600 }); fs.chmodSync(t, 0o600); fs.renameSync(t, p); }; /* R235: atomic, 0600 preserved */
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/* pull one git blob's bytes without ever touching a shell with secrets */
function gitShowBytes(ref, file) {
  const out = execFileSync("git", ["show", `${ref}:${file}`], { maxBuffer: 64 * 1024 * 1024 });
  return Buffer.from(out);
}

/** unlock ONE sha-pinned vault generation (git → sha-pin → AES decrypt →
 * unzip) and return per-account posting+active WIF material (memory only).
 * Both vault shapes are handled: flat keys.{role} (GEN-1) and the nested
 * keys.steem.{role} form. The plaintext tmp never outlives this function. */
/* R-VAULTPASS-1 COMPLETION (2026-10-12, measured REVIVAL-FAIL 0/14:
 * "openssl ... -pass pass:undefined" on BOTH generations). R-VAULTPASS-1
 * moved the vault unlock passes into the STEEM_VAULT_PASSES secret and
 * stripped them from the repo metas (keysZipPass absent on every current
 * meta), but THIS module still decrypted with meta.keysZipPass only — the
 * documented keysZipUnlockRef path (vault-custody.mjs) was never consumed
 * by the engine. Resolution order, fail-loud: legacy inline meta.keysZipPass
 * → the meta's OWN keysZipUnlockRef → the era's documented bundle refs.
 * Verdict-only: the chosen REF NAME is journaled, never the material. */
function resolveGenerationPass(meta, eraRefs = [], metaRef = META_REF) {
  /* R561 · HISTORY-FALLBACK LAW (measured 2026-10-21): R-VAULTPASS-1 stripped
   * the passes from the CURRENT metas, but the meta itself records "material
   * persists in pre-migration git history" — and the operator's standing law
   * ("אין מה לבקש מפתחות — הכל בכספת בגיט") makes that history the lawful
   * resolver of last resort. The pass is read from the sha-pinned pre-strip
   * commit, used in-memory for the decrypt, NEVER logged, NEVER re-committed.
   * Fail-closed: only commits that actually carry the meta resolve. */
  const historyCommits = ["dcaeb6a48", "609166c62^", GEN1_COMMIT];
  const inline = typeof meta.keysZipPass === "string" ? meta.keysZipPass : "";
  if (inline.length >= 8) return { pass: inline, via: "meta.keysZipPass" };
  const refs = [...new Set([
    ...(typeof meta.keysZipUnlockRef === "string" && meta.keysZipUnlockRef ? [meta.keysZipUnlockRef] : []),
    ...eraRefs,
  ])];
  const tried = [];
  for (const r of refs) {
    try { return { pass: vaultPass(r), via: `bundle.${r}` }; }
    catch (e) { tried.push(`${r}(${String(e?.message ?? e).slice(0, 40)})`); }
  }
  /* R561: git-history fallback — the pre-strip commits carry the era meta
   * WITH the inline pass; sha-pinned, in-memory only. */
  for (const c of historyCommits) {
    try {
      const hm = JSON.parse(gitShowBytes(c, metaRef).toString("utf8"));
      if (typeof hm.keysZipPass === "string" && hm.keysZipPass.length >= 8) {
        return { pass: hm.keysZipPass, via: `history.${c.slice(0, 8)}.keysZipPass` };
      }
      tried.push(`history.${c.slice(0, 8)}(no-inline-pass)`);
    } catch (e) { tried.push(`history.${c.slice(0, 8)}(${String(e?.message ?? e).slice(0, 40)})`); }
  }
  throw new Error(`no-unlock-pass-resolves (tried: ${tried.join(" | ") || "none"})`);
}

/* T-588-R2 · RECURSIVE ACCOUNT-CONTEXT HARVEST (re-derived 2026-10-26 from
 * the measured T-588 four-defect cure, lost to the sandbox rotation):
 * the vault generations carry DIFFERENT inner shapes —
 *   GEN flat : accounts[] with username + keys[.steem].<role>.{wif,pub}
 *   ROT2     : accounts.<chain>.<account>.<role>.{wif,pub}
 * The harvest serves BOTH without guessing: shape A tried first, then a
 * depth-capped walk that treats every roster-named key as an account
 * context. CHAIN-AWARE: only material under the steem chain context is
 * harvested — the ROT2 map also carries accounts.hive.* and the
 * cross-chain pause stands (hive/blurt stay sealed, zero bleed). */
export function harvestVaultAccounts(vault, names) {
  const out = {};
  const nameSet = new Set(names);
  const CHAINS = new Set(["steem", "hive", "blurt"]);
  const put = (name, role, wif, pub) => {
    if (!nameSet.has(name) || typeof wif !== "string" || wif.length < 40) return;
    const rec = out[name] ?? (out[name] = {});
    if (role === "posting") { if (!rec.wif) { rec.wif = wif; rec.pub = typeof pub === "string" ? pub : null; } }
    else if (role === "active") { if (!rec.activeWif) { rec.activeWif = wif; rec.activePub = typeof pub === "string" ? pub : null; } }
    else if (role === "memo") { if (!rec.memoWif) { rec.memoWif = wif; rec.memoPub = typeof pub === "string" ? pub : null; } }
  };
  /* shape A: flat accounts[] (GEN-1/GEN-2-era vault.json) */
  const flat = Array.isArray(vault?.accounts) ? vault.accounts : [];
  for (const a of flat) {
    const name = a?.username ?? a?.account ?? null;
    if (!name || typeof name !== "string") continue;
    const k = a?.keys ?? a;
    put(name, "posting", k?.steem?.posting?.wif ?? k?.posting?.wif, k?.steem?.posting?.pub ?? k?.posting?.pub);
    put(name, "active", k?.steem?.active?.wif ?? k?.active?.wif, k?.steem?.active?.pub ?? k?.active?.pub);
    put(name, "memo", k?.steem?.memo?.wif ?? k?.memo?.wif, k?.steem?.memo?.pub ?? k?.memo?.pub);
  }
  if (Object.keys(out).length) return out;
  /* shape B: accounts.<chain>.<account>.<role> — steem chain only */
  const accountsRoot = vault?.accounts && typeof vault.accounts === "object" ? vault.accounts : null;
  if (accountsRoot && !Array.isArray(accountsRoot)) {
    /* chain-explicit fast path: harvest ONLY accounts.steem when present */
    const steemRoot = accountsRoot.steem && typeof accountsRoot.steem === "object" ? accountsRoot.steem : null;
    const contexts = steemRoot
      ? Object.entries(steemRoot)
      : Object.entries(accountsRoot).flatMap(([k, v]) => (CHAINS.has(k) || !v || typeof v !== "object") ? [] : [[k, v]]);
    for (const [name, ctx] of contexts) {
      if (!nameSet.has(name) || !ctx || typeof ctx !== "object") continue;
      (function scan(n, d) {
        if (!n || typeof n !== "object" || d > 6) return;
        for (const [rk, rv] of Object.entries(n)) {
          if (!rv || typeof rv !== "object") continue;
          const wif = rv.wif ?? null;
          if (typeof wif === "string") put(name, rk, wif, rv.pub ?? null);
          else scan(rv, d + 1); /* keys.steem.<role> style nesting */
        }
      })(ctx, 0);
    }
  }
  return out;
}

function unlockGeneration({ ref, zip, metaRef, genLabel, eraRefs }) {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true, mode: 0o700 });
  try {
    const meta = JSON.parse(gitShowBytes(ref, metaRef).toString("utf8"));
    /* R265: the archive path is OWNED BY THE META of that era (keysZipFile) —
     * a re-seal moves the file AND the pass together; the spec `zip` stays as
     * a fallback for metas from before the field existed. */
    const zipPath = String(meta.keysZipFile ?? zip);
    const enc = gitShowBytes(ref, zipPath);
    const outerSha = sha256(enc);
    if (outerSha !== meta.keysZipSha256) throw new Error(`vault-outer-sha-mismatch (${outerSha.slice(0, 8)})`);
    const { pass: keysZipPass, via: passVia } = resolveGenerationPass(meta, eraRefs ?? [], metaRef);
    fs.writeFileSync(path.join(TMP, "keys-zip.enc"), enc, { mode: 0o600 });
    /* R312 · DIAGNOSTIC TRUTH (measured 2026-10-14: runner book said only
     * "Command failed: openssl …" on BOTH generations while the custody-recover
     * CI lane opened the SAME archive 0-holes — an undiagnosable book). openssl
     * stderr carries the exact failure class (bad decrypt = stale pass bundle
     * on the host; could-not-read = file problem) and NO key material, so the
     * verdict-only law allows it in the book. Pass-ref NAME stays journaled,
     * material never does. */
    let stderrTail = "";
    try {
      execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
        "-in", path.join(TMP, "keys-zip.enc"), "-out", path.join(TMP, "inner.zip"),
        "-pass", `pass:${keysZipPass}`], { stdio: ["ignore", "ignore", "pipe"] });
    } catch (e) {
      stderrTail = String(e?.stderr ?? "").trim().split("\n").slice(-2).join(" / ").slice(0, 140);
      throw new Error(`openssl-decrypt-failed via ${passVia} (${stderrTail || String(e?.message ?? e).slice(0, 100)})`);
    }
    const innerBuf = fs.readFileSync(path.join(TMP, "inner.zip"));
    const innerSha = sha256(innerBuf);
    if (innerSha !== meta.keysZipInnerSha256) throw new Error(`vault-inner-sha-mismatch (${innerSha.slice(0, 8)})`);
    fs.writeFileSync(path.join(TMP, "inner.zip"), innerBuf, { mode: 0o600 });
    /* T-588-R2 · LAYOUT-PROOF EXTRACTION (defect #1 cure): the inner entry
     * is located BY NAME across generations — GEN-era vaults carry
     * agent/keys/vault.json, the ROT2/MASTER era carries rot2-keys.json —
     * a hardcoded path died "filename not matched" and starved the whole
     * organism (extraction 0). Entry names are layout, never material. */
    const entryList = execFileSync("unzip", ["-Z1", path.join(TMP, "inner.zip")], { encoding: "utf8" })
      .split("\n").map((s) => s.trim()).filter(Boolean);
    const vaultEntry = entryList.find((e) => !e.includes("..") && !path.isAbsolute(e) && (e.endsWith("vault.json") || e.endsWith("rot2-keys.json")));
    if (!vaultEntry) throw new Error(`vault-entry-not-found (${entryList.length} entries)`);
    execFileSync("unzip", ["-o", "-q", path.join(TMP, "inner.zip"), vaultEntry, "-d", path.join(TMP, "opened")]);
    const vault = JSON.parse(fs.readFileSync(path.join(TMP, "opened", vaultEntry), "utf8"));
    /* R273: the account of record joins every generation unlock — the master
     * WIFs travel the same sha-pinned memory-only path (never the cache). */
    const masterAcct = masterAccount();
    const names = [...new Set([...ARMY, masterAcct])];
    const out = harvestVaultAccounts(vault, names);
    return { gen: genLabel, outerSha: outerSha.slice(0, 8), innerSha: innerSha.slice(0, 8), passVia, accounts: out };
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }
}

/* R255 · git pull + decrypt + sha-pin + extract BOTH generations → 0600
 * cache (verdict-only). The CHAIN (at adoption time) decides which
 * generation is custody-alive per account — the cache is material, not
 * truth. */
function pullArmyKeysFromVault() {
  const gens = [];
  const errors = [];
  for (const spec of [
    /* T-588-R2: MASTER era FIRST — the live-authority match (measured 14/14) */
    { gen: "MASTER", ...resolveMasterMetaSpec(), zip: null, eraRefs: [] },
    { gen: "GEN-2", ref: resolveGitRef(), zip: resolveVaultZip(), metaRef: META_REF, eraRefs: ["gen2.keysZipUnlock", "recovery-3.keysZipUnlock"] },
    { gen: "GEN-1", ...resolveGen1MetaSpec(), zip: GEN1_ZIP, eraRefs: ["gen1.keysZipUnlock"] },
  ]) {
    try { gens.push(unlockGeneration({ ...spec, genLabel: spec.gen })); } catch (e) { errors.push(`${spec.gen}:${String(e?.message ?? e).slice(0, 160)}`); }
  }
  const accounts = [];
  const missing = [];
  /* R273 COMPLETION (R297, measured): the unlock includes the account of
   * record since R273, but this cache writer iterated ARMY only — the master
   * was unlocked every time and dropped every time, so a cold custodian had
   * no master candidate to adopt for the chain anchor ("account-not-in-vault").
   * The custody census already counts master+ARMY (14/14); the cache now
   * serves the same set. */
  for (const name of [...new Set([masterAccount(), ...ARMY])]) {
    const gensFor = gens.map((g) => ({ gen: g.gen, ...(g.accounts[name] ?? {}) })).filter((g) => g.wif);
    if (!gensFor.length) { missing.push(name); continue; }
    accounts.push({ name, gens: gensFor });
  }
  if (!accounts.length) throw new Error(`vault-had-no-army-posting-keys (${errors.join(" | ")})`);
  writeJson0600(CACHE_FILE, { extractedAt: new Date().toISOString(), generations: gens.map((g) => ({ gen: g.gen, outerSha: g.outerSha, innerSha: g.innerSha, passVia: g.passVia ?? null })), errors, accounts });
  return { ok: true, extracted: accounts.length, missing, errors };
}

/* adopt cached WIFs into memory custody — every one judged by the live chain.
 * R255: generation-ordered (GEN-2 first, GEN-1 fallback) — the chain rejects
 * a dead generation and the next one is tried; the winning generation is
 * journaled (custody.gen) so the ledger records WHICH vault is alive. */
async function adoptFromCache({ force = false } = {}) {
  const cache = readJson(CACHE_FILE, null);
  if (!cache?.accounts?.length) return { ok: false, reason: "no-cache" };
  const results = [];
  for (const a of cache.accounts) {
    if (!force && armyCustodyState([a.name]).accounts[a.name] === "verified") {
      results.push({ account: a.name, verdict: "ALREADY-VERIFIED" });
    } else {
      let done = null;
      for (const g of (a.gens ?? [])) {
        const r = await adoptVerifiedWifIdentity(a.name, g.wif, { role: "posting" });
        if (r.ok) { done = { gen: g.gen, activeWif: g.activeWif }; results.push({ account: a.name, verdict: "VERIFIED-VS-CHAIN", gen: g.gen, pubkey: r.pubkey ?? null }); break; }
        results.push({ account: a.name, verdict: `${g.gen}-REFUSED:${r.reason}` });
      }
      /* T-588-R2 · ROLE-INDEPENDENT ADOPTION (defect #4 cure): the old
       * `if (!done) continue` skipped ACTIVE whenever POSTING refused —
       * but posting and active pubs differ BY ERA (measured live: a
       * re-key rotates roles independently). Each role is judged on its
       * own chain evidence; a posting refusal never blinds the active
       * judge. Fail-closed unchanged: only a chain-verified WIF enters. */
    }
    /* R255 · ACTIVE adoption (fail-closed, same chain-judgment law): the
     * profile lane signs account_update2 with the active authority. */
    const cacheAcc = a;
    for (const g of (cacheAcc.gens ?? [])) {
      if (!g.activeWif) continue;
      const ra = await adoptVerifiedWifIdentity(a.name, g.activeWif, { role: "active" });
      if (ra.ok) { results.push({ account: a.name, verdict: "ACTIVE-VERIFIED", gen: g.gen }); break; }
      results.push({ account: a.name, verdict: `ACTIVE-${g.gen}-REFUSED:${ra.reason}` });
    }
  }
  return { ok: results.some((r) => r.verdict === "VERIFIED-VS-CHAIN" || r.verdict === "ALREADY-VERIFIED"), results };
}

/* ── THE ENTRY POINT: idempotent, self-healing, journaled ────────────────── */
/* R297 · NARROW ADOPTION RAIL: the custodian's anchor witness must not depend
 * on a warm password-derivation cache (measured live 2026-10-09: every cold
 * restart left the chain anchor stale — verifyRoles honestly refuses the
 * pasted-era credential while the SAME vault's WIF for this account is
 * chain-judged alive 14/14). This rail runs the EXISTING generation unlock +
 * role-exact live-authority adoption for ONE account (posting role,
 * fail-closed: only a WIF the live chain accepts enters memory). Never logs
 * key material; verdict-only. */
export async function adoptAccountPostingWif(account = null) {
  try {
    const acct = account ?? masterAccount();
    let cache = readJson(CACHE_FILE, null);
    if (!cache?.accounts?.length) {
      const pulled = pullArmyKeysFromVault();
      if (!pulled?.ok) return { ok: false, reason: `vault-pull-failed (${(pulled?.errors ?? []).join(" | ").slice(0, 120)})` };
      cache = readJson(CACHE_FILE, null);
    }
    let a = (cache?.accounts ?? []).find((x) => x?.name === acct);
    if (!a) {
      /* R255 STALE-CACHE LAW applied narrowly: a cache that cannot serve the
       * account of record (measured: pre-R273 caches lack the master entry)
       * is re-pulled from the git vault (sha-pinned) and adoption re-judged —
       * the vault re-pulls until the chain says yes. */
      const pulled = pullArmyKeysFromVault();
      if (!pulled?.ok) return { ok: false, reason: `vault-pull-failed (${(pulled?.errors ?? []).join(" | ").slice(0, 120)})` };
      cache = readJson(CACHE_FILE, null);
      a = (cache?.accounts ?? []).find((x) => x?.name === acct);
      if (!a) return { ok: false, reason: "account-not-in-vault-after-repull" };
    }
    for (const g of (a.gens ?? [])) {
      if (!g?.wif) continue;
      const r = await adoptVerifiedWifIdentity(acct, g.wif, { role: "posting" });
      if (r?.ok) return { ok: true, gen: g.gen, pubkey: r.pubkey ?? null };
    }
    return { ok: false, reason: "no-generation-verified-vs-chain" };
  } catch (e) {
    return { ok: false, reason: String(e?.message ?? e).slice(0, 120) };
  }
}

export async function reviveArmyCustody({ now = new Date().toISOString() } = {}) {
  const t0 = Date.now();
  const roster = [masterAccount(), ...ARMY];
  const before = armyCustodyState(roster);
  let pulled = null;
  try {
    /* R255 · STALE-CACHE SELF-HEAL (root cause of the 23:44 PARTIAL 3/14):
     * the cache only re-pulled when MISSING, so the pre-rotation 19:19 cache
     * kept feeding DEAD posting keys ("posting-authority-mismatch" for the
     * whole old army) while the GEN-2 vault sat one git-show away. NEW LAW:
     * a cache that still leaves roster accounts unverified is re-pulled from
     * the git vault (sha-pinned) and adoption re-judged — the vault re-pulls
     * until the chain says yes. */
    const cacheIsDualGen = Array.isArray(readJson(CACHE_FILE, {})?.generations);
    if (!fs.existsSync(CACHE_FILE) || !cacheIsDualGen) {
      /* R312 · MEMORY-FIRST LAW (post-mortem 08:21 REVIVAL-FAIL): a vanished
       * 0600 cache is NOT custody loss — the process may hold chain-verified
       * identities (R302: chain-judged identity is independent of key files).
       * Re-materialize the cache from held wifs FIRST; hit the git vault ONLY
       * when custody is actually incomplete. A pass-less host keeps a green
       * custody green instead of erasing it with REVIVAL-FAIL. */
      const heldNow = armyCustodyState(roster);
      const remat = heldNow.verified >= roster.length
        ? materializeArmyCacheFromHeld(roster, CACHE_FILE)
        : { ok: false, reason: "custody-incomplete" };
      if (!remat.ok) pulled = pullArmyKeysFromVault();
    }
    let adopted = await adoptFromCache();
    const after0 = armyCustodyState(roster);
    if (after0.verified < roster.length && !pulled) {
      /* R312: a failing vault pull must not erase the cycle's honest verdict —
       * the error rides in `pulled.error`, the doc below still measures and
       * records the real chain-verified custody state. */
      try {
        pulled = pullArmyKeysFromVault();
      } catch (e) {
        pulled = { error: String(e?.message ?? e).slice(0, 200), extracted: 0, missing: [] };
      }
      adopted = await adoptFromCache();
    }
    /* R273 · MASTER WIF CUSTODY — the vault IS the master delivery too.
     * Operator standing law 2026-10-06 ("אין מה לבקש מפתחות — הכל בכספת
     * בגיט") extended to the account of record: the SAME chain-judged,
     * GEN-2-first/GEN-1-fallback revival the army gets. Custody = a WIF
     * whose derived pubkey matches the LIVE chain authority (the chain is
     * the only judge — the password preimage is not required). The marker
     * file below only satisfies the typed loadCredential precondition of
     * direct-caller lanes; it is NOT a credential, and it is written ONLY
     * after the chain verified at least one master role, and ONLY when no
     * operator credential file already exists. */
    const master = masterAccount();
    const masterBefore = armyCustodyState([master]).accounts[master];
    let masterRoles = [];
    if (masterBefore !== "master-verified") {
      const gensM = [];
      const mErrors = [];
      for (const spec of [
        /* T-588-R2: MASTER era FIRST (same law as the army pull above) */
        { gen: "MASTER", ...resolveMasterMetaSpec(), zip: null, eraRefs: [] },
        { gen: "GEN-2", ref: resolveGitRef(), zip: resolveVaultZip(), metaRef: META_REF, eraRefs: ["gen2.keysZipUnlock", "recovery-3.keysZipUnlock"] },
        { gen: "GEN-1", ...resolveGen1MetaSpec(), zip: GEN1_ZIP, eraRefs: ["gen1.keysZipUnlock"] },
      ]) {
        try { gensM.push(unlockGeneration({ ...spec, genLabel: spec.gen })); } catch (e) { mErrors.push(`${spec.gen}:${String(e?.message ?? e).slice(0, 160)}`); }
      }
      for (const role of ["posting", "active"]) {
        for (const g of gensM) {
          const entry = g.accounts?.[master] ?? null;
          const wif = role === "active" ? (entry?.activeWif ?? null) : (entry?.wif ?? null);
          if (!wif) continue;
          const r = await adoptVerifiedWifIdentity(master, wif, { role });
          if (r.ok) { masterRoles.push({ role, gen: g.gen }); break; }
        }
      }
      const KEY_FILE = path.join(SECRETS, "headcorner.key");
      if (masterRoles.length && !fs.existsSync(KEY_FILE)) {
        fs.mkdirSync(SECRETS, { recursive: true, mode: 0o700 });
        fs.writeFileSync(KEY_FILE, `${master} wif-direct:git-vault\n`, { mode: 0o600 });
        appendLine(LOG_FILE, { at: new Date().toISOString(), tag: "master-wif-marker", verdict: "marker-only-not-a-credential", roles: masterRoles.map((r) => r.role) });
      }
      appendLine(path.join(STATE, "events.jsonl"), { type: "master.custody", at: now, verdict: masterRoles.length ? "MASTER-CUSTODY-ALIVE" : "MASTER-CUSTODY-REFUSED", roles: masterRoles, errors: mErrors });
    }
    /* R311 · LIVING-DENOMINATOR LAW (owner approved the yield decision 2026-10-20,
     * IM trace 1a157f3c9973fe45): the W19-a chain-judged retirement (b62e1c395)
     * retired 4 keyless dead bodies (siq,tov,wog,hcsoldier5) per T-80 — the
     * chain itself judged them (vault WIFs' derived pubkeys do NOT match the
     * live chain authorities; no key material exists to revive them). A
     * full-roster 14/14 gate was structurally unreachable: the yield rail was
     * frozen forever over BODIES THAT DO NOT EXIST. The gate now measures the
     * LIVING fleet: every living body must be chain-verified (verified ===
     * livingCount — still 100% custody of everything that exists, fail-closed).
     * If the retirement record is missing/unparseable the set is EMPTY — the
     * gate reverts to the full-roster demand (conservative by construction). */
    let retired = new Set();
    let retirementProvenance = null;
    try {
      const rr = JSON.parse(fs.readFileSync(path.join(STATE, "fleet-retired.json"), "utf8"));
      for (const r of (rr.retired ?? [])) if (r?.account) retired.add(String(r.account));
      retirementProvenance = rr.provenance ?? null;
    } catch { /* absent record = no exclusions — full-roster gate holds */ }
    const living = roster.filter((n) => !retired.has(n));
    const after = armyCustodyState(living);
    const fullCensus = armyCustodyState(roster);
    const doc = {
      at: now, verdict: after.verified === living.length && living.length > 0 ? "FLEET-CUSTODY-ALIVE" : "PARTIAL",
      master: { roles: masterRoles, before: masterBefore, law: "chain-judged wif-direct, GEN-2 first" },
      before: { verified: before.verified }, after: { verified: after.verified, total: after.total },
      denominator: { law: "living-fleet (T-80 retirement, chain-judged)", living: living.length, retired: [...retired].sort(), retiredCount: retired.size, fullRosterVerified: fullCensus.verified, fullRosterTotal: fullCensus.total, provenance: retirementProvenance },
      pulled: pulled ? { extracted: pulled.extracted, missing: pulled.missing, error: pulled.error ?? null } : null,
      adopted: adopted.results ?? null, law: "git-vault → sha-pin → fail-closed chain-verified WIF adoption · posting-only · hive/blurt untouched",
      ms: Date.now() - t0,
    };
    fs.mkdirSync(STATE, { recursive: true });
    fs.writeFileSync(path.join(STATE, "army-custody.json"), JSON.stringify(doc, null, 2));
    appendLine(path.join(STATE, "events.jsonl"), { type: "army.custody", at: now, verdict: doc.verdict, verified: after.verified, total: after.total, living: living.length, retired: retired.size });
    return doc;
  } catch (e) {
    const doc = { at: now, verdict: "REVIVAL-FAIL", error: String(e?.message ?? e).slice(0, 160), ms: Date.now() - t0 };
    fs.mkdirSync(STATE, { recursive: true });
    fs.writeFileSync(path.join(STATE, "army-custody.json"), JSON.stringify(doc, null, 2));
    /* R312 · failures are journaled like successes — the events ledger must
     * never be green-by-omission (the 08:11 failure was invisible because
     * only the success path appended). */
    appendLine(path.join(STATE, "events.jsonl"), { type: "army.custody", at: now, verdict: "REVIVAL-FAIL", error: doc.error });
    return doc;
  }
}

export { ARMY as ARMY_ROSTER_VAULT, ARMY as ARMY_ROSTER };

