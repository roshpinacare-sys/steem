# CHANGELOG V564

## מה זוהה
NEXT_SESSION_PROMPT_V563 הציע לחבר `/composite/live/v563` ל-`gateEvaluateBridge554`.
V554 משתמש ב-`getCompositeScore543()` — baseline 0.8 תמיד.
V563 כבר מחזיר score=0.8..1.0 (לפי autocorr seed) אבל gate לא ידע על זה.

## מה נבנה
**`lib/gateLiveEvaluate564.js`** — Live Gate Evaluation:
- `evaluateLiveGate564()` — אותה לוגיקת _decide546, עם `getCompositeScore563()` (V563)
- `evaluateGateDiff564()` — diff: baseline V554 vs live V564 (scoreDelta, decisionChanged)
- `registerEndpoints564(app)` — wire endpoints

## Endpoints חדשים
- `GET /api/v1/gate/evaluate/live/v564` — live decision עם V563 score
- `GET /api/v1/gate/evaluate/diff/v564` — diff baseline vs live
- `GET /api/v1/admin/summary/v564`

## מה חובר
Chain שנסגר:
```
POST /autocorr/seed/v562 → tokenSnapshotBuffer562 →
getCompositeScore563() (V563) → gateLiveEvaluate564() → AUTO/SUPERVISED/MANUAL
```
V563 score ≥ 0.70 + trend≠unknown → decision AUTO (לעומת MANUAL ב-V554).

## אימות
- `tests/v564.test.js` — 13/13 ✓
- `scripts/audit-tests.js` — לפני: 161/19/0 → אחרי: **162/19/0** (+1 pass, 0 regres)
- libCount=644 < 645 ✓ (v497 constraint)
- SACRED intact, node --check clean

## מה לא אומת
- 19 cannotRun (vitest/ESM)
- decision=AUTO יוחזר רק כשגם score≥0.70 וגם trend≠unknown. בסביבת test, trend=unknown → MANUAL תמיד.
