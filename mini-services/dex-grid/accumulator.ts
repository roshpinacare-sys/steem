// ─────────────────────────────────────────────────────────────────────
// ACCUMULATOR — חוק-שימור-המצבר (§XI R208R, trace 1a10dda614a62251)
//
// R208R קבע: total_realized = Σ אירועים-קנוניים-ייחודיים — לא
// "סף-קודם + תצוגה-נוכחית". המודול הזה הוא המימוש היחיד; dex-grid/index.ts
// ומעבדת-ההתקפה מייבאים את-אותו-קוד-בדיוק (אין-עותקי-בדיקה).
//
// אינווריאנטות:
//   A1  לכל-אירוע-ממומש canonicalEventId ייחודי (מונה-מונוטוני + תוכן + זמן).
//   A2  total = Σ פעם-אחת-לכל-id — ריטריי/ריפליי/כפילות/אירוע-מאוחר אינם
//       מוסיפים דבר.
//   A3  שורה-קרועה (כתיבה-חלקית) = torn כנה — לא שקט, לא אפס-שקרי, לא כפילות.
//   A4  הספר (fills.jsonl) הוא מקור-האמת; המצבר במדינה נגזר-ממנו תמיד
//       (בכתיבה ובעלייה) — מוות/הפעלה-מחדש אינם משנים-את-הסך.
//   A5  גלגול-שעון לא משנה-דבר: ה-id כולל מונה-מונוטוני, לא רק זמן.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import { createHash } from "node:crypto";

export interface CanonicalFillLike {
  at: string;
  pair: string;
  side: string;
  amountIn: number;
  amountOut: number;
  pnlUsd: number | null;
  canonicalEventId?: string;
}

/** A1+A5 — מזהה-אירוע-קנוני: מונה-מונוטוני + זמן + תוכן */
export function computeCanonicalEventId(
  fillSeq: number, at: string, pair: string, side: string, amountIn: number, amountOut: number,
): string {
  return createHash("sha256").update(`${fillSeq}|${at}|${pair}|${side}|${amountIn}|${amountOut}`).digest("hex");
}

/** ה-id שלפיו מנופחים — קנוני אם-קיים, נגזר-תוכן אחרת (שורות-ישנות-טרום-r208r) */
export function effectiveEventId(f: CanonicalFillLike): string {
  return f.canonicalEventId ?? `${f.at}|${f.pair}|${f.side}|${f.amountIn}|${f.amountOut}`;
}

/**
 * A2+A3+A4 — גזירת-המצבר מהספר: קריאה-שורה-בשורה, ניפוח-לפי-id,
 * ספירת-torn כנה. ספר-חסר = אפס-אירועים (כנה) — לעולם לא זיוף.
 */
export function recomputeRealizedFromLedger(fillsPath: string): { total: number; unique: number; torn: number } {
  let torn = 0;
  const seen = new Set<string>();
  let total = 0;
  try {
    const raw = fs.readFileSync(fillsPath, "utf8");
    for (const line of raw.trim() ? raw.trim().split("\n") : []) {
      try {
        const f = JSON.parse(line) as CanonicalFillLike;
        const id = effectiveEventId(f);
        if (seen.has(id)) continue; // כפילות/ריפליי — אינו נספר בשנית (A2)
        seen.add(id);
        total += f.pnlUsd ?? 0;
      } catch { torn += 1; } // שורה-קרועה — כנה (A3)
    }
  } catch { /* ספר-חסר = אפס אירועים — כנה */ }
  return { total: Math.round(total * 10000) / 10000, unique: seen.size, torn };
}
