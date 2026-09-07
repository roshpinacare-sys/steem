# NEXT_SESSION_PROMPT_V517.md — Start of V518

## Pre-flight
```bash
node scripts/audit-tests.js          # expect pass=63, cannotRun=72, realFail=0
node --check ecos-api-server.js      # PARSE_OK
NODE_ENV=test node tests/v517.test.js   # 17/17
NODE_ENV=test node tests/v516.test.js   # 15/15
md5sum lib/fiatLedger.js lib/auditLog.js
# 563e9b1f9e67091a5b6527c0a92568e5  lib/fiatLedger.js
# e5a5c2c27801d2d03991bc8e5a1df8cb  lib/auditLog.js
```

## מצב ב-V517
- 517.0.0. `canonRegistryBridge517.js` — Action C: רישום
  `onboardingFlow` (263..268, ×6) + `agentDispatchBridge` (246..253, ×8)
  ב-`canonBridgePatch508`.
- audit: 63 pass (+1), 72 cannotRun, 0 realFail. SACRED נשמר.
- bridge508 מכיר עכשיו: 7 (V516) + 2 (V517) + reflectionLoop (507) + tipModule (509) = **11 מגדלים**.

## הצעד הבא — V518

הדרך הזולה לזהות מועמדים נוספים:
```bash
ls lib/ | grep -v Canon | sed 's/[0-9]*\.js$//' | sort | uniq -c | sort -rn | head -15
# לכל מועמד: בדוק אם הוא parallel-dup אמיתי:
#   head -3 lib/<name><lowest>.js | grep -q "module.exports = require"
```

**מועמדים פתוחים** (לא נרשמו ב-bridge508, צריך אימות לפני רישום):
- `marketMaker` ×36 — חשוד **לא** parallel-dup פשוט (גודל חריג).
  לפני רישום, ודא חתימת V495 consolidation בכל non-tip member.
- `providerAdapters` ×17 — לא נבדק. ראה אם זה parallel-dup או inheritance-chain.
- `economicIntegrityLoadBearing` ×11 — לא נבדק.
- `meshDispatcher` ×10 — **כבר נבדק ב-V517: לא parallel-dup. אל תרשום.**

**הצעה ל-V518 (Action C המשך):** עבור על כל אחד מ-3 המועמדים הפתוחים,
אמת חתימה (V495 consolidation header), וצור `canonRegistryBridge518.js`
שרושם רק את אלה שאכן parallel-dup. אם אף אחד לא — עבור ל-Action D.

## כללים
- exit code only. 0 npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-518. IIFE בסוף השרת. שיקוף ב-src/lib.
- חובה descriptor.members לכלול את כל הקבצים הקיימים בדיוק.
- חובה לבדוק שכל non-tip member הוא thin re-export של tip לפני רישום parallel-duplicate.
- דווח במספרים מ-`scripts/audit-tests.js`. חובה סעיף "מה לא אומת".
