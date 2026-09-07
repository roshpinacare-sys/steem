# NEXT_SESSION_PROMPT_V554.md — Start of V555

## Pre-flight
```bash
md5sum lib/fiatLedger.js lib/auditLog.js           # 563e9b1f / e5a5c2c2
node --check ecos-api-server.js
NODE_ENV=test node tests/v554.test.js              # 14/14
node scripts/audit-tests.js                       # ≥152 pass / 19 cannotRun / 0 realFail
```

## Convention שמור
- `node_modules/ws`, `commander` — vendored stubs.
- selfExcludes: `v510, v528, v534` — circular audit loop.
- `trendSeedBridge553` — boot seed מופעל פעם אחת. אל תכפיל.

## מצב ב-V554
- 554.0.0. **באג מתועד**: `deepHealthPolicy546._readTrend546` קורא `r.trend` אבל `getTrend542()` מחזיר `r.direction`.
- `gateEvaluateBridge554` מתקן בצד הצרכן — קורא `_decide546` ישירות עם trend נכון.
- `GET /api/v1/deep-health/gate/evaluate` → decision=MANUAL כי score=0 (canon543 לא נטען בריצה ללא הפעלת מלאה).
- 152 pass, 19 cannotRun, 0 realFail.

## הצעד הבא הכי בעל-מינוף: V555

**תקן את הבאג במקור — patch deepHealthPolicy546._readTrend546**

הבאג ב-`_readTrend546` הוא הנה:
```js
// שורה 87-88 ב-lib/deepHealthPolicy546.js:
const trend = (typeof r === 'string') ? r
            : (r && typeof r.trend === 'string') ? r.trend   // ← 'trend' שגוי
            : 'unknown';
// תיקון: r.direction במקום r.trend
```

**משימה:**
```bash
grep -n "r.trend\|r\.trend\|typeof r.trend" lib/deepHealthPolicy546.js
```
1. אמת שהשורה היא בדיוק `r.trend` (ולא `r.direction`).
2. תקן עם `str_replace` — שורה אחת בלבד: `r.trend` → `r.direction || r.trend`.
3. הרץ: `node -e "var h=require('./lib/deepHealthAlertHistory542.js'); require('./lib/trendSeedBridge553.js').seedTrend553(10); console.log(require('./lib/deepHealthPolicy546.js').getPolicy546())"`
4. ודא policy.trend !== 'unknown' ו-policy.decision !== MANUAL (אם score > 0).
5. הרץ מחדש את כל הטסטים שמזכירים policy546 (grep). ודא 0 רגרסיות.

**כלל**: `str_replace` על שורה אחת בדיוק. בלי DOTALL. אל תשנה שורות אחרות. בדוק md5 של SACRED אחרי.
