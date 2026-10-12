import { NextRequest, NextResponse } from "next/server";
import { hasCredentials, setPassword, createSession, OP_COOKIE, audit } from "@/lib/operator-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * אתחול-ראשון של סיסמת-המפעיל.
 * נפתח רק כשאין קובץ-הרשאות; מהרגע-שנקבע — סגור לתמיד (fail-closed).
 * הסיסמה עצמה אינה נשמרת, אינה נרשמת, אינה מוחזרת. hash scrypt בלבד.
 */
export async function POST(req: NextRequest) {
  let body: { password?: unknown } = {};
  try {
    body = (await req.json()) as { password?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "גוף-הבקשה אינו תקין" }, { status: 400 });
  }
  if (hasCredentials()) {
    return NextResponse.json({ ok: false, error: "אתחול סגור: הרשאות קיימות" }, { status: 403 });
  }
  const r = setPassword(body.password);
  if (!r.ok) {
    audit("setup_rejected", { reason: r.error ?? "unknown" });
    return NextResponse.json({ ok: false, error: r.error ?? "האתחול נדחה" }, { status: 400 });
  }
  const ip = req.headers.get("x-forwarded-for") ?? null;
  const sess = createSession(ip);
  audit("setup_completed", {});
  const res = NextResponse.json({ ok: true, expiresAt: sess?.expiresAt ?? null });
  if (sess) {
    res.cookies.set(OP_COOKIE, sess.token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 12 * 3600,
    });
  }
  return res;
}
