# NEXT_SESSION_PROMPT_V506 — Start of V507

## מצב ב-V506
- 506.0.0. `GET /api/v1/status` משרת מ-`systemStatus505` — governance.ok=true. ✅
- **Pre-flight**:
  ```bash
  node scripts/audit-tests.js    # expect ~51 pass, 72 cannotRun, 0 realFail
  node --check ecos-api-server.js
  NODE_ENV=test node tests/v506.test.js   # 16/16
  md5sum lib/fiatLedger.js lib/auditLog.js
  ```

## הצעד הבא הכי בעל-מינוף: הורדת debtScore

`getSystemPosture505()` מדווח `debtScore: 75` — גבוה. המקור: מגדלי-שכפול.

**המשימה לV507**: השתמש ב-`GET /api/v1/registry/duplication` — מצא את המגדל הגדול
ביותר שאין לו עדיין canon facade, בנה `<towerName>Canon507.js` (כמו meshDispatcherCanon470
ו-marketMakerCanon471), ועדכן `/api/v1/mesh/dispatch/status` לכלול אותו.

**אזהרה**: תחשב רק parallel-dup (לא inheritance chain) בטוחה להפיכה ל-thin re-export.
בדוק בעזרת grep: האם מודול A עושה `require('./moduleB')` בתוך הגדרת class — אם כן,
זו inheritance-chain, לא thin re-export.
