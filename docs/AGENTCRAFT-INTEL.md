# AGENTCRAFT-INTEL — זיקוק-אינטליגנציה מ-agentcraft לריבונות-האוטונומית (R252)

> מקור: https://github.com/blendi-remade/agentcraft — clone מלא (shallow, HEAD `35da4f5`, 46MB),
> ~50 קבצי-מקור נקראו שורה-שורה (foreman/src + docs + mod-feature-map), 2026-10-07T21:0xZ.
> רישיון MIT — הרעיונות חופשיים-להטמעה; אנחנו מזקקים-דפוסים, לא מעתיקים-קוד.

## 0 · מה-זה-באמת (ומה-לא)

AgentCraft נראה כמו "קבוצת סוכני-Claude עובדת-על-הקוד-שלך-בתוך-סטודיו-Minecraft". זו-העטיפה.
המכונה-האמיתית היא **Foreman** — orchestrator עצמאי (Node 22 + TypeScript, ~11,200 LOC,
**487 בדיקות-vitest**, MIT) שמנהל lead + עד-5-workers: גרף-משימות-מתמשך, worktrees-עם-מיזוגים-מוגנים,
תור-החלטות, זיכרון-markdown-משותף, אוטובוס-הודעות, צביר-פעילות-חי, לופ-CI, ופנקס-עלויות —
הכל-שורד-ריסטארטים. **המשחק סוגר — הסוכנים ממשיכים-לעבוד.**

**האמת-המדודה-השלישית לחוק-שכבת-התשתית (§8.3/§9.2):** גם-כאן — 11.2k-LOC-של-תשתית-תזמון
מול-תצוגת-משחק-דקה. הערך-והביקוש הם-במנוע-שמודד-ומתזמן-סוכנים, לא-בחזית.

## 1 · עשרה-דפוסים-מועברים (מדוד-מהמקור)

| # | דפוס | במקור | התרגום-אצלנו |
|---|---|---|---|
| 1 | state-אטומי + הסגר | `state.json` temp+fsync+rename; קובץ-קורום-מועבר-ל-`.corrupt-<ts>`-ומתחיל-נקי-במקום-crash-loop | חוזה-קוקפיט: snapshot-ממשלתי-אחד (agents/tasks/decisions/feed/counters) בכתיבה-אטומית |
| 2 | snapshot/upsert + ack | `snapshot`-מלא-ב-hello → delta-upserts; מעטפת `{v:1,type,id,…}` | הקונסול-קורא-JSON-יציב במקום-לגרד-פרוזה-עברית מה-worklog |
| 3 | TaskGraph + done-only-via-verified-push | טבלת-מעברים, בדיקת-מחזוריות, ready-queue לפי-עדיפות; משימה-עם-worktree נסגרת-רק-דרך-מיזוג-מאושר | **התרופה-המבנית-ל-custodian-sweeps**: משימה-נסגרת-רק-כש-selftest-ירוק **והקומיט-נדחף-בשער-הכפול** |
| 4 | DecisionQueue | options-מומלץ-ראשון, reopen-בסירוב (`Merge refused: <reason>`), settle-אחרי-אפקט | פעולות-מסוכנות-שה-guard עוצר (publish/token/דחיפה-מאסיבית) נהיות-החלטות-ממתינות-למפעיל-בקונסול |
| 5 | חיזוי-קונפליקטים לפני-מיזוג | `merge-tree --write-tree` dry-run + רשימת-קבצים; מיזוג-off-tree עם-FF-only | שכבה-לפני-sovereign-push: לדעת-מראש-איפה-יהיה-קונפליקט-עם-סוכן-מקביל |
| 6 | gitsafety תלת-שכבתי | env `protocol.allow=never` + policy + חסימת-כלים — git-עצמו-מסרב-push | שכבה-רביעית-מתחת-ל-guard: hardening-env לכל-process-שסוכן-מריץ |
| 7 | טלמטריה-per-tool | מיפוי-דטרמיניסטי tool→activity; JSONL-8MB-מסתובב; `isStale()` מעמעם-במקום-להסתיר | מיפוי-שלנו: steem-op→`chain` · git-push→`shipping` · selftest→`testing` · דפוס-isStale-לכרטיסי-סוכנים |
| 8 | זיכרון-markdown עם-front-matter | `shared/<slug>.md` + `agents/<id>/<slug>.md`, `visibleTo(agent)`, append-mode | ספריית-לקחים-per-סוכן-מעל-ה-worklog (שמירת-ה-append-only-של-האם) |
| 9 | sim fire-drill נטול-עלות | backend-מתוסכל-מוזרע-PRNG שמריץ-את-הצינור-האמיתי (worktrees/edits/tests/merges) | חזרות-ליליות-על-branch-גריטה: claim→edit→selftest→guarded-push→decision — אפס-טוקנים, אפס-סיכון-לקאנון |
| 10 | docs-מהסכמה-עם-CI-נגד-התיישנות | פרוטוקולים-נוצרים-מ-zod-ומאומתים-ב-CI (`npm run check`) | `docs/STATE.md` נוצר-מהחוזה-וה-guard דורש-טריות |

## 2 · מיפוי-לכאבים-שלנו (ראיות-מה-R-היסטורי)

| כאב-מדוד | ראיה | תרופה-מהטבלה |
|---|---|---|
| דריסת-worklog-ע"י-סוכן-מקביל | c60ebae (R250: 1929→1909-שורות, שוחזר-מ-5458292) | #7-טלמטריה + `detectAnomalies`-התכווצות (מומש-היום) |
| custodian-משתיק-קוד-חדש | 95e90d2 (R248: selftest 1501→1260-שורות) | #3-TaskGraph עם done-gate + חוק-state-only-ל-custodian |
| רגרסיית-666→551-שקטה | R248-פורנזיה | #9-sim-drill + #10-חוזה-מאומת-CI |
| סטיות-state-בין-סוכנים | rebase-קונפליקטים-חוזרים | #5-חיזוי-קונפליקטים + #1-state-אטומי-אחד |
| פעולות-מפעיל-שנתקעות-בסודות | PAT-E403×3 | #4-DecisionQueue — הבקשה-יוצאת-כהחלטה-מוצגת-בקונסול |

## 3 · מומש-היום (R252 — גל-1, מאמץ-S)

- **`mini-services/saos-engine/worklog-intel.mjs`** — מודול-טהור: `parseWorklog`/`computeStats`/`detectAnomalies` (בלוקים, סוכנים, כפילויות-Task-ID, חוסרי-סיכום, **התכווצות**=הפרת-append-only, רצפת-שורות, גלישת-newline).
- **`scripts/worklog-analytics.mjs`** — CLI (`--json/--out/--min-lines/--previous-lines/--selftest`) — קריאה-בלבד, אפס-כתיבה-כברירת-מחדל. פלט-ה-JSON = הערוץ-המכונתי-הראשון-של-הקונסול-החי (הסוכן-השני בונה-את-התצוגה — החוזה-כאן).
- **19-וקטורים חדשים ב-selftest** (כולל-תפיסת-התכווצות BY CONSTRUCTION — האויב-ממשפחת-c60ebae/95e90d2).

## 4 · מפת-דרכים מדורגת (הפרדת-מסילות: המשחק/תצוגה=הסוכן-השני · מנוע/פרוטוקולים=מסילה-זו)

- **גל-2 (M)** — #3-TaskGraph (done-only-via-verified-push) + #4-DecisionQueue בתוך-חוזה-ה-state; ה-guard מפיק-decisions במקום-עצירה-שקטה.
- **גל-3 (M)** — #9-sim-fire-drill מוזרע (חזרה-מלאה-על-branch-גריטה) + #5-`merge-tree`-dry-run-לפני-sovereign-push.
- **גל-4 (S)** — #6-gitsafety-env לכל-process-שסוכן-מריץ (שכבה-רביעית-מתחת-ל-guard) + #10-`docs/STATE.md`-מהחוזה-עם-בדיקת-טריות-ב-guard.
- **אינטגרציה-עם-הקונסול**: `worklog-analytics --json` נכנס-לסקרייפ-הקונסול-לצד-ה-state-החי-של-המנוע (state.json/events.jsonl — קיימים-ב-saos-engine).

## 5 · מה-לא-להעתיק (כנות)

- מוד-ה-Minecraft — התצוגה-שלנו-היא-web-קונסול (המסילה-של-הסוכן-השני).
- חלקי-claude-agent-sdk-ספציפיים — הסוכנים-שלנו-רבי-מנועים (Z.ai/LLM-skill + bun).
- קוד-מועתק-מהמקור — אנחנו-מזקקים-דפוסים-למודולים-משלנו-ברישיון-מדידה-עצמית.

## 6 · שורה-תחתונה

agentcraft מוכיח-שלישית-שהערך-הוא-בשכבת-התזמון-המודדת-את-עצמה. קיבלנו-ממנו-חמישה-רעיונות-מוכחים-ב-487-בדיקות,
מימשנו-מיד-את-הזול-והבטוח-מביניהם (טלמטריה-על-ה-worklog — מאומת-ב-selftest), ותייגנו-את-השאר-לגלים-2–4-עם-הפרדת-מסילות-ברורה.
