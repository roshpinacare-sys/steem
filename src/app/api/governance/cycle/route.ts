// ─────────────────────────────────────────────────────────────────────
// POST /api/governance/cycle — הרצאת מחזור-החלטה אחד (r142).
// קורא: דיבון-הממשל (3042) כפעימה-קבועה, וכן יד-אנושית במקרה-צורך.
// זהה בין-קריאות: לולאה-יחידה פנימית (R80) + קירור 90ש' בין מחזורים
// מוצלחים שהוזנו חיצונית — כדי שפעימה+יד לא ייצרו ספירלת-החלטות.
// ─────────────────────────────────────────────────────────────────────

import { governanceLoopState, runGovernanceCycle } from "@/lib/weave/governance-loop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_CYCLE_GAP_MS = 90_000;
const g = globalThis as typeof globalThis & { __govLastManualCycleAt?: number };

export async function POST(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const last = g.__govLastManualCycleAt ?? 0;
    const loop = governanceLoopState();
    if (!force && loop.lastCycleAt && Date.parse(loop.lastCycleAt) > 0) {
      const since = Date.now() - Math.max(last, Date.parse(loop.lastCycleAt));
      if (since < MIN_CYCLE_GAP_MS) {
        return Response.json({
          ok: true,
          skipped: true,
          reason: `קירור-מחזור (${Math.ceil((MIN_CYCLE_GAP_MS - since) / 1000)}ש' עד המחזור הבא) — אנטי-ספירלה`,
          loop,
        });
      }
    }
    g.__govLastManualCycleAt = Date.now();
    // r144-f — force מועבר הלאה: פוטר את הקצב-הפנימי של הלולאה (לא את קירור-90ש' כאן).
    const state = await runGovernanceCycle({ force });
    return Response.json({ ok: true, loop: state });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "שגיאת מחזור" },
      { status: 500 },
    );
  }
}

export async function GET() {
  return Response.json({ ok: true, loop: governanceLoopState(), hint: "POST כדי להריץ מחזור" });
}
