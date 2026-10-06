// ─────────────────────────────────────────────────────────────────────
// GET /api/governance — מצב-הפרוטוקול הריבוני החי (r142).
// האמת בלבד: PROGRAM_STATE · NEXT_ACTION · OPEN_DECISIONS · ההחלטות
// האחרונות מתוך יומן hash-chained · אימות-שרשרת · מצב-הלולאה.
// אפס סודות — הפרוטוקול כולו ניתן-לפרסום מלכתחילה.
// ─────────────────────────────────────────────────────────────────────

import { governanceLoopState } from "@/lib/weave/governance-loop";
import { governanceBrainStats } from "@/lib/weave/governance-brain";
import {
  readDecisionLog,
  readNextAction,
  readOpenDecisions,
  readProgramState,
  verifyDecisionLog,
} from "@/lib/weave/sovereign-decisions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const programState = readProgramState();
    const nextAction = readNextAction();
    const openDecisions = readOpenDecisions();
    const log = readDecisionLog();
    const chain = verifyDecisionLog();
    const loop = governanceLoopState();

    return Response.json({
      ok: true,
      governance: {
        protocolOrigin: "unified-platform v33.56 governance-state (adopted r142)",
        operatorStandingApproval: programState?.operatorStandingApproval ?? null,
        programState,
        nextAction,
        openDecisions,
        loop,
        brain: governanceBrainStats(),
        chain: {
          ok: chain.ok,
          entries: chain.entries,
          brokenAt: chain.brokenAt,
          doctrine:
            "append-only hash-chained — prevHash→entryHash (sha256), אי-אפשר לשכתב את העבר, רק להוסיף",
        },
        recentDecisions: log.slice(-10).reverse(),
      },
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "שגיאת ממשל" },
      { status: 500 },
    );
  }
}
