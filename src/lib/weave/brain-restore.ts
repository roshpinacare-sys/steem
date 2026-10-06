// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · brain-restore — השבת המוח מכספת הצי (Task 25)
//
// הוראת המפעיל: "ודא לעגן את הכל — לא לסמוך כלום על הסנדבוקס".
// המוח (3 מפתחות NVIDIA NIM) חי רק ב-DB הסנדבוקס ואבד בקריסה
// (Task 24). המקורות חיים בגיטהאב הפרטי — ולכן השחזור מתרחש
// בענן, מתוך הבית הריבוני, בלי תלות בשום סנדבוקס:
//
//   steem: agent/vault/KEYS-BACKUP-2026-09-09.tar.enc (openssl
//   aes-256-cbc + pbkdf2 300000) + agent/recovery-meta.json (הסיסמה
//   keysBackupPass — משמרת-מערכת, הוראת מפעיל 2026-09-10)
//   Saosmartwallet: db/custom.db — הכספת הישנה (VaultEntry אטומים)
//
// שרשרת הפתיחה (מלאי Task 21, נאמנות-העברה מוכחה): headcorner WIF
// מה-.env שבארכיון → key-seal (scrypt KEK) → master → פענוח
// VaultEntry(chain='nvidia') → אימות טביעת-אצבע מול שדה ה-pub.
//
// חוק ברזל: אפס סוד בפלט — מודפסות טביעות-אצבע בלבד.
// ─────────────────────────────────────────────────────────────────────
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "child_process";
import { Database } from "bun:sqlite";

export const VAULT_SOURCES = {
  steemRepo: "roshpinacare-sys/steem",
  walletRepo: "roshpinacare-sys/Saosmartwallet",
  tarEncPath: "agent/vault/KEYS-BACKUP-2026-09-09.tar.enc",
  recoveryMetaPath: "agent/recovery-meta.json",
  oldDbPath: "db/custom.db",
} as const;

export interface VaultSources {
  workDir: string;
  tarEnc: string;
  recoveryMeta: string;
  oldDb: string;
  keysBackupSha256: string; // המדד המתועד ב-recovery-meta
  archiveShaMatch: boolean;
}

/** הורדת שלושת מקורות הכספת מהגיטהאב הפרטי (קריאה בלבד, כלום לא נכתב לריפו) */
export async function fetchVaultSources(pat: string, workDir: string): Promise<VaultSources> {
  fs.mkdirSync(workDir, { recursive: true });
  const headers = {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github.raw",
    "User-Agent": "weave-brain-restore",
  };
  async function download(repo: string, filePath: string, dest: string): Promise<void> {
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}?ref=main`, {
      headers,
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      throw new Error(`הורדת ${repo}/${filePath} נכשלה: HTTP ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error(`הורדת ${repo}/${filePath}: גוף ריק`);
    fs.writeFileSync(dest, buf, { mode: 0o600 });
  }

  const tarEnc = path.join(workDir, "KEYS-BACKUP.tar.enc");
  const recoveryMeta = path.join(workDir, "recovery-meta.json");
  const oldDb = path.join(workDir, "old-custom.db");
  await download(VAULT_SOURCES.steemRepo, VAULT_SOURCES.tarEncPath, tarEnc);
  await download(VAULT_SOURCES.steemRepo, VAULT_SOURCES.recoveryMetaPath, recoveryMeta);
  await download(VAULT_SOURCES.walletRepo, VAULT_SOURCES.oldDbPath, oldDb);

  const meta = JSON.parse(fs.readFileSync(recoveryMeta, "utf8")) as {
    keysBackupPass?: string;
    keysBackupSha256?: string;
  };
  if (!meta.keysBackupPass || !meta.keysBackupSha256) {
    throw new Error("recovery-meta חסר keysBackupPass/keysBackupSha256");
  }
  const actual = crypto.createHash("sha256").update(fs.readFileSync(tarEnc)).digest("hex");
  const archiveShaMatch = actual === meta.keysBackupSha256;
  if (!archiveShaMatch) {
    throw new Error(
      `שלמות הארכיון נפרצה: sha256 בפועל ${actual.slice(0, 16)}… ≠ המתועד ${meta.keysBackupSha256.slice(0, 16)}… — לא פותחים כלום`
    );
  }

  // הסיסמה חיה בזיכרון בלבד — לא נכתבת לשום קובץ
  (meta as { keysBackupPass?: string }).keysBackupPass = undefined;
  return {
    workDir,
    tarEnc,
    recoveryMeta,
    oldDb,
    keysBackupSha256: meta.keysBackupSha256,
    archiveShaMatch,
  };
}

/** פענוח הארכיון — openssl enc aes-256-cbc + pbkdf2(300000, sha256).
 *  הפורמט: "Salted__" + 8B מלח + צופן; המפתח נגזר 48B (32 מפתח + 16 IV). */
export function decryptKeysBackup(tarEnc: string, pass: string, outDir: string): string {
  const buf = fs.readFileSync(tarEnc);
  if (buf.subarray(0, 8).toString("latin1") !== "Salted__") {
    throw new Error("פורמט ארכיון לא מזוהה — לא Salted__ (openssl enc)");
  }
  const salt = buf.subarray(8, 16);
  const ct = buf.subarray(16);
  const keyIv = crypto.pbkdf2Sync(pass, salt, 300_000, 48, "sha256");
  const dec = crypto.createDecipheriv("aes-256-cbc", keyIv.subarray(0, 32), keyIv.subarray(32, 48));
  const pt = Buffer.concat([dec.update(ct), dec.final()]); // PKCS#7 מוסר אוטומטית
  fs.mkdirSync(outDir, { recursive: true });
  const tarGz = path.join(outDir, "keys-bundle.tar.gz");
  fs.writeFileSync(tarGz, pt, { mode: 0o600 });
  execSync(`tar xzf ${JSON.stringify(tarGz)} -C ${JSON.stringify(outDir)}`, { timeout: 60_000 });
  fs.rmSync(tarGz, { force: true }); // הצרור המפוענח לא נשאר על הדיסק
  return outDir;
}

export interface BrainVaultKey {
  fingerprint: string; // nv-fp:… — מודפס בלבד
  key: string; // בזיכרון בלבד — נאטם מיד בבית
  oldStatus: string;
  oldNote: string;
}

/** פתיחת הכספת הישנה: WIF → key-seal → master → מפתחות NVIDIA.
 *  אותה שרשרת שהוכיחה נאמנות-העברה ב-Task 21. */
export function openOldVault(agentEnvPath: string, oldDbPath: string): BrainVaultKey[] {
  const env = fs.readFileSync(agentEnvPath, "utf8");
  const wifs: string[] = [];
  for (const m of env.matchAll(/^(?:OWNER|ACTIVE|POSTING|MEMO)_WIF=(\S+)$/gm)) {
    wifs.push(m[1]);
  }
  if (wifs.length === 0) throw new Error("אין מפתחות בקרה ב-.env שבארכיון");

  const old = new Database(oldDbPath, { readonly: true });
  try {
    const cfg = old.query("SELECT keySeals FROM GateConfig WHERE id='gate'").get() as
      | { keySeals: string }
      | null;
    if (!cfg?.keySeals) throw new Error("אין keySeals ב-GateConfig הישן");
    const seals = JSON.parse(cfg.keySeals) as Array<{
      pub: string;
      chain: string;
      account: string;
      role: string;
      kdfSalt: string;
      encMaster: string;
      sealIv: string;
      sealTag: string;
    }>;

    const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
    const deriveKek = (pass: string, saltHex: string): Buffer =>
      crypto.scryptSync(pass, Buffer.from(saltHex, "hex"), 32, SCRYPT);
    const openGcm = (key: Buffer, ct: string, iv: string, tag: string): string => {
      const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
      d.setAuthTag(Buffer.from(tag, "hex"));
      return Buffer.concat([d.update(Buffer.from(ct, "hex")), d.final()]).toString("utf8");
    };

    let master: Buffer | null = null;
    let openedWith = "";
    for (const wif of wifs) {
      for (const s of seals) {
        try {
          const hex = openGcm(deriveKek(wif, s.kdfSalt), s.encMaster, s.sealIv, s.sealTag);
          if (hex.length === 64 && /^[0-9a-f]+$/.test(hex)) {
            master = Buffer.from(hex, "hex");
            openedWith = `${s.chain}/${s.account}/${s.role}`;
            break;
          }
        } catch {
          /* GCM דוחה מפתח שגוי מיד — הבא */
        }
      }
      if (master) break;
    }
    if (!master) throw new Error("ה-master של הכספת לא נפתח עם אף מפתח מהארכיון");
    console.log(`[vault] master נפתח דרך key-seal (${openedWith}) — 32B בזיכרון`);

    const rows = old
      .query(
        "SELECT id, pub, encPriv, privIv, privTag, status, verifyNote FROM VaultEntry WHERE chain='nvidia'"
      )
      .all() as Array<{
      id: string;
      pub: string | null;
      encPriv: string;
      privIv: string;
      privTag: string;
      status: string;
      verifyNote: string;
    }>;

    const keys: BrainVaultKey[] = [];
    for (const r of rows) {
      const plain = openGcm(master, r.encPriv, r.privIv, r.privTag);
      const fp = "nv-fp:" + crypto.createHash("sha256").update(plain).digest("hex").slice(0, 16);
      if (r.pub && r.pub.startsWith("nv-fp:") && r.pub !== fp) {
        throw new Error(`אי-התאמת טביעת-אצבע ל-${r.id} — הכספת שונתה?`);
      }
      keys.push({ fingerprint: fp, key: plain, oldStatus: r.status, oldNote: r.verifyNote });
    }
    master = null; // ה-master מקופל מיד
    console.log(`[vault] ${keys.length} מפתחות NVIDIA פוענחו; טביעות נאמתו מול שדה ה-pub`);
    return keys;
  } finally {
    old.close();
  }
}

/** אימות-אמת חי — 1-token chat מול integrate.api.nvidia.com (לא
 *  /v1/models הציבורי-המטעה). מחזיר סטטוס בלבד, אף פעם לא המפתח. */
export async function probeBrainKey(
  key: string
): Promise<{ live: boolean; code: number | string }> {
  try {
    const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b",
        messages: [{ role: "user", content: "1" }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    return { live: res.ok, code: res.status };
  } catch (e) {
    return { live: false, code: e instanceof Error ? e.message.slice(0, 40) : "err" };
  }
}

/** מציאת agent/.env בתוך הארכיון שחולץ — המבנה המתועד ב-README של הכספת */
export function findAgentEnv(extractDir: string): string {
  const candidates = [
    path.join(extractDir, "agent", ".env"),
    path.join(extractDir, "keys-extracted", "agent", ".env"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // חיפוש עומק כללי — הארכיון עשוי להיפרוס תחת תיקיית שורש
  const found = execSync(`find ${JSON.stringify(extractDir)} -type f -name '.env' -path '*/agent/*'`, {
    encoding: "utf8",
    timeout: 30_000,
  })
    .split("\n")
    .filter(Boolean);
  if (found.length === 0) throw new Error("agent/.env לא נמצא בארכיון");
  return found[0];
}
