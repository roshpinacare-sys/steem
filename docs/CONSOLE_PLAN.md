# CONSOLE_PLAN — מערכת הניהול החדשה (Console v1)

החלטת הבעלים: לא להישען על מודל ה-UI הראשוני (שורת טאבים שטוחה של mission-control).
המערכת החדשה נבנית כ-**Console** — קונסולת הפעלה של מפעיל בודד, מבוססת שכבות חזקות.
מסמך זה = התוכנית המחייבת. מימוש v1 במשימה 14.

---

## 1. עקרון מנחה

הפלטפורמה עברה שלושה שלבים: סימולציה (25 מודולים) → בקרה חיה (Cockpit) → מנועי שירות (Solo).
השלב הרביעי הוא **הפעלה**: הפיכת כל הניתוחים לסדר-יום מנוהל — משימות, הון, ביצוע, מדידה.
הקונסולה לא מחליפה את המנועים — היא המעטפת שמנהלת אותם.

## 2. ארכיטקטורה (שכבות)

```
┌─ Console Shell (RTL sidebar + topbar) ─────────────────────────────┐
│  State: zustand (view/sidebar) · Data: TanStack Query (cache/retry)│
├─ Views ────────────────────────────────────────────────────────────┤
│  🎛️ HQ        — סקירת מצב: התקדמות + הון + חשבון חי + הצעד הבא     │
│  ✅ מבצעים     — Runbook: משימות לפי שלב, סטטוס, פעולות מוכנות     │
│  💰 יומן הון   — Ledger: הפקדות/מחזורים/רווחים, P&L חי            │
│  🧭 Cockpit    — (קיים) AccountCockpit                             │
│  ⚡ סולו       — (קיים) SoloEngines                                │
│  🗺️ מפה        — (קיים) SoloMap                                    │
│  🧪 מנוע       — (קיים) LegacyEngine — הדשבורד הסימולציה המלא      │
├─ Execution Layer ──────────────────────────────────────────────────┤
│  /api/ops/prepare — פעולות מוכנות-חתימה: op JSON + קישורי steemlogin│
│  חוק ברזל: הפלטפורמה מרכיבה — המפתח והחתימה אצל המשתמש בלבד        │
├─ Persistence (Prisma/SQLite) ──────────────────────────────────────┤
│  OpsTask (runbook) · CapitalEvent (ledger) · ManagedAccount (קיים) │
└────────────────────────────────────────────────────────────────────┘
```

## 3. מודל נתונים חדש

**OpsTask** — משימת ריצה של המפעיל:
`order, phase (week1|month1|quarter), title, description, status (todo|active|done|blocked), keyAuth (posting|active|owner-offline|none), sourceDoc`
- seed ראשוני: 10 משימות מגל 4 (§7) — תביעת פרסים, ניקוי הרשאות, ברית-עדים, קוראציה, BOT-3, יומן הון, S1, S2, BOT-1, fleet.

**CapitalEvent** — אירוע הון מהעולם האמיתי:
`kind (deposit|convert_result|reward|expense), amountUsd, asset (USD|STEEM|SBD|SP), note, occurredAt`
- GET מחשב סיכום: הפקדות/תוצאות/פרסים/הוצאות → P&L נטו.

## 4. API Surface (חדש)

| נתיב | פעולות | הערות |
|---|---|---|
| `/api/ops/tasks` | GET/POST/PATCH/DELETE | GET מזריע runbook אם ריק |
| `/api/ops/capital` | GET/POST/DELETE | GET כולל summary |
| `/api/ops/prepare?username=` | GET | קריאה חיה: פרסים לתביעה → קישור steemlogin; feed/ask חי → מתכון המרה; ספירת הרשאות מיושנות → היגיינה |

כל הנתיבים `force-dynamic`, קריאה-בלבד לשרשרת, בלי מפתחות.

## 5. שכבת הביצוע (Execution Layer) — החלטת האבטחה

1. ה-prepare endpoint מרכיב **ops JSON מדויק** + **קישורי חתימה** (steemlogin.com/sign/...) מנתונים חיים.
2. פעולות posting (תביעה, הצבעת עד) — קישור חתימה ישיר, המשתמש מאשר בדפדפן.
3. פעולות active (convert, delegate) — מתכון + קישור, עם אזהרת סיכון.
4. פעולות owner (ניקוי הרשאות) — **לעולם לא קישור חתימה**; רק הוראות חתימה אופליין (KEY_CAPABILITIES §5).

## 6. חוזה UI החדש (שונה מהמודל הראשוני)

- **Sidebar** (RTL: ימין) עם 7 views — במקום שורת טאבים שטוחה; מתקפל במובייל ל-drawer.
- **Topbar**: חשבון פעיל + מחיר STEEM חי + נקודת חיים + שעון-סימולציה מסומן בנפרד.
- **TanStack Query** לכל ה-views החדשים (staleTime לכל מקור: tasks 10s, capital 10s, prepare 60s, live 60s) — במקום polling ידני.
- **Zustand** למצב UI (view פעיל, sidebar) — persist ב-localStorage.
- פלטת צבעים: zinc + emerald/amber/rose/violet/teal (אין כחול/indigo). Footer דביק בכל view.

## 7. מפת דרכים

- **v1 (משימה 14, הושלם)**: Shell + HQ + Runbook + יומן הון + prepare endpoint + איחוד כל הפאנלים הקיימים.
- **v2 (משימה 15, הושלם)**: ניטור חלון-BOT-3 — `WindowSample`/`WatchAlert` ב-DB + `/api/ops/watch` (דגימה TTL 5 דק' + סורק רקע + כפתור "סרוק עכשיו" + ספארקליין + התראות מעבר פתוח/סגור); דוח שבועי — `/api/ops/report` מרכיב דוח עברית מלאה (ראנבוק/הון/חשבון חי/חלון/הזדמנויות) עם העתקה והורדת .md; ריבוי חשבונות — `/api/ops/accounts` (וולידציה מול השרשרת, headcorner מוגן) + מתג חשבון ב-topbar; `market-snapshot.ts` כמקור יחיד לחישוב ה-edge.
- **v3 (משימה 18, הושלם)**: חתימה חיה בדפדפן — מסך "חי" (`LiveView`): KeySession (posting/active; WIF או סיסמת-על; נגזר בדפדפן דרך steem-js UMD מקומי `/steem.min.js`, בזיכרון בלבד, ללא persist), `/api/ops/tx/preview` (בונה ops מדויקים מהשרשרת + ולידציית יתרות, אפס מפתחות), שידור ישיר דפדפן→RPC (`signAndBroadcast`), 6 פעולות חתומות (תביעה · claim_account · העברה · Power Up/Down · הסרת הצבעות-עדים), מתכנן Power Down (13 שבועות + הערכות $) ו-Auto-Claim (30 דק' כשהטאב פתוח); סוכן מקומי 24/7 (`agent/`, Node, מפתחות ב-.env מקומי בלבד — Auto-Claim + צופה חלון). פירוט כלכלי: docs/REVENUE_PATHS.md.
- **v4 (מתוכנן)**: תזמונן משימות חוזרות חתומות (ראנבוק→ביצוע), חיבור הסוכן ל-OpLog חי, סליקת rail-play.

## 8. קריטריוני קבלה v1

1. `/` נפתח ישר ל-HQ של הקונסולה (לא לדשבורד הישן).
2. סימון משימה כ-done נשמר ב-DB ומופיע ב-HQ.
3. רישום הפקדה $100 + מחזור תוצאה $230 מציג P&L נטו נכון.
4. prepare מחזיר קישור תביעה תקין עם הסכומים החיים של headcorner.
5. כל הפאנלים הקיימים (Cockpit/Solo/Map/Engine) נגישים מה-sidebar בלי רגרסיה.
6. lint + tsc נקיים; אפס שגיאות קונסולה בדפדפן.
