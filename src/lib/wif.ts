/**
 * R18b — נגזירה-פומבית מ-WIF · מנורמלת-ושקטה
 *
 * מטפל בשני-פורמטים-שנתקלו-בשטח:
 *  · P5…  = פורמט-גרפן (P + WIF) — מנורמל ל-WIF רגיל (51, מתחיל-ב-5)
 *  · K/L… = WIF-דחוס-52-תווים — ספריית-steem תומכת-בו-וגוזרת-נכון-מול-השרשרת
 *          (אומת 8/8 על headcorner steem+hive) אבל מרעישה-ב-WARN לכל-גזירה.
 *
 * העוזר משתיק-את-רעש-ה-WARN-בלבד-עבור-הקריאה-הזו-ורק-עבור-מפתחות-דחוסים —
 * לא-משנה-שום-ערך, לא-מחזיר-חומר-מפתח, ומחזיר-null-בכל-כשל.
 */
export function derivePubQuietly(wif: string, derive: (w: string) => string): string | null {
  const norm = wif.replace(/^P(?=[5JKL])/, "").trim();
  if (!norm) return null;
  const isCompressed = /^[KL][1-9A-HJ-NP-Za-km-z]{51}$/.test(norm);
  if (!isCompressed) {
    try {
      return derive(norm) || null;
    } catch (_) {
      return null;
    }
  }
  const origLog = console.log;
  console.log = () => {};
  try {
    return derive(norm) || null;
  } catch (_) {
    return null;
  } finally {
    console.log = origLog;
  }
}
