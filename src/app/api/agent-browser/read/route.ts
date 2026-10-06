// /api/agent-browser/read — קריאת עמוד חי דרך שירות z.ai (page_reader).
// הקליינט לעולם לא נוגע ב-SDK: הוא שולח כתובת, מקבל טקסט נקי + קישורים.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalizeUrl, readPage } from "@/lib/agent-browser/zai";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let url = "";
  let sessionSlug: string | null = null;
  try {
    const body = (await req.json()) as { url?: unknown; s?: unknown };
    url = String(body?.url ?? "").trim();
    sessionSlug = typeof body?.s === "string" && body.s ? body.s : null;
  } catch {
    return NextResponse.json(
      { ok: false, error: "גוף הבקשה אינו JSON תקין" },
      { status: 400 },
    );
  }

  const normalized = normalizeUrl(url);
  if (!normalized) {
    return NextResponse.json(
      { ok: false, error: "כתובת לא תקינה — צפה כתובת http(s) מלאה" },
      { status: 400 },
    );
  }

  try {
    const result = await readPage(normalized);
    // תיעוד ביקור בסשן פעיל (בלי לחסום את התשובה על כתיבת-DB)
    if (sessionSlug) {
      void db.browserVisit
        .create({
          data: {
            sessionId: sessionSlug, // slug = id ידני (ראה sessions/route.ts)
            kind: "READ",
            url: normalized,
            title: result.title.slice(0, 200),
          },
        })
        .catch(() => {});
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error:
          e instanceof Error
            ? `קריאת העמוד נכשלה: ${e.message}`
            : "קריאת העמוד נכשלה",
      },
      { status: 502 },
    );
  }
}
