# CHANGELOG_V516.md

## V516 — Canon Registry Bridge (Phase P404)

### מה זוהה (C בסדר הכרעה)
`canonBridgePatch508` חושף `registerCanonFacade508()` כדי שfacades חדשות יתקנו
את דוח הכפילויות. רק `tipModuleCanon509` נרשמה. שישה Canon facades שנוצרו
לאחר V508 לא נרשמו — הדוח ב-`/api/v1/registry/honest-patched` היה חסר 7 מגדלים:
- `telemetryCanon511` → telemetry ×6
- `sybilGuardCanon512` → sybilGuard ×6
- `reputationLedgerCanon513` → reputationLedger ×6
- `offlineQueueCanon514` → offlineQueue ×6
- `triTowerCanon515` → splitModule + quadraticFunding + x402 (×6 כ"א)

### מה נבנה
**`canonRegistryBridge516.js`** — חיבור בין canonBridgePatch508 ל-5 facades (7 מגדלים):
- טוען את bridge508 ורושם 7 descriptors (parallel-duplicate, base=263, tip=268)
- `getRegistrationSummary516()` — סטטוס רישום (registered/skipped/ok)
- `getPatchedReport516(opts)` — דוח מלא דרך bridge508
- `registerEndpoints516(app)` — 3 endpoints: V516-T01..T03
- IIFE מחובר בסוף השרת
- משוקף ב-lib/ ו-src/lib/

### תוצאות אימות (exit code בלבד)
| בדיקה | תוצאה |
|---|---|
| `node --check` | ✅ PARSE_OK |
| SACRED md5 | ✅ 563e9b1f / e5a5c2c2 |
| `tests/v516.test.js` | ✅ **15/15, exit 0** |
| `tests/v515.test.js` | ✅ 13/13, exit 0 (רגרסיה: אפס) |
| `scripts/audit-tests.js` | ✅ **62 pass, 72 cannotRun, 0 realFail** |

### מה לא אומת
- 72 suites דורשים vitest/ESM — לא ניתן לרוץ בסביבה זו.
- T11 (getPatchedReport516): נבדק gracefully — אין libDir אמיתי בטסט. 
  ב-runtime אמיתי הדוח יעבוד דרך bridge508.
- לא נבדק runtime של endpoints (אין express server חי).
