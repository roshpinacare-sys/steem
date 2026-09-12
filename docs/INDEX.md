# SAOS — אינדקס המסמכים ההנדסיים

> **Steem AI Agent OS** — מערכת ריבונית אוטונומית על Steem/Hive + שרשרת-ריבונית משלנו (SAOS-NET v1.3) + אקספלורר-עם-הוכחות.
> נקודת-כניסה זו מסודרת כך שכל מה שיש לנו נמצא, מאומת, וניתן לשחזור.

## המסמכים המרכזיים (מסדר-קריאה)

| מסמך | מה יש בו | מתי קוראים |
|---|---|---|
| **[ARCHITECTURE.md](./ARCHITECTURE.md)** | הארכיטקטורה המלאה של המערכת החיה: שכבות, זהויות, אוטובוס, דמון (28 לולאות), DEX/AMM, גשר, מפעל, משכורות, ריבונות-RC, פיצול-שרדים | להבין איך הכל בנוי |
| **[EMPIRE_LEDGER.md](./EMPIRE_LEDGER.md)** | פנקס-האימפריה: כל החשבונות, הנכסים, וכל ה-txids המרכזיים לפי משימה — כולל איך לאמת כל טענה באופן-עצמאי | לדעת מה שלנו ולאמת |
| **[OPERATIONS.md](./OPERATIONS.md)** | ספר-ההפעלה: הרצת הדמון, טבלת exec-whitelist + cooldowns, שערי-הוכחה G1–G6, נהלי-שחזור (מפעל-דור-שני, צ'אנקים) | להפעיל ולתחזק |
| **[KNOWN_LIMITS.md](./KNOWN_LIMITS.md)** | כל חומות-הפרוטוקול שנמדדו חי + הפתרון-הריבוני לכל אחת | לפני שמנסים לפרוץ גבול |
| **[ROADMAP.md](./ROADMAP.md)** | הגבולות הבאים: ג'נזיס-טוקן, מטריצת-בריכות, גיוס-הון, Blurt/Leofinance, ביצועים | לתכנן את הצעד הבא |
| **[BIG_SYSTEM_PLAN.md](./BIG_SYSTEM_PLAN.md)** | **תוכנית-המערכת-הגדולה** (Task 54 · פערים-4+6-נסגרו-ב-Task 55 — Vault-v2 + רפלקס-חיצוני): מהמאתר-ל-OS מבוזר — פירוק-הדימון למודולים, STRATA (ממשק-מצב-עולם-מהשרשרת), CHAIN-ABSTRACTION, 8 פערים-ל״בלתי-מוגבל-לחלוטין״ וסדר-ביצוע | לפני-כל-גל-פיתוח-הבא |
| **[VALUE_MAP.md](./VALUE_MAP.md)** | מפת-הערך: מאיפה-באמת נכנס ערך, באיזה רמות, ואיך כל-טרנזקציה מייצרת-ערך-נוסף | לחשוב-על-הכנסה-חדשה |
| **[WRAPPED_DEX.md](./WRAPPED_DEX.md)** | ה-DEX-העטוף: מסילות-wrapped, סולמות-HE, והמסגרת-שמסבירה את החומות שנמדדו | לפני-פעולת-DEX |

## מסמכי-עומק היסטוריים (רקע/החלטות)

- `ROAST.md` / `ROAST_CONSOLE_V4.md` — שערי-הוכחה G1–G6 והמשמעת שאחרי ה-veto המוצרי
- `KEY_CAPABILITIES.md` · `STEEM_KEYS_PLAYBOOK.md` — יכולות-מפתחות (כל-4-התפקידים, שרשראות-בת)
- `EMPIRE_STRATEGY.md` · `EXECUTION_PLAYBOOK.md` · `SOLO_MODEL_PLAYBOOK.md` — אסטרטגיה ודרכי-רווח
- `REVENUE_PATHS.md` · `EARNING_VECTORS_ANALYSIS.md` · `RENTAL_SCAN.md` — מסילות-הכנסה
- `EFFICIENCY_AUDIT.md` · `EXPLORATION_WAVE2/4.md` — ביקורות וסיורים
- `SOVEREIGN_ANALYSIS.md` · `RAIL_PLAY_BRIEF.md` · `AUTOMATION_BUILD_PLAN.md` · `CONSOLE_PLAN.md` — ניתוח-ריבונות, מסילות-חתימה, תוכניות-אוטומציה והקונסולה

## הכלל המחייב

**כל טענה במסמכים האלה חייבת להיות מדורגת**: `on-chain` (txid שכל-אחד יכול לאמת) · `proven-local` (ריצה-מדודה מקומית) · `empirical` (תצפית) · `idea`. אין טענות ללא ראיה. מי שמוסיף יכולת → מעדכן ARCHITECTURE + EMPIRE_LEDGER + KNOWN_LIMITS באותו commit.

## ארכיון-הראיות (נאסף-מחדש-ב-R19d)

| מקום | מה יש בו |
|---|---|
| **[docs/reports/](./reports/)** | כל דוחות-העונה: SAOS-PULSE/DAILY/BRIEFING/DOSSIER + ביקורות-טענות (CLAIMS-AUDIT) + תוספות-ראסט — נקודת-מקור יחידה, אין שכפולים בשורש |
| **[../broadcasts/](../broadcasts/)** | 49+ מכתמי-שידור ומכתמי-סבב (r18p→r19d) — כל סבב נחתם בקובץ מתוארך |
| **[../worklog.md](../worklog.md)** | פנקס-העבודה השוטף של הסבבים (Task ID / Work Log / Stage Summary) |
| **[../MANIFEST.txt](../MANIFEST.txt)** | מניפסט-sha256 של ארטיפקט-המפתחות האטום (2026-09-10) |
| **[../agent/DAEMONS.md](../agent/DAEMONS.md)** | חוזה-שער-ה-LIVE/DRY החי — מקור-האמת לספירת-הלולאות והדיימונים |

> **סדר-השורש (R19d)**: בשורש נשארים רק מסמכי-חיים — README · worklog · MANIFEST · AGENT-BRIEFING · ENGINEER_BRIEF · CONTROLS-THAT-EXIST · PATCH-SPEC-P11 · THE_WEAVE. כל דוח מתוארך → `docs/reports/` · כל מכתם → `broadcasts/` · קבצי-רעש זמניים נמחקים במקום.
