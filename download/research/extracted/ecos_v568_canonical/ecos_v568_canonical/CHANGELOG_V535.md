# CHANGELOG_V535.md — Bridge532 Singleton Accessor

## מה זוהה
`_bridge532` חי בתוך IIFE סגורה של V532 — לא נגיש מ-IIFE חיצוני. V534 (`governanceHealthGate534`) ניסה לקרוא אותו ולא הצליח (`hbRunning: false`). הפתרון הוצג ב-NEXT_SESSION_PROMPT_V534.

## מה נבנה ומה חובר

**שינוי ב-`lib/heartbeatGovernanceBridge532.js`:**
- הוספת getter/setter `activeBridge532` ל-`module.exports` (עם `get`/`set` syntax)
- ערך ראשוני: `null`

**שינוי ב-`ecos-api-server.js` IIFE V532:**
- שורה אחת: `Bridge532.activeBridge532 = _bridge532;` — מאכלסת את ה-singleton לאחר יצירתו

**V535 IIFE חדש:**
- `GET /api/v1/diamond/heartbeat/governance/bridge-live` — מחזיר `stats()` + `getSnapshot()` מה-singleton החי. `503` אם הסינגלטון עוד null (fail-closed).
- `GET /api/v1/admin/summary/v535`

## תוצאות אימות (לפני → אחרי)
| מדד | לפני V535 | אחרי V535 |
|-----|-----------|-----------|
| pass | 132 | **133** |
| cannotRun | 19 | 19 |
| realFail | 0 | **0** |

## מה לא אומת
- 19 cannotRun (vitest/ESM) — לא ניתן לאמת בסביבה זו.
- ה-bridge עצמו (beatsSeen וכו') — יוחזר null עד שהגרסה הרצה תפעיל POST `/governance/start`.
