# NEXT_SESSION_PROMPT_V516.md — Start of V517

## Pre-flight
```bash
node scripts/audit-tests.js    # expect pass=62, cannotRun=72, realFail=0
node --check ecos-api-server.js
NODE_ENV=test node tests/v516.test.js   # 15/15
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```

## מצב ב-V516
- 516.0.0. `canonRegistryBridge516.js` — C בסדר הכרעה: רישום 7 מגדלים
  (telemetry+sybilGuard+reputationLedger+offlineQueue+splitModule+quadraticFunding+x402)
  ב-canonBridgePatch508. honest-patched report עכשיו מלא.
- audit: 62 pass, 72 cannotRun, 0 realFail.

## הצעד הבא — V517
הרץ: `ls lib/ | grep -v Canon | sed 's/[0-9]*\.js$//' | sort | uniq -c | sort -rn | head -10`

הbrige508 עדיין לא מכיר:
- `onboardingFlow` — מכוסה ב-pentaTowerCanon480, אבל שם אין `getTowerDescriptor` בפורמט bridge508.
  → הוסף descriptor ל-canonRegistryBridge516 או צור V517 patch.

בדוק סדר הכרעה A-E:
- A: patch files — כולם USED (נבדק). אין garbage קל לנקות.
- B: towers — כמעט הכל מכוסה. בדוק אם pentaTowerCanon480 רשוי ב-bridge508.
- C: בדוק אם `hexaTowerCanon481` רשוי ב-bridge508 — probably not.
- E: אם הכל מחובר — שקול לאחד את bridge508+bridge516 ל-single truth registry.

## כללים
- exit code only. 0 npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-517. IIFE בסוף השרת.
- דווח: X/Y pass, Z cannotRun, W realFail מ-audit-tests.js.
- חובה סעיף "מה לא אומת".
