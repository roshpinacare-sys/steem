# NEXT_SESSION_PROMPT_V512.md — Start of V513

## Pre-flight
```bash
node scripts/audit-tests.js    # expect pass=58, cannotRun=72, realFail=0
node --check ecos-api-server.js
NODE_ENV=test node tests/v512.test.js   # 10/10
md5sum lib/fiatLedger.js lib/auditLog.js
```

## מצב ב-V512
- 512.0.0. `sybilGuardCanon512.js` — facade ל-6 מודולי sybilGuard (V263–V268).
- audit: pass=58, cannotRun=72, realFail=0. SACRED intact.

## הצעד הבא
**V513: בדוק מגדל tipModule**
```bash
ls lib/ | grep tipModule | sort -V
grep "require.*tipModule" lib/tipModule*.js | head -8
```
- parallel? → `tipModuleCanon513.js` facade (כמו sybilGuardCanon512).
- chain? → shim לגרסה הנמוכה ביותר שמייבאת ישירות.

אחרי tipModule — מגדל splitModule (6 מודולים) ו-agentDispatchBridge (8).
אבל בחר **משימה אחת** — facade אחד, מחובר, מאומת.

## כללים
- exit code only. 0 npm deps. SACRED לא לגעת.
- כל מזידה מסתיים ב-513. IIFE בסוף השרת.
- דווח: X/Y pass, Z cannotRun, W realFail — מספרים מ-audit-tests.js בלבד.
