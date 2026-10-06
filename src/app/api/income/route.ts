// GET /api/income — מנוע ההכנסה: מדידה חיה של כל מקורות ההכנסה מול יעד המשימה ($1,000/יום)
// POST /api/income — מבצע מדידה + כותב רשומה יומית לקנון (sovereign/income/daily-<date>.json)
// R127 — נולד מהוראת המפעיל: המשימה היא תוצאה נמדדת, לא דופק בריאות.

import { NextRequest, NextResponse } from "next/server";
import { composeIncome, writeIncomeDay, backfillMissingIncomeDays, type BackfillResult } from "@/lib/weave/income";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const record = url.searchParams.get("record") === "1";
  try {
    const report = await composeIncome();
    if (record) {
      const { file, created } = writeIncomeDay(report);
      return NextResponse.json({ ...report, recorded: { file, created } });
    }
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `מנוע ההכנסה נכשל: ${String((e as Error).message).slice(0, 160)}` },
      { status: 503 },
    );
  }
}

export async function POST() {
  try {
    // R128 — ריפוי הזיכרון קודם לרישום: ימים שהסנדבוקס היה מת בהם ממולאים
    // ממקורות האמת לפי תאריך, ורק אז נרשם היום. הדופק (הקורא הקבוע
    // של הנתיב הזה) מרפא את זיכרון המשימה בעצמו בכל רישום יומי.
    // כישלון מילוי אינו עוצר רישום — הוא מדווח בכנות בשדה backfill
    // (הרשומה של היום היא המשימה הראשית; המילוי ינסה שוב מחר).
    let backfill: BackfillResult | { ok: false; ran: false; noteHe: string };
    try {
      backfill = await backfillMissingIncomeDays();
    } catch (e) {
      backfill = { ok: false, ran: false, noteHe: `מילוי-החסר נכשל: ${String((e as Error).message).slice(0, 140)}` };
    }
    const report = await composeIncome();
    const { file, created } = writeIncomeDay(report);
    return NextResponse.json({ ...report, recorded: { file, created }, backfill });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `מדידה ורישום נכשלו: ${String((e as Error).message).slice(0, 160)}` },
      { status: 503 },
    );
  }
}
