// /api/domains — רישום הדומיינים הריבוניים של המפעיל.
// GET  → הרשימה מה-DB (אמת מקומית, לא מלאי).
// POST → הוספת דומיין מתוכנן (תקינות פורמט נבדקת ברמת התווים).

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { domainValid } from "@/lib/agent-browser/zai";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const domains = await db.sovereignDomain.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ ok: true, domains });
  } catch (err) {
    // R119 · חוק הכנות: כשל-DB אינו "רשימה ריקה" — הסתרת כישלון תציג אמת-שקר
    return NextResponse.json(
      {
        ok: false,
        error: `קריאת הדומיינים נכשלה: ${err instanceof Error ? err.message : String(err)}`,
        domains: [],
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let domain = "";
  let purpose = "";
  try {
    const body = (await req.json()) as { domain?: unknown; purpose?: unknown };
    domain = String(body?.domain ?? "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");
    purpose = typeof body?.purpose === "string" ? body.purpose.slice(0, 300) : "";
  } catch {
    return NextResponse.json(
      { ok: false, error: "גוף הבקשה אינו JSON תקין" },
      { status: 400 },
    );
  }

  if (!domainValid(domain)) {
    return NextResponse.json(
      { ok: false, error: "פורמט דומיין לא תקין (למשל: example.com)" },
      { status: 400 },
    );
  }

  try {
    const existing = await db.sovereignDomain.findUnique({
      where: { domain },
    });
    if (existing) {
      return NextResponse.json(
        { ok: false, error: "הדומיין כבר רשום במרכז" },
        { status: 409 },
      );
    }
    const created = await db.sovereignDomain.create({
      data: { domain, purpose },
    });
    return NextResponse.json({ ok: true, domain: created });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "הרישום נכשל",
      },
      { status: 500 },
    );
  }
}
