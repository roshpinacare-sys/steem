# AGENTS — רישום הסוכנים הקנוני של המערכת

## ── Startup Workflow · מסלול-הפעלה לסוכן חדש (harness · r151) — קרא-קודם ──

**Before writing code — המסלול (60 שניות):**
1. `git pull --rebase --autostash origin main` — יש סשנים-מקבילים; רץ רק על ראש-השרשרת (**rebase-חשוף נחסם-על-ידי-השער**).
2. `bash init.sh` — שער-האימות (7 סעיפים): git-sync · סודות · tsc/eslint · הצי · המכונות · שער-ההרג · הוכחת-הריבונות · מפת-האמת. **אדום = תיקון-לפני-עבודה-חדשה.**
3. **שער-ההוכחות (R208P · חוק-קשיח):** `bun run scripts/proof-gate.ts` — טוען את ספר-ההוכחות, מאמת שרשרת+עדויות, ומדפיס מיון: **PROVEN (אסור-לפתוח-מחדש — רק להפרך; ההפרכה נרשמת) · OPEN · REFUTED**. יציאה≠0 = אין עבודה. ראש-הספר מושווה לראש-העדות בספר-הרשת — אי-התאמה = נדרש `proof-book-attest`. הצטת: `--reprove` מריץ את פקודות-השחזור החי. **המאכף-העומד (R209 · :3052 · mini-services/proof-law)** מריץ את אותו-שער אוטומטית כל 5-דק' כולל שחזור-חי-מסתובב ואזעקות — החוק אינו תלוי-זיכרון-סוכן; מצבו: `sovereign/proofs/proof-law-state.json` + GET `http://127.0.0.1:3052/`.
4. קרא `SOVEREIGN-INDEX.md` — מפת-האמת האחת (מיוצרת-מהחי בכל-init.sh: הצי · המפה · ספר-ההישגים · הפרוטוקול · הפתוחים).
5. קרא `session-handoff.md` (מצב · חסמים · צעד-הבא) + רשומה-אחת ב-`progress.md` + `feature_list.json` (active_feature).
6. בחר פתוח מ-progress.md או next_step מ-feature_list.json. יומן-העבודה המלא: `worklog.md` (append בלבד).

**Definition of Done · הגדרת-סיום — כל הסעיפים או אין הכרזה:**
- [ ] הקוד עובר `bash init.sh` ירוק (tsc 0 · eslint 0 · הצי חי).
- [ ] `bun run scripts/proof-gate.ts` ירוק בפתיחת-המושב **ובסיומו** (R208P): שרשרת-ספר-ההוכחות תקינה, אפס-סטיות-עדות-חיות. הוכחה-חדשה שנבנתה בסבב ⇒ נרשמת ב-`scripts/proof-seed.ts`/`proof-revisions.ts` דרך `appendProof` + עדות-ראש לספר-הרשת (`scripts/proof-book-attest.ts`).
- [ ] לכל טענה יש **ראיה מדודה**: נתיב-state / txid / פלט-API — אפס מספרים מהזיכרון.
- [ ] `feature_list.json` עודכן (status + evidence_path + last_verified_at) · `progress.md` רשומה-חדשה · `session-handoff.md` עדכני.
- [ ] commit + push על ראש-השרשרת (ריבייס אם נדרש) · worklog.md סעיף-גל.

**מסלול-מצב (איפה האמת):** מפעל `sovereign/businesses/content-factory-state.json` · קיורציה `sovereign/curation/state.json` · כסף `sovereign/money/state.json`+`pnl-scan.json` · עסקים `sovereign/businesses/registry.json`+`ONE-READ.md` · פריטים-פתוחים `progress.md`.

**Scope · גבולות-היקף:** One feature at a time — `active_feature` יחיד ב-feature_list.json; Stay in scope — אסור לפתוח-feature חדשה לפני סגירת-הפעילה או הקפאתה-בראיה; תלויות מרושמות ב-`dependencies` בכל-feature. אין סודות בגיט (upload/* · *.env · .git-askpass.sh) · אין המצאת-הכרעות-מפעיל (WEAVE_PUBLIC_URL / D-TREASURY) · אין "בוצע" בלי ראיה.

**שער-ההרג · sovereign-guard (r153 · אדפטציה של destructive_command_guard) — חוק-קשיח:**
- לפני כל פקודה-פוטנציאלית-הרסנית (reset/clean/rebase/push-force/rm-רקורסיבי/pkill/prisma-reset) — הרץ `bun scripts/sovereign-guard.mjs --check "<cmd>"`; exit 1 = חסום, הקפד על-ה-Tip.
- `--explain "<cmd>"` = ניתוח-בלבד (אפס-תופעות-לוואי) · `--selftest` = טבלת-האמת (60 מקרים; init.sh מאמת) · `--install` = התקנת pre-commit.
- ה-pre-commit כבר אוטומטי: סודות-מדורגים + שורות-.sh-הרסניות נחסמות בקומיט (fail-closed בגבול-הגיט).
- המשמעויות-הקנוניות-שעברו-מדידה: `git pull --rebase --autostash` (לא rebase-חשוף — r150/r151) · `git push --force-with-lease` (לא --force) · גריטה → /tmp בלבד · הריגת-תהליך → kill <PID> מ-lsof -t -i:<פורט> (לעולם לא pkill/killall).
- כל חסימה נרשמת כראיה: `sovereign/guard/blocked.jsonl` + `stats.json`. אסור למחוק/לעקוף את היומן.

**End of Session · לפני-סיום-סשן (רוטינה-קבועה):**
1. `bash init.sh` ירוק.
2. עדכון `feature_list.json` + רשומה בראש `progress.md` + עדכון `session-handoff.md`.
3. רישום-גל ב-`worklog.md` (append).
4. `git add` סלקטיבי (רק מה ששייך-לגל; לעולם לא upload/* · *.env · .git-askpass.sh) → commit → push.
   - **חוק-הודעות-קומיט (Task 25)**: כל קומיט חייב הודעה תיאורית (מה+למה). הודעת-UUID בלבד (למשל `a4c085c0-fd1b-…`) אסורה — היא נזירות-חד-כיוונית: התוכן נשמר אבל ההיסטוריה מתה לקריאה. דמון שמצרף-מצב אוטומטית מכתיב `[lane]: <מה התרענן> (<תאריך>)` — הדפוס הקיים ב-`[daemon-state] keeper: fleet state refresh (...)` הוא התקן.
5. ודא local==origin (`git rev-parse --short HEAD` == `origin/main`).

> מה שלהלן — הרישום ההיסטורי-המלא של הסוכנים והמכונות (מקור-עמק, לא נקרא בכל-סשן).

---

> מקור אמת אחד לכל הסוכנים האוטונומיים בכל 16 הריפואים.
> הרישום החי: `Console/agents/registry.json` — מתעדכן אוטומטית כל שעה על-ידי `agents-watch`.
> התצוגה הציבורית: `https://roshpinacare-sys.github.io/Console/#agents`
> ריענון R71 (2026-09-21): כל מספר בדף זה נמדד מחדש מה-API, מהשרשרת ומהלוגים.
> ריענון אמת r123 (2026-09-25): הרישום החי מונה **29 סוכנים** · שלושת הסודות נמסרו
> (R72–R75) — קווי Steem/ZERO, הגריד ושערי-האמת ירוקים במדידה חיה · עדכוני הסטטוס
> שלהלן מסומנים בנמדד-מחדש, השאר — מספרי R71 (נכונים למועדם).

## מצב במבט-על (R71 · 2026-09-21)

| מדד | ערך |
|---|---|
| ריפואים במערכת | **16** (14 המקוריים + Domain, בית התאומים מ-r67 · + Defi — פרטי ריק שנוצר 2026-09-21T13:28:43Z, נרשם ב-R73) |
| פרטיים / ציבוריים | 14 פרטיים · 2 ציבוריים (Console, Domain) — Defi ללא מכונות וללא סוכן: ממתין להגדרת ייעודו על-ידי המפעיל (הסוכן אינו ממציא מכונה למטרה שלא הוגדרה) |
| ריפואים עם מכונות | 7 (Zip, steem, saos-dex, Console, Domain, saos-sovereign-foundry, +סוכני-ארכיון ב-8 נוספים) |
| סוכנים אוטונומיים | 29 ברישום החי (נמדד 2026-09-24) · במדידת R71: 30 זרימות (7 מכונות-ייצוג בתאומים ציבוריים · 9 סוכני-ארכיון פרטיים · 14 בקרים/מראות/שערים ציבוריים) |
| מצב מכסת ה-Actions | הפרטיות נדחות מ-2026-09-20T12:36Z (מיצוי 2,000 דק'/חודש); הציבוריות בלתי-מוגבלות |

## עידן ריבונות-המכסה (R71)

הספר הישן תיאר את העידן שלפני 2026-09-20. האמת שנמדדה מאז: מות המכסה
הרג גם את **cloud-heart** — המכונה שהייתה הלב החי האחרון של SAOS-NET
(auto-save כל ~90 דק', כל הדחיפות ל-steem מ-09-18 עד 09-20 הן שלה;
ה-attest החי מהשרשרת מת עוד ב-2026-09-06). הריבונות שנבנתה בעקבות זה:

**התאומים הציבוריים ב-Domain הם המכונות** (דקות חינם, בלתי-מוגבלות).
המקורות הפרטיים — גיבוי dispatch-בלבד (החזרת קדנס = קומיט אחד).
סוכני-הארכיון הפרטיים מושהים כל עוד המכסה מתה (הריצות נדחות מ-2026-09-20) —
האמת היומית עליהם נשפטת מקומית מאז r118: דיבון fleet-verify מריץ 10 מאמתים
ודוחף את פסקי-הדין לגיט כקומיטי [bot] בכל יום.

## מכונות הייצור — הבתים הכפולים

### THE WEAVE (ספר: Zip · מכונות: Domain)

| מכונה | קדנס (תאום ב-Domain) | מקור (Zip) | מצב |
|---|---|---|---|
| weave-heart | שעתי :13 | dispatch-בלבד (R71) | ירוק מ-R72 — החותם נפתח (אימוץ MAIN_KEY; הספר 293→297 אימותים במסירה, att 304 במדידת R73) |
| weave-anchor-lines | דו-שעתי :33 + אחרי כל פעימה | dispatch-בלבד (R71) | ירוק מ-R75 — קו ZERO חי (ON-CHAIN block 35247391; cp#296, att 304 במדידת R73); קו Steem חי (ה-WIF נמסר לכספת Domain ב-R75; ריצות עוקבות מצליחות — נמדד 2026-09-25); קו Hive מושהה בכנות — מפתחותיו הוסרו (R11) |
| weave-ecosystem | יומי 06:30 | dispatch-בלבד (R71) | ירוק — אומת מקצה-לקצה (da6f6ab, 00:00:42Z 09-21) |
| web-publish | :03/:23/:43 | dispatch-בלבד (R71) | ירוק (אין דואר) |
| weave-mirror | שעתי (Domain) | — | ירוק |
| weave-brain-restore | חד-פעמי, הושלם | dispatch (לא הוסר — אף פעם לא היה לו קדנס) | הושלם · 1/1 |

### SAOS-NET (ספר: steem · מכונה: Domain — R71)

| מכונה | קדנס (תאום ב-Domain) | מקור (steem) | מצב |
|---|---|---|---|
| cloud-heart | כל 30 דק' :17/:47 | dispatch-בלבד (R71; הוסר שוב ב-R73 אחרי ש-dac4d1e החזירו במרוץ) | **הלב החי הוחזר לחיים על דקות ציבוריות** — keyless-safe מהעיצוב (חותם הצי אינו קיים בריפו; רץ ירוק 14 יום keyless לפני מות המכסה). בחירת-מנהיג מהשרשרת (attest/git freshness); TAKEOVER מקדם את השרשרת ודוחף auto-save. R73: ה-gitkeeper הוקשח (healOntoOrigin — cherry-pick של כתיבות הריצה בלבד; עריכות זרות מאומצות, לעולם לא נדרסות בשקט). |

### הבורסה (ספר: saos-dex · מכונות: Domain)

| מכונה | קדנס (תאום ב-Domain) | מקור (saos-dex) | מצב |
|---|---|---|---|
| dex-beat | דו-שעתי :53 (shift-guard 3ש') | dispatch-בלבד (R71) | ירוק — world.json הוחזר לחיים (r68) |
| dex-grid | יומי 03:48 (shift-guard 23ש') | dispatch-בלבד (R71) | ירוק ממסירת STEEM_ACTIVE_WIF (הכספת ב-Domain; ריצה ירוקה 2026-09-24T03:55Z, נמדד) |
| dex-watch | :07/:27/:47 (Console+Domain) | — | ירוק |
| dex-mirror | שעתי :52 (Domain) | — | ירוק |

### הבקרים והמראות (ציבוריים — Console + Domain)

| מכונה | קדנס | מצב |
|---|---|---|
| truth-gate | 20 דק' לסירוגין בשני הבתים | ALL-GREEN בשני הבתים (10/0/2 ב-Domain, נמדד 2026-09-25T01:19Z; האדום ההיסטורי G11-grid נרפא עם מסירת המפתח) |
| agent-verify | שעתי (Console) | ירוק — ריצות אחרונות ALL_PASS בשני הבתים (נמדד 2026-09-25; האדום ההיסטורי A34 — גריד מזדקן — נרפא) |
| money-watch | 20 דק' (Console+Domain) | ירוק |
| moment-watch | 20 דק' (Domain) | ירוק |
| agents-watch | שעתי :37 (Console+Domain) | ירוק — הרישום הציבורי |
| console-publish | push + לוח זמנים | ירוק |
| key-verify | dispatch (Domain) | אדום-כן — unidentified עד מסירת מפתח נכון |

## סוכני הארכיון (9 — פרטיים, קדנס יומי נשמר)

claims-guard (Adsmarket) · baseline-integrity (anchor-baseline) ·
controls-audit (roshpina) · sdk-verify (Sdk) · jumpper-tests (saos-jummper) ·
archive-keeper (Project-files, dispatch) · control-center-build
(saos-control-center) · platform-selftest (saos-sovereign-platform) ·
wallet-verify (Saosmartwallet).

**מדידת האמת (מפקח R71):** 5 מתוך 9 ירוקים בריצה יומית עד 09-20 בדיוק
(עד שהמוות תפס); 3 נוספים ירוקים עד 09-19 — משבצת ה-09-20 שלהם נורתה
אחרי מות המכסה; archive-keeper הוא dispatch-בלבד מעולם. מאז כולם נדחים
במכסה וישובו כשתחזור — ~8 ריצות/יום במדידה (8.9), מתאם בנוחות במכסה.

### saos-sovereign-foundry (פרטי · ארכיון תבנית)

| מכונה | קדנס | מצב |
|---|---|---|
| CI | push/PR בלבד | **ירוק בראש** — 99 כישלונים היסטוריים ואז תוקן בריצה האחרונה (35161896260, 2026-09-16T23:20:59Z, נסגר ב-OL-3); רדום מאז — אין לו קדנס. |

**תיקון אמת (R71):** הרישום הקודם אמר "ציבורי" — הריפו פרטי (נמדד ב-API);
והכתם "0/100" — האמת 99 כישלונים + ריצה ירוקה אחרונה אחת. הספר המוגש
(state.json/OL-3) ידע את שתי העובדות; דף זה לא — תוקן.

## החלטות תפעוליות

1. **ריבונות המכסה (R71):** התאומים הציבוריים הם המכונות; המקורות הפרטיים
   גיבוי dispatch-בלבד. התצרוכת הפרטית שמיצתה את החשבון (~2,180+ דק'/חודש
   מול 2,000) לא תחזור — מבנה, לא מזל.
1. **כלל החלון ל-steem (R73):** דחיפות non-state ל-steem (קוד, workflows,
   docs) מבוצעות אך ורק כשאין ריצת cloud-heart חיה ב-Domain — נמדד
   ב-API (in_progress=0), לא בשעון (ה-scheduler מפגר 7-11 דק'). המרוץ
   של dac4d1e הוכיח למה; ה-keeper המוקשח הוא הביטחון המבני, הכלל —
   חגורת-הבטיחות.
2. **איסור אימוג'י מוחלט** — נשמר (65 תווים טוהרו ב-Task 37; סריקות מאז 0).
3. **הסוכנים נשפטים לפי עבדות** — כל מספר מה-API, גם הכתמים האדומים גלויים.
4. **חוק הסודות:** אף סוד לעולם לא בקוד, לא בלוג, לא בשם-ערך. שלושת
   הסודות הקנוניים ממתינים למסירה לפי ה-README של Domain (דלת המפעיל).
