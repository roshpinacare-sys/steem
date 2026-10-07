# SAOS — מערכת-הפעלה ריבונית-אוטונומית על Steem

> **אמת-אחת: הגיט.** הסנדבוקס הוא מטמון-נמחק (~5×/יום). מה שלא נדחף לגיט — לא קרה.
> סוכן? התחל מ-**[AGENTS.md](./AGENTS.md)** — חוק-פתיחה-חובה.

## מה זה
מערכת עצמאית שמנהלת נוכחות ופעולות על השרשרת הציבורית של Steem:

- **מוח (engine)** — `mini-services/saos-engine/` — מחזורים יומיים (21 שלבים): תצפית, מועצה (council), גריד, מלחמת-תוכן, חיילים, עוגני-אמת, התאמה-למידה. Node/bun טהור, תלות-רשת מינימלית (@noble).
- **קוקפיט (UI)** — Next.js 16 + Prisma/SQLite — תצוגה-חיה של כל-המדדים ב-`:3000`.
- **שרשרת-חוק (git-sovereignty)** — כל-קומיט-גוף חתום-GPG, דחיפה-רק-FF דרך שער (`scripts/sovereign-push.sh`), וכל-tip נעוגן-על-השרשרת הציבורית (`saos-git-custody-v1` ע"י `headcorner`) — כך קו-האמת ניתן-לאימות ע"י-כל-צד-שלישי לנצח.
- **ביקורת-פנימית** — `selftest.mjs` (587 וקטורים, fail-closed) + ביקורות-adversarial ב-`audit/`.
- **שער-MCP** — `mini-services/saos-engine/mcp.mjs` — כל-סוכן בעולם (Claude Code, Cursor, Codex, ...) מדבר עם-הריבונות בשפת-ה-MCP האוניברסלית (השראה: דפוס-ה-"One MCP" של REA).

## התחלה-מהירה (מגיט-בלבד — שום-תלות בסנדבוקס קודם)
```bash
bash scripts/sovereign-bootstrap.sh /tmp/saos-fresh   # clone טרי + התקנה + selftest מלא
node mini-services/saos-engine/selftest.mjs           # חייב N/N PASS
node scripts/chain-anchor-probe.mjs                   # מאמת עוגן-tip מול השרשרת הציבורית
```

## חוקים (חובה-קריאה)
| מסמך | נושא |
|---|---|
| [AGENTS.md](./AGENTS.md) | חוק-סוכנים: אפס-אמון בסנדבוקס, פתיחת-סשן, שער-דחיפה |
| [SOVEREIGN-WRITER-LAW.md](./SOVEREIGN-WRITER-LAW.md) | זהות-כותבים, FF-only, חתימות, סעיף-checkpoint |
| [docs/SANDBOX-DISTRUST-LAW.md](./docs/SANDBOX-DISTRUST-LAW.md) | החוק-המלא: הסנדבוקס אינו-מקור-אמת; שחזור-מגיט; runner-חיצוני |
| [audit/](./audit/) | ביקורות-טענות לפי-סבב, כולל `audit/r241/CLAIM-TRUTH-AUDIT.md` |

## הפעלה
- מנוע: `cd mini-services/saos-engine && bun index.ts` (ברירת-מחדל `:3040`)
- קוקפיט: `bun run dev` (ברירת-מחדל `:3000`)
- מחזור-בודד: `cd mini-services/saos-engine && bun daily.mjs`
- פסק-כשירות מדוד: `node mini-services/saos-engine/doctor.mjs [--json] [--scope git|selftest|engine|actions|chain|all]` — fail-closed, remedy-ניתן-לפעולה (דפוס-`rea doctor`)
- אימות-רציף-חיצוני: GitHub Actions `.github/workflows/sovereign-cycle.yml` (כל-30 דק: clone→install→selftest→עוגן-שרשרת) — פעיל גם-כשהסנדבוקס מת.

## חיבור-סוכן-חיצוני דרך-MCP (השער-האוניברסלי)
כל-סוכן שתומך ב-MCP (Claude Code, Cursor, Codex, Windsurf...) מוסיף:
```json
{ "mcpServers": { "saos": { "command": "node", "args": ["mini-services/saos-engine/mcp.mjs"], "cwd": "<repo-root>" } } }
```
כלים-זמינים: `saos_law` (חוקי-הפתיחה) · `saos_status` (מצב-המנוע-החי) · `saos_doctor` (פסק-כשירות מדוד) · `saos_anchors` (עוגני-שרשרת) · `saos_join` (איך-להצטרף).
אפס-סודות-בפלט (scrub מובנה של WIF/PAT/token) · fail-closed (כל-שגיאה כנה עם-remedy). רקע: [docs/COMPETITIVE-INTELLIGENCE.md](./docs/COMPETITIVE-INTELLIGENCE.md).

## מבנה
```
mini-services/saos-engine/   המוח — מחזורים, חוזים, selftest
src/                         קוקפיט Next.js (ראוט-יחיד /)
db/                          SQLite (Prisma) — לא-משחזר-מגיט; bootstrap מריץ prisma db push
scripts/                     שער-דחיפה, בדיקת-סטייה, bootstrap, פרובת-עוגן
docs/ ו-audit/               חוקים וביקורות
state (לא-בגיט)              mini-services/saos-engine/state/ — ראיות-חיות, ניתנות-לבנייה-מחדש
```
