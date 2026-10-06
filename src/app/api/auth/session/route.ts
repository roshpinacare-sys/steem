// ─────────────────────────────────────────────────────────────────────
// GET /api/auth/session — בדיקת תוקף של טוקן-המפעיל.
// Authorization: Bearer <token>. מחזיר את זהות-הסשן או 401.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { OPERATOR_ACCOUNT, operatorFromRequest } from "@/lib/operator-auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = operatorFromRequest(req);
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: "אין סשן-מפעיל פעיל (לא סופק טוקן, שגוי, או פג-תוקף)" },
      { status: 401 },
    );
  }
  return NextResponse.json({
    ok: true,
    account: OPERATOR_ACCOUNT,
    publicKey: session.pub,
    expiresAt: new Date(session.exp).toISOString(),
  });
}
