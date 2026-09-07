# NEXT_SESSION_PROMPT_V537.md — Start of V538

## Pre-flight
```bash
node --check ecos-api-server.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f / e5a5c2c2
node scripts/audit-tests.js               # expect 135 pass / 19 cannotRun / 0 realFail
NODE_ENV=test node tests/v537.test.js     # 12/12
```

## Convention שמור
- `heartbeatGovernanceBridge532.activeBridge532` — getter/setter. V532 IIFE מאכלס. אל תשנה.
- `heartbeatGovernanceBridge532.activeHb532` — getter/setter. `_getOrCreate532` מאכלס. אל תשנה.
- `defaultBridge532` לא קיים — לא להשתמש.
- `tests/v528.test.js` שורה 65 — non-self filter. אל תחזיר ל-strict.

## מצב ב-V537
- 537.0.0. `activeHb532` חשוף. GET /status/v537 מחזיר hbLive+hbRunning בפועל.
- 135 pass, 19 cannotRun, 0 realFail.

## הצעד הבא הכי בעל-מינוף: V538

**חבר `activeHb532` ל-`hbRunning` ב-V534 endpoint:**

```bash
grep -n "hbRunning\|_hb532_534\|activeHb\|activeHb532" ecos-api-server.js | grep -i "534\|hbRunning" | head -10
```

V534 IIFE מחזיר `hbRunning: false` כי `_hb532_534 = null`.
עדכן V534/V536 IIFE לקרוא `Bridge532.activeHb532` (כמו שV537 עושה) ולהחזיר `hbRunning` אמיתי.

כלל: אל תיצור IIFE חדש אם אפשר לעדכן קיים. בדוק: האם מותר לשנות IIFE קיים? (הוספה בלבד לendpoints — אבל שינוי פנימי IIFE מותר).

אם זה מסוכן → בנה V538 IIFE שמחזיר aggregated status מכל השלבים (V532+V534+V536+V537).

## כללים
- exit code only. אפס npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-538. tests/v538.test.js exit 0.
- דווח: pass לפני→אחרי, cannotRun, realFail.
