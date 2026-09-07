# NEXT_SESSION_PROMPT_V481.md — Start of V482

## מצב ב-V481
- 481.0.0. `hexaTowerCanon481.js` — facade ל-6 ה-Canons הגדולים (473+475+476+477+478+480), ~88 מודולים → נקודת כניסה יחידה.
- SACRED intact. 22/22 ירוקים.

## Pre-flight
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v481.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```

## מגדלים שנותרו ללא איחוד (V482)
```bash
ls lib/ | sed 's/[0-9].*$//' | sort | uniq -c | sort -rn | head -10
```
- `marketMaker` ×37 (עם Canon475) — הגדול ביותר; הלא-קנוניים עדיין טוענים בשרת ישירות
- `providerAdapters` ×17 (עם Canon476) — ללא thin re-export
- `economicIntegrityLoadBearing` ×11 (עם Canon477) — IIFE הישנים בשרת מייבאים ישירות פונקציות ייחודיות

**המלצה לV482: thin re-export בטוח**
הגרסאות הישנות של providerAdapters (267–286) **אינן** מיובאות ישירות בשרת (grep מאמת).
ניתן להפוך אותן ל-thin re-export בטוח:
```js
// lib/providerAdapters267.js (לאחר thin re-export)
'use strict';
module.exports = require('./providerAdaptersCanon476.js');
```
- ודא 0 הפניות ישירות ל-providerAdapters267-286 בשרת לפני מחיקה/re-export
- בדוק שה-Canon476 exports את כל הפונקציות הנדרשות
- כתוב 10+ tests, exit 0
