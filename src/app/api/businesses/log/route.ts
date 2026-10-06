// ─────────────────────────────────────────────────────────────────────
// /api/businesses/log — יומן-החיים של חממת-העסקים (r186 · חיבור-שבור-תוקן)
//
// רקע (r186-b מפקד-המתים): businesses-view.tsx קרא לנתיב הזה מאז r147 והנתיב
// מעולם לא נבנה — brief-log.jsonl היה נכתב-ולא-נקרא (משקל-מת). זה החיבור.
//
// מה הנתיב מחזיר (קריאה-בלבד, אפס מפתחות, אפס כתיבה):
//   GET /api/businesses/log                    → tail של brief-log.jsonl (ברירת-מחדל)
//   GET /api/businesses/log?stream=business    → tail של business-log.jsonl
//   · כל שורה מפורסרת בנפרד — שורה-שבורה (כתיבה-אטומית בשיא) נזרקת בכנות,
//     לא מפילה את התשובה; אין-נתונים = entries: [] עם ok:true.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import fs from "node:fs";

export const dynamic = "force-dynamic";

const HOME = "/home/z/my-project";
const STREAMS: Record<string, string> = {
  brief: `${HOME}/sovereign/businesses/brief-log.jsonl`,
  business: `${HOME}/sovereign/businesses/business-log.jsonl`,
};
const MAX_LINES = 120;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const streamKey = url.searchParams.get("stream") ?? "brief";
  const file = STREAMS[streamKey];
  if (!file) {
    return NextResponse.json(
      { ok: false, error: `unknown stream '${streamKey}' (available: ${Object.keys(STREAMS).join(", ")})` },
      { status: 400 },
    );
  }

  let entries: Record<string, unknown>[] = [];
  let dropped = 0;
  try {
    const raw = fs.readFileSync(file, "utf8");
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const tail = lines.slice(-MAX_LINES);
    for (const line of tail) {
      try {
        entries.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        dropped += 1; // שורה-חתוכה מכתיבה-אטומית — מדווחת בכנות, לא מפילה
      }
    }
  } catch {
    entries = []; // אין-קובץ / אין-הרשאה — מצב-ריק כן, לא שקר
  }

  entries.reverse(); // החדש-ראשון לתצוגה
  return NextResponse.json(
    { ok: true, stream: streamKey, count: entries.length, droppedLines: dropped, entries },
    { headers: { "cache-control": "no-store" } },
  );
}
