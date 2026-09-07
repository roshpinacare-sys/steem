# Changelog — V528 — ניקוי ניפוח + פתרון cannotRun + תיקון באג MMR

**Release:** ECOS V528 · 2026-06-05 · AI lead (Opus 4.8)

## מה זוהה
- סוכן קודם הוסיף ב-v527 תיקייה `ECOS_CANONICAL_KNOWLEDGE/` של ~19MB (רובה `ECOS_FULL_SOURCE_BUNDLE.md`
  של 15MB — שכפול כל קוד-המקור) שניפחה את הזיפ מ-5.4MB ל-9.5MB. לא רלוונטי, מנפח כל גרסה.
- 28 חבילות cannotRun: 7 משתמשות ב-vitest כ-globals (בלי import), 19 צריכות `pg`, 1 `ws`, 1 `commander`.
- באג MMR אמיתי: `generateProof` לא כלל את `posInPeak`, אז `verifyProof` סידר אחים בסדר שגוי וכל
  proof של leaf שאינו במיקום 0 נכשל (שבר inclusionProof + mmrAuditBridge).

## מה נעשה
1. **הוסר הניפוח** — מחקתי את ECOS_CANONICAL_KNOWLEDGE/, lib+src/lib/canonicalKnowledge527.js,
   scripts/build-canonical-knowledge.js, וה-IIFE שלו מהשרת. חזרה ל-23MB.
2. **globals shim** — `node_modules/vitest/globals.cjs` (zero-dep, Node builtins) מזריק
   describe/it/expect/hooks/vi ל-globalThis; `scripts/audit-tests.js` טוען אותו כ---require.
   הוריד cannotRun 28→21 (7 ה-globals רצות עכשיו).
3. **תיקון MMR** — הוספתי `posInPeak: leafIndex - peak.leafStart` ל-generateProof (lib+src/lib).
   תיקן את inclusionProof + mmrAuditBridge.
4. **תיקון mock** — ב-auditBackfill.test.js ה-mock של pg לא דימה את ה-LEFT JOIN (החזיר אותן שורות
   כל batch / תפס את ה-SELECT בענף ה-INSERT). תיקנתי שיעקוב אחר ids שעברו backfill. הקוד התקין; ה-mock היה שבור.

## אימות (audit מלא, exit code)
לפני (v527): ~117 pass / 28 cannotRun / 0 realFail (עם ניפוח 9.5MB).
אחרי (v528): **123 pass / 21 cannotRun / 0 realFail**, זיפ ~5–6MB.
SACRED ללא שינוי (563e9b1f / e5a5c2c2). השרת parse נקי. tests/v528.test.js: 9/0.

## מה לא אומת (בכנות)
- **21 cannotRun נשארות, וכולן צריכות חבילת npm אמיתית שאי-אפשר להתקין אופליין:**
  **19 צריכות `pg` (postgres driver), 1 `ws`, 1 `commander`.** לא זייפתי אותן — stub מזויף היה
  הופך אותן ל-realFail כוזב. כדי לאמת אותן: בסביבה עם רשת הרץ `npm i pg ws commander` ואז את ה-audit.
- ה-globals shim הוא שכבת-תאימות, לא vitest מלא.
