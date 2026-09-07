# CHANGELOG V565

## מה זוהה
libCount=643 (limit 645). NEXT_SESSION_PROMPT_V564 המליץ על IIFE-only endpoint לחסוך quota ל-lib/.

## מה נבנה
**IIFE-only** בסוף `ecos-api-server.js` — ללא קובץ lib חדש:
- `_buildChainSummary565()` — inner function ב-IIFE
- מחבר: scoreV543 (V543), scoreV563 (V563), gateV554 (V554), gateV564 (V564)
- מוסיף: scoreDelta, decisionChanged, autocorrBufferSize, hint פעיל

## Endpoints חדשים
- `GET /api/v1/gate/chain-summary/v565` — chain observability מלא
- `GET /api/v1/admin/summary/v565`

## מה חובר
Chain observability מלא ב-response אחת:
```
scoreV543=0.8 (V543 baseline) → scoreV563=0.8 (V563, buffer empty) →
gateV554=MANUAL → gateV564=MANUAL
hint: "seed ≥5 snapshots via POST /api/v1/market-maker/autocorr/seed/v562"
```

## אימות
- `tests/v565.test.js` — 13/13 ✓
- `scripts/audit-tests.js` — לפני: 162/19/0 → אחרי: **163/19/0** (+1 pass, 0 regres)
- libCount=643 < 645 ✓ (IIFE-only, no new file)
- SACRED intact, node --check clean

## מה לא אומת
19 cannotRun (vitest/ESM). decisionChanged=true יוצג רק אחרי seed+trend≠unknown — לא נוצר בסביבת test.
