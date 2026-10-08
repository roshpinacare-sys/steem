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
import { masterAccount, adoptVerifiedWifIdentity, armyCustodyState } from "./signer.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const SECRETS = path.join(DIR, "..", "..", ".secrets");
const TMP = path.join(SECRETS, "vault-tmp");
const CACHE_FILE = path.join(SECRETS, "army-keys.json");
const CUSTODY_FILE = path.join(STATE, "army-custody.json");

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
const VAULT_ZIP = "agent/vault/KEYS-ZIP-2026-10-07.zip.enc"; /* R245-ROT2: the GEN-2 vault (previous archive kept in history — its keys are DEAD) */
const META_REF = "agent/recovery-meta.json";
const GIT_REF = "origin/main";

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
function unlockGeneration({ ref, zip, metaRef }) {
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
    fs.writeFileSync(path.join(TMP, "keys-zip.enc"), enc, { mode: 0o600 });
    execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
      "-in", path.join(TMP, "keys-zip.enc"), "-out", path.join(TMP, "inner.zip"),
      "-pass", `pass:${meta.keysZipPass}`], { stdio: ["ignore", "ignore", "pipe"] });
    const innerBuf = fs.readFileSync(path.join(TMP, "inner.zip"));
    const innerSha = sha256(innerBuf);
    if (innerSha !== meta.keysZipInnerSha256) throw new Error(`vault-inner-sha-mismatch (${innerSha.slice(0, 8)})`);
    fs.writeFileSync(path.join(TMP, "inner.zip"), innerBuf, { mode: 0o600 });
    execFileSync("unzip", ["-o", "-q", path.join(TMP, "inner.zip"), "agent/keys/vault.json", "-d", path.join(TMP, "opened")]);
    const vault = JSON.parse(fs.readFileSync(path.join(TMP, "opened", "agent", "keys", "vault.json"), "utf8"));
    const byName = new Map((vault.accounts ?? []).map((a) => [a.username, a]));
    const out = {};
    for (const name of ARMY) {
      const a = byName.get(name);
      const wif = a?.keys?.steem?.posting?.wif ?? a?.keys?.posting?.wif ?? null;
      const pub = a?.keys?.steem?.posting?.pub ?? a?.keys?.posting?.pub ?? null;
      const activeWif = a?.keys?.steem?.active?.wif ?? a?.keys?.active?.wif ?? null;
      const activePub = a?.keys?.steem?.active?.pub ?? a?.keys?.active?.pub ?? null;
      if (wif) out[name] = { wif, pub, activeWif, activePub };
    }
    return { gen: ref === GEN1_COMMIT ? "GEN-1" : "GEN-2", outerSha: outerSha.slice(0, 8), innerSha: innerSha.slice(0, 8), accounts: out };
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
    { gen: "GEN-2", ref: GIT_REF, zip: VAULT_ZIP, metaRef: META_REF },
    { gen: "GEN-1", ref: GEN1_COMMIT, zip: GEN1_ZIP, metaRef: META_REF },
  ]) {
    try { gens.push(unlockGeneration(spec)); } catch (e) { errors.push(`${spec.gen}:${String(e?.message ?? e).slice(0, 80)}`); }
  }
  const accounts = [];
  const missing = [];
  for (const name of ARMY) {
    const gensFor = gens.map((g) => ({ gen: g.gen, ...(g.accounts[name] ?? {}) })).filter((g) => g.wif);
    if (!gensFor.length) { missing.push(name); continue; }
    accounts.push({ name, gens: gensFor });
  }
  if (!accounts.length) throw new Error(`vault-had-no-army-posting-keys (${errors.join(" | ")})`);
  writeJson0600(CACHE_FILE, { extractedAt: new Date().toISOString(), generations: gens.map((g) => ({ gen: g.gen, outerSha: g.outerSha, innerSha: g.innerSha })), errors, accounts });
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
        results.push({ account: a.name, verdict: `GEN-${g.gen}-REFUSED:${r.reason}` });
      }
      if (!done) continue;
    }
    /* R255 · ACTIVE adoption (fail-closed, same chain-judgment law): the
     * profile lane signs account_update2 with the active authority. */
    const cacheAcc = a;
    for (const g of (cacheAcc.gens ?? [])) {
      if (!g.activeWif) continue;
      const ra = await adoptVerifiedWifIdentity(a.name, g.activeWif, { role: "active" });
      if (ra.ok) { results.push({ account: a.name, verdict: "ACTIVE-VERIFIED", gen: g.gen }); break; }
      results.push({ account: a.name, verdict: `ACTIVE-GEN-${g.gen}-REFUSED:${ra.reason}` });
    }
  }
  return { ok: results.some((r) => r.verdict === "VERIFIED-VS-CHAIN" || r.verdict === "ALREADY-VERIFIED"), results };
}

/* ── THE ENTRY POINT: idempotent, self-healing, journaled ────────────────── */
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
    if (!fs.existsSync(CACHE_FILE) || !cacheIsDualGen) pulled = pullArmyKeysFromVault();
    let adopted = await adoptFromCache();
    const after0 = armyCustodyState(roster);
    if (after0.verified < roster.length && !pulled) {
      pulled = pullArmyKeysFromVault();
      adopted = await adoptFromCache();
    }
    const after = armyCustodyState(roster);
    const doc = {
      at: now, verdict: after.verified === roster.length ? "FLEET-CUSTODY-ALIVE" : "PARTIAL",
      before: { verified: before.verified }, after: { verified: after.verified, total: after.total },
      pulled: pulled ? { extracted: pulled.extracted, missing: pulled.missing } : null,
      adopted: adopted.results ?? null, law: "git-vault → sha-pin → fail-closed chain-verified WIF adoption · posting-only · hive/blurt untouched",
      ms: Date.now() - t0,
    };
    fs.mkdirSync(STATE, { recursive: true });
    fs.writeFileSync(path.join(STATE, "army-custody.json"), JSON.stringify(doc, null, 2));
    appendLine(path.join(STATE, "events.jsonl"), { type: "army.custody", at: now, verdict: doc.verdict, verified: after.verified, total: after.total });
    return doc;
  } catch (e) {
    const doc = { at: now, verdict: "REVIVAL-FAIL", error: String(e?.message ?? e).slice(0, 160), ms: Date.now() - t0 };
    fs.mkdirSync(STATE, { recursive: true });
    fs.writeFileSync(path.join(STATE, "army-custody.json"), JSON.stringify(doc, null, 2));
    return doc;
  }
}

export { ARMY as ARMY_ROSTER_VAULT, ARMY as ARMY_ROSTER };
