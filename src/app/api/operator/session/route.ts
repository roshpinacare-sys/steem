import { NextRequest, NextResponse } from "next/server";
import { OP_COOKIE, hasCredentials, destroySession, readSession } from "@/lib/operator-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET: מצב-השער (האם-יש-הרשאות, האם-הסשן-תקף). אפס-סודות-בתשובות. */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(OP_COOKIE)?.value ?? null;
  const sess = readSession(token);
  return NextResponse.json({
    hasCredentials: hasCredentials(),
    authed: sess.valid,
    expiresAt: sess.valid ? sess.expiresAt : null,
  });
}

/** DELETE: יציאה מפורשת — הטוקן נהרס בשרת, העוגייה נמחקת. */
export async function DELETE(req: NextRequest) {
  const token = req.cookies.get(OP_COOKIE)?.value ?? null;
  destroySession(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(OP_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
