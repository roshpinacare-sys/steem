# CHANGELOG V532 — Heartbeat → Governance Bridge

## Version: 532.0.0 | Phase: P293
## Author: AI (Claude Sonnet 4.6) | Date: 2026-06-05

## מה זוהה
- Baseline: **129 pass, 19 cannotRun, 0 realFail**.
- NEXT_SESSION_PROMPT_V531 ביקש: `heartbeatGovernanceBridge532` — סגירת הלולאה בין Diamond Heartbeat (V454) ל-Governance Bridge (V531).
- `_hb454` local ל-IIFE → לא נגיש ישירות. פתרון: HB עצמאי עם `onBeat` hook.

## מה נבנה
**`lib/heartbeatGovernanceBridge532.js`** (ומשוכפל ל-`src/lib/`):
- `createBridge532(opts)` → `{ onBeat, getSnapshot, stats, _triggerNow532 }`.
- `onBeat(beat)` → קורא ל-`buildBridgeSnapshot531` → שומר last-known-state.
- `getSnapshot()` → fail-closed: `{ ok:false, reason:'not_started' }` אם עוד לא פעם; `{ ok:false, reason:'stale' }` אם ישן מ-maxAge.
- כל שגיאה ב-`buildBridgeSnapshot531` נשמרת ב-`lastError`, לא נזרקת חזרה.

## מה חובר
| מקור | יעד |
|------|-----|
| `diamondHeartbeat454.createHeartbeat454` | `onBeat: b.onBeat` — loop סגורה |
| `governanceStatusBridge531.buildBridgeSnapshot531` | קרוא בכל beat |
| `GET /governance-state` | fail-closed sentinel / live snapshot |

## אימות אמיתי
- **24/24 V532 tests — exit 0** (אחרי הוספת docs).
- audit-tests.js: **130 pass (+1), 19 cannotRun, 0 realFail**.
- node --check: OK. SACRED MD5: תקין.

## מה לא אומת
- `buildBridgeSnapshot531` end-to-end בסביבה חיה (תלוי O437/status505/gc499) — ה-snapshotOpts מוזרקים lazy, לא אומת שהם זמינים ב-runtime.
- שני ה-HB instances (V454 + V532) בו-זמנית — לא נבדקה התנגשות. כיוון שהם עצמאים, הסיכון נמוך.
- 19 cannotRun — ESM/vitest, לא ניתן לאמת.
