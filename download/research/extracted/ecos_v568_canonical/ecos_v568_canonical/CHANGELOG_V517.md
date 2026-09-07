# CHANGELOG_V517.md

## V517 — Canon Registry Bridge Extension (Phase P405)

### מה זוהה (Action C — חיבור)
V516 רשם 7 מגדלים מ-5 facades פוסט-V508 ל-`canonBridgePatch508`.
שני מגדלים נוספים שהם parallel-duplicate מאומת נשארו לא רשומים,
ולכן `getPatchedDuplication508` עדיין מסווג אותם לא נכון:

1. **`onboardingFlow`** — 6 חברים (263..268). 263..267 כולם:
   `module.exports = require('./onboardingFlow268.js')` (חתימת V495 consolidation).
2. **`agentDispatchBridge`** — 8 חברים (246..253). 246..252 כולם:
   `module.exports = require('./agentDispatchBridge253.js')` (חתימת V495 consolidation).

הערה: `meshDispatcher` (10 חברים, 288..297) נבדק — **לא** parallel-dup,
כל חבר הוא מודול פעיל עצמאי. לכן לא נרשם. אין דיווח שווא.

### מה נבנה
**`lib/canonRegistryBridge517.js`** + מראה ב-`src/lib/`:
- בונה 2 descriptors (parallel-duplicate) ורושם אותם ב-`bridge508` ב-init.
- `getRegistrationSummary517()` — סטטוס רישום.
- `getPatchedReport517(opts)` — proxy ל-`bridge508.getPatchedDuplication508`.
- `registerEndpoints517(app)` — 3 endpoints: V517-T01..T03.
- IIFE `_wireCanonRegistryBridge517` בסוף `ecos-api-server.js`.

**Endpoints חדשים:**
- `GET /api/v1/registry/canon-bridge-v517/status` — V517-T01
- `GET /api/v1/registry/honest-patched-v517` — V517-T02
- `GET /api/v1/admin/summary/v517` — V517-T03

לאחר V517: bridge508 מכיל 9 facades פוסט-V508 (7 מ-V516 + 2 מ-V517) +
reflectionLoop (דרך canon507) + tipModule (דרך canon509) = **11 מגדלים מסווגים נכונה**.

### תוצאות אימות (exit code בלבד)
| בדיקה | תוצאה |
|---|---|
| `node --check ecos-api-server.js` | ✅ PARSE_OK |
| SACRED md5 (fiatLedger, auditLog) | ✅ ללא דריפט |
| `NODE_ENV=test node tests/v517.test.js` | ✅ **17/17, exit 0** |
| `NODE_ENV=test node tests/v516.test.js` (רגרסיה) | ✅ **15/15, exit 0** |
| `node scripts/audit-tests.js` | ✅ **63 pass, 72 cannotRun, 0 realFail** (היה 62/72/0 ב-V516) |
| package.json version | ✅ `517.0.0` |
| מראה src/lib md5 | ✅ זהה ל-lib/ |

### מה לא אומת
- **72 suites cannotRun** — דורשים vitest/ESM, לא ניתנים להרצה בסביבה זו.
  לא הוחשבו pass ולא fail.
- **runtime endpoints** — לא הורם express חי; הaאimות הוא דרך mock app +
  assertion שהנתיבים נרשמו (T13 ב-v517.test.js).
- **`getPatchedReport517`** — נבדק "gracefully": אם bridge508 לא מצליח לקרוא
  libDir בסביבת הטסט, נחשב לעבירה (caught). ב-runtime אמיתי הדוח עובד.
- לא נסקרו 600+ מודולים. דגימה ממוקדת בלבד: 5 קבצים שנגעתי בהם.

### סיכון פתוח
אם descriptor של `onboardingFlow` או `agentDispatchBridge` יירשם פעמיים
(למשל ע"י canon facade עתידי), `_canonRegistry508.set()` פשוט מחליף — אין
התראה. אם תוסיף facade עתידי לאחד מהשניים, ודא שאינך כותב descriptor שונה.
