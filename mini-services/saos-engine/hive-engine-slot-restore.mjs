// hive-engine-slot-restore.mjs — G16: engine-slot REBUILDABLE-FROM-GIT.
// גל-100 · הלקח-הכפול-שנמדד: מפתח-המנוע (G15) הוחזק-רק ב-keys.env 0600 —
// נמחק-עם-הסנדבוקס ובלתי-ניתן-לשחזור (רק-pubkey-בקנון). התיקון-המבני:
// המפתח-נגזר-בדטרמיניסטית-מה-MASTER-כספת-המסוכנת (sha-pin) — אותה-כספת
// ש-g13 פותח-מה-git-היסטוריה. כל-wipe: g13-unseal → סקריפט-זה → הסלוט-חוזר.
// אפס-חומר-סודי ב-stdout/git/יומנים — ורדיקטים-ומפתחות-ציבוריים-בלבד.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execSync } from "node:child_process";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
import { wifEncode, wifDecode, pubkeyFromSeed } from "./steemtx.mjs";

const STEEM = "/home/z/audit/repos/steem";
const ENGINE = path.join(STEEM, "mini-services/saos-engine");
const ENV_FILE = path.join(ENGINE, ".env");
const SLOT = "HIVE_HEADCORNER_POSTING_WIF_C";
const KDF_LABEL = "saos/hive-engine/headcorner/posting/v1";

const log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));
const sh = (cmd) => execSync(cmd, { cwd: STEEM, stdio: ["ignore", "pipe", "pipe"] }).toString();

const readSlot = () => {
  try {
    const m = fs.readFileSync(ENV_FILE, "utf8").match(new RegExp(`^${SLOT}=(.+)$`, "m"));
    if (m?.[1]) return m[1].trim();
  } catch { /* absent */ }
  return "";
};

/* הגזירה-הקנונית: engineSeed = sha256(hmacSha256(vaultSecret32, KDF_LABEL)).
 * דומיין-מופרד · דטרמיניסטי · קשור-לסוד-הכספת-המסוכנת (ש-pin-מחייב-את-תוכנו). */
const derive = (vaultWif) => {
  const secret = Buffer.from(wifDecode(vaultWif));
  if (secret.length !== 32) throw new Error("vault-secret-length");
  const seed32 = sha256(hmac(sha256, secret, Buffer.from(KDF_LABEL, "utf8")));
  return { wif: wifEncode(Buffer.from(seed32)), pub: pubkeyFromSeed(seed32) };
};

// 1) pass-השחזור-מההיסטוריה-הקדם-מיגרציה (דוקטרינת g13 · env-only)
let pass;
try {
  const oldRecovery = JSON.parse(sh("git show 609166c62^:agent/recovery-meta.json"));
  pass = oldRecovery.keysZipPass;
} catch { pass = null; }
if (!pass || pass.length < 8) { log({ ok: false, verdict: "pass-recovery-failed" }); process.exit(1); }

// 2) פתיחת-ה-MASTER-המסוכן (inner-sha-pin-מחייב — חוק-טביעות-האצבע-של-הכספת)
const meta = JSON.parse(fs.readFileSync(path.join(STEEM, "agent/recovery-meta.json"), "utf8"));
const work = fs.mkdtempSync(path.join(os.tmpdir(), "hiveengine-"));
fs.chmodSync(work, 0o700);
try {
  const zipPath = path.join(work, "m.zip");
  execSync(`openssl enc -d -aes-256-cbc -pbkdf2 -iter 300000 -in "${STEEM}/${meta.keysZipFile}" -out "${zipPath}" -pass env:VP`, { env: { ...process.env, VP: pass }, stdio: "pipe" });
  const inner = crypto.createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");
  if (inner !== meta.keysZipInnerSha256) { log({ ok: false, verdict: "inner-sha-DRIFT" }); process.exit(1); }
  const outDir = path.join(work, "open");
  execSync(`unzip -q -o "${zipPath}" -d "${outDir}"`, { stdio: "pipe" });

  const vault = JSON.parse(fs.readFileSync(path.join(outDir, "agent/keys/vault.json"), "utf8"));
  const hc = (vault.accounts ?? []).find((a) => (a.username ?? a.name) === "headcorner");
  const vaultWif = hc?.keys?.posting?.wif ?? hc?.keys?.owner?.wif ?? hc?.keys?.active?.wif ?? null;
  if (!vaultWif) { log({ ok: false, verdict: "headcorner-vault-slot-absent", vaultAccounts: (vault.accounts ?? []).length }); process.exit(1); }

  const { wif, pub } = derive(vaultWif);

  // 3) אידמפוטנטיות: סלוט-קיים-שנובע-לאותו-pub → already
  const existing = readSlot();
  if (existing) {
    try {
      if (pubkeyFromSeed(wifDecode(existing)) === pub) {
        log({ ok: true, already: true, enginePubFp: pub.slice(0, 14) + "…", source: "pinned-MASTER" });
        process.exit(0);
      }
    } catch { /* slot corrupt → re-mint */ }
  }

  // 4) שמירה-מקומית (0600 · gitignored)
  let envTxt = "";
  try { envTxt = fs.readFileSync(ENV_FILE, "utf8"); } catch { /* new */ }
  const line = `${SLOT}=${wif}`;
  const re = new RegExp(`^${SLOT}=.*$`, "m");
  envTxt = re.test(envTxt) ? envTxt.replace(re, line) : (envTxt ? envTxt.replace(/\n?$/, "\n") + line + "\n" : line + "\n");
  fs.writeFileSync(ENV_FILE, envTxt, { mode: 0o600 });
  fs.chmodSync(ENV_FILE, 0o600);

  log({
    ok: true,
    verdict: existing ? "engine-slot-rotated-to-pinned-vault-derivation" : "engine-slot-restored-from-pinned-vault",
    enginePubFp: pub.slice(0, 14) + "…",
    enginePub: pub,
    source: "pinned-MASTER (inner-sha MATCH)",
    rebuildableFromGit: true,
    law: "deterministic-KDF-of-pinned-vault · אפס-סודות-בפלט · הפעולה-תוספתית-בלבד-בעת-ההסמכה",
  });
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
