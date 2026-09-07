# NEXT_SESSION_PROMPT_V541.md — Start of V542

## Pre-flight
```bash
node --check ecos-api-server.js
md5sum lib/fiatLedger.js lib/auditLog.js        # 563e9b1f / e5a5c2c2
node scripts/audit-tests.js                     # expect 139 pass / 19 cannotRun / 0 realFail
NODE_ENV=test node tests/v541.test.js           # 27/27
```

## Convention שמור (אל תשנה)
- `heartbeatGovernanceBridge532.activeBridge532` / `.activeHb532` — getter/setter, V532 IIFE מאכלס.
- `tests/v528.test.js` שורה 65 — non-self filter. אל תחזיר ל-strict.
- `_classifyItem540`: סדר קריטי — hbRunning קודם, activeHb שני, bridge שלישי.

## מצב ב-V541
- 541.0.0. `deepHealthAlertFilter541.js` — query-param filter על deepHealthAlerts540.
- `GET /api/v1/deep-health/alerts/v541?severity=critical&category=bridge&limit=N`
- audit: **139 pass, 19 cannotRun, 0 realFail**.

## הצעד הבא — V542

**אפשרות A — Alert History Ring Buffer** (מה שהיה B ב-V540)
`lib/deepHealthAlertHistory542.js` — ring buffer (N=50 snapshots) של קריאות ל-buildFilteredAlerts541.
endpoint חדש: `GET /api/v1/deep-health/alert-history/v542` → רשימת snapshots עם timestamp.
- מאפשר לזהות trends (האם alerts גוברים? מתי הם הופיעו?)
- 0 state חיצוני, הכל in-memory, נאפס עם restart.

**אפשרות B — Tower Canon: marketMaker**
`marketMaker333` הוא ה-tip של שרשרת inheritance (298→...→333).
canon facade שחושף רק את API של 333 כנקודת כניסה יחידה.
⚠️ inheritance chain — אל תנסה thin re-export. facade בלבד.

**המלצה: A** — עקבי עם קו deep-health, פשוט, read-only, מחבר מודולים קיימים.

## כללים
- exit code only. 0 npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-542. IIFE בסוף. tests/v542.test.js exit 0.
- דווח: X/Y pass לפני→אחרי (מ-139), cannotRun, realFail.
- חובה סעיף "מה לא אומת".
