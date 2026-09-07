# CHANGELOG V552 — Deep Health Score Bridge

## Version: 552.0.0 | Phase: P311
## Author: AI (Claude Sonnet 4.6) | Date: 2026-06-06

## מה זוהה
- Baseline: **149 pass, 19 cannotRun, 0 realFail**.
- NEXT_SESSION_PROMPT_V551 ביקש: חיבור signals אמיתיים ל-gate549.
- **בג אמיתי שנמצא**: `getCompositeScore543()` מחזיר `{ compositeScore: 0.5 }` אבל `deepHealthPolicy546._readScore546()` מחפש `r.composite` או `r.score` — field name mismatch → score=0 תמיד → gate=MANUAL תמיד.

## מה נבנה
**`lib/deepHealthScoreBridge552.js`** (ומשוכפל ל-`src/lib/`):
- `applyScoreBridge552()` — require-cache patch על `getCompositeScore543`, מוסיף alias fields `composite` ו-`score` לתוצאה. Idempotent.
- `getScoreBridgeStats552()` — calls/lastScore/patched.
- מופעל ב-boot ב-V552 IIFE.

## תוצאת הפאטש
| לפני V552 | אחרי V552 |
|-----------|-----------|
| score = 0 | score = 0.5 |
| decision = MANUAL (score=0) | decision = MANUAL (trend=unknown, fail-closed) |
| gate שבור | gate עם ניקוד אמיתי |

Decision = MANUAL עדיין — **נכון**: trend=unknown → fail-closed by design. trend יתפתח עם history.

## מה חובר
`marketMakerCanon543 → deepHealthPolicy546 → gate547 → gate549 → dispatchBridge550 → executePlan437_patched551`

## אימות
- **22/22 V552 tests — exit 0**.
- audit: **150 pass (+1), 19 cannotRun, 0 realFail**.
- node --check: OK. SACRED MD5: תקין.

## מה לא אומת
- trend יתפתח מ-unknown ל-known רק עם history data מ-`deepHealthAlertHistory542`. לא אומת.
- decision=SUPERVISED/AUTO — לא הושג (trend חסר). לא ניתן לבדוק ב-process קצר.
- 19 cannotRun — ESM/vitest.
