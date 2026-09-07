# NEXT_SESSION PROMPT V467

## הצעד הבא הכי בעל-מינוו

**חיבור עמוק: Diamond Autonomous Guard ←→ Receipts / Ledger**

1. **חבר את `diamondAutonomousGuard467` למערכת הקבלות וה-ledger.**
   - כאשר `actWithGuard467` מבצע צעד כספי סמלי (dryRun=false), יש לייצר `agentReceipts268` קבלה מלאה לאותו צעד (AP2 mandate chain).
   - הוסף `recordAutonomousReceipt467(step, execution)` שכותבת ל-`agentReceipts268` + `auditLog.js` + מעדכנת את `fiatLedger.js` (בקריאה read-only לבדיקת יתרה, לא מוטציה ישירה).
   - תוצר: כל פעולה אוטונומית מוכיחה "מי עשה מה, מתי, עם איזה אישור guard".

2. **אם B עדיין פתוח — בנה aliasing wrapper לטסטים ישנים.**
   - במקום thin re-export פשוט (`module.exports = require('./X.js')`), צור `backwardCompatWrapper.js` שיודע להעביר קריאות מ-`getPerf267()` ל-`getPerf268()` וכו'.
   - בדוק על מגדל אחד קטן (`ussdSmsStateMachine265-268` או `agentReceipts263-268`), אמת שהטסטים הישנים עוברים.

3. **נקה תיעוד ישן שלא מיובא בקוד:**
   - `docs/changelogs/` ו-`docs/sessions/` מכילים מאות קבצים ישנים (V265-V286). אף אחד לא מיובא בקוד. מחק אותם לאחר וידוא 0 הפניות.

**כללים:** אפס npm deps חדשים. אפס מגע ב-SACRED. יש לעטוף שינוי ב-IIFE חדש או בתוך הקיים עם try/catch. תוצר עובד > תוצר שאפתני.
