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

## 6 · המראה-הציבורית (R254 · מבוקרת-R256+R257)

הליבה-הפתוחה חיה-ציבורית: **github.com/roshpinacare-sys/saos-agents** (MIT, main=94c610e) —
src/ המודולים-הטהורים (taskgraph/decisionqueue/worklog-intel) · cli/ · test/ (59-וקטורים) ·
docs/PATTERNS.md+STATE-CONTRACT.md · tools/ (טריו-git-safety-מדוד) · docs/ci.example.yml (ממתין-לטוקן-עם-workflow-scope) · SECURITY.md · .gitattributes.
ביקורות-חוסר-אמון (R256+R257): באג-fresh-clone-תוקן (mkdir-ב-atomicWrite) · **באג-CRLF-תוקן** (נרמול-\r\n?→\n — Windows-נמדד-ולא-רק-מזעיק; תוקן-קודם-בעץ-הפרטי-וסונכרן-byte-identical) ·
חוזה-קודי-יציאה-מדויק · דטרמיניזם-bun↔node-בחמישה-seeds · סריקת-סודות-על-כל-ההיסטוריה-אפס-פגיעות · ירוק-בשתי-הריצות.
הסנכרון-ידני-מדוד: cp-whitelist-מהעץ-הפרטי → סריקות-סודות (דפוסים+PAT-מילולי) → staging-מחוץ-לעץ
→ דחיפה. כספות/מפתחות/state/מודולי-עסקים/התיקייה-הרצינית — לעולם-לא. שינוי-ב-src/cli/test-הפרטיים
מחייב-השוואה-מול-הציבורי-ודחיפה-חוזרת.
