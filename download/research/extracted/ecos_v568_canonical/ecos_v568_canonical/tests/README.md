# ECOS Tests — מפת האמת

## ריצה מהירה

```bash
# ריצה מקומית (Node בלבד — כל מה שניתן לאמת כאן):
node scripts/audit-tests.js

# טסט ספציפי:
NODE_ENV=test node tests/v<NNN>.test.js
```

## קטגוריות

### PASS — רצו ויצאו 0
כ-47+ suites שרצים ישירות תחת `node`. אלה **אומתו**. עדכן ב-`scripts/audit-tests.js`.

### CANNOT-RUN — דורשים vitest
72 suites שנכתבו עם `vitest` (describe/it/expect) — **לא ניתנים להרצה** בסביבה ללא
`npm install`. **אינם נחשבים pass** ואינם נחשבים fail — הם unverified.

**רשימת הסיבות:**
- `describe is not defined` — שימוש ב-vitest API
- `ERR_MODULE_NOT_FOUND` — חוסר `vitest`, `supertest`, `ws`, `express` כתלויות dev
- `Unexpected token` — ESM syntax

**איך לרוץ אותם (בסביבה עם npm):**
```bash
npm install
npx vitest run tests/
```

### REAL-FAIL — רצו ונכשלו
אלה **בעיות אמיתיות** שצריך לתקן. אין להתעלם מהם לייפוי מספרים.

היסטוריה:
- `v243.test.js` — תוקן ב-V503 (קבצי documentation חסרו לאחר archive V497)

## כלל הזהב

> **"X/Y עברו, Z cannotRun, W realFail"** — לעולם לא "הכל עובד".

המספרים מגיעים מ-`node scripts/audit-tests.js` בלבד.
