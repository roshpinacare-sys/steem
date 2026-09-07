# NEXT_SESSION_PROMPT_V518.md — Start of V519

## Pre-flight
```bash
node scripts/audit-tests.js          # expect pass=64, cannotRun=72, realFail=0
node --check ecos-api-server.js      # PARSE_OK
NODE_ENV=test node tests/v518.test.js   # 16/16
NODE_ENV=test node tests/v517.test.js   # 17/17
NODE_ENV=test node tests/v516.test.js   # 15/15
md5sum lib/fiatLedger.js lib/auditLog.js
# 563e9b1f9e67091a5b6527c0a92568e5  lib/fiatLedger.js
# e5a5c2c27801d2d03991bc8e5a1df8cb  lib/auditLog.js
```

## מצב ב-V518
- 518.0.0. `canonTowerAuditor518.js` נוסף (audit-only, 0 רישומים ל-bridge508).
- audit: 64 pass (+1), 72 cannotRun, 0 realFail. SACRED נשמר.
- 3 המועמדים מ-V517 נפסלו רשמית (verdict ב-`getCandidateVerdicts518`):
  marketMaker / providerAdapters / economicIntegrityLoadBearing — כולם
  containers של מודולים פעילים, לא parallel-dup.

## למה Action C מוצה כרגע
לפי `auditAllTowers518()` המגדלים היחידים שמסווגים eligible כרגע (וכבר
נרשמו): `onboardingFlow` (V517), `agentDispatchBridge` (V517) + 7 מ-V516.
אין מועמד פתוח חדש שלא נרשם.

## הצעד הבא — V519 — שני מסלולים אפשריים

### מסלול 1 (מומלץ): Action D — Audit completeness sweep
לאמת שכל **endpoint כספי** (mint/withdraw/transfer/settle) עובר דרך
`guardMint402` / `guardWithdraw402` ויוצר רשומת `auditLog`. צור
`lib/auditCompletenessProbe519.js` שעובר על כל ה-routes של ecos-api-server,
מסמן endpoints "money-touching" לפי regex של path/handler-source, ומחזיר
דוח endpoints-without-audit. שום שינוי לוגי, רק probe + report.

### מסלול 2: הרחב את האאודיטור
הוסף סורק שני: `inheritanceChainAuditor519` — מסווג מגדלים שהם chains
(ראש דורש נמוכים). זה משלים את `canonTowerAuditor518` שמטפל רק ב-parallel-dup.

## כללים
- exit code only. 0 npm deps. SACRED לא לגעת.
- כל מזהה מסתיים ב-519. IIFE בסוף השרת. שיקוף ב-src/lib.
- חובה סעיף "מה לא אומת" בתיעוד.
- אל תרשום descriptor ב-bridge508 בלי לעבור דרך `classifyTower518` תחילה.

## אזהרה
אל תרשום `marketMaker`, `providerAdapters`, או
`economicIntegrityLoadBearing` ב-`canonBridgePatch508`. V518 פסל אותם
רשמית עם טסטים שיכשלו אם הסיווג ישתנה בלי שהקבצים בעצמם יומרו ל-thin
re-export קודם.
