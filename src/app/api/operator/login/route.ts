import { NextRequest, NextResponse } from "next/server";
import {
  OP_COOKIE,
  verifyPassword,
  createSession,
  loginAllowed,
  recordLoginResult,
  audit,
} from "@/lib/operator-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** כניסת-מפעיל: הגבלת-ניסיונות 5/5 דק' · תשובה-אחידה (ללא רמזים) · מטא-ביקורת בלבד. */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? null;
  const gate = loginAllowed(ip);
  if (!gate.allowed) {
    audit("login_rate_limited", { retryAfterSec: gate.retryAfterSec });
    return NextResponse.json(
      { ok: false, error: `נחסמת זמנית. נסה שוב בעוד ${gate.retryAfterSec} שניות` },
      { status: 429, headers: { "retry-after": String(gate.retryAfterSec) } }
    );
  }
  let body: { password?: unknown } = {};
  try {
    body = (await req.json()) as { password?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "גוף-הבקשה אינו תקין" }, { status: 400 });
  }
  const ok = verifyPassword(body.password);
  recordLoginResult(ip, ok);
  if (!ok) {
    audit("login_failed", {});
    return NextResponse.json({ ok: false, error: "סיסמה שגויה" }, { status: 401 });
  }
  const sess = createSession(ip);
  audit("login_ok", {});
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
