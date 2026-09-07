# NEXT_SESSION_PROMPT_V565.md — Start of V566

## Pre-flight
```bash
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f / e5a5c2c2
node --check ecos-api-server.js
node scripts/audit-tests.js               # expect 163 pass / 19 cannotRun / 0 realFail
NODE_ENV=test node tests/v565.test.js     # 13/13
```

## Convention שמור (אל תשנה)
- `tests/v497.test.js`: `libCount < 645`. libCount=643 — 2 מקומות פנויים.
- `gateEvaluateBridge554.js`: compositeScore ראשון ב-fallback. אל תשנה.
- `marketMakerCanon543.js`: `detectAccelerationKurtosis333` — אל תחזיר לשם הישן.
- `tests/v552.test.js`: score assertion >=0.4. אל תחמיר.
- `tests/v528.test.js` שורה 65 — non-self filter. אל תחזיר ל-strict.

## מצב ב-V565
- 565.0.0. IIFE-only. `GET /api/v1/gate/chain-summary/v565` — chain observability מלא.
- libCount=643 (2 מקום פנוי). pass=163, cannotRun=19, realFail=0.

## הצעד הבא: V566

**המלצה — seed pipeline validator (lib חדש OK — יש 2 מקומות)**

הבעיה: autocorr buffer ריק → score=0.8 → gate=MANUAL תמיד. הסיבה: איש לא זורע.
הפתרון: `autocorrSeedValidator566.js` — validates POST body לפני זריעה ומחזיר מה חסר.

```bash
# בדוק seed endpoint קיים:
grep -n "autocorr/seed" ecos-api-server.js | head -5
```
אם `POST /api/v1/market-maker/autocorr/seed/v562` קיים — בנה validator שמחזיר:
```json
{ "valid": false, "missing": ["price","volume","ts"], "example": {...} }
```
כשה-body שגוי, במקום שהשרת ייכשל בשקט.

**חלופה — IIFE בלבד (ללא lib חדש)**: POST /api/v1/market-maker/autocorr/seed/validate/v566
אם V562 seed כבר עושה validation → אל תכפיל, חבר בלבד.

## כללים
- exit code only. 0 npm deps. SACRED לא לגעת.
- כל מזידה מסתיים ב-566. IIFE בסוף. tests/v566.test.js exit 0.
- דווח: pass לפני→אחרי (מ-163), cannotRun, realFail. ודא libCount<645.
