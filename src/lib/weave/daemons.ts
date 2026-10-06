// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Daemons — זהויות רשת-רמה שנגזרות ממפתח הרשת שב-seal
//
// הבעיה שהמודול הזה סוגר (נתפסה בקריאה לפני Task 17): זהויות DAEMON
// שנוצרו עם מפתח אקראי (generateIdentity) חיות רק על המכונה שיצרה
// אותן — ledger.json חסר-סודות משחזר אותן בענן בלי מפתח, ו-ensure
// שנתקל בסוכן קיים-וחסר-מפתח נכשל (fail-closed) ⇒ הפעימה העננית
// שצריכה לחתום קורסת.
//
// הפתרון — אותה דוקטרינה של מפתח הרשת עצמו: הזהויות נגזרות
// דטרמיניסטית ממפתח הרשת (שחי רק ב-seal):
//   devKey = keccak256("weave-daemon/v1:<name>:<networkKeyHex>")
// אותה כתובת בכל סביבה שפותחת את ה-seal; ייבוא הספר משאיר את הסוכן
// בלי מפתח — וה-ensure משלים אותו מהגזירה (self-heal, בדיוק כמו
// ensureCloudAgent ו-ensureNetworkKeyFromSeal). mismatch בכתובת =
// הזהות בספר אינה נגזרת — fail-closed, לא נטענים זהות שאיננו.
//
// ⚠ DEVNET: המפתח הנגזר נשמר ב-DB (מטמון מקומי בלבד, לעולם לא
// ב-ledger.json). בייצור — הגזירה רצה אצל הסוכן/ה-runner מה-seal.
// ─────────────────────────────────────────────────────────────────────

import { keccak256, toUtf8Bytes } from "ethers";
import { db } from "@/lib/db";
import { identityFromKey } from "./evm";

export const DAEMON_DERIVATION_VERSION = "weave-daemon/v1";

/** שגיאת DAEMON עם קוד HTTP צפוי — ההודעה בעברית ומיועדת ללקוח */
export class DaemonError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "DaemonError";
    this.status = status;
  }
}

/**
 * הגזירה הדטרמיניסטית — אותו שם + אותו מפתח רשת = אותו מפתח DAEMON
 * בכל מכונה. הקלט הקנוני מתועד כאן והוא חלק מהפרוטוקול (לא לשנות —
 * שינוי ינתק את כל הזהויות הנגזרות מהספר).
 */
export function deriveDaemonKeyHex(name: string, networkKeyHex: string): string {
  return keccak256(toUtf8Bytes(`${DAEMON_DERIVATION_VERSION}:${name}:${networkKeyHex}`));
}

/** מפתח הרשת מה-DB (מובטח ע"י הפעימה מה-seal; בסנדבוקס קיים תמיד) */
export async function networkKeyHexOrFail(): Promise<string> {
  const nk = await db.networkKey.findUnique({ where: { id: "weave-network" } });
  if (!nk || !nk.devKeyHex) {
    throw new DaemonError(
      "מפתח הרשת אינו זמין — זהויות DAEMON נגזרות מה-seal דרך מפתח הרשת (הרץ פעימה או פתח seal תחילה)",
      500
    );
  }
  return nk.devKeyHex;
}

export interface DaemonAgent {
  id: string;
  name: string;
  role: string;
  ethAddress: string;
}

/**
 * זהות DAEMON נגזרת-seal — create-or-self-heal:
 *   · קיים עם מפתח        ⇒ החזר (מסלול מהיר בסנדבוקס)
 *   · קיים בלי מפתח        ⇒ השלם מהגזירה — אם הכתובת תואמת (clone/ענן)
 *   · קיים בכתובת אחרת     ⇒ fail-closed: הזהות בספר אינה נגזרת
 *   · לא קיים              ⇒ צור מהגזירה
 */
export async function ensureDaemonAgent(name: string, role: string): Promise<DaemonAgent> {
  const netKey = await networkKeyHexOrFail();
  const devKeyHex = deriveDaemonKeyHex(name, netKey);
  const identity = identityFromKey(devKeyHex);

  const existing = await db.agent.findUnique({ where: { name } });
  if (existing) {
    if (existing.ethAddress !== identity.address) {
      throw new DaemonError(
        `זהות ה-DAEMON "${name}" בספר אינה נגזרת ממפתח הרשת (כתובת ${existing.ethAddress} ≠ נגזרת ${identity.address}) — fail-closed; נדרשת מיגרציה מתועדת`,
        500
      );
    }
    if (!existing.devKeyHex) {
      await db.agent.update({ where: { id: existing.id }, data: { devKeyHex } });
    }
    return { id: existing.id, name: existing.name, role: existing.role, ethAddress: existing.ethAddress };
  }

  const created = await db.agent.create({
    data: {
      name,
      role,
      ethAddress: identity.address,
      pubKeyHex: identity.pubKeyHex,
      devKeyHex, // ⚠ DEVNET מטמון מקומי — לעולם לא ב-ledger.json
      status: "ACTIVE",
    },
  });
  return { id: created.id, name: created.name, role: created.role, ethAddress: created.ethAddress };
}
