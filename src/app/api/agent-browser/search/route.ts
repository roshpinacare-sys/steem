// /api/agent-browser/search — חיפוש רשת חי דרך שירות z.ai (web_search).

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { webSearch } from "@/lib/agent-browser/zai";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let query = "";
  let num = 8;
  let sessionSlug: string | null = null;
  try {
    const body = (await req.json()) as { q?: unknown; num?: unknown; s?: unknown };
    query = String(body?.q ?? "").trim();
    const n = Number(body?.num);
    if (Number.isFinite(n) && n >= 1) num = Math.min(Math.floor(n), 15);
    sessionSlug = typeof body?.s === "string" && body.s ? body.s : null;
  } catch {
    return NextResponse.json(
      { ok: false, error: "גוף הבקשה אינו JSON תקין" },
      { status: 400 },
    );
  }

  if (!query) {
    return NextResponse.json(
      { ok: false, error: "שאילתת חיפוש ריקה" },
      { status: 400 },
    );
  }

  try {
    const { items, tookMs } = await webSearch(query, num);
    if (sessionSlug) {
      void db.browserVisit
        .create({
          data: {
            sessionId: sessionSlug,
            kind: "SEARCH",
            url: `search:${query.slice(0, 180)}`,
            title: `${items.length} תוצאות`,
          },
        })
        .catch(() => {});
    }
    return NextResponse.json({ ok: true, query, results: items, tookMs });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error:
          e instanceof Error ? `החיפוש נכשל: ${e.message}` : "החיפוש נכשל",
      },
      { status: 502 },
    );
  }
}
