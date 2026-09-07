# NEXT_SESSION_PROMPT_V536.md — Start of V537

## Pre-flight
```bash
node --check ecos-api-server.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f / e5a5c2c2
node scripts/audit-tests.js               # expect 134 pass / 19 cannotRun / 0 realFail
NODE_ENV=test node tests/v536.test.js     # 12/12
```

## Convention שמור
- `heartbeatGovernanceBridge532.activeBridge532` — getter/setter. V532 מאכלס. אל תשנה ל-plain property.
- `tests/v528.test.js` שורה 65 — non-self filter. אל תחזיר ל-strict.
- `defaultBridge532` לא קיים — לא להשתמש בו.

## מצב ב-V536
- 536.0.0. שרשרת חיבור: V532 IIFE → activeBridge532 → V534 + V536 קוראים אותו.
- `GET /health-v536` מחזיר `bridgeLive: true/false` בהתאם לאם POST /governance/start נקרא.
- 134 pass, 19 cannotRun, 0 realFail.

## הצעד הבא הכי בעל-מינוף: V537

**חשוף `_hb532` singleton** (ה-heartbeat עצמו) מ-V532 IIFE.

```bash
grep -n "activeBridge532\|activeHeartbeat532\|_hb532" ecos-api-server.js | head -10
```

כמו ש-V535 חשף `activeBridge532`, עשה אותו הדבר ל-`_hb532`:
1. הוסף ל-`diamondHeartbeat454.js`: `exports.activeHeartbeat454 = null` (getter/setter).
2. ב-V532 IIFE: `HB454.activeHeartbeat454 = _hb532;` אחרי `_getOrCreate532`.
   — אבל: `_hb532` נוצר lazy! → עדכן `_getOrCreate532` לאכלס את ה-accessor.
3. V537 IIFE: קרא את `HB454.activeHeartbeat454` ובדוק `hbRunning`.

אלטרנטיבה פשוטה יותר: הוסף `activeHb532 = null` ל-`heartbeatGovernanceBridge532.js` (כמו activeBridge532).

## כללים
- exit code only. אפס npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-537. tests/v537.test.js exit 0 → zip.
