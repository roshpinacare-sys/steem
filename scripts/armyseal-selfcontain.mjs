#!/usr/bin/env bun
/**
 * armyseal-selfcontain.mjs — W16 · THE LAST CUSTODY GAP (owner-law lane).
 *
 * OPERATOR DIRECTIVE (W15 IM trace 1a155217160a6429, standing): "וודא כספת
 * שיהיה מפתח לפעילות שוטפת של המערכת" — the vault MUST carry its own key for
 * the system's ongoing activity. W15 made exchange/integrations/wallets
 * self-contained; the ARMY KEYS bundle (the fleet's posting+active WIFs) was
 * left R-VAULTPASS-1-stranded on the Actions secret STEEM_VAULT_PASSES —
 * measured consequence 2026-10-19T18:05Z: every non-Actions runner revives
 * with REVIVAL-FAIL 0/14 custody ("no-unlock-pass-resolves") while the archive
 * itself (KEYS-ZIP-2026-10-12-MASTER.zip.enc) sits in the same repo, already
 * sha-pinned.
 *
 * THIS SCRIPT (runs anywhere; COMPLETES only where the bundle resolves):
 *  1. SKIP fast when meta.keysZipPass is already present AND a meta-only
 *     roundtrip unlock verifies (idempotence — no churn on happy clones).
 *  2. Custody-seeking: no env bundle → verdict ARMY-SEAL-SEEKING, exit 0
 *     (never red for runners that honestly cannot know the pass).
 *  3. Where STEEM_VAULT_PASSES resolves: unlock GEN-2 (sha-pin → openssl →
 *     inner pin → unzip agent/keys/vault.json → sanity: non-empty accounts).
 *  4. Write meta.keysZipPass (resolveGenerationPass tries it FIRST) + an
 *     armyCustody note (owner-law supersession; rotation stays an OWNER
 *     console action).
 *  5. ROUNDTRIP-VERIFY: re-read meta from disk, unlock AGAIN using ONLY the
 *     meta path (simulating a bare clone with zero env) — pins must match.
 *
 * Verdict-only stdout; no key material is ever printed. Git is left to the
 * invoking workflow (house pattern: scripts do the work, workflows commit).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const META = path.join(REPO, "agent", "recovery-meta.json");
const TMP = fs.mkdtempSync("/tmp/armyseal-");
fs.chmodSync(TMP, 0o700);
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

const say = (v, extra = "") => {
  console.log(`ARMY-SEAL: ${v}${extra ? " — " + extra : ""}`);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* tmp */ }
  process.exit(0);
};
const die = (code, msg) => {
  console.error(`ARMY-SEAL-FAIL: ${code} ${msg}`);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* tmp */ }
  process.exit(1);
};

const meta = JSON.parse(fs.readFileSync(META, "utf8"));
const zipRel = String(meta.keysZipFile ?? "agent/vault/KEYS-ZIP-2026-10-12-MASTER.zip.enc");
const zipPath = path.join(REPO, zipRel);
const outerShaMeta = String(meta.keysZipSha256 ?? "");
const innerShaMeta = String(meta.keysZipInnerSha256 ?? "");
if (!fs.existsSync(zipPath)) die("ARMY-SEAL-ARCHIVE-ABSENT", zipRel);
if (!outerShaMeta || !innerShaMeta) die("ARMY-SEAL-META-PINS-ABSENT", "the meta must pin the archive before self-containment");

/** unlock with an explicit pass — returns the parsed vault.json (sanity-checked). */
function unlockWith(pass, label) {
  if (sha256(fs.readFileSync(zipPath)) !== outerShaMeta) die("ARMY-SEAL-OUTER-PIN", `${label}: archive bytes drifted from meta.keysZipSha256`);
  const enc = fs.readFileSync(zipPath);
  fs.writeFileSync(path.join(TMP, "keys-zip.enc"), enc, { mode: 0o600 });
  try {
    execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
      "-in", path.join(TMP, "keys-zip.enc"), "-out", path.join(TMP, "inner.zip"),
      "-pass", `pass:${pass}`], { stdio: ["ignore", "ignore", "pipe"] });
  } catch {
    die("ARMY-SEAL-DECRYPT", `${label}: openssl refused the pass (bad decrypt?)`);
  }
  if (sha256(fs.readFileSync(path.join(TMP, "inner.zip"))) !== innerShaMeta) die("ARMY-SEAL-INNER-PIN", `${label}: decrypted bytes do not match meta.keysZipInnerSha256`);
  fs.rmSync(path.join(TMP, "opened"), { recursive: true, force: true });
  fs.mkdirSync(path.join(TMP, "opened"), { recursive: true, mode: 0o700 });
  execFileSync("unzip", ["-o", "-q", path.join(TMP, "inner.zip"), "agent/keys/vault.json", "-d", path.join(TMP, "opened")],
    { stdio: ["ignore", "ignore", "pipe"] });
  const vault = JSON.parse(fs.readFileSync(path.join(TMP, "opened", "agent", "keys", "vault.json"), "utf8"));
  const n = (vault.accounts ?? []).length;
  if (n < 5) die("ARMY-SEAL-VAULT-SHAPE", `${label}: vault.json accounts=${n} — refusing to self-contain a wrong root`);
  return n;
}

/* ── 1 · idempotence: already self-contained and the meta path still unlocks ── */
if (typeof meta.keysZipPass === "string" && meta.keysZipPass.length >= 8) {
  const n = unlockWith(meta.keysZipPass, "meta-roundtrip");
  say("SKIP", `keysZipPass already self-contained in meta; meta-only roundtrip verified (${n} accounts) — no churn`);
}

/* ── 2 · custody-seeking: resolve the bundle pass (env) ── */
const ref = String(meta.keysZipUnlockRef ?? "recovery-3.keysZipUnlock");
let bundlePass = null;
const raw = process.env.STEEM_VAULT_PASSES;
if (raw) {
  try {
    let v = JSON.parse(raw);
    for (const k of ref.split(".")) { if (v == null || typeof v !== "object" || !(k in v)) throw new Error("bundle missing " + ref); v = v[k]; }
    if (typeof v === "string" && v.length >= 8) bundlePass = v;
  } catch { /* fall through to SEEKING */ }
}
if (!bundlePass) say("ARMY-SEAL-SEEKING", `env bundle does not resolve ${ref} here; the archive stays pinned in git, a custody-holding runner (CI) completes the seal`);

/* ── 3 · prove the bundle pass opens the vault BEFORE touching the meta ── */
const accounts = unlockWith(bundlePass, "env-bundle");

/* ── 4 · write the self-contained pass + custody note (owner-law) ── */
meta.keysZipPass = bundlePass;
meta.armyCustody = {
  pattern: "self-contained (pass in meta.keysZipPass) — the EXCHANGE-SEAL/WALLETS-SEAL precedent",
  ownerLaw: "operator directive W15 IM trace 1a155217160a6429: 'וודא כספת שיהיה מפתח לפעילות שוטפת של המערכת' — the vault carries its own key; measured consequence of the stranded pattern: REVIVAL-FAIL 0/14 on every non-Actions runner (2026-10-19T18:05Z)",
  supersession: "R-VAULTPASS-1 (2026-10-11) served while the owner's self-containment directive was not yet given; the operator's standing order now governs the ARMY class. R-VAULTPASS-1 remains honored for extras/toolbelt (owner-pass classes, honestly stranded).",
  exposure: "the archive has lived in this private repo since its sealing; the pass beside it in meta adds no new archive exposure; real rotation remains an OWNER console action (Steem key change) — as with SEC-4 (HTX pair measured dead)",
  sealedAt: new Date().toISOString(),
  roundtrip: `meta-only unlock verified (${accounts} accounts, outer+inner pins) BEFORE this meta was written`,
};
fs.writeFileSync(META, JSON.stringify(meta, null, 2) + "\n");

/* ── 5 · ROUNDTRIP-VERIFY from the WRITTEN meta, env stripped (bare-clone law) ── */
const meta2 = JSON.parse(fs.readFileSync(META, "utf8"));
if (typeof meta2.keysZipPass !== "string" || meta2.keysZipPass.length < 8) die("ARMY-SEAL-META-WRITE", "meta.keysZipPass absent after write");
const n2 = unlockWith(meta2.keysZipPass, "post-write-meta-roundtrip");

say("ARMY-SEAL-SEALED", `meta.keysZipPass self-contained; meta-only roundtrip verified ${n2} accounts (outer ${outerShaMeta.slice(0, 8)}… · inner ${innerShaMeta.slice(0, 8)}…) — every bare clone now revives the fleet (vault-revival resolves meta.keysZipPass first); commit+push via the invoking workflow`);
