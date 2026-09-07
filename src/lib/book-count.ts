/**
 * book-count — 107: ספירת-הספר-המלא (מדויק) — מקור-אחד-למושג.
 * נספר-מתוך bookBlocks() (המטמון-האינקרמנטלי ב-weave.ts — קריאת-זנב-בלבד) במקום
 * re-read-מלא של-הקובץ: הסוכן-השני הראה-לנו-את-ה-W18 (ספירת-ספר-מלא מוצהרת),
 * ואנחנו מוסיפים-את-הלקח-המדוד-שלנו (OOM-107): אף-קורא-שני-של-הקובץ-המלא.
 * ה-sovexplorer וה-truthpath קוראים-שניהם מכאן — שני-פאנלים לא יכולים להתנגד.
 */

import { bookBlocks } from "@/lib/weave";

let countCache: { total: number; blocks: number } | null = null;
let countKey = "";

export function countBookTxsCached(): { total: number | null; blocks: number | null } {
  try {
    const all = bookBlocks();
    // key על גובה-הראש + מספר-הבלוקים — ספירה מחדש רק כשהספר זז
    const key = `${all.length}:${all.length ? all[all.length - 1].height : 0}`;
    if (countCache && countKey === key) return { total: countCache.total, blocks: countCache.blocks };
    let total = 0;
    for (const b of all) total += Array.isArray(b.txs) ? b.txs.length : 0;
    countCache = { total, blocks: all.length };
    countKey = key;
    return { total, blocks: all.length };
  } catch {
    return { total: null, blocks: null };
  }
}
