// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Archive Witness — POST /api/weave/archive/witness
//
// עד הארכיון: ההיסטוריה הכתובה של הרשת (anchor-baseline) נמדדת חיה
// מהמקור ומעידה בספר. המדידה קובעת, לעולם לא הלקוח:
//   · שורש חדש ⇒ אימות CROSSCHAIN חתום ⇒ checkpoint מיידי מכסה ⇒
//     ייצוא ledger.json (הפעימה/העוגן הבאים דוחפים ומעידים ב-$0)
//   · שורש שכבר מעיד (גם AUDIT וותיק) ⇒ דילוג כנה (דה-דופליקציה)
//   · אין גישה לריפו הפרטי ⇒ REFUSED — לא נכתבת עדות (fail-closed)
//
// העד רץ אוטומטית בכל פעימה (weave-beat §5.7); הנתיב הזה הוא
// המסלול הידני — אותה מכניקה בדיוק, בלחיצת כפתור.
// ─────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/weave/api";
import { ArchiveError, witnessArchive } from "@/lib/weave/archive";
import { createCheckpointNow } from "@/lib/weave/beat";
import { exportLedger } from "@/lib/weave/ledger-sync";

export const dynamic = "force-dynamic";

const LEDGER_PATH = path.join(process.cwd(), "sovereign", "ledger.json");

export async function POST() {
  try {
    const result = await witnessArchive();

    // סולם ההוכחות: עדות חדשה נכתבה ⇒ checkpoint מיידי + ייצוא
    let checkpoint: { index: number; root: string } | null = null;
    let ledgerExported = false;
    if (result.status === "ATTESTED" && result.attSeq !== null) {
      const cp = await createCheckpointNow();
      if (cp) checkpoint = { index: cp.index, root: cp.root };
      try {
        const snap = await exportLedger();
        fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
        fs.writeFileSync(LEDGER_PATH, JSON.stringify(snap, null, 2) + "\n");
        ledgerExported = true;
      } catch {
        // הייצוא נכשל — לא פטאל: הפעימה הבאה תייצא; העדות כבר ב-DB
      }
    }

    return NextResponse.json({
      ok: true,
      archiveWitness: {
        status: result.status,
        reason: result.reason,
        attSeq: result.attSeq,
        snapshot: result.snapshot,
        checkpoint,
        ledgerExported,
        note:
          result.status === "ATTESTED"
            ? "העדות נכתבה וחתומה; ה-checkpoint מכסה; הפעימה/העוגן הבאים דוחפים ומעידים עליה ב-$0"
            : result.reason,
      },
    });
  } catch (error) {
    if (error instanceof ArchiveError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return jsonError(error);
  }
}
