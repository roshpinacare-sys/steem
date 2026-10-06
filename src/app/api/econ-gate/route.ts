// ─────────────────────────────────────────────────────────────────────
// /api/econ-gate — שער-הכלכלה כמסלול-חי (r148-b)
//
// GET — משטח-האמת של השער (fail-soft nulls, אפס המצאה):
//   · law    — חוק-הבית בשורה-אחת (registry lawHe; null אם הדיסק לא נענה)
//   · today  — {actionsToday, cap} — ספירת שידורים-אמת מהמונים החיים
//     (money · business-engine — ראה measureBudget; לא שורות-יומן-החלטות)
//   · recent — 20 פסקי-הדין האחרונים (sovereign/governance/econ-gate.jsonl)
//
// POST — קלט EconGateInput ⇒ פסק-דין EconGateVerdict מלא (תקציב → שיפוט).
//   קלט-פסול ⇒ 400 עם סיבה בעברית. בלי שער-מוצא — דפוס-הבית למסלולי-פנים
//   (כמו /api/governance/cycle): הפונים הם דיבוני-localhost והלולאה עצמה.
//
// ה-SDK (z-ai-web-dev-sdk) רץ כאן בשרת-בלבד (nodejs runtime) — מעולם לא בקליינט.
// ─────────────────────────────────────────────────────────────────────

import { measureBudget, readGateLog, readRegistryLawHe, runEconGate, type EconGateInput } from "@/lib/econ-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const budget = measureBudget();
  return Response.json({
    ok: true,
    at: new Date().toISOString(),
    law: readRegistryLawHe(),
    today: { actionsToday: budget.actionsToday, cap: budget.cap, actionDay: budget.actionDay },
    recent: readGateLog(20),
  });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "גוף-הבקשה אינו JSON תקין" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  // אימות-קלט כן: שדות-חובה, ושדות-אופציה מטיפוס-נכון — בלי השערות
  const errs: string[] = [];
  for (const k of ["actionId", "kind", "description", "source"] as const) {
    const v = b[k];
    if (typeof v !== "string" || !v.trim()) errs.push(`שדה-חובה חסר/ריק: ${k}`);
  }
  if (b.businessId !== undefined && b.businessId !== null && typeof b.businessId !== "string") {
    errs.push("businessId חייב להיות מחרוזת");
  }
  for (const k of ["estimatedCost", "expectedValue"] as const) {
    if (b[k] !== undefined && b[k] !== null && typeof b[k] !== "string") errs.push(`${k} חייב להיות מחרוזת`);
  }
  for (const k of ["killLineAware", "reversible"] as const) {
    if (b[k] !== undefined && b[k] !== null && typeof b[k] !== "boolean") errs.push(`${k} חייב להיות בוליאני`);
  }
  if (b.spend !== undefined && b.spend !== null && typeof b.spend !== "boolean") {
    errs.push("spend חייב להיות בוליאני");
  }
  if (errs.length > 0) {
    return Response.json({ ok: false, error: errs.join(" · ") }, { status: 400 });
  }

  const input: EconGateInput = {
    actionId: (b.actionId as string).trim().slice(0, 200),
    kind: (b.kind as string).trim().slice(0, 100),
    description: (b.description as string).trim().slice(0, 2000),
    source: (b.source as string).trim().slice(0, 120),
    ...(typeof b.businessId === "string" && b.businessId.trim() ? { businessId: b.businessId.trim().slice(0, 120) } : {}),
    ...(typeof b.estimatedCost === "string" && b.estimatedCost.trim() ? { estimatedCost: b.estimatedCost.trim().slice(0, 300) } : {}),
    ...(typeof b.expectedValue === "string" && b.expectedValue.trim() ? { expectedValue: b.expectedValue.trim().slice(0, 300) } : {}),
    ...(typeof b.killLineAware === "boolean" ? { killLineAware: b.killLineAware } : {}),
    ...(typeof b.reversible === "boolean" ? { reversible: b.reversible } : {}),
    ...(typeof b.spend === "boolean" ? { spend: b.spend } : {}),
  };

  try {
    const verdict = await runEconGate(input);
    return Response.json({ ok: true, verdict });
  } catch (e) {
    // כשל-שער כן: לא "ALLOW בשקט" — שגיאה מדווחת
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "שגיאת-שער לא צפויה" },
      { status: 500 },
    );
  }
}
