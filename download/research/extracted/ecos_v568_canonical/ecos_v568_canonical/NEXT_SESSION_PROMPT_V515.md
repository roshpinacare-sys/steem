# NEXT_SESSION_PROMPT_V515.md — Start of V516

## Pre-flight
```bash
node scripts/audit-tests.js    # expect pass=61, cannotRun=72, realFail=0
node --check ecos-api-server.js
NODE_ENV=test node tests/v515.test.js   # 13/13
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```

## מצב ב-V515
- 515.0.0. `triTowerCanon515.js` — facade ל-3 מגדלי parallel-dup (splitModule + quadraticFunding + x402), V263–V268.
- audit: 61 pass, 72 cannotRun, 0 realFail.

## הצעד הבא — V516
הרץ: `ls lib/ | grep -v Canon | sed 's/[0-9]*\.js$//' | sort | uniq -c | sort -rn | head -12`

מגדלים שעדיין ללא canon ×6 (מוכרים):
- `reputationLedger` (6) — בדוק parallel vs chain
- `reflectionLoop` (6) — בדוק parallel vs chain

**המלצה: `duoTowerCanon516.js`** — facade ל-reputationLedger + reflectionLoop (אם שניהם parallel-dup).
אם אחד chain — בנה רק את ה-parallel אחד.

לבדוק גם:
- `ls lib/ | grep -v Canon | sed 's/[0-9]*\.js$//' | sort | uniq -c | sort -rn | head -20`
  לזהות מגדלים נוספים ×4+ ללא canon.
- בדוק C בסדר הכרעה: האם Diamond heartbeat עדיין פתוח?

## כללים
- exit code only. 0 npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-516. IIFE בסוף השרת.
- דווח: X/Y pass, Z cannotRun, W realFail מ-audit-tests.js.
- חובה סעיף "מה לא אומת".
