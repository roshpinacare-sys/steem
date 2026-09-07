# CHANGELOG_V544.md — ECOS V544

## גרסה: 544.0.0
## בסיס: V543a (הטוב מבין שתי גרסאות V543 שהועלו)
## אודיט לפני: 141 pass / 19 cannotRun / 0 realFail
## אודיט אחרי: 142 pass / 19 cannotRun / 0 realFail

---

## בחירת בסיס (V543a vs V543b)

שתי גרסאות V543 הועלו. בוצע ניתוח:

| קריטריון | V543a (Replit) | V543b (Replit) |
|---------|---------------|---------------|
| בסיס | V542 (140/19/0) | fork אחר (125/34/0) |
| SACRED | ✅ | ✅ |
| audit | 141/19/0 | 141/19/0 |
| מודול חדש | `marketMakerCanon543.js` | `deepHealthAlertAggregator543.js` |
| תיקוני bugs | `withdrawalHistoryService.js` (syntax), `cryptoRail.js` (חסר), טסטי v510/v528/v534 | — |

**נבחר V543a** — בסיס בריא יותר (140/19 vs 125/34), תיקוני bugs אמיתיים.

---

## מה זוהה ב-V544

**בעיה**: `deepHealthAlertHistory542.push542()` קרא רק כאשר מגיע HTTP request מפורש
לאחד מ-3 ה-endpoints. ללא תנועת HTTP — הring buffer נשאר ריק, `getTrend542()` מחזיר
תמיד `'unknown'`, וכל ה-stack מ-V539–V543 חסר ערך.

**פתרון**: scheduler שמאזין ל-DiamondHeartbeat465 ומפעיל `push542()` אוטומטית על כל beat.

---

## מה נבנה

### `lib/deepHealthHistoryScheduler544.js` + `src/lib/` mirror

מחבר DiamondHeartbeat465 (V465) ← heartbeatGovernanceBridge532 (V532) ← deepHealthAlertHistory542 (V542).

**`attach544()`** — מחבר ל-heartbeat פעיל:
- ניסיון 1: `heartbeatGovernanceBridge532.activeHb532` (setter/getter מ-V532)
- ניסיון 2: `diamondHeartbeat465.defaultDiamondHeartbeat465()` singleton
- אם אין — מחזיר `ok:false` (idle, לא קורס)

**`_onBeat544(beat)`** — callback שנקרא בכל beat:
- מפעיל `push542({triggerSource:'scheduler544'}, 'scheduler544')`
- circuit-breaker: אחרי 50 שגיאות — עוצר (לא מאכלס log)

**`detach544()`** — מנתק ומאפס state (בעיקר לbetting).

**`status544()`** — `{attached, historyAvailable, beatsReceived, pushOk, pushErrors, circuitOpen, lastPushAt, lastError}`

**`registerEndpoints544(app)`**:
- `GET  /api/v1/deep-health/scheduler/status` — status
- `POST /api/v1/deep-health/scheduler/attach` — attach (idempotent)
- `GET  /api/v1/admin/summary/v544`

IIFE בשרת מנסה attach אוטומטי בעת טעינה.

---

## מספרי אימות

| שלב | pass | cannotRun | realFail |
|-----|------|-----------|----------|
| V542 (base) | 140 | 19 | 0 |
| V543a (adopted) | 141 | 19 | 0 |
| V544 (this) | **142** | 19 | 0 |

- `node --check ecos-api-server.js` → OK
- `NODE_ENV=test node tests/v544.test.js` → **34/34 passed, exit 0**
- SACRED: fiatLedger 563e9b1f ✓ | auditLog e5a5c2c2 ✓

---

## מה לא אומת

- 19 cannotRun: טסטי HTTP שדורשים `express`+`supertest`+`pg` — לא מותקנים. cannotRun אמיתי.
- `attach544()` נבדק עם mock heartbeat — לא עם DiamondHeartbeat465 חי.
- circuit-breaker (50 שגיאות) נבדק לספירה בלבד — לא ל-50 iterations.
- ה-patch על `_beat465` עוקף את ה-wrapping הקיים אם V532 כבר wrapped — לא נבדק double-wrap.
