# NEXT_SESSION_PROMPT V466

## הצעד הבא הכי בעל-מינוף

**איחוד מגדל-שכפול קטן ומהיר → חיבור ל-Decision Engine.**

1. **בחר מגדל קטן (B) שאינו בשימוש בשרת** — לדוג' `agentReceipts263.js`–`268.js` (6 מודולים) או `agentLoop225.js`/`227.js`/`230.js`/`231.js` (4 מודולים).
   - ודא שאף `require` בשרת לא טוען אותם (בדוק `grep -r "agentReceipts263" ecos-api-server.js lib/ src/`).
   - הפוך את הישנים ל־thin re-export של הגבוה ביותר (268 או 231).
   - הרץ `node --check` + `tests/v466.test.js` — חייב לעבור.

2. **אם A-B נקיים — חבר את ה־Diamond Heartbeat לפעולה אוטונומית (D).**
   - הרחב את `diamondOrchestratorBridge466.js` לייצר צעדים כספיים **באישור guard** (V402) כאשר `proactiveDecisions462` מזהה "urgency >= 3".
   - הוסף `POST /api/v1/diamond/orchestrator/act` — מריץ plan עם `moneySteps > 0` דרך `guardMint402`/`guardWithdraw402` (fail-closed).
   - תעד כל פעולה כספית ב־auditLog + receipt.

3. **דחיסת מבחנים (tests) ישנים שנשארו:**
   - 11 קבצי בדיקה נשארו; אם ניתן למחוק עוד כאלה ללא `require` — נקה.

**כללים:** אפס npm deps חדשים. אפס מגע ב־SACRED. יש לעטוף כל שינוי ב־IIFE חדש או בתוך הקיים עם try/catch. תוצר עובד > תוצר שאפתני.
