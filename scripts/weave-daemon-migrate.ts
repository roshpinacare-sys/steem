#!/usr/bin/env bun
/* weave-daemon-migrate.ts — מיגרציה חד-פעמית של זהויות DAEMON לגזירה מה-seal
 *
 * הרקע (Task 17, נתפס בקריאה לפני הכתיבה): רגולטור השוק נוצר עם מפתח
 * אקראי (generateIdentity) שחי רק ב-DB של הסנדבוקס. ledger.json חסר-סודות
 * משחזר אותו בענן בלי מפתח ⇒ הפעימה העננית שמנסה לסלק שוק נכשלת
 * (fail-closed) ⇒ הלב הענני היה קורס בסליקה הראשונה (m#1 פג תוקף
 * 2026-09-15T12:00Z).
 *
 * התיקון המבני: זהויות DAEMON נגזרות דטרמיניסטית ממפתח הרשת שב-seal
 * (src/lib/weave/daemons.ts) — אותה כתובת בכל סביבה, self-heal בכל מקום.
 *
 * המיגרציה הזו (אידמפוטנטית, מתועדת בספר):
 *   1. הזהות הישנה פורשת — משנה שם ל-"…-v1-retired"; הכתובת והאימותים
 *      החתומים נשארים עליה (היסטוריה שלמה — verifyLedger מאמת מול הטבלה).
 *   2. הזהות החדשה נוצרת מהגזירה (אותו שם קנוני).
 *   3. אימות AUDIT חתום ע"י הרגולטור החדש (הפעולה הראשונה שלו) מתעד
 *      את ההעברה: כתובות, מספר האימותים שנשארו על הפורשת, הסיבה.
 *   4. checkpoint מכסה + ייצוא ledger.json (הדחיפה באחריות הפעימה הבאה).
 *
 * הרצה: bun scripts/weave-daemon-migrate.ts
 */
import * as fs from "fs";
import * as path from "path";
import { db } from "@/lib/db";
import { deriveDaemonKeyHex, ensureDaemonAgent, networkKeyHexOrFail } from "@/lib/weave/daemons";
import { identityFromKey } from "@/lib/weave/evm";
import { appendAttestation } from "@/lib/weave/ledger";
import { createCheckpointNow } from "@/lib/weave/beat";
import { exportLedger } from "@/lib/weave/ledger-sync";

const ROOT = path.resolve(__dirname, "..");
const LEDGER_PATH = path.join(ROOT, "sovereign", "ledger.json");
const DAEMON_NAME = "weave-market-regulator";
const RETIRED_NAME = "weave-market-regulator-v1-retired";

async function main(): Promise<void> {
  const netKey = await networkKeyHexOrFail();
  const derived = identityFromKey(deriveDaemonKeyHex(DAEMON_NAME, netKey));

  const current = await db.agent.findUnique({ where: { name: DAEMON_NAME } });
  const retired = await db.agent.findUnique({ where: { name: RETIRED_NAME } });

  if (!current && retired) {
    const regulator = await ensureDaemonAgent(DAEMON_NAME, "DAEMON");
    console.log(`[migrate] כבר מוּגרר — הרגולטור הנגזר: ${regulator.ethAddress}`);
    return;
  }
  if (!current) {
    const regulator = await ensureDaemonAgent(DAEMON_NAME, "DAEMON");
    console.log(`[migrate] אין רגולטור ישן בספר — נוצר נגזר-seal ישירות: ${regulator.ethAddress}`);
    return;
  }
  if (current.ethAddress === derived.address) {
    console.log(`[migrate] הרגולטור כבר נגזר מה-seal (${derived.address}) — אין מיגרציה`);
    return;
  }

  // ── המיגרציה עצמה ──
  const attCount = await db.attestation.count({ where: { agentId: current.id } });
  const oldAddress = current.ethAddress;

  // 1. הישן פורש — השם משתחרר; הכתובת והאימותים נשארים עליו (שלמות היסטוריה)
  await db.agent.update({ where: { id: current.id }, data: { name: RETIRED_NAME } });

  // 2. החדש נוצר מהגזירה
  const regulator = await ensureDaemonAgent(DAEMON_NAME, "DAEMON");

  // 3. תיעוד בספר — אימות AUDIT חתום ע"י הרגולטור החדש
  const att = await appendAttestation({
    agentId: regulator.id,
    claim:
      `מיגרציית רגולטור השוק לזהות נגזרת-seal: הזהות הישנה (מפתח אקראי, מקומי בלבד) ` +
      `פורשה עם ${attCount} אימותים חתומים שנשארים עליה לצמיתות; מעתה הרגולטור נגזר ` +
      `דטרמיניסטית ממפתח הרשת שב-seal — אותה כתובת בכל סביבה, השלמה-עצמית אחרי כל ייבוא.`,
    claimType: "AUDIT",
    evidence: [
      `kind=daemon-migration`,
      `daemon=${DAEMON_NAME}`,
      `retiredName=${RETIRED_NAME}`,
      `retiredAddress=${oldAddress}`,
      `attestationsUnderRetired=${attCount}`,
      `newAddress=${regulator.ethAddress}`,
      `derivation=weave-daemon/v1 · keccak256(version:name:networkKey)`,
      `reason=ledger.json חסר-סודות — זהות אקראית לא שורדת ייבוא בענן; נגזרת-seal משלימה את עצמה בכל מקום`,
      `at=${new Date().toISOString()}`,
    ].join(" · "),
  });

  // 4. checkpoint מכסה + ייצוא הספר
  const cp = await createCheckpointNow();
  const snap = await exportLedger();
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(snap, null, 2) + "\n");

  console.log(
    `[migrate] הושלם: retired=${RETIRED_NAME} (${oldAddress} · ${attCount} atts) · ` +
      `נגזר=${regulator.ethAddress} · att ${att.seq} · cp#${cp ? cp.index : "?"} · ledger.json ייוצא`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("MIGRATE-ERROR:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
