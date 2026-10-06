#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// SEAL-RECOVER-LOCAL (R93) — שחזור מפתח הרשת ל-DB המקומי אחרי איפוס-סשן
//
// הרקע (נמדד חי, 2026-09-23T00:19Z): איפוס הסנדבוקס מחק את ה-DB כולל
// את מטמון המפתחות (NetworkKey.devKeyHex). הספר שוחזר מ-origin (398/398
// תקפות) אך הריפוי נחסם: ensureDaemonAgent דורש את מפתח הרשת.
//
// הנתיב המתועד (r72 + R91): המפתחות עצמם לעולם לא הוחלפו — רק הסיסמה
// סבבה (G3 → r72). לפני הסבב, הסיסמה חיה במטא שבגיט (דוקטרינת ריפו-פרטי
// דאז). מכאן: blob היסטורי + סיסמה היסטורית = אותם מפתחות בדיוק.
//
// חוקי-ברזל של הסקריפט:
//   · אף מפתח, אף סיסמה — לא מודפסים לעולם. רק כתובות ופסקי-דין.
//   · השופט הוא השרשרת: מפתח הרשת המשוחזר חייב לאמת חתימת checkpoint
//     אמיתית מהספר המיובא (recoverCheckpointSigner). אי-התאמה = סירוב.
//   · כתובות חייבות להתאים משולשת: blob היסטורי ↔ מטא חי ↔ ספר מיובא.
//   · כתיבה ל-DB בלבד (מטמון מקומי) — לעולם לא לגיט, לעולם לא לקנון.
//
// שימוש: bun scripts/seal-recover-local.ts [--dry-run]
// ─────────────────────────────────────────────────────────────────────

import { execSync } from "node:child_process";
import * as crypto from "node:crypto";
import { db } from "../src/lib/db";
import { identityFromKey, recoverCheckpointSigner } from "../src/lib/weave/evm";

const ROOT = process.cwd();
const HIST_COMMIT = "a776515"; // weave-core — הקומיט שבו הסיסמה עוד במטא
const CURRENT_META = `${ROOT}/sovereign/weave-seal.meta.json`;
const MAGIC = "WEAVE-CLOUD-SEAL-1";

function gitShow(ref: string, path: string): string {
  return execSync(`git show ${ref}:${path}`, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).toString();
}

function sealDecrypt(raw: string, passphrase: string) {
  // פורמט הבית המקורי: שורת MAGIC, ואז hex בשורות של 100 תווים
  const lines = raw.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines[0] !== MAGIC) throw new Error("פורמט seal היסטורי לא מזוהה");
  const payload = Buffer.from(lines.slice(1).join(""), "hex");
  const salt = payload.subarray(0, 16);
  const iv = payload.subarray(16, 28);
  const tag = payload.subarray(28, 44);
  const ct = payload.subarray(44);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(pt);
  if (parsed.format !== MAGIC) throw new Error("תוכן seal היסטורי לא מזוהה");
  return parsed as {
    cloudKeyHex: string;
    networkKeyHex: string;
    cloudAddress: string;
    networkAddress: string;
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const verdicts: string[] = [];
  // הערה: חייב להיות declaration-פונקציה (ולא arrow על const) — רק כך
  // מזהה TypeScript את טיפוס ה-never ומצר את ה-null-ability אחרי ה-guard.
  function fail(m: string): never {
    console.error("✗ " + m);
    process.exit(1);
  }

  // 1. הזוג ההיסטורי — blob + סיסמה מהשושלת (בזיכרון בלבד)
  const oldEnc = gitShow(HIST_COMMIT, "sovereign/weave-seal.enc");
  const oldMeta = JSON.parse(gitShow(HIST_COMMIT, "sovereign/weave-seal.meta.json")) as {
    passphrase?: string;
    cloudAddress?: string;
    networkAddress?: string;
  };
  if (!oldMeta.passphrase) fail("אין passphrase במטא ההיסטורי — הנתיב חסום");
  const payload = sealDecrypt(oldEnc, oldMeta.passphrase);
  verdicts.push("פענוח blob היסטורי: אושר (AEAD)");

  // 2. התאמה משולשת של כתובות
  const curMeta = JSON.parse((await import("node:fs")).readFileSync(CURRENT_META, "utf8")) as {
    cloudAddress: string;
    networkAddress: string;
  };
  if (payload.cloudAddress !== curMeta.cloudAddress) fail("כתובת ענן: blob↔מטא-חי סתירה");
  if (payload.networkAddress !== curMeta.networkAddress) fail("כתובת רשת: blob↔מטא-חי סתירה");
  verdicts.push(`כתובות תואמות מטא חי: cloud ${curMeta.cloudAddress.slice(0, 8)}… · network ${curMeta.networkAddress.slice(0, 8)}…`);

  // 3. נגזרת-מחדש — המפתח גוזר בדיוק את הכתובת שבמטא
  const netId = identityFromKey(payload.networkKeyHex);
  const cloudId = identityFromKey(payload.cloudKeyHex);
  if (netId.address !== curMeta.networkAddress) fail("המפתח המשוחזר אינו גוזר את כתובת הרשת");
  if (cloudId.address !== curMeta.cloudAddress) fail("מפתח הענן המשוחזר אינו גוזר את כתובת הענן");
  verdicts.push("גזירה מחדש: שני המפתחות גוזרים בדיוק את כתובותיהם");

  // 4. השופט — השרשרת: checkpoint אחרון עם חתימה מהספר המיובא
  const cp = await db.checkpoint.findFirst({
    where: { sig: { not: null }, signerAddr: { not: null } },
    orderBy: { index: "desc" },
  });
  if (!cp || !cp.sig || !cp.signerAddr) fail("אין checkpoint חתום בספר — אין שופט");
  const cpValue = {
    index: cp.index,
    attFrom: cp.attFrom,
    attTo: cp.attTo,
    root: cp.root,
    prevRoot: cp.prevRoot,
  };
  const recovered = recoverCheckpointSigner(cpValue, cp.sig);
  // אינטגריטי נוסף: ה-digest המחושב מחדש חייב להתאים ל-entryHash הכתוב בספר
  const { checkpointDigest } = await import("../src/lib/weave/evm");
  const recomputed = checkpointDigest(cpValue);
  if (recomputed !== cp.entryHash) {
    fail(`digest mismatch: checkpoint#${cp.index} — הספר אינו עקבי עם עצמו`);
  }
  if (recovered.toLowerCase() !== netId.address.toLowerCase()) {
    fail(`השופט סירב: חתימת checkpoint#${cp.index} שוחזרה ל-${recovered.slice(0, 10)}… ולא לכתובת הרשת`);
  }
  if (recovered.toLowerCase() !== (cp.signerAddr || "").toLowerCase()) {
    fail(`השופט סירב: חותם ה-checkpoint בספר (${cp.signerAddr}) אינו כתובת הרשת`);
  }
  verdicts.push(`השופט אישר: checkpoint#${cp.index} (root ${cp.root.slice(0, 12)}…) נושא חתימת המפתח המשוחזר`);

  // 5. הסוכן בספר — weave-cloud-heart חייב לשאת את כתובת הענן
  const cloudAgent = await db.agent.findUnique({ where: { name: "weave-cloud-heart" } });
  if (!cloudAgent) fail("אין weave-cloud-heart בספר");
  if (cloudAgent.ethAddress.toLowerCase() !== cloudId.address.toLowerCase()) {
    fail("כתובת weave-cloud-heart בספר אינה תואמת את מפתח הענן");
  }
  verdicts.push(`הספר מסכים: weave-cloud-heart = ${cloudAgent.ethAddress.slice(0, 10)}…`);

  // 6. כתיבה — מטמון מקומי בלבד
  if (dryRun) {
    verdicts.push("dry-run: לא נכתב דבר");
  } else {
    // מפתח הרשת
    const nk = await db.networkKey.findUnique({ where: { id: "weave-network" } });
    if (!nk) {
      await db.networkKey.create({
        data: { id: "weave-network", address: netId.address, devKeyHex: payload.networkKeyHex },
      });
    } else {
      if (nk.address.toLowerCase() !== netId.address.toLowerCase()) fail("סתירת כתובת רשת ב-DB");
      if (!nk.devKeyHex) {
        await db.networkKey.update({
          where: { id: "weave-network" },
          data: { devKeyHex: payload.networkKeyHex },
        });
      }
    }
    // מפתח הענן (השלמה בלבד — המפתח לא בגיט מעולם)
    if (!cloudAgent.devKeyHex) {
      await db.agent.update({
        where: { id: cloudAgent.id },
        data: { devKeyHex: payload.cloudKeyHex },
      });
    }
    verdicts.push("נכתב ל-DB מקומי: NetworkKey.devKeyHex + weave-cloud-heart.devKeyHex (מטמון בלבד — לא בגיט)");
  }

  console.log(verdicts.map((v) => "✓ " + v).join("\n"));
  console.log(dryRun ? "DRY-RUN OK" : "SEAL-RECOVER OK");
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ " + String((e as Error)?.message ?? e));
  process.exit(1);
});
