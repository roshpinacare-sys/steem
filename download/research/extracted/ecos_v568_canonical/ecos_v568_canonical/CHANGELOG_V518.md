# CHANGELOG_V518.md

## V518 — Canon Tower Auditor (Phase P406)

### מה זוהה (Action C — צד-אימות)
`NEXT_SESSION_PROMPT_V517` הציע 3 מועמדים לרישום ב-`canonBridgePatch508`:
`marketMaker` (×36), `providerAdapters` (×17), `economicIntegrityLoadBearing` (×11).

בדיקה ישירה של כל non-tip בשלושת המגדלים (regex על
`^module.exports = require('./...')`) הראתה:

| מגדל | חברים | non-tip | thin re-export | active | parallel-dup? |
|---|---:|---:|---:|---:|:---:|
| marketMaker (298..333) | 36 | 35 | **0** | 35 | ❌ |
| providerAdapters (267..286) | 17 | 16 | 1 (V482 בלבד) | 15 | ❌ |
| economicIntegrityLoadBearing (361..371) | 11 | 10 | **0** | 10 | ❌ |

אף אחד אינו עומד בחוזה V516/V517 ל-`parallel-duplicate`. רישום שלהם
ב-`bridge508` היה משחזר בדיוק את באג הדיווח-השווא ש-V516/V517 הסירו.

### מה נבנה
**`lib/canonTowerAuditor518.js`** + מראה ב-`src/lib/` (מעבר MD5 זהה).

- `classifyTower518(name)` — סורק `lib/<name><NNN>.js`, מסווג כל non-tip כ-
  `thinReexport` / `active` / `unreadable`. `isParallelDuplicate` רק אם כל
  ה-non-tip הם thin re-export ויש לפחות אחד.
- `auditAllTowers518({minMembers=3})` — סורק את כל קבוצות-המגדלים ב-`lib/`,
  ממיין לפי גודל, ומחזיר `eligibleForRegistration` (רשימת מועמדים-לרישום).
- `getCandidateVerdicts518()` — verdict ממוקד ל-3 המועמדים מ-V517.
- `registerEndpoints518(app)` — 3 endpoints. שום descriptor לא נרשם
  ב-`bridge508` (fail-closed: אם לא נכון לרשום — לא רושמים).
- IIFE `_wireCanonTowerAuditor518` בסוף `ecos-api-server.js` (try/catch,
  לא-פטאלי).

**Endpoints חדשים:**
- `GET /api/v1/registry/canon-auditor-v518/status` — V518-T01
- `GET /api/v1/registry/canon-auditor-v518/full?min=3` — V518-T02
- `GET /api/v1/admin/summary/v518` — V518-T03

### אילוצים
- 0 npm deps חדשים. Node built-ins + require יחסי בלבד.
- SACRED לא נגעו. אין שינוי endpoints קיימים. אין מחיקת קבצים.
- כל מזהה מסתיים ב-`518`.

### תוצאות אימות (exit code בלבד)
| בדיקה | תוצאה |
|---|---|
| `node --check ecos-api-server.js` | ✅ PARSE_OK |
| SACRED md5 (fiatLedger, auditLog) | ✅ ללא דריפט |
| `NODE_ENV=test node tests/v518.test.js` | ✅ **16/16, exit 0** |
| `NODE_ENV=test node tests/v517.test.js` (רגרסיה) | ✅ **17/17, exit 0** |
| `NODE_ENV=test node tests/v516.test.js` (רגרסיה) | ✅ **15/15, exit 0** |
| `node scripts/audit-tests.js` | ✅ **64 pass / 72 cannotRun / 0 realFail** (V517: 63/72/0) |

### מה לא אומת
- 72 חבילות `cannotRun` (vitest/ESM/חוסר deps) לא נבדקו ב-runner הזה — לא
  נחשבות לא-pass ולא-fail. זהה לבסיס V517, לא רגרסיה.
- ה-endpoints החדשים נבדקו דרך stub של express בלבד (לא boot מלא של שרת).
- `auditAllTowers518` נבדק כשהוא רץ מ-`lib/` המקומי; ב-CI עם libDir שונה
  ייתכנו ספירות אחרות (לא מועברות ל-bridge ממילא).

### הצעד הבא ל-V519
ראה `NEXT_SESSION_PROMPT_V518.md`. ההצעה: עבור Action D (Audit completeness)
או B נוספים — אין כיום מועמד ידוע פתוח ל-Action C.
