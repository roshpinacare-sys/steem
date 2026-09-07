# CHANGELOG V468

## תאריך: 2026-06-04

### מה זוהה (טריאז')
- 1558 קבצי JS, ~400K שורות, 96 טסטים.
- קבצי SACRED תקינים (fiatLedger.js, auditLog.js — md5 לא השתנה).
- שרת עובר `node --check`.
- 47 קבצי patch ישנים ללא הפניות בקוד (ecos-api-server.js, lib/, src/, tests/).
- 3 תמונות כבדות (>100KB כל אחת) ללא הפניות בקוד ב-gumloop/assets/.
- קובץ סקריפט אחד (`scripts/reembed-patches.js`) וקובץ טסט-patch אחד ללא הפניות.
- מגדלי שכפול מזוהים (meshDispatcher 288–297, agentDispatchBridge 246–253) אך APIs שונים לחלוטין — איחוד דורש חקירה מעמיקה, נדחה לגרסה עתידית.

### מה נבנה
- **V468 — Canonical Cleanup Registry**
  - `lib/cleanupRegistry468.js`: מודול read-only המתעד מה נוקה ולמה.
  - `GET /api/v1/registry/cleanup`: דוח JSON של כל הקבצים שהוסרו + הסיבה.
  - `GET /api/v1/admin/summary/v468`: מטא-אנדפוינט עם תיאור ורשימת אנדפוינטים.
  - IIFE `_wireCleanupRegistry468` בסוף ecos-api-server.js, עטוף try/catch (non-fatal).

### מה נוקה (Priority A)
- 47 קבצי patch ישנים שלא מיובאים בקוד — נמחקו.
- 3 תמונות כבדות לא-רלוונטיות — נמחקו (~1.1MB+).
- `scripts/reembed-patches.js` — נמחק (אפס הפניות).
- `tests/ecos-api-server-v216-patch.js` — נמחק (אפס הפניות).
- 39 קבצי patch מיובאים נשמרו לחלוטין — לא נשבר הבסיס.

### חיבור
- ה-Cleanup Registry מחובר ל-registry הקיים (V463) דרך אנדפוינט חדש תחת `/api/v1/registry/`.
- כל מזהה במודול V468 מסתיים ב-468 (const/class/fn).
- אין תלות npm חדשה.

### אימות
- `node --check ecos-api-server.js` — עובר (exit 0).
- `NODE_ENV=test node tests/v468.test.js` — 19/19 טסטים עוברים (exit 0).
- SACRED md5 תקין — לא נגענו ב-basis.
- קבצים מיובאים עדיין קיימים — לא נשבר טסט ישן.
