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

const ARMY = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"];
const VAULT_ZIP = "agent/vault/KEYS-ZIP-2026-09-10.zip.enc";
const META_REF = "agent/recovery-meta.json";
const GIT_REF = "origin/main";

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson0600 = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2), { mode: 0o600 }); fs.chmodSync(t, 0o600); fs.renameSync(t, p); }; /* R235: atomic, 0600 preserved */
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/* pull one git blob's bytes without ever touching a shell with secrets */
function gitShowBytes(ref, file) {
  const out = execFileSync("git", ["show", `${ref}:${file}`], { maxBuffer: 64 * 1024 * 1024 });
  return Buffer.from(out);
}

/* git pull + decrypt + sha-pin + extract army WIFs → 0600 cache (verdict-only) */
function pullArmyKeysFromVault() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true, mode: 0o700 });
  const meta = JSON.parse(gitShowBytes(GIT_REF, META_REF).toString("utf8"));
  const enc = gitShowBytes(GIT_REF, VAULT_ZIP);
  const outerSha = sha256(enc);
  if (outerSha !== meta.keysZipSha256) throw new Error(`vault-outer-sha-mismatch (${outerSha.slice(0, 8)})`);
  fs.writeFileSync(path.join(TMP, "keys-zip.enc"), enc, { mode: 0o600 });
  const pass = String(meta.keysZipPass);
  execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
    "-in", path.join(TMP, "keys-zip.enc"), "-out", path.join(TMP, "inner.zip"),
    "-pass", `pass:${pass}`], { stdio: ["ignore", "ignore", "pipe"] });
  const innerBuf = fs.readFileSync(path.join(TMP, "inner.zip"));
  const innerSha = sha256(innerBuf);
  if (innerSha !== meta.keysZipInnerSha256) throw new Error(`vault-inner-sha-mismatch (${innerSha.slice(0, 8)})`);
  fs.writeFileSync(path.join(TMP, "inner.zip"), innerBuf, { mode: 0o600 });
  execFileSync("unzip", ["-o", "-q", path.join(TMP, "inner.zip"), "agent/keys/vault.json", "-d", path.join(TMP, "opened")]);
  const vault = JSON.parse(fs.readFileSync(path.join(TMP, "opened", "agent", "keys", "vault.json"), "utf8"));
  const byName = new Map((vault.accounts ?? []).map((a) => [a.username, a]));
  const accounts = [];
  const missing = [];
  for (const name of ARMY) {
    const a = byName.get(name);
    const wif = a?.keys?.steem?.posting?.wif ?? a?.keys?.posting?.wif;
    const pub = a?.keys?.steem?.posting?.pub ?? a?.keys?.posting?.pub;
    if (!wif) { missing.push(name); continue; }
    accounts.push({ name, wif, pub: pub ?? null });
  }
  if (!accounts.length) throw new Error("vault-had-no-army-posting-keys");
  writeJson0600(CACHE_FILE, { extractedAt: new Date().toISOString(), source: VAULT_ZIP, outerSha: outerSha.slice(0, 8), innerSha: innerSha.slice(0, 8), accounts });
  /* the plaintext vault never outlives the extraction */
  fs.rmSync(TMP, { recursive: true, force: true });
  return { ok: true, extracted: accounts.length, missing };
}

/* adopt cached WIFs into memory custody — every one judged by the live chain */
async function adoptFromCache({ force = false } = {}) {
  const cache = readJson(CACHE_FILE, null);
  if (!cache?.accounts?.length) return { ok: false, reason: "no-cache" };
  const results = [];
  for (const a of cache.accounts) {
    if (!force && armyCustodyState([a.name]).accounts[a.name] === "verified") {
      results.push({ account: a.name, verdict: "ALREADY-VERIFIED" });
      continue;
    }
    const r = await adoptVerifiedWifIdentity(a.name, a.wif, { role: "posting" });
    results.push({ account: a.name, verdict: r.ok ? "VERIFIED-VS-CHAIN" : `REFUSED:${r.reason}`, pubkey: r.pubkey ?? null });
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
    if (!fs.existsSync(CACHE_FILE)) pulled = pullArmyKeysFromVault();
    const adopted = await adoptFromCache();
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

export { ARMY as ARMY_ROSTER_VAULT };
