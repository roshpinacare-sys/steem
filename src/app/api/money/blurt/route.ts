// ─────────────────────────────────────────────────────────────────────
// /api/money/blurt — רגל BLURT: מדידה + נתיב-כספת (R101d)
//
// GET בלבד בשלב זה — הרגל מודדת את האמת החיה (יתרה, RPC, סמכות
// מהכספת) ולא משדרה דבר. שידור העברות וזירת-המסחר הפנימית (WBLURT)
// הן הצעד הבא המתועד בחסימה — ייבנו תחת אותם חוקים (שער-$100,
// אימות-סמכות ביט-מול-ביט, קבלה-השרשרת-השופטת).
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { readBlurtLeg } from "@/lib/dex/blurt-wire";

export const dynamic = "force-dynamic";

export async function GET() {
  const leg = await readBlurtLeg("headcorner");
  return NextResponse.json({
    ok: leg.ok,
    at: leg.at,
    account: leg.account,
    rpc: leg.rpc,
    balances: leg.balances,
    keyPreflight: {
      vaultOpened: leg.keyPreflight.vaultOpened,
      // הפומבי בלבד — לעולם לא הפרטי
      derivedPub: leg.keyPreflight.derivedPub,
      liveActive: leg.keyPreflight.liveActive,
      match: leg.keyPreflight.match,
    },
    verdict: leg.verdict,
    note: leg.note,
    doctrine: [
      "חוק הקידומת (R99, נמדד): BLT5HhJD ≡ STM5HhJD — אותם בייטים, שורש-המורשת של סיסמת-האב.",
      "נתיב-הכספת (R101c): סיסמת-האב → active החי של STEEM → חותמת → מפתח-אב → AES-256-GCM → ה-WIF של BLURT — בזיכרון בלבד.",
      "אין שידור בשלב זה — סמכות מוכחת במדידה; העברות וזירת WBLURT הן הצעד הבא המתועד.",
      "הכל עתיד לעבור דרך שער-העסקאות $100 — אותו חוק אחד לכל הרגליים.",
    ],
  });
}
