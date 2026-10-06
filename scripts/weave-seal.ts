// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Seal — מפתחות הענן בתוך מעטפת מוצפנת בריפו (zero-touch)
//
// דוקטרינת הצי (fleet_vault, Task 82): הריפו פרטי; זמינות קריטית;
// מפתחות ברור-טקסט לעולם לא בגיט — אבל מעטפת AES-256-GCM כן, עם
// הסיסמה במשמרת מפוצלת. ה-seal הזה נותן
// לפעימת הענן זהות יציבה בין איפוסי סנדבוקס:
//   · cloudKeyHex  — זהות weave-cloud-heart (חותם אימותי פעימה)
//   · networkKeyHex — מפתח הרשת לחתימת checkpoints (EIP-712)
//
// משמרת הסיסמה (G3, 2026-09-14):
//   1. WEAVE_SEAL_PASSPHRASE ב-GitHub Actions Secrets — הענן (ייצור)
//   2. .env.local (לא בגיט) — ה-runner הראשי (הסנדבוקס)
//   3. הכספת האישית של המפעיל — cat .env.local
//   הסיסמה לא נמצאת בגיט — המעטפת חסרת-ערך לבדה.
//
// שימוש:
//   bun scripts/weave-seal.ts --create          # יוצר/מחליף seal מה-DB
//   bun scripts/weave-seal.ts --status          # קיום + כתובות בלבד
//   bun scripts/weave-seal.ts --rotate-secret   # סבב משמרת: סיסמה חדשה →
//                                                 # .enc מוצפן מחדש + סוד בגיטהאב
//                                                 # + .env.local; הסיסמה לא נדפסת
// ─────────────────────────────────────────────────────────────────────

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { db } from "@/lib/db";
import { generateIdentity, identityFromKey } from "@/lib/weave/evm";
import { setSecret } from "./weave-secret";

const ROOT = path.resolve(__dirname, "..");
const SEAL_DIR = path.join(ROOT, "sovereign");
const ENC_PATH = path.join(SEAL_DIR, "weave-seal.enc");
const META_PATH = path.join(SEAL_DIR, "weave-seal.meta.json");
const ENV_LOCAL_PATH = path.join(ROOT, ".env.local");
const SECRET_NAME = "WEAVE_SEAL_PASSPHRASE";
const MAGIC = "WEAVE-CLOUD-SEAL-1";

export interface SealPayload {
  format: typeof MAGIC;
  sealedAt: string;
  cloudKeyHex: string;
  networkKeyHex: string;
  cloudAddress: string;
  networkAddress: string;
}

/** סיסמת ה-seal — הסביבה קודם (GitHub Secret בענן / .env.local מקומי),
 *  ואז meta ישן לתאימות לאחור. בלי שתיהן — שגיאה עם הסבר מלא. */
function sealPassphrase(): { value: string; source: "env" | "meta" } {
  const env = process.env.WEAVE_SEAL_PASSPHRASE;
  if (env && env.trim().length > 0) return { value: env.trim(), source: "env" };
  if (fs.existsSync(META_PATH)) {
    const meta = JSON.parse(fs.readFileSync(META_PATH, "utf8")) as { passphrase?: string };
    if (typeof meta.passphrase === "string" && meta.passphrase.length > 0) {
      return { value: meta.passphrase, source: "meta" };
    }
  }
  throw new Error(
    "אין סיסמת seal: WEAVE_SEAL_PASSPHRASE לא בסביבה (GitHub Secret בענן / .env.local מקומי) ואין passphrase ב-meta — סבב משמרת: bun scripts/weave-seal.ts --rotate-secret"
  );
}

function sealDecrypt(hex: string, passphrase: string): SealPayload {
  const payload = Buffer.from(hex, "hex");
  const salt = payload.subarray(0, 16);
  const iv = payload.subarray(16, 28);
  const tag = payload.subarray(28, 44);
  const ct = payload.subarray(44);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(pt) as SealPayload;
  if (parsed.format !== MAGIC) throw new Error("תוכן seal לא מזוהה");
  return parsed;
}

function sealEncrypt(payload: SealPayload, passphrase: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, ct]).toString("hex");
}

function sealVerifyIntegrity(parsed: SealPayload): void {
  // בדיקת שלמות: הכתובות נגזרות מהמפתחות וחייבות להתאים
  if (identityFromKey(parsed.cloudKeyHex).address !== parsed.cloudAddress) {
    throw new Error("seal פגום — כתובת הענן אינה נגזרת מהמפתח");
  }
  if (identityFromKey(parsed.networkKeyHex).address !== parsed.networkAddress) {
    throw new Error("seal פגום — כתובת הרשת אינה נגזרת מהמפתח");
  }
}

export function sealOpen(): SealPayload {
  const raw = fs.readFileSync(ENC_PATH, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  if (lines[0] !== MAGIC) throw new Error("פורמט seal לא מזוהה");
  const hex = lines.slice(1).join("");
  const { value, source } = sealPassphrase();
  const parsed = sealDecrypt(hex, value);
  sealVerifyIntegrity(parsed);
  if (source === "meta") {
    console.warn("[weave-seal] ⚠ נפתח מ-meta ישן — משמרת הייצור היא Secrets/.env.local");
  }
  return parsed;
}

/** כתיבת המעטפת לגיט + משמרת מפוצלת: סוד בגיטהאב, .env.local מקומי,
 *  meta ללא סיסמה. הסיסמה לעולם לא נדפסת ולעולם לא נכנסת לגיט. */
async function sealWrite(
  payload: SealPayload,
  passphrase: string
): Promise<void> {
  fs.mkdirSync(SEAL_DIR, { recursive: true });
  const hex = sealEncrypt(payload, passphrase);
  fs.writeFileSync(ENC_PATH, MAGIC + "\n" + (hex.match(/.{1,100}/g) ?? []).join("\n") + "\n", {
    mode: 0o600,
  });

  // 1. משמרת הייצור — GitHub Actions Secret (sealed box דרך ה-API)
  const status = await setSecret(SECRET_NAME, passphrase);
  console.log(
    `[weave-seal] הסוד ${SECRET_NAME} ${status === 201 ? "נוצר" : "עודכן"} ב-GitHub (הענן יכול לפתוח את ה-seal)`
  );

  // 2. ה-runner הראשי — .env.local (bun טוען אותו אוטומטית; לא בגיט)
  writeEnvLocal(passphrase);
  console.log("[weave-seal] .env.local עודכן עם WEAVE_SEAL_PASSPHRASE (מקומי בלבד)");

  // 3. meta — בלי סיסמה; כתובות + מפת משמרת לכל clone עתידי
  fs.writeFileSync(
    META_PATH,
    JSON.stringify(
      {
        format: MAGIC,
        at: payload.sealedAt,
        rotatedAt: new Date().toISOString(),
        custody: {
          primary: `GitHub Actions Secret: ${SECRET_NAME} (הענן — ייצור)`,
          local: ".env.local (ה-runner הראשי; לא בגיט — .env.* מחוץ לריפו)",
          operator: "הכספת האישית של המפעיל — הרץ: cat .env.local",
        },
        kdf: "scrypt(2^14)",
        enc: "aes-256-gcm",
        cloudAddress: payload.cloudAddress,
        networkAddress: payload.networkAddress,
        note: "המעטפת חסרת-ערך לבדה — הסיסמה במשמרת מפוצלת (Secrets/.env.local/כספת המפעיל) ולעולם לא בגיט.",
      },
      null,
      2
    ) + "\n"
  );

  // 4. הוכחת סבב-ידנית — פתיחה חוזרת מהסיסמה החדשה בזיכרון בלבד
  const reopened = sealDecrypt(hex, passphrase);
  sealVerifyIntegrity(reopened);
  if (reopened.cloudAddress !== payload.cloudAddress) {
    throw new Error("סבב משמרת נכשל — פתיחה חוזרת לא תואמת");
  }
}

function writeEnvLocal(passphrase: string): void {
  let content = "";
  if (fs.existsSync(ENV_LOCAL_PATH)) {
    content = fs.readFileSync(ENV_LOCAL_PATH, "utf8");
  }
  const line = `WEAVE_SEAL_PASSPHRASE=${passphrase}`;
  if (/^WEAVE_SEAL_PASSPHRASE=.*$/m.test(content)) {
    content = content.replace(/^WEAVE_SEAL_PASSPHRASE=.*$/m, line);
  } else {
    content = (content.endsWith("\n") || content === "" ? content : content + "\n") + line + "\n";
  }
  fs.writeFileSync(ENV_LOCAL_PATH, content, { mode: 0o600 });
}

async function sealCreate(): Promise<void> {
  const network = await db.networkKey.findUnique({ where: { id: "weave-network" } });
  if (!network || !network.devKeyHex) {
    throw new Error("אין מפתח רשת ב-DB — צור checkpoint פעם אחת לפני ה-seal");
  }

  // זהות ענן חדשה אם אינה קיימת; אם קיימת — נעילת המפתח הקיים (יציבות זהות)
  const existing = await db.agent.findUnique({ where: { name: "weave-cloud-heart" } });
  let cloudKeyHex: string;
  if (existing?.devKeyHex) {
    cloudKeyHex = existing.devKeyHex;
  } else {
    cloudKeyHex = generateIdentity().devKeyHex;
  }
  const cloudAddress = identityFromKey(cloudKeyHex).address;

  const payload: SealPayload = {
    format: MAGIC,
    sealedAt: new Date().toISOString(),
    cloudKeyHex,
    networkKeyHex: network.devKeyHex,
    cloudAddress,
    networkAddress: network.address,
  };
  const passphrase = crypto.randomBytes(32).toString("base64url");

  await sealWrite(payload, passphrase);
  console.log("seal נוצר:", ENC_PATH);
  console.log("  cloudAddress:", cloudAddress);
  console.log("  networkAddress:", network.address);
  console.log("  משמרת: GitHub Secret + .env.local + כספת המפעיל (cat .env.local)");
}

/** סבב משמרת (G3): אותם מפתחות — מעטפת וסיסמה חדשות.
 *  הסיסמה הישנה (env/meta) נדרשת לפתיחה; החדשה נכנסת ל-Secrets+.env.local.
 *  המפתחות עצמם אינם מוחלפים — יציבות זהות הרשת נשמרת. */
async function sealRotateSecret(): Promise<void> {
  if (!fs.existsSync(ENC_PATH)) {
    throw new Error("אין seal לסבב — הרץ --create קודם");
  }
  const payload = sealOpen(); // נפתח עם הסיסמה הנוכחית (env או meta ישן)
  const passphrase = crypto.randomBytes(32).toString("base64url");
  await sealWrite({ ...payload, sealedAt: new Date().toISOString() }, passphrase);
  console.log("[weave-seal] סבב משמרת הושלם — אותם מפתחות, מעטפת חדשה:");
  console.log("  cloudAddress:", payload.cloudAddress, "(לא השתנה)");
  console.log("  networkAddress:", payload.networkAddress, "(לא השתנה)");
  console.log("  ⚠ שמור את הסיסמה בכספת אישית: cat .env.local");
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "--status";
  if (mode === "--create") {
    await sealCreate();
    return;
  }
  if (mode === "--rotate-secret") {
    await sealRotateSecret();
    return;
  }
  // status
  const exists = fs.existsSync(ENC_PATH);
  console.log("seal:", exists ? "קיים" : "חסר");
  if (exists && fs.existsSync(META_PATH)) {
    const meta = JSON.parse(fs.readFileSync(META_PATH, "utf8")) as {
      at?: string;
      rotatedAt?: string;
      passphrase?: string;
      kdf?: string;
      enc?: string;
      cloudAddress?: string;
      networkAddress?: string;
      custody?: Record<string, string>;
    };
    console.log("  sealedAt:", meta.at, "| rotatedAt:", meta.rotatedAt ?? "—", "| kdf:", meta.kdf, "| enc:", meta.enc);
    console.log("  cloudAddress:", meta.cloudAddress);
    console.log("  networkAddress:", meta.networkAddress);
    console.log(
      "  משמרת:",
      meta.passphrase
        ? "⚠ LEGACY — הסיסמה ב-meta בגיט (סבב: --rotate-secret)"
        : meta.custody
          ? `Secrets + .env.local (rotated ${meta.rotatedAt ?? "?"})`
          : "לא מתועדת"
    );
  }
}

// ריצה כ-CLI בלבד כשהמודול הוא ה-entry (לא בעת import מ-weave-beat)
if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("SEAL-ERROR:", e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
