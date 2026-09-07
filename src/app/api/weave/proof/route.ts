import { NextRequest, NextResponse } from "next/server";
import { buildCertificate } from "@/lib/weave";

export const dynamic = "force-dynamic";

/**
 * GET /api/weave/proof?h=<64hex> — W3: מחולל-התעודות.
 *
 * תעודת-אריגה לחותמת-בודדת: הנתיב נבנה מה-block-log בלבד (הארכיון-המלא,
 * אותו-חוק של kernel-replay) — כל-אדם יכול לאמת בעצמו מהג'נזיס + הספר,
 * בלי לסמוך על אף-שרת.
 *
 *   · pending-seal — החותמת חיה על הספר; תאוטם בבאצ' השעתי הבא
 *   · sealed       — נתיב-מרקל מלא מול שורש-האיטום + נושא-הצ'קפוינט + העגונים
 *   · unknown      — ה-hash לא נטווה (מצב, לא שגיאה)
 */
export async function GET(req: NextRequest) {
  const h = (req.nextUrl.searchParams.get("h") || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) {
    return NextResponse.json({ ok: false, err: "bad-hash", expect: "?h=<64 hex>" }, { status: 400 });
  }

  const cert = await buildCertificate(h);
  if (!cert) {
    return NextResponse.json({ ok: false, state: "unavailable", h, why: "replay-failed-or-kernel-missing" });
  }

  return NextResponse.json({
    ok: true,
    certificate: cert,
    verifier:
      "rebuild leaves = sha256(canon({h,seq,kind,by,at,salt})) from the public block log, fold canonically (odd=dup-last), walk the path, compare to seal.root — then verify the checkpoint that carries the root on Steem/Hive/Blurt (custom_json saos.weave.v1) and TRON (transitively via stateRoot).",
  });
}
