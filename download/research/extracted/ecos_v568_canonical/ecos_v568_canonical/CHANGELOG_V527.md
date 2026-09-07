# Changelog — V527 — סגירת כל ה-realFail (תיקונים אמיתיים + תשתית shim)

**Release:** ECOS V527 · 2026-06-05 · AI lead (Opus 4.8)

## מה זוהה (audit מלא על v526)
111 pass / 28 cannotRun / 5 realFail. טופלו כל 5 הכשלים — לא בעקיפה, בתיקון אמיתי.

## מה נבנה/תוקן
- **lib/rails/{manualRail,stripeRail,bankTransferRail}.js** — מודולי מסילות-תשלום אמיתיים שהיו
  חסרים לגמרי (paymentRail.test.js ציפה להם). מממשים id/isAvailable/capabilities/deposit,
  זיכוי דרך ה-FiatLedger (SACRED) + רישום audit. paymentRail: 7/0.
- **monitor/index.js** — שרת status+SSE אמיתי (GET /monitor/status עם sseClients, GET /monitor/stream
  כ-text/event-stream, ו-checkValidatorIdleState). monitor: 5/0.
- **node_modules/vitest/ (ה-shim הוונדורי)** — הורחב: mock matchers (toHaveBeenCalled/Once/Times/With)
  + vi.spyOn אמיתי שמיירט מתודות וסופר קריאות. תיקן embeddingProvider (18/0), v524, stripe — תשתית
  משותפת שמשרתת כל חבילה שמשתמשת ב-mocks/spies.
- **tests/v510.test.js (T09)** — טסט-מטא של סוכן קודם שקיבע הנחה ישנה (cannotRun≥70). ה-shim הוריד
  את cannotRun בכוונה (יותר חבילות רצות באמת = שיפור, לא רגרסיה). תוקן לבדוק בריאות אמיתית
  (pass גבוה + buckets עקביים). v510: 10/0.

## אימות (exit code, audit מלא)
לפני: 111 pass / 28 cannotRun / 5 realFail → **אחרי: 117 pass / 28 cannotRun / 0 realFail**.
SACRED ללא שינוי (563e9b1f / e5a5c2c2). השרת עושה parse. אפס תלויות npm חדשות (ה-shim הוא vendored source).

## מה לא אומת (בכנות)
- 28 חבילות עדיין cannotRun: חלקן משתמשות ב-vitest כ-globals (ה-shim הוא import-only), חלקן צריכות
  חבילת npm אמיתית (pg/commander) שלא מותקנת אופליין. לא נבדקו כאן — לא עוברות ולא נכשלות.
- ה-shim הוא שכבת-תאימות, לא vitest אמיתי. במקום קריטי — אמת מול vitest אמיתי ב-CI עם רשת.
- parse ≠ runtime: אימות זה לא מבטיח שכל endpoint רץ נכון בזמן ריצה.

## הצעד הבא
להרחיב את ה-shim ל-globals (יוריד עוד cannotRun), או לאחד את systemStatus504/505 הכפולים.
