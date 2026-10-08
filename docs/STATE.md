# STATE CONTRACT — חוזה-ה-state לקונסול-החי (R253)

> הזיקוק-הממסדי-מ-agentcraft (docs/AGENTCRAFT-INTEL.md §1-דפוסים-1/2/7): הקונסול-לא-גורד-פרוזה —
> הוא-קורא-חוזה-מכונתי-יציב. מסמך-זה-מגדיר-מה-קיים, מי-כותב, ומה-הטריות-הנדרשת.

## 1 · הערוצים-המכונתיים (הקונסול-קורא-מכאן)

| ערוץ | מקור | כותב-יחיד | טריות-נדרשת |
|---|---|---|---|
| `mini-services/saos-engine/state/selftest-last-run.json` | תוצאת-selftest מלאה {pass,fail,at,vectors} | selftest.mjs (ריצה-מלאה-בלבד) | <24h (doctor-אוכף) |
| `mini-services/saos-engine/state/push-custody.json` | ראיית-דחיפה-אחרונה {lastPushedSha,pushedAt,branch} | sovereign-push.sh-בלבד | <24h-לצורך-שער-ה-done |
| `mini-services/saos-engine/state/tasks.json` | גרף-המשימות {tasks[],seed?,law} | scripts/task-console.mjs-בלבד | שדה-updatedAt-לכל-משימה |
| `mini-services/saos-engine/state/decisions.json` | תור-ההחלטות {decisions[]} | scripts/task-console.mjs-בלבד | listOpen-מחושב-תמיד |
| `bun scripts/worklog-analytics.mjs --json` | טלמטריית-ה-worklog {totalBlocks,perAgent,duplicates,anomalies} | קריאה-בלבד (אפס-כתיבה) | מחושב-בזמן-קריאה |
| state-החי-של-המנוע (engine/custodian/metrics/builder :3040–3043 `/health`) | פעילות-השרשרת-והסחר | המנוע-עצמו | מדוד-בכל-קריאה |

## 2 · חוקי-הכתיבה

1. **מי-כותב-לאן** — tasks.json/decisions.json נכתבים-רק-דרך-task-console (persist-אטומי: temp+rename). push-custody נכתב-רק-ע"י-sovereign-push. selftest-last-run נכתב-רק-בסוף-ריצת-selftest-מלאה. אין-כותב-שני-לאף-קובץ.
2. **קורום=הסגר, לא-crash-loop** — קובץ-שלא-ניתן-לפענח מועבר-ל-`<file>.corrupt-<ts>` והמערכת-מתחילה-נקייה (דפוס-המקור, §1-דפוס-1).
3. **append-only-ל-worklog** — ה-analytics מדווח-התכווצות-כ-anomaly; כל-ירידה-בשורות-דורשת-שחזור-מההיסטוריה (חוק-ה-lineage).
4. **ה-custodian נוגע-רק-ב-state** (לא-ב-.mjs/.sh/.md) — מוכח-פעמיים-בפורנזיה (c60ebae, 95e90d2).

## 3 · שער-ה-done (done-only-via-verified-push)

משימה-ב-task-console יכולה-לעבור `review→done` **רק**-אם-כל-אלה-מדודים-מהעץ-ברגע-הבקשה:
- `selftest-last-run.json`: `fail==0` **וגם** `at` טרי-(<24h)
- `push-custody.json`: `lastPushedSha` קיים **וגם** `pushedAt` טרי-(<24h)
- אם-למשימה-יש-`commit` — הוא-חייב-להופיע-בראיית-הדחיפה
סירוב = `DONE-GATE-REFUSED` עם-רשימת-החוסרים. אין-מנגנון-עקיפה — גם-לא-למפעיל (למפעיל-יש-cancel-למשימה, לא-בקשה-לעקוף-ראיות).

## 4 · DecisionQueue (הפטול-מהעצירה-השקטה)

פעולה-מחייבת-מפעיל (היפוך-visibility, רוטציית-טוקן, שינוי-חוק) יוצאת-כהחלטה-פתוחה:
- `options` — המומלץ-ראשון-ומסומן `recommended:true`
- `decision-answer` — מזהה-מספרי/טקסט-מלא/קידומת-ייחודית (דו-משמעי=נדחה)
- `settle` — רק-אחרי-האפקט-בפועל · `reopen` — עם-סיבה-מתועדת-בהיסטוריה · `cancel` — כשמיותרת
- הקונסול-מרנדר `decisions.json` — פתוחות-ישנות-ראשונה

## 5 · מפת-הדרכים-הנותרת (מזיקוק-agentcraft — ראו-גם-tasks.json-החי)

- **גל-3-הנשאר**: sim-fire-drill-מלא-על-branch-גריטה (worktrees-אמיתיים, אפס-LLM) · שדרוג-ה-forecast-מ-advisory-ל-blocking-אחרי-תקופת-התבוננות
- **גל-4-הנשאר**: docs/STATE.md-מהחוזה-בקוד (generated+CI-check) · gitsafety-env-מושתל-בהרצת-סוכנים-חיצוניים
- **שכבת-התצוגה** (מסילת-הסוכן-השני): קונסול-החי — כל-הערוצים-כאן-מוכנים-לגרייה

## 6 · המראה-הציבורית (R254 · מבוקרת-R256→R260)

הליבה-הפתוחה חיה-ציבורית: **github.com/roshpinacare-sys/saos-agents** (MIT, main=26cfc26) —
src/ המודולים-הטהורים (taskgraph/decisionqueue/worklog-intel) · cli/ · test/ (90-וקטורים + cli-contract-77-וקטורי-ספאוון) ·
docs/PATTERNS.md+STATE-CONTRACT.md · tools/ (טריו-git-safety-מדוד) · docs/ci.example.yml (ממתין-לטוקן-עם-workflow-scope) · SECURITY.md · .gitattributes.
ביקורות-חוסר-אמון (R256→R260): באג-fresh-clone-תוקן · באג-CRLF-תוקן · מנעול-כותב+מזהים-עמידים-להתנגשות (R258) ·
**R259 — מנוע-מוטציות-מדוד (kill-rate 43%→97% + מוטנט-שקול-מסווג), 21-וקטורי-הריגה · cli-contract-ספאוון (חוזה-קודי-יציאה/אפס-stack-traces/מירוץ-12-כותבים) ·
validate-before-persist (הרעלת-מצב-נמדדה-ונחסמה) · חיות-בעלים-במנעול (SIGKILL-storm-התאוששות-מלאה) · נרמול-U+2028/2029 (fuzz-2000-אפס-הפרות) ·
fsync-לפני-rename + סריקת-שאריות-tmp · כיסוי-V8-פונקציות 49/50-בליבה · ירוק-ב-bun+node-על-שיבוט-טרי-מ-GitHub** ·
**R260 — סבב-הענקים: 6-פרובות-חיות-הפכו-לחוק: CWE-59 (openSync "wx"+0600 — symlink-על-tmp-נעקב-וקורבן-נדרס; נמדד-ונחסם) · חוזה-argv-סגור (UNKNOWN-FLAG-נדחה-בשם; בליעה-שקטה-של-תוויות-"--"/טעות-כתיב-נמדדה-ונחסמה) · אין-תשובה-ריקה-שמתחזה (INVALID-DECISION) · מיון-מכונה-חף-ICU (cmpStr-code-unit ב-ready/listOpen) · ולידציית-צורה-בשני-הולידטורים (state-פגום-נדחה-בשם במקום-"Pundefined"/TypeError) · סרת-הבטחה-המתה-מ-gitsafety-env (GIT_ALLOW_PROTOCOL-מנצח — חוזה-מוכרז: סירוב-כולל-כולל-file) · SIGTERM-storm-נקי · prototype-pollution-נמדד-נקי · npm-pack-install-צרכן-ירוק**.
סריקת-סודות-על-כל-ההיסטוריה-אפס-פגיעות. הסנכרון-ידני-מדוד: src-byte-identical (cmp) · cli-מותאם-נתיבות-בלבד (ה-cp-העיוור-נתפס-ע"י-השער) →
סריקות (דפוסים+PAT-מילולי) → דחיפה. כספות/מפתחות/state/מודולי-עסקים/התיקייה-הרצינית — לעולם-לא.

## 7 · R262 — מבחן-הפתע על עצמנו + השרת-שלא-יפול-שוב

- **אינצידנט-השרת (נמדד)**: next-dev מת מ-kernel-OOM (turbopack-cache 2.5GB על 4GB) — ואף-מרפא לא היה: ה-watchdog-הריבוני חי-בתוך-next-server עצמו (SPOF-מבני). הסנדבוקס קוצר-כל-עץ-תהליכים-של-קריאת-כלי (נמדד: אף `setsid sleep 600` נקצר) — רק-שושלת-ה-boot שורדת (R216-b).
- **dev-keeper-organ (:3044)**: probe-:3000-כל-8s → היגיינת-cache (wipe-.next->1.2GB — שורש-ה-OOM) → respawn-`bun run dev`. מושתל-משושלת-ה-boot דרך **git-pre-commit-hook תוספתי-תמיד-exit-0** (ה-custodian מקיים-commit-מהשושלת-החיה) — כבר-קם-והחזיר-את-השרת-בעצמו (spawns≥1). ב-boot-הבא: נטען-אוטומטית (סריקת-mini-services).
- **מבחן-הפתע (13-פרובות-על-שיבוט-טרי)**: כל-הצהרות-R258→R260 אומתו-מחדש-וכן-8-זוויות-חדשות (TZ/locale, readonly-dir, depth-bomb, huge-line, symlink-escape, unicode-RTL, argv-edges, tarball-install) — **והפתעה-תפסה**: **אובדן-עדכונים-שקט במנעול-הכותב** (20-כותבים→16-18-משימות, כולם rc=0).
- **שורש-כפול**: (1) ה-R259-יצר-מנעול-ריק-וכתב-pid-אחרי-הרכישה ("informational only") — בעומס-קר מתחרה-קרא-בעלים-ריק, הזדקן->250ms, גנב-מנעול-מכותב-חי; (2) וקטור-המירוץ-בקונטרקט השתמש-ב-spawnSync-בתוך-Array.from — **12-ה"מקביליים" רצו בטור** — לכן-הסוויטה-הייתה-ירוקה.
- **התיקון (מנעולים-נולדים-שלמים)**: pid-נכתב-ל-claim-פרטי-לפני-ששם-המנעול-קיים; link()-אטומי מקדם-אותו; גניבת-בעלים-ריק-הוסרה (חוק-הגיל-30s-לזבל-זר); שחרור-מאמת-בעלות; גניבות-תחת-מוטקס-גניבה+אימות-inode (TOCTOU-נתפס-ביומן-חי: rename-הרג-מנעול-של-יורש-חי); **רשת-אטימה: persist-מאמת-inode-רגע-לפני-ה-rename — שני-כותבים-לא-יכולים-שניהם-לעבור → כל-שארית-מירוץ הופכת LOCK-LOST-MIDWRITE-נקוב, לעולם לא אובדן-שקט**.
- **מדידה-אחרי**: 200-כותבים-מקבילים-על-פני-10-סערות → אפס-אובדן-שקט (כל-כותב נכנס או LOCK-BUSY-נקוב) · קונטרקט 79/79×2-ריצות (וקטור-המירוץ-עכשיו-מקבילי-אמיתי) · selftest-90/90×2 · 13/13-פרובות · src-byte-identical.
- **ריבונות-מקבילה**: אותר-אינסטנס-הנדסה-שני-חי (R260-אימות/R261) — איחוי-חוקי-אפס-force (3-מיזוגים, local-wins-ל-state-חי, worklog-union); מספור-סבבים = מקס+1 מ-worklog-טרייה.
