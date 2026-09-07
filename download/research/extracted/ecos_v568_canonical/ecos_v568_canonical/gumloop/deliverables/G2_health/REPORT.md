# G2 — דוח בריאות Codebase (executed 2026-05-31)

> נותח בפועל על `ecos_v232_canonical`. נתונים: `code_health.json`.
> תרשימים: `assets/chart_code_size.png`, `assets/chart_code_health.png`.

## מספרים
- **682 קבצי JS/JSX**, ~**196,861 שורות** קוד.
- הקובץ הגדול: `ecos-api-server.js` — **22,375 שורות** (🚩 מועמד מובהק לפיצול לראוטרים/מודולים).

## ממצאים מרכזיים
1. **136 קבצים כפולים בין `src/lib/` ל-`lib/`** 🚩 — דפוס ה-mirror לגיטימי (כמו agentLoop231),
   אבל בקנה מידה כזה יש **סיכון drift**. המלצה: בדיקת md5 שה-mirror זהה ב-pre-flight, או מקור-אמת יחיד + re-export.
2. **5 מודולים יתומים**: sandboxHarden227.js, paymentRail.js, agent-core-bridge.js, paymentRail.js, agent-core-bridge.js — לבדוק dead-code מול טעינה דינמית.
3. **מודולים בלי טסט** (דגימה): agent-core-bridge, paymentRail, semanticPatchEngine, stateRoot — חלקם קריטיים (semanticPatchEngine!). להוסיף כיסוי.
4. **אבטחה:** 22× `child_process`, 16× `exec(` — לוודא שאין הזרקת קלט-משתמש. אין סודות hardcoded / `eval` (טוב).

## פעולות לפי קריטיות
- 🔴 לוודא mirror-integrity (md5) של 136 הכפילויות ב-pre-deploy.
- 🟠 טסטים ל-semanticPatchEngine / paymentRail / stateRoot.
- 🟡 לתכנן פיצול של ecos-api-server.js (22K שורות).
