// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Market API — POST /api/weave/market/settle
//
// הרצת המכריע: לכל שוק פתוח — מדידה חיה של המטרה. הוכרע ⇒ SETTLE
// (מתמטיקה פרו-רטה, אירוע חתום במפתח הרשת) ⇒ אימות MARKET חתום
// בספר הראשי ⇒ checkpoint מיידי מכסה אותו ⇒ ייצוא ledger.json
// (הפעימה/העוגן הבאים דוחפים ומעידים עליו ב-$0).
// פג תוקף ללא הכרעה ⇒ REFUND מלא — פתיחת-חזרה כנה.
// המכריע אינו מקבל outcome מהלקוח — המדידה קובעת, תמיד.
// ─────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/weave/api";
import { resolveOpenMarkets, MarketError } from "@/lib/weave/market";
import { createCheckpointNow } from "@/lib/weave/beat";
import { exportLedger } from "@/lib/weave/ledger-sync";

export const dynamic = "force-dynamic";

const LEDGER_PATH = path.join(process.cwd(), "sovereign", "ledger.json");

export async function POST() {
  try {
    const result = await resolveOpenMarkets();

    // סולם ההוכחות: אם נכתבו אימותי MARKET — checkpoint מיידי + ייצוא
    let checkpoint: { index: number; root: string } | null = null;
    let ledgerExported = false;
    if (result.attSeqs.length > 0) {
      const cp = await createCheckpointNow();
      if (cp) checkpoint = { index: cp.index, root: cp.root };
      try {
        const snap = await exportLedger();
        fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
        fs.writeFileSync(LEDGER_PATH, JSON.stringify(snap, null, 2) + "\n");
        ledgerExported = true;
      } catch {
        // הייצוא נכשל — לא פטאל: הפעימה הבאה תייצא; האימותים כבר ב-DB
      }
    }

    return NextResponse.json({
      ok: true,
      resolution: {
        settled: result.settled,
        refunded: result.refunded,
        successors: result.successors,
        attSeqs: result.attSeqs,
        checkpoint,
        ledgerExported,
        note:
          result.attSeqs.length === 0
            ? "אין שווקים להכרעה — הכל פתוח או סגור; המדידה קובעת"
            : "הסליקות נכתבו לספר כאימותי MARKET חתומים; ה-checkpoint מכסה; הפעימה/העוגן הבאים דוחפים ומעידים ב-$0",
      },
    });
  } catch (error) {
    if (error instanceof MarketError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return jsonError(error);
  }
}
