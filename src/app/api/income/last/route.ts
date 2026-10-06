// GET /api/income/last — הרשומה היומית האחרונה שהוקלטה לקנון (sovereign/income/daily-*.json)
// קריאה קלה (קובץ בלבד) לתצוגת בית — המדידה החיה הכבדה ב-/api/income.

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const dir = path.join(process.cwd(), "sovereign", "income");
    const files = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => /^daily-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
      : [];
    if (!files.length) {
      return NextResponse.json({ ok: true, exists: false, days: [] });
    }
    const last = files[files.length - 1];
    const body = JSON.parse(fs.readFileSync(path.join(dir, last), "utf8"));
    return NextResponse.json({ ok: true, exists: true, file: last, days: files.length, report: body });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `קריאת הרשומה היומית נכשלה: ${String((e as Error).message).slice(0, 120)}` },
      { status: 503 },
    );
  }
}
