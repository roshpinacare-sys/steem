# SAOS · מאגר-הלקחים (memory/lessons.md)

מאגר זה הוא פלט-התקשורת בין-האיברים של R237: המנוע (engine, :3040) מזין
לבילדר (builder, :3043) לקח-מדיד אחד ליום מתוך state/learning.json —
הבילדר מציע את השורה (proposal-only), וה-custodian מחויב-את-השורה לשרשרת
ה-git החתומה. כל לקח נושא ראיה ממודדת — אין לקח בלי מקור.

<!-- השורה-האחרונה היא נקודת-ההיאחזות של עריכות-ההוספה (find/replace) -->

## 2026-10-13 · חוק-GEN-3: הריבונות לא שואלת מפתחות — פעם-אחת-ולתמיד
- **לקח**: R-VAULTPASS-1 (2026-10-11) העביר את passes-הכספת ל-Actions secrets (CI-בלבד) — ובכך ניתק את החייאה המקומית. כל מחיקה-קרה = `.secrets/` מת = SIGNING-DEAD = המפעיל נשאל שוב. נמדד: 3 מחיקות, 3 העלאות-חוזרות.
- **ראיה**: commit 24cf4c02 → GEN-3 (`agent/vault/HEADCORNER-GEN3.enc` + META; ciphertext-בגיט, shard-רנטימי מחוץ-לפרויקט — שתי-החזקות לעולם לא מתלכדות בגיט) + `sanbox/key-guardian.sh` חוט ב-bootstrap/commit-loop/autonomy-runner.
- **הוכחה**: מחיקה מדומה 11:12 → חייאה זהה-בית (8ae2b7fa… ← 8ae2b7fa…) תוך שניות, בלי מפעיל, בלי upload, בלי CI. חוק 2026-10-06 נאכף מבנית.

## 2026-10-13 · חוק-SELF-PATH: daemon נושא את נתיבו-המוחלט
- **לקח**: `bash "$0"` ב-daemon מת על חייאה (cwd יחסי נעלם). נמדד 2026-10-13 בבוקר: שתי-לולאות-התמדה מתו עד-העלאה-ידנית.
- **ראיה**: commit 24cf4c02 — `SELF="$SB/$(basename …)"` ב-commit-loop.sh + autonomy-runner.sh.

## 2026-10-13 · חוק-שושלת: reconcile חייב לשמר טיפים-חתומי-שרשרת
- **לקח**: reset-soft-לטיפ (alive-wins) יתם מהשושלת קומיט-מקומי שכבר נחתם בשרשרת — origin החזיק תאומה-שם-זהה SHA-אחר, ולכן ה-drift לא היה נראה מראש. נמדד: anchored 7ac579ec (09:16) איבד-אבות, probe FAIL.
- **תיקון-מוכח**: שתלת-שושלת `commit-tree` עם tree זהה-בית ואפס-שינוי-תוכן (commit 5c4ed6d2) → anchored=True drift=False.
- **כלל**: לפני reset/union — הרץ `chain-anchor-probe.mjs`, ואם הטיפ-החתום עומד-לצאת-מהשושלת → graft קודם.

