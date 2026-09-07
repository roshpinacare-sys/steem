# CHANGELOG_V543.md — ECOS V543

## גרסה: 543.0.0
## תאריך: 2026-06-05
## סטטוס אודיט: 140 pass / 19 cannotRun / 0 realFail

---

## מה זוהה

**אודיט בסיסי:** V542 יציב ב-140/19/0. כל 19 ה-cannotRun הם טסטי-אינטגרציה HTTP
שדורשים `express` + `supertest` — שתי חבילות שאינן מותקנות ב-node_modules.
אלה לא ניתנות לתיקון ללא `npm install`; הן cannotRun בכנות.

**בעיות שזוהו ותוקנו:**
1. `lib/withdrawalHistoryService.js` — שגיאת syntax: `\`` (backslash+backtick) לפני template literal (שריד escaping של סוכן קודם). תוקן בשתי הגרסאות (lib/ + src/lib/).
2. `lib/rails/cryptoRail.js` — חסר לגמרי. השרת עושה `new CryptoRail()` בתוך IIFE, וכשהמודול חסר — טעינת-האפליקציה מתפרקת בטסטי endpoint. נוצר בדפוס manualRail.
3. `tests/v510.test.js` T08 — non-self filter לא כלל v528/v534, גרם למעגליות. תוקן.
4. `tests/v528.test.js` — selfExcludes לא כלל v534. תוקן.
5. `tests/v534.test.js` T13 — assert strict `failCount===0` ללא selfExcludes. תוקן לכלול v510/v528/v534.

---

## מה נבנה

### `lib/marketMakerCanon543.js` + `src/lib/marketMakerCanon543.js` (mirror)

**Enhanced canonical facade** עבור מגדל marketMaker (V298–V333, 36 מודולים).
מרחיב את `marketMakerCanon475` עם:

#### `getCompositeScore543()`
ציון בריאות מורכב [0..1] משקלול 4 מדדים:
- **kurtosis (0.3):** AuditCapTrail333.detectStreakChanges333 — ok → 1, else 0
- **outlierZ (0.3):** PageRangeDiffBridge333.computeOutlierZScore333 — ok+noOutliers → 1, ok+outliers → 0.5, fail → 0
- **autocorr (0.2):** RankedOverlapBuffer333.measureBandWidthAutocorrelation333 — ok → 1, else 0
- **entropy (0.2):** NormDeltaPercentilesTracker333.computeEntropyRedundancy333 — ok+redundancy<0.5 → 1, ok → 0.5, fail → 0

דרגה: A(≥0.8), B(≥0.6), C(≥0.4), D(<0.4)

#### `getHealthReport543()`
snapshot מלא: composite + trend מתוך חלון גלילי של 10 נקודות.
- rising: score עלה >0.05 מהנקודה הקודמת
- falling: score ירד >0.05
- stable: הפרש ≤0.05
- unknown: קריאה ראשונה

#### `registerEndpoints543(app)` — 3 endpoints:
- `V543-T01 GET /api/v1/market-maker/canon/health/v543`
- `V543-T02 GET /api/v1/market-maker/canon/composite/v543`
- `V543-T03 GET /api/v1/admin/summary/v543`

### שינויים בשרת
IIFE `_wireMarketMakerCanon543()` — non-fatal (try/catch). שרשרת:
```
marketMaker298→...→333 ← marketMakerCanon475 ← marketMakerCanon543 (tip)
```

---

## מספרי אימות

- **לפני:** 140 pass / 19 cannotRun / 0 realFail (V542)
- **אחרי:** 140 pass / 19 cannotRun / 0 realFail (V543)
- **טסט V543:** 15/0 (node tests/v543.test.js exit 0)
- **node --check ecos-api-server.js:** OK
- **SACRED:** fiatLedger 563e9b1f ✓ | auditLog e5a5c2c2 ✓

---

## מה לא אומת

- 19 ה-cannotRun לא נבדקו — דורשות express+supertest+pg (ראה NEXT_SESSION_PROMPT).
- `cryptoRail.js` — נוצר כ-stub; נתיב deposit פעיל רק כש-`ECOS_CRYPTO_ENABLED=1`. לא נבדק עם ledger אמיתי.
- trend calculation בוצע ב-unit בלבד (תוך-זיכרון); לא נבדק עם stream אמיתי של snapshots.
