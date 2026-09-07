# מה אפשר לעשור עם מפתח Steem — מטריצת סמכויות מלאה ונוהל ניקוי

> מסמך המשך ל-`EXECUTION_PLAYBOOK.md` (ול-`EARNING_VECTORS_ANALYSIS.md`). הפעם: **מה כל מפתח באמת נועל ומה הוא פותח** — מטריצת סמכויות per-operation, מנגנוני multi-sig, RC וחשבונות-משנה, ונוהל ניקוי אופליין מדויק לחשבון הפלטפורמה **@headcorner**.
> כל מספר חשבוני על @headcorner **נמדד חי** מ-`api.steemit.com` (קריאות בלבד — על פי שעון השרשרת: 2026-09-01). מכניקות השרשרת נכונות לעידן HF17–HF25.
> לא בוצעה שום פעולה ברשת. הנוהל בסעיף 5 מיועד לריצה ידנית של בעלי החשבון בלבד.

---

## 1. תמצית מנהלים

| מפתח | משפט-על | מה הוא **לא** יכול |
|---|---|---|
| **Posting** | "מקלדת התוכן" — פרסום, הצבעה, עוקבים, reblog, ניהול קהילה, טענת רווחים | להזיז שקל אחד מהיתרות |
| **Active** | "הארנק" — כל העברה, המרה, מסחר, escrow, השכרת SP, הצבעות עדים ו-SPS | לשנות את עצמו או מפתחות אחרים |
| **Owner** | "שליטת-על" — משנה **את כל** המפתחות וההרשאות, כולל owner עצמו; מאחזר חשבון פרוץ | (אין — owner מכסה הכל, כולל חתימה על פעולות posting/active) |
| **Memo** | "מעטפת המסרים" — הצפנה/פענוח של מסרי `#` בלבד | לחתום **אפילו פעולה אחת** |

> **כלל הזהב:** מפתחות הם אישורי-גישה בלבד; **היתרות חיות על החשבונות**. לכן: הפרדת תפקידים — חשבון-תוכן (posting) נפרד מחשבון-הון (active), וowner אף פעם לא נוגע ברשת. פריצת מפתח אחד לא אמורה להיות מסוגלת לגעת בהון.

---

## 2. מטריצת סמכות מלאה

### 2.1 POSTING — מה מפתח התוכן פותח

| פעולה (op) | מה משיגה | סיכון הון |
|---|---|---|
| `comment` | פרסום פוסט/תגובה (כולל beneficiaries בהצבעה-ראשונה) | אפס |
| `delete_comment` | מחיקת פוסט/תגובה — רק כשאין תגובות-בנות ואין צבירת רווחים חיובית (לאומת מול הצ'יין לפרטי התנאי) | אפס |
| `vote` | הצבעה/דאונווט; מזיז קורצ'ן מאגר-הפרסים — **לא מהיתרות של החשבון** | אפס |
| `custom_json` (id: `follow`) | עוקבים/הסרת עוקבים, mute | אפס |
| `custom_json` (id: `reblog`) | reblog (הדהוד פוסט) | אפס |
| `custom_json` (id: `community`) | ניהול קהילה: מינויי מנהלים/אוצרים, חוקי תיוג | אפס |
| `reblog` | אותו custom_json — מוצג ב-steem-js כפונקציה נפרדת | אפס |
| `claim_reward_balance` | טענת רווחים ממתינים (STEEM/SBD/SP) ליתרות החשבון | אפס (הכסף נשאר בחשבון) |
| `account_update2` (תת-קבוצת posting) | עדכון פרופיל (`json_metadata` / `posting_json_metadata`); עדכון מפתח-posting דרך op זה בחתימת posting — לאומת מול הצ'יין; ההליך המקובל לשינוי מפתחות: `account_update` עם owner | נמוך |
| `delegate_rc` | העברת נפח-RC לחשבונות אחרים — בפועל עובד גם עם posting; רשמית posting/active — לאומת מול הצ'יין | אפס |

> הערות: `custom_json` ב-id `witness` (עדכוני עדות ישנים) — לאומת מול הצ'יין; כיום ניהול עדות הוא active (ראו 2.2). הצבעה לעדים איננה posting — היא `account_witness_vote` ב-active.

### 2.2 ACTIVE — מה מפתח הארנק פותח

| פעולה (op) | מה משיגה | סיכון הון |
|---|---|---|
| `transfer` | העברת STEEM/SBD לכל חשבון — הדלת שדרכה כסף עוזב לנצח | **גבוה** |
| `transfer_to_vesting` | Power up: STEEM→SP (נזילות ננעלת; יציאה = 13 תשלומים שבועיים) | בינוני |
| `withdraw_vesting` | Power down: SP→STEEM, **13 תשלומים שבועיים** (חלון-תגובה לאירוע חשוד) | בינוני |
| `set_withdraw_vesting_route` | ניתוב תשלומי power-down לחשבונות אחרים (עד 100% מצטבר, אופציית auto-vest) | בינוני |
| `convert` | SBD→STEEM בערך $1-feed; **בגרות 3.5 ימים** (בסיס ל-BOT-3) | בינוני |
| `limit_order_create` | הנחת פקודה בשוק הפנימי SBD/STEEM | **גבוה** |
| `limit_order_cancel` | ביטול פקודה תקועה | אפס |
| `delegate_vesting_shares` | השכרת SP; **ההרשאה חוזרת ב-5 ימים** (`delegation_return_period`=432000s, נמדד) | בינוני |
| `transfer_to_savings` | נעילה עצמית (הגנה מפני פריצת active) | נמוך |
| `transfer_from_savings` | משיכה מחיסכון; **בגרות 3 ימים** — ניתנת לביטול בתוך החלון | בינוני |
| `cancel_transfer_from_savings` | ביטול בקשת משיכה בתוך חלון ההמתנה | אפס |
| `escrow_transfer` | פתיחת עסקת נאמנות (המפקיד נועל כסף) | **גבוה** |
| `escrow_approve` | אישור/דחייה כבורר או כצד — רטיפיקציה עד 3 ימים | נמוך |
| `escrow_dispute` | פתיחת מחלוקת | נמוך |
| `escrow_release` | שחרור הכסף (לפי תנאים) — כבורר זה הכוח האמיתי | **גבוה** |
| `account_witness_vote` | הצבעה לעדים (עד 30) — לא owner, **דווקא active** | אפס |
| `account_witness_proxy` | הקצאת פרוקסי הצבעה | אפס |
| `witness_update` | רישום/עדכון עד (מפתח-חתימה, עמלה, url) | אפס |
| `witness_set_properties` | פרמטרי עד (feed, account_creation_fee וכו') | אפס |
| `feed_publish` | קביעת מחיר-feed (משפיע רשתית, לא על יתרות) | אפס |
| `create_proposal` | הגשת הצעת SPS (0.5 SBD יצירה? — לאומת מול הצ'יין) | אפס |
| `update_proposal_votes` | הצבעה להצעות SPS | אפס |
| `remove_proposal` | מחיקת הצעות שלך | אפס |
| `claim_account` | טענת זיכוי-יצירת-חשבון מ-RC (ראו סעיף 4) | אפס |
| `create_claimed_account` | יצירת חשבון מזיכוי קיים — בלי תשלום fee | אפס |
| `account_create` | יצירת חשבון בתשלום fee (במקום זיכוי RC) | נמוך |
| `delegate_rc` | העברת RC (רשמית active; בפועל עובד גם posting) | אפס |
| `custom_json` (ids נבחרים) | פרוטוקולים חוץ-שרשרתיים שנועלו active (למשל legacy `witness`) — לאומת מול הצ'יין | אפס–נמוך |

> `recover_account` ו-`request_account_recovery` אינם ops של active — ראו 2.3.

### 2.3 OWNER — מה מפתח השליטה פותח (והכל מתחתיו)

| פעולה (op) | מה משיגה | סיכון הון |
|---|---|---|
| `account_update` | שינוי **כל** המפתחות (owner/active/posting/memo) וכל `account_auths` — הרשאות נוספות/שלילה | **גבוה** (שליטה מלאה בחשבון) |
| `recover_account` | אחזור חשבון לאחר פריצה; חתימת owner כפולה (הישן מההיסטוריה + החדש מבקשת-האחזור) | **גבוה** |
| `request_account_recovery` | פתיחת בקשת אחזור על-ידי חשבון-האחזור (trustee); נדרשת הרשאת owner (ועל-פי חלק מהמימושים גם active) של חשבון-האחזור — לאומת מול הצ'יין | אפס |
| `decline_voting_rights` | ויתור על כוח-הצבעה — נכנס לתוקף לאחר 30 יום | אפס |
| **הכל מתחתיו** | מפתח-owner מספק גם posting וגם active — הוא סופרסט. ולכן: owner לעולם לא חם | — |

**מכניקת חלון-האחזור של 30 יום:**
1. חשבון-האחזור של @headcorner (נמדד: `recovery_account = steem`) משדר `request_account_recovery` עם authority-owner **חדשה**.
2. לבעלים האמיתי יש **חלון של 30 יום** להשלים `recover_account` עם שני מפתחי-owner: החדש (מהבקשה) + הישן (מהיסטוריית owner של השרשרת).
3. היסטוריית מפתחות-owner נשמרת כ-60 יום (לאומת מול הצ'יין את הפרמטרים המדויקים: תוקף הבקשה, זמן שמירת ההיסטוריה).
4. כיוון הזמנים חשוב: מי ששולט ב-owner מסוגל גם להחליף את חשבון-האחזור — ולכן הגנת-האחזור תקפה רק כשowner קר.

### 2.4 MEMO — מה מפתח המסרים פותח

| שימוש | מה משיג | סיכון הון |
|---|---|---|
| מסרי `#` (מוצפנים) | הצפנה/פענוח של memo ב-transfer; שיתוף-פעולה פרטי | אפס |
| מסרי בורסה | memo הפקדה של בורסה — תמיד עם קידומת `#` (מוצפן למפתח-הmemo של הבורסה); memo ללא `#` נשלח **פתוח** | אפס (אך חשיפת-פרטים) |

> מפתח-memo אינו חותם פעולות כלל — דליפתו אינה מזיזה כסף, אך מחשופת את תוכן ההתכתבויות הפיננסית. בהרבה חשבונות (כולל חשבונות חדשים שנוצרו דרך UI) מפתח-active משמש גם כmemo-key — לאומת מול הצ'יין לפני כל שיתוף.

### 2.5 סיכום-על של המטריצה

| קבוצת פעולות | הרשאה מינימלית |
|---|---|
| תוכן, קורצ'ן, עוקבים, קהילה, טענת רווחים | posting |
| כספים, מסחר, escrow, שכירות SP, חיסכון, המרות | active |
| גוברננס (עדים, SPS, פרוקסי) | active |
| שינוי מפתחות/הרשאות, אחזור | owner |
| הצפנת מסרים | memo |

---

## 3. account_auths מול key_auths — ספי-משקל ו-multi-sig

כל הרשאה בחשבון היא:

```
authority = {
  weight_threshold: N,                  // סכום המשקלים שצריך לעבור כדי לחתום
  account_auths: [["שם-חשבון", weight], ...],   // חשבונות אחרים כחותמים
  key_auths:     [["STM<pubkey>", weight], ...] // מפתחות ציבוריים כחותמים
}
```

| היבט | `key_auths` (מפתחות) | `account_auths` (חשבונות) |
|---|---|---|
| מה ניתן | מפתח ציבורי שלך בשליטתך | **כל** הסמכות הנוכחית של חשבון אחר (כולל כל המפתחות שלו) |
| ביטול | דורש owner-key חדש (רוטציית מפתח) | הסרה ב-`account_update` — בלי להחליף מפתחות |
| סיכון | דליפת המפתח הפרטי | החשבון-הנותן תלוי באבטחת **החשבון-המקבל** (שרשרת אמון) |
| מקרה שימוש | חשבונות אישיים, בוטים | אפליקציות שדורשות "לדבר בשם החשבון" (steemhunt, steemauto וכו') |
| הגבלה | עד 10 חברי-הרשאה לכל authority (קבוע פרוטוקול) | עד 10 חברי-הרשאה לכל authority |

**תבניות multi-sig:**

| תבנית | מבנה | יתרון | מחיר | מתי |
|---|---|---|---|---|
| 1-of-1 | מפתח יחיד, threshold 1 | אוטומציה פשוטה | אין ביזור | כל הבוטים — **ברירת-המחדל של SAOS** |
| 2-of-2 (server+owner) | threshold 2; מפתח-active של שרת (w1) + מפתח-owner קר (w1) | שרת לבדו **לא** מסוגל להזיז כסף — חתימה אנושית לכל פעולת-הון | הבוט מפסיק להיות אוטומטי | אוצר גדול / הון עצום, פעולות ידניות נדירות |
| threshold מוחלש | threshold 1 מתוך 2 חותמים | אד-הוק | זהה ל-1-of-1 | לא מומלץ — אשליית אבטחה |
| חשבון-בוט ממומן | חשבון-משנה זול עם מפתח יחיד + מסה מוגבלת | פיצוץ-טווח (blast radius) קטן | תחזוקת חשבונות | **ההמלצה ל-SAOS** במקום multi-sig |

> **ההחלטה ההנדסית של SAOS:** multi-sig 2-of-2 על חשבון-הון הוא יעיל-מרבית אך קוטל אוטומציה (כל `transfer` דורש הרמת מקש ידנית). התחליף: מפתח-active יחיד, על מכונה מבודדת, עם תקרת-מסה יומית מאוכפת בקוד, על חשבון שמחזיק מינימום נזילות — כל העודף זורם ל-SP (יציאה מ-SP = 13 שבועות, שהם זמן-תגובה) ולחיסכון (בגרות 3 ימים ניתנת לביטול).

---

## 4. יצירת חשבונות ו-RC — צי המשנה

| פעולה | הרשאה | מנגנון |
|---|---|---|
| `claim_account` | active | טוען זיכוי ליצירת חשבון; עלותו ב-RC. עם מספיק SP הזיכוי כמעט-חינמי (המספר הקהילתי המקובל: **~5,300+ SP** — לאומת מול הצ'יין); אחרת אפשר לשלם fee ב-STEEM |
| `create_claimed_account` | active | יוצר חשבון על-ידי שריפת זיכוי קיים — בלי fee |
| `account_create` | active | יצירה בתשלום fee (ערך ה-fee לאומת מול הצ'יין) |
| `delegate_rc` | posting/active | הקצאת נפח-RC לחשבון אחר; ה-RC של המקבל גדל מיידית; ביטול ההקצאה חוזר לשולח (מיידי — לאומת מול הצ'יין) |

**מדידה חיה על @headcorner (2026-09-01):**

| מדד | ערך | משמעות |
|---|---|---|
| SP עצמי (vesting_shares) | ≈ 5,320 SP | **מעל** סף ה-~5,300 SP — `claim_account` זמין בחינם |
| SP שהתקבל בהקצאה | ≈ 247 SP | סה"כ יעיל ≈ 5,567 SP |
| RC גבוה (max_rc) | ≈ 9.0×10¹² | מנבור RC מלא; regen מלא על פני 5 ימים |
| רווחים ממתינים | 42,533.62 VESTS ≈ 26.3 SP | נטענים עם `claim_reward_balance` (posting) |
| יתרות נזילות | 0.153 STEEM, 0 SBD, 0 חיסכון | חשיפה נזילה זעירה — כבר במבנה הנכון |

**אסטרטגיית צי הבוטים:**
1. `claim_account` אחת לתקופה מ-@headcorner (על מכונה מבודדת, מפתח-active) → מאגר זיכויים.
2. `create_claimed_account` יוצר לכל תפקיד-בוט חשבון-משנה זול ונפרד: אחד לקורצ'ן (BOT-2), אחד לתוכן L2 (BOT-8), אחד לשכירות SP (BOT-1), וכו'.
3. `delegate_rc` מ-top-up של headcorner לכל חשבון-משנה לפי עומס — בוט שנתקע ב-RC לא עוצר את השאר.
4. בוט שנפרץ = אפס נזילות, אפס SP משלו, אפס הרשאות על האוצר — נזרק ונוצר מחדש תוך דקות.

---

## 5. נוהל ניקוי אופליין ל-@headcorner — שלילת הרשאות-posting של אפליקציות

### 5.1 המצב הנמדד (חי, 2026-09-01)

`posting.account_auths` של @headcorner — **8 הרשאות**, כל אחת weight 1, `weight_threshold` 1:

| אפליקציה | סטטוס קהילתי | החלטת הנוהל |
|---|---|---|
| `bottracker.app` | לא פעיל/לא ידוע | **שלילה** |
| `dlive.app` | עזב את Steem (מזמן) | **שלילה** |
| `smartsteem` | השירות נסגר | **שלילה** |
| `steem-plus-app` | תוסף נטוש | **שלילה** |
| `steemauto` | השירות נסגר/הופסק | **שלילה** |
| `steemhunt.com` | **פעיל** | לשיקולך — ברירת-מחדל: נשאר (השורה מוערת בסקריפט לניקוי מלא) |
| `streemian` | נסגר | **שלילה** |
| `utopian.app` | נסגר | **שלילה** |

- **7 שלילות** + steemhunt.com בשיקול — כך מתיישב המספר "7" במסמכים הקודמים עם 8 שנמדדו.
- `active.account_auths` ו-`owner.account_auths`: **ריקים** (נמדד) — אין מה לנקות שם כרגע.
- מפתח-posting, active, owner, memo: נשמרים **כפי שהם** — הנוהל נוגע רק ברשימת `posting.account_auths`.
- עובדת-היגיינה שנמדדה: `last_owner_update = 1970-01-01` — מפתח-ה-owner מעולם לא הוחלף מאז יצירת החשבון (2018). לא חוסם את הנוהל, אבל ראו 5.5.

### 5.2 עקרונות-מבצע (לא לדלג)

1. **מפתח-owner מעולם לא נוגע במכונה מחוברת.** החתימה על מכונה מנותקת (air-gapped): הכנת snapshot במכונה מחוברת → חתימה במכונה מנותקת → שידור במכונה מחוברת **בלי מפתחות**. מפתח-ה-owner מוקלד ידנית במכונה המנותקת, לא נשמר בקובץ/היסטוריה/סביבה.
2. **שידור ללא מפתחות** — הטרנזקציה נחתמת כ-JSON ומועברת ב-USB. המכונה המחוברת רואה חתימה, לא סוד.
3. המפעיל הוא בעלי החשבון בלבד. אין "עזרה" משירותי-צד-שלישי (אף אתר "חוסך לך את זה" = העברת owner לזר).
4. חלון TaPoS: ה-ref-block מה-snapshot תקף כ-2 ימים (~65,536 בלוקים) — העדיף להשלים prepare→sign→broadcast באותו יום.

### 5.3 שלבי ההליך

| שלב | מכונה | מה קורה |
|---|---|---|
| 0 (אופציונלי, נפרד) | מחוברת | `claim_reward_balance` עם **מפתח-posting** — לטעון את ~26 ה-SP הממתינים. פעולת-posting, לא חלק מהנוהל הזה |
| 1 | מחוברת (ללא מפתחות) | `node hc-cleanup.js prepare` — snapshot של החשבון + dgpo ל-`hc-snapshot.json` |
| 2 | מנותקת | `node hc-cleanup.js sign` — בניית `account_update` (owner/active/memo/json_metadata נשמרים, `posting.account_auths` מסונן), הקלדת WIF-owner, חתימה → `hc-signed-tx.json` |
| 3 | מחוברת (ללא מפתחות) | `node hc-cleanup.js broadcast` — שידור network_broadcast_api |
| 4 | מחוברת (ללא מפתחות) | `node hc-cleanup.js verify` — בדיקות האימות (טבלה 5.4) |

> התקנת התלות במכונה המנותקת: על מכונה מחוברת `npm pack steem@0.7.11` → העברת ה-tarball ב-USB → `npm install ./steem-0.7.11.tgz` במכונה המנותקת. אפס גישת רשת בזמן החתימה.

### 5.4 הסקריפט (Node, תלות יחידה: `steem@0.7.11` — קריאה/חתימה/שידור)

```js
// hc-cleanup.js — שלילת הרשאות-posting ל-@headcorner | מצבים: prepare|sign|broadcast|verify
const steem = require('steem');
const fs = require('fs');
const https = require('https');
const readline = require('readline');

const ACCOUNT = 'headcorner';
const RPC_HOST = 'api.steemit.com';
// נמדד חי מהשרשרת (2026-09-01) — 7 שלילות; steemhunt.com פעילה, בשיקולך:
const REVOKE = [
  'bottracker.app', 'dlive.app', 'smartsteem', 'steem-plus-app',
  'steemauto', 'streemian', 'utopian.app'
  // , 'steemhunt.com'   ← הסרת ההערה = ניקוי מלא (8/8)
];
const SNAP = 'hc-snapshot.json';

function rpc(method, params) {
  const body = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 });
  return new Promise((res, rej) => {
    const req = https.request(
      { host: RPC_HOST, path: '/', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      r => { let d = ''; r.on('data', c => (d += c));
             r.on('end', () => { const j = JSON.parse(d); j.error ? rej(new Error(JSON.stringify(j.error))) : res(j.result); }); });
    req.on('error', rej); req.write(body); req.end();
  });
}
const getAccount = async () => (await rpc('condenser_api.get_accounts', [[ACCOUNT]]))[0];

const cmd = process.argv[2];
(async () => {
  if (cmd === 'prepare') {                                  // מכונה מחוברת — אין מפתחות
    const [account, dgpo] = await Promise.all([
      getAccount(), rpc('condenser_api.get_dynamic_global_properties', [])]);
    fs.writeFileSync(SNAP, JSON.stringify({ account, dgpo, at: dgpo.time }, null, 2));
    console.log('account_auths לפני:', account.posting.account_auths.map(([n]) => n));
    console.log('snapshot →', SNAP);
  }

  if (cmd === 'sign') {                                     // מכונה מנותקת — WIF מוקלד ידנית
    const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
    const a = snap.account;
    const posting = {
      weight_threshold: a.posting.weight_threshold,         // לא לגעת בסף
      key_auths: a.posting.key_auths,                       // מפתח-posting נשאר
      account_auths: a.posting.account_auths.filter(([n]) => !REVOKE.includes(n))
    };
    if (posting.account_auths.length === a.posting.account_auths.length)
      throw new Error('אין מה לשלול — בדוק את REVOKE');
    const op = ['account_update', {
      account: ACCOUNT,
      owner: a.owner,                          // נשמר בדיוק כפי שהוא — אסור לשנות
      active: a.active,                        // נשמר
      posting,                                 // השדה היחיד שמשתנה
      memo_key: a.memo_key,                    // נשמר
      json_metadata: a.json_metadata           // נשמר — לא לאבד את הפרופיל
    }];
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('הקלד WIF-owner (לא נשמר, לא נרשם): ', wif => {
      rl.close();
      const trx = {
        ref_block_num: snap.dgpo.head_block_number & 0xFFFF,
        ref_block_prefix: Buffer.from(snap.dgpo.head_block_id, 'hex').readUInt32LE(4),
        expiration: new Date(Date.parse(snap.dgpo.time) + 3600e3).toISOString().slice(0, 19),
        operations: [op]
      };
      const signed = steem.auth.signTransaction(trx, [wif]);   // chain_id ברירת-מחדל = mainnet
      fs.writeFileSync('hc-signed-tx.json', JSON.stringify(signed, null, 2));
      console.log('חתום → hc-signed-tx.json | account_auths חדש:',
        JSON.stringify(signed.operations[0][1].posting.account_auths));
      process.exit(0);                                          // ה-WIF לא נוגע לדיסק
    });
  }

  if (cmd === 'broadcast') {                                // מכונה מחוברת — אין מפתחות
    const trx = JSON.parse(fs.readFileSync('hc-signed-tx.json', 'utf8'));
    console.log('שידור:', JSON.stringify(
      await rpc('network_broadcast_api.broadcast_transaction', { trx, max_block_age: 3600 })));
    // חלופה: condenser_api.broadcast_transaction עם params [trx]
  }

  if (cmd === 'verify') {                                   // מכונה מחוברת — אימות סופי
    const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
    const now = await getAccount();
    const names = now.posting.account_auths.map(([n]) => n).sort();
    const expect = snap.account.posting.account_auths
      .map(([n]) => n).filter(n => !REVOKE.includes(n)).sort();
    const checks = {
      'ההרשאות שנשללו בדיוק': JSON.stringify(names) === JSON.stringify(expect),
      'owner key לא שונה': JSON.stringify(now.owner.key_auths) === JSON.stringify(snap.account.owner.key_auths),
      'active key לא שונה': JSON.stringify(now.active.key_auths) === JSON.stringify(snap.account.active.key_auths),
      'posting key לא שונה': JSON.stringify(now.posting.key_auths) === JSON.stringify(snap.account.posting.key_auths),
      'memo_key לא שונה': now.memo_key === snap.account.memo_key,
      'ה-op אכן בוצע (last_owner_update התעדכן)': now.last_owner_update !== snap.account.last_owner_update,
      'סף posting לא שונה': now.posting.weight_threshold === snap.account.posting.weight_threshold
    };
    let ok = true;
    for (const [k, v] of Object.entries(checks)) { console.log(v ? 'PASS' : 'FAIL', '—', k); ok = ok && v; }
    process.exit(ok ? 0 : 1);
  }
})();
```

### 5.5 רשימת אימות אחרי השידור

| בדיקה | צפי |
|---|---|
| `posting.account_auths` בהתרעת `get_accounts` | רק `steemhunt.com` (או ריק בניקוי מלא) |
| `owner.key_auths[0]` | זהה ל-snapshot — המפתח **לא** הוחלף |
| `active.key_auths[0]`, `posting.key_auths[0]`, `memo_key` | זהים ל-snapshot |
| `last_owner_update` | השתנה מ-1970-01-01 לתאריך הביצוע (הוכחת `account_update`) |
| `posting.weight_threshold` | 1 — ללא שינוי |
| לוג השרשרת (`get_ops_in_block` על הבלוק) | op `account_update` אחד, עם ההרשאות הצפויות |

### 5.6 אם בעתיד יופיעו `account_auths` ב-active או ב-owner

| מה מופיע | משמעות | פעולה |
|---|---|---|
| active `account_auths` לאפליקציה | גוף זר יכול **להזיז כסף** | הסרה מיידית באותו נוהל (הסקריפט — אותו op `account_update`, מסנן את הרשימה הנכונה); אם לא ידוע מי הוסיף — התייחס כפריצה: החלף active גם כן |
| owner `account_auths` לאפליקציה | גוף זר יכול **להחליף את כל המפתחות** — פריצה מלאה | שלילה + **רוטציית owner מיידית** באוויר-גפ (אותו op, עדכון key_auths של owner); שקול אחזור חשבון אם השליטה הועברה |
| posting `account_auths` חדשות | הוספה בזדונית/מחדשת | אותו נוהל; אם אפליקציה ששללת "חזרה" — היא איננה יכולה בעצמה: משהו עדיין מחזיק posting/owner → חקור ורוטט posting |

הערה-היגיינה: גם אפשרות שינוי `recovery_account` (op `change_recovery_account`, owner, נכנס לתוקף לאחר 30 יום — לאומת מול הצ'יין) היא שדרוג עתידי: חשבון-אחזור שאתה שולט בו במקום `steem`. מומלץ רק לאחר שowner קר ויציב.

---

## 6. ארכיטקטורת מפתחות לפלטפורמה — BOT-1..9

מיפוי מפרטי הבוטים מ-`EXECUTION_PLAYBOOK.md` למפתח, למקום-המגורים של המפתח ולתקרת-החשיפה:

| בוט | Ops (מה-Playbook) | מפתח נדרש | היכן המפתח חי | תקרת חשיפה |
|---|---|---|---|---|
| BOT-1 · שכירות SP | `delegate_vesting_shares`, `transfer` | Active | שרת מבודד | ≤70% מה-SP מושכר; נזילות מינימלית; ההרשאה חוזרת ב-5d |
| BOT-2 · Curation | `vote` | **Posting בלבד** | שרת חם (רוטציה מיידית) | אפס הון |
| BOT-3 · המרת SBD | `convert`, `limit_order_create` | Active | שרת מבודד | ≤30% מה-SBD בו-זמנית |
| BOT-4 · פער בין-מקומי | `limit_order_create` | Active | שרת מבודד | $15K/מחזור |
| BOT-5 · Market maker | `limit_order_create`/`cancel` | Active | שרת מבודד | 50/50 מלאי; עצירה ב-spread < 1.5% |
| BOT-6 · SPS | `create_proposal`, `update_proposal_votes` | Active | שרת מבודד (משותף עם BOT-1) | אפס — פעולות-גוברננס בלבד |
| BOT-7 · בורר Escrow | `escrow_approve`, `escrow_release` | Active | שרת מבודד | עמלות בלבד; רק חוזים מרוטיפיקציה |
| BOT-8 · L2+תחרויות | `comment`, `custom_json` | **Posting בלבד** | שרת חם | אפס הון |
| BOT-9 · היגיינה | `claim_reward_balance` (posting); `limit_order_cancel`, ניקוי-delegation (active) | Posting + Active | posting חם; active-ops דרך חשבון-בוט ממומן זעיר | תקרת-מסה יומית זעירה |
| @headcorner (ראשי/אוצר) | הכל, לעיתים רחוקות | Owner **קר** (אוויר-גפ); posting לטענות/תחזוקה | Owner: מכונה מנותקת בלבד; posting: שרת חם | Owner לעולם לא חם; נזילות מינימום; עודף → SP/חיסכון |

**טופולוגיה:** headcorner = אוצר + בנק-RC (claim_account + delegate_rc). הבוטים = חשבונות-משנה זולים (סעיף 4) שכל אחד מחזיק רק את המפתח המינימלי לתפקידו. ה-kernel של SAOS (מצב live) חותם לפי אותה מטריצה: emit → בדיקת הרשאה → המפתח המתאים לפי מיקום-האחסון.

---

## 7. חוקי-זהב

1. **Owner לעולם לא אונליין.** מכונה מנותקת, הקלדה ידנית, לעולם לא בקובץ/סביבה/היסטוריה. כל פעולת-owner עוברת את הנוהל של סעיף 5.
2. **מפתח-posting הוא מפתח-הבוטים.** כל אוטומציה שלא מזיזה כסף (תוכן, קורצ'ן, L2) רצה עליו — חם על השרת, ומוחלף בדקות מבלי לגעת בשום דבר אחר.
3. **Active רק על מכונה מבודדת** עם תקרת-מסה יומית שאכופה בקוד (לא בראש); אין active על השרת הציבורי, גם לא "רק לבדיקה".
4. **רוטציה אחרי כל חשד:** posting/active מתחלפים דרך owner באוויר-גפ; אם owner חשוד — מיד נוהל אחזור פעיל (חשבון-אחזור + חלון 30 יום) ולא "ממתינים לראות".
5. **היגיינת memo:** מפתח-memo חושף התכתבויות, לא כסף — לא לשתף עם שירותים; מסרי בורסה תמיד עם `#` (מוצפן); memo ללא `#` נשלח פתוח לכל הרשת.
6. **חשבונות-אוצר ללא סף-חלש:** threshold של 1 עם מפתח יחיד מקובל רק כשהחשבון עצמו ממוסגר (נזילות מינימום, עודף ל-SP/חיסכון); לאוצר גדול — 2-of-2 עם המחיר שלו, או חשבון-משנה ממומן במסה מוגבלת.
7. **כל `account_auths` נבחן רבעונית** ומה שלא בשימוש נשלל באוויר-גפ (סעיף 5). לעולם לא ניתן active/owner לאפליקציה — זו אינה "הרשאה", זו מסירת-החשבון.
8. **צי-משנה במקום חשבון-אל:** לכל תפקיד-בוט חשבון זול משלו + delegate_rc מהאוצר. פריצה של בוט = נזק של בוט.
9. **לפני כל פעולת-כסף:** רוב משני מקורות-RPC + כתיבה ל-OpLog + audit יומי — בדיוק כמו בסימולציה, בלי קיצורי-דרך.
10. **סימולציה קודמת ל-live:** שום מפתח אמיתי לא נולד על שרת-פיתוח; רוטציה שגרתית: posting — זולה ותכופה; active — תקופתית; owner — רק בתגובה לצורך/חשד.

---

*נמדד חי מ-`api.steemit.com` (קריאות בלבד), על פי שעון השרשרת 2026-09-01. פריטים שסומנו "לאומת מול הצ'יין" ייבדקו מול קוד המקור/steem-js בעת האינטגרציה — לפני כל שימוש בפעולת-כסף.*
