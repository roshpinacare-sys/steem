// ─────────────────────────────────────────────────────────────────────
// /api/admin/dispatch — הזנקת סוכן ענן ידנית (workflow_dispatch).
// רק סוכנים ברשימה המאושרת; ה-PAT צד-שרת בלבד.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { dispatchWorkflow, DISPATCHABLE } from "@/lib/live/cloud";
import { operatorFromRequest } from "@/lib/operator-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // פעולת-מפעיל: בלי סשן-מפעיל חתום — אין הזנקה
  if (!operatorFromRequest(req)) {
    return NextResponse.json(
      {
        ok: false,
        error: "הזנקת סוכנים נעולה. התחבר עם מפתח ה-active של המפעיל.",
        locked: true,
      },
      { status: 401 },
    );
  }
  let body: { repo?: string; workflow?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "גוף הבקשה חייב להיות JSON תקין" },
      { status: 400 }
    );
  }
  const { repo, workflow } = body;
  if (!repo || !workflow) {
    return NextResponse.json(
      { ok: false, error: "נדרשים repo ו-workflow" },
      { status: 400 }
    );
  }
  const target = DISPATCHABLE.find((d) => d.repo === repo && d.workflow === workflow);
  if (!target) {
    return NextResponse.json(
      { ok: false, error: "סוכן זה אינו ברשימת ההפעלה המאושרת" },
      { status: 400 }
    );
  }
  try {
    await dispatchWorkflow(repo, workflow);
    return NextResponse.json({
      ok: true,
      dispatched: { repo, workflow, label: target.label },
      at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error ? err.message : "ההזנקה נכשלה — נסה שוב",
      },
      { status: 502 }
    );
  }
}
