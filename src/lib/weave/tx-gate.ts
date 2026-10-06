// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · TX-GATE — שער-העסקאות (R97).
//
// הוראת המפעיל: "מערכת אוטונומית לא צריכה שער מפעיל רק במקרים של
// עסקאות באמת גדולות 100$ ומעלה."
//
// החוק — כל פעולת-כסף מוערכת ב-USD חי בזמן ההחלטה:
//   · מתחת לסך $100 → אוטונומיה מלאה (ALLOWED) — הרשת פועלת לבד.
//   · $100 ומעלה   → תור אישור למפעיל (QUEUED) — כלום לא זז בלי החלטתו.
//   · אין מדידת-USD חיה → REFUSED — אין שער, אין מסחר (הרצפה נשארת).
//   · מפעיל שמוציא פעולה בעצמו (סשן-מפעיל) → ALLOWED — המפעיל הוא השער.
//
// כל הכרעה נשמרת עם קבלה — האמת במדידה, לא בזיכרון.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import { db } from "@/lib/db";

/** הסף היחיד — כתוב פעם אחת, נאכף בכל מקום (הוראת המפעיל) */
export const GATE_THRESHOLD_USD = 100;

/**
 * r197 — חוק-העצירה והחשיבה: קובץ-אמת אחד (sovereign/autonomy/GATE.json).
 * fail-closed: קובץ קרוע/לא-קריא ⇒ PAUSED — היעדר-אמת אינו היתר.
 * השרת הוא שכבת-ההגנה העצמאית: גם אם דיבון חסר-משמעת ינסה — כאן זה נעצר.
 */
function readGlobalAutonomy(): { mode: "PAUSED" | "THINKING" | "ACTIVE"; reason: string } {
  try {
    const raw = JSON.parse(fs.readFileSync("/home/z/my-project/sovereign/autonomy/GATE.json", "utf8")) as { mode?: string; reason?: string };
    if (raw?.mode === "ACTIVE") return { mode: "ACTIVE", reason: String(raw.reason ?? "") };
    if (raw?.mode === "THINKING") return { mode: "THINKING", reason: String(raw.reason ?? "") };
    return { mode: "PAUSED", reason: String(raw?.reason ?? "שער-לא-תקין") };
  } catch {
    return { mode: "PAUSED", reason: "fail-closed: קובץ-השער לא נקרא (חוק-r197)" };
  }
}

export type GateVerdict = "ALLOWED" | "QUEUED" | "REFUSED";

export interface GateInput {
  source: string; // money-mover | liquidity | exchange | ...
  action: string; // reprice | arm-buy | swap | bridge | ...
  title: string;
  payload: Record<string, unknown>;
  /** הערכת-USD חיה; null = לא נמדד — ואז מסורבים בכנות */
  usdValue: number | null;
  usdBasis: string;
  issuedBy: "operator" | "daemon";
  reason: string;
}

export interface GateDecision {
  verdict: GateVerdict;
  id: string;
  threshold: number;
  usdValue: number | null;
  /** r206 — ייחוס-אמת: השער נושא את סיבת-ההכרעה של עצמו — האורגניזם חייב לדעת
   *  למה נסרב (חוסר-דיון? עצירה? אין-שער?) ולא לקבל תשובה-אחת-לכל-הסירובים.
   *  נמדד חי (r206): 14/14 הסירובים היו NO-DELIBERATION ב-USD חי — וה-route
   *  דיווח "USD לא נמדד חי" לכולם — ייחוס-שקר שהצית למידה כוזבת. */
  decidedBy?: string;
  reason?: string;
}

export async function evaluateGate(input: GateInput): Promise<GateDecision> {
  const base = {
    source: input.source.slice(0, 60),
    action: input.action.slice(0, 60),
    title: input.title.slice(0, 200),
    payload: JSON.stringify(input.payload),
    usdBasis: input.usdBasis.slice(0, 250),
    reason: input.reason.slice(0, 250),
  };

  // r197 — חוק-העצירה והחשיבה (הוראת-המפעיל trace 1a108e334b3129a9):
  //   PAUSED   → פעולת-דיבון נסרבת תמיד; רק המפעיל עצמו עובר (המפעיל הוא השער).
  //   THINKING → פעולת-דיבון עוברת רק עם רשות-דיון מלאה ב-payload
  //              (claim/why/expected/risk/rollback — "לחשוב לפני שעושים").
  //   ACTIVE   → המשך לשער-ה-$100 הרגיל.
  const autonomy = readGlobalAutonomy();
  if (input.issuedBy === "daemon" && autonomy.mode !== "ACTIVE") {
    if (autonomy.mode === "PAUSED") {
      const reason = `האוטונומיה עוצרה על-ידי המפעיל — אף פעולה אוטומטית לא זזה · ${autonomy.reason.slice(0, 160)}`;
      const r = await db.txGate.create({
        data: { ...base, usdValue: input.usdValue ?? 0, verdict: "REFUSED", decidedBy: "autonomy:PAUSED",
          reason, decidedAt: new Date() },
      });
      return { verdict: "REFUSED", id: r.id, threshold: GATE_THRESHOLD_USD, usdValue: input.usdValue, decidedBy: "autonomy:PAUSED", reason };
    }
    // THINKING — דורשים דיון מלא; דיון חסר/קרוע = סירוב (fail-closed)
    const d = (input.payload ?? {}) as { deliberation?: Record<string, unknown> };
    const delib = d?.deliberation;
    const delibOk = !!delib && ["claim", "why", "expected", "risk", "rollback"].every((k) => typeof (delib as Record<string, unknown>)[k] === "string" && String((delib as Record<string, unknown>)[k]).trim().length >= 8);
    if (!delibOk) {
      const reason = "THINKING — פעולה בלי דיון מלא (מה/למה/צפי/סיכון/רולבק) נסרבת — לחשוב לפני שעושים (חוק-r197)";
      const r = await db.txGate.create({
        data: { ...base, usdValue: input.usdValue ?? 0, verdict: "REFUSED", decidedBy: "autonomy:NO-DELIBERATION",
          reason, decidedAt: new Date() },
      });
      return { verdict: "REFUSED", id: r.id, threshold: GATE_THRESHOLD_USD, usdValue: input.usdValue, decidedBy: "autonomy:NO-DELIBERATION", reason };
    }
  }

  // שער שלמות-מדידה: לעולם לא מפרשים "לא נמדד" כ"קטן מהסף" —
  // אותו חוק כמו רצפת-הפאריטה: אין שער, אין מסחר.
  if (input.usdValue == null || !Number.isFinite(input.usdValue) || input.usdValue < 0) {
    const noUsdReason = "USD לא נמדד חי — השער אינו יכול להעריך, לכן שום דבר לא זז (אין שער, אין מסחר)";
    const r = await db.txGate.create({
      data: {
        ...base,
        usdValue: 0,
        verdict: "REFUSED",
        decidedBy: "policy:no-usd-mark",
        reason: noUsdReason,
        decidedAt: new Date(),
      },
    });
    return { verdict: "REFUSED", id: r.id, threshold: GATE_THRESHOLD_USD, usdValue: null, decidedBy: "policy:no-usd-mark", reason: noUsdReason };
  }

  // המפעיל שהוציא את הפעולה בעצמו — המפעיל הוא השער
  if (input.issuedBy === "operator") {
    const r = await db.txGate.create({
      data: {
        ...base,
        usdValue: input.usdValue,
        verdict: "ALLOWED",
        decidedBy: "operator",
        decidedAt: new Date(),
      },
    });
    return { verdict: "ALLOWED", id: r.id, threshold: GATE_THRESHOLD_USD, usdValue: input.usdValue };
  }

  // מתחת לסף — אוטונומיה מלאה. זו ברירת-המחדל של הרשת.
  if (input.usdValue < GATE_THRESHOLD_USD) {
    const r = await db.txGate.create({
      data: {
        ...base,
        usdValue: input.usdValue,
        verdict: "ALLOWED",
        decidedBy: `policy:<${GATE_THRESHOLD_USD}`,
        reason: `${input.usdValue.toFixed(2)}$ < ${GATE_THRESHOLD_USD}$ — אוטונומיה מלאה, הפעולה רצה בלי שער`,
        decidedAt: new Date(),
      },
    });
    return { verdict: "ALLOWED", id: r.id, threshold: GATE_THRESHOLD_USD, usdValue: input.usdValue };
  }

  // מהסף ומעלה — תור אישור המפעיל. שום דבר לא זז עד החלטתו.
  const r = await db.txGate.create({
    data: {
      ...base,
      usdValue: input.usdValue,
      verdict: "QUEUED",
      decidedBy: "policy:operator-gate",
      reason: `הפעולה ${input.usdValue.toFixed(2)}$ ≥ ${GATE_THRESHOLD_USD}$ — הועברה לתור אישור המפעיל`,
    },
  });
  return { verdict: "QUEUED", id: r.id, threshold: GATE_THRESHOLD_USD, usdValue: input.usdValue };
}

export async function settleGate(
  id: string,
  state: "EXECUTED" | "APPROVED" | "REJECTED",
  by: string,
  receipt?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.txGate.update({
      where: { id },
      data: {
        verdict: state,
        decidedBy: by.slice(0, 120),
        decidedAt: new Date(),
        ...(receipt ? { receipt: JSON.stringify(receipt) } : {}),
      },
    });
  } catch {
    /* כשל עדכון-עדות אינו עוצר תשובה — הקבלה החיה היא השרשרת */
  }
}

/** אישור/דחייה של פעולה בתור — רק המפעיל (הסשן נבדק ב-API) */
export async function decideQueued(
  id: string,
  decision: "approve" | "reject",
  by: string,
): Promise<{ ok: true; record: Record<string, unknown> } | { ok: false; code: string; verdict?: string }> {
  const rec = await db.txGate.findUnique({ where: { id } });
  if (!rec) return { ok: false, code: "NOT-FOUND" };
  if (rec.verdict !== "QUEUED") return { ok: false, code: "NOT-QUEUED", verdict: rec.verdict };
  await settleGate(id, decision === "approve" ? "APPROVED" : "REJECTED", by);
  return { ok: true, record: { ...rec, verdict: decision === "approve" ? "APPROVED" : "REJECTED" } };
}

/** תמונת-השער ל-UI: התור, ההיסטוריה האחרונה, והמונים */
export async function gateSnapshot() {
  const [queue, recent, allowed, queued, refused, executed, rejected] = await Promise.all([
    db.txGate.findMany({ where: { verdict: "QUEUED" }, orderBy: { createdAt: "desc" }, take: 25 }),
    // r206 — חלון-ביקורת רחב: האורגניזם מצליב את אמונותיו הנלמדות מול ספר-השער
    // (תיקון-ייחוס עצמי דורש ראיות מספיקות בחלון — 50 ולא 20)
    db.txGate.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    db.txGate.count({ where: { verdict: { in: ["ALLOWED", "EXECUTED"] } } }),
    db.txGate.count({ where: { verdict: "QUEUED" } }),
    db.txGate.count({ where: { verdict: "REFUSED" } }),
    db.txGate.count({ where: { verdict: "EXECUTED" } }),
    db.txGate.count({ where: { verdict: "REJECTED" } }),
  ]);
  return {
    threshold: GATE_THRESHOLD_USD,
    queue,
    recent,
    stats: { allowed, queued, refused, executed, rejected },
  };
}
