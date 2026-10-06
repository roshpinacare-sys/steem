// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Market API — GET /api/weave/market
//
// ספר השוק במלואו (replay דטרמיניסטי + אימות שרשרת וחתימות),
// לוח ההון לכל סוכן, ומועמדי ההכרעה — מדידה חיה של כל מטרה
// פתוחה בלי לסלק (הסליקה פעולה מפורשת, לא תופעת לוואי של GET).
// openContext.zeroJudge — השופט החיצוני החי: גובה בלוק ZERO
// בקריאה חסרת-מפתחות (לברירות מחדל חכמות בפתיחת שוק ולתצוגה).
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/weave/api";
import { computeBook, measureTarget, STARTING_POINTS, type MarketTarget } from "@/lib/weave/market";
import { ZERO_BLOCK_SECONDS_MEASURED, ZERO_RAIL_ID, zeroBlockHeight } from "@/lib/weave/zero";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const book = await computeBook();

    // מועמדי ההכרעה — מדידה חיה, קריאה בלבד
    const open = book.listings.filter((l) => l.status === "OPEN");
    const resolvable = await Promise.all(
      open.map(async (l) => {
        const m = await measureTarget(l.target as MarketTarget);
        const expired = Date.parse(l.byDate) <= Date.now();
        return {
          marketSeq: l.marketSeq,
          title: l.title,
          measured: m,
          expired,
          action: m.resolved ? "SETTLE" : expired ? "REFUND" : "HOLD",
        };
      })
    );

    // הקשר לפתיחת שווקים חדשים — מה שהרשת יכולה למדוד כרגע,
    // ומה שהשרשרת החיצונית מודדת עבורה (חי, חסר-מפתחות)
    const [planStages, lastCp, anchorCount, zeroAnchorCount, attestationCount, zeroJudge] = await Promise.all([
      db.planStage.findMany({ where: { state: { not: "DONE" } }, orderBy: { sortOrder: "asc" } }),
      db.checkpoint.findFirst({ orderBy: { index: "desc" } }),
      db.attestation.count({ where: { claimType: "ANCHOR" } }),
      db.checkpoint.count({ where: { anchorNet: ZERO_RAIL_ID } }),
      db.attestation.count(),
      zeroBlockHeight()
        .then((j) => ({
          reachable: true as const,
          chainId: j.chainId,
          height: j.height,
          measuredAt: j.measuredAt,
          endpoint: j.endpoint,
          blockSeconds: ZERO_BLOCK_SECONDS_MEASURED,
        }))
        .catch((e: unknown) => ({
          reachable: false as const,
          error: e instanceof Error ? e.message : "zero rpc unreachable",
        })),
    ]);

    return NextResponse.json({
      ok: true,
      market: {
        doctrine:
          "הסחורה: הכרעה עתידית של טענות מדידות · השופט: המדידה — של הרשת עצמה (PlanStage/Checkpoint/Attestation) או של שרשרת ציבורית חיצונית חיה (ZERO 9369, חסר-מפתחות) · ההון: נקודות אמת — מוניטין מוצהר, אפס כסף · הסליקה נכנסת לספר ⇒ checkpoint ⇒ עיגון ב-$0",
        startingPoints: STARTING_POINTS,
        book: {
          events: book.events,
          headHash: book.headHash,
          chainValid: book.chainValid,
          firstBreak: book.firstBreak,
          sigOk: book.sigOk,
          verdict: book.chainValid
            ? `ספר השוק תקין: ${book.events} אירועים, שרשרת תקינה, ${book.sigOk}/${book.events} חתימות`
            : `ספר השוק שבור (firstBreak=${book.firstBreak ?? "?"}) — השוק נעול`,
        },
        listings: book.listings,
        agents: book.agents,
        resolvable,
        openContext: {
          planStages: planStages.map((s) => ({ code: s.code, title: s.title, state: s.state })),
          checkpointMax: lastCp?.index ?? 0,
          anchorCount,
          zeroAnchorCount,
          attestationCount,
          zeroJudge,
        },
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
