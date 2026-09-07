# TFA × אקוסיסטם Claude — מיפוי יכולות לשילוב (v279)

> מסמך-בוס. מטרה: לאתר את **היכולות הכי חזקות** מהאקוסיסטם של Claude Code / סוכני-AI (MCP, skills, tools, hooks)
> ולמפות *איך* כל אחת משתלבת ב-TFA כדי להעלות מקצועיות, אפשרויות, ואימוץ. הכלל: מרחיבים, לא משנים.

## עיקרון-העל
TFA כבר **מדבר MCP** (14 כלים). האקוסיסטם של Claude Code נשען על אותו פרוטוקול בדיוק — לכן TFA לא "מתחרה" בכלים, אלא הופך ל**שכבת-האמון שמתחת לכולם**: כל כלי/skill/MCP-server שסוכן מפעיל יכול לעבור דרך TFA לפני פעולה מסוכנת, ולצאת עם proof נייד בר-אימות.

## היכולות הכי חזקות לשילוב (מדורג לפי ערך × מאמץ)

### ✅ נבנה ב-v279: `tfa_simulate_action` (MCP dry-run)
סוכן (Claude Code/Cursor) קורא לפני פעולה מסוכנת ומקבל ניבוי-אפקט (reversible/blastRadius/valueAtRisk/warnings) **בלי לבצע**. זה ה-MetaMask-simulation מוכלל לכל פעולה, חשוף דרך הפרוטוקול שהאקוסיסטם מדבר. עכשיו ל-TFA **14 כלי MCP**.

### 1. MCP Tool Annotations (readOnly/destructive/idempotent hints) — ערך גבוה, מאמץ נמוך
מפרט ה-MCP החדש תומך ב-annotations שמספרים ל-client אם כלי בטוח/הרסני/אידמפוטנטי. TFA הוא בדיוק מנוע-הסיווג — נגזור annotations מ-`classifyActionServerSide` לכל 14 הכלים, כך ש-Claude Code יציג אזהרת-בטיחות מדויקת *לפני* קריאה. **next.**

### 2. MCP Resources + Prompts — ערך גבוה
מעבר ל-tools, MCP תומך ב-**resources** (קריאת receipts/passports/track-record כמשאבים בני-עיון) וב-**prompts** (תבניות מוכנות כמו "verify this action before deploy"). TFA יחשוף את ה-read-model כ-resources ואת ה-gate-flows כ-prompts.

### 3. Claude Code Hooks (PreToolUse) — ערך עצום, הוא ה-wedge
ל-Claude Code יש hooks שרצים *לפני* כל קריאת-כלי. hook קצר שמפנה כל פעולה מסוכנת ל-`tfa_check_action`/`tfa_simulate_action` הופך את TFA ל**שער-אמון אוטומטי בכל סשן** — בלי ש-המפתח ישנה דבר. זה היישום הישיר של wedge #1.

### 4. Agent Skills (SKILL.md) — ערך גבוה, מאמץ נמוך
"TFA Trust Gate" כ-skill מותקן: מלמד את הסוכן מתי וכיצד לעבור דרך TFA, עם דוגמאות. הפצה קלה דרך מאגרי-skills.

### 5. GitHub Action + n8n/Zapier node (wedges #2/#3) — כבר ב-roadmap
המשך ישיר: כל PR / כל workflow אוטומטי עובר אימות TFA ומקבל verdict חתום.

### 6. OpenAPI 3.1 + Swagger — תשתית לאימוץ
שיקוף כל 53 ה-endpoints, כדי שמפתחים יבנו לקוחות ו-SDKs מבוססי-תקן.

## למה זה מנצח
האקוסיסטם של Claude מצוין ב**ביצוע** (כתיבת קוד, קריאת כלים) אך חסר **שכבת-אמון בת-הוכחה**. TFA משלים בדיוק את זה — ניטרלי, חוצה-vendor, MCP-native — ולכן משתלב בכל סוכן/כלי במקום להחליף אותם. כל יכולת שמשתלבת מגדילה את משטח-האימוץ בלי לדלל את הליבה.
