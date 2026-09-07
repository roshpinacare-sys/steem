# מפתחות Steem — מה בעצם ניתן לעשות איתם (מדוד חי)

> המסמך המכונן על יכולות-המפתח ב-SAOS. **המטריצה המרכזית נמדדה חי מהרשת** בתאריך המדידה
> באמצעות `condenser_api.get_potential_signatures` על חשבון-עדות אמיתי (justyy) —
> לא מסמכים ישנים ולא ניחושים. הניסוי: `scripts/key_authority_probe.py`,
> תוצאות גלמי: `scripts/key_authority_results.json`.

---

## 1. ארבעת המפתחות — מה כל אחד שווה

| מפתח | סמכות | אם דולף — הנזק | מדיניות אחזקה ב-SAOS |
|---|---|---|---|
| **Owner** | הכול + שינוי כל ההרשאות + שחזור חשבון | קטסטרופלי, בלתי-הפיך | **קר** — נייר/כספת, לעולם לא על שרת |
| **Active** | כל הכסף, המסחר, ה-DAO, העדים | ריקון יתרה בדקות | **חם-מוגבל** — שרת מבודד + תקרת-מסה יומית |
| **Posting** | תוכן, הצבעות, custom_json, תביעת-פרסים, פרופיל | ספאם בשמך — מסוכן אך לא מזיז כסף | **חם** — על שרתי האפליקציות, החלפה מיידית |
| **Memo** | רק הצפנת/פענוח הודעות מוצפנות | חשיפת תוכן הודעות | חם או קר לפי שימוש |

- **קריפטוגרפיה**: secp256k1 (ECDSA), WIF-compressed, קידומת `STM`; גזירה מ-Brain-Key
  ל-4 תפקידים נפרדים; יחסי owner ⊇ active ⊇ posting (owner תמיד יכול לחתום על הכול).
- **אין "גז"**: המפתח לא שולם עלות-פעולה — ה-RC של החשבון הם המשאב. מפתח בלי SP = מפתח חנוק.

---

## 2. המטריצה המדודה — איזה מפתח מבצע מה (32 בדיקות חיות)

### 2.1 רמת **POSTING** — "אפליקציית התוכן וה-L2" (אפס סיכון הון)
| Op | שימוש ב-SAOS |
|---|---|
| `vote` | BOT-2 curation אוטומטי |
| `comment` | תוכן, תשובות, BOT-8 |
| `delete_comment` | ניקוי |
| `comment_options` | ניהול payouts (beneficiaries דרך extensions) |
| `claim_reward_balance` | BOT-9 היגיינה — **התגלית: posting מספיק!** |
| `custom_json` (required_posting_auths) | **כל ה-L2**: קהילות, הצבעות-טוקן, משחקים, KG |
| `account_update2` | עדכון פרופיל/meta — posting מספיק |

### 2.2 רמת **ACTIVE** — "הבנק, המסחר, ה-DAO" (כל הכסף)
| קבוצה | Ops |
|---|---|
| העברות | `transfer`, `transfer_to_vesting`, `withdraw_vesting`, `delegate_vesting_shares` |
| חיסכון | `transfer_to_savings`, `transfer_from_savings`, `cancel_transfer_from_savings` |
| שוק | `limit_order_create`, `limit_order_cancel` |
| המרה | `convert` |
| Escrow | `escrow_transfer`, `escrow_approve`, `escrow_release`, `escrow_dispute` |
| DAO/SPS | `create_proposal`, `update_proposal_votes`, `remove_proposal` |
| L2-כספי | `custom_json` (required_auths) — העברות טוקני SE, NFT trades |
| חשבונות | `claim_account` (יצירת חשבונות סבסוד) |
| ניהול-עדים | `witness_update`, `feed_publish`, `witness_set_properties`* |
| ממשל-עדים | `account_witness_vote`, `account_witness_proxy` — **התגלית: דורש active!** |

### 2.3 רמת **OWNER** בלבד
| Op | משמעות |
|---|---|
| `decline_voting_rights` | ויתור על כוח הצבעה — בלתי-הפיך, לכן owner |
| `account_update` / `account_create` | שינוי הרשאות עצמן, יצירת חשבון-מפתח |
| שחזור חשבון | תקופת התאוששות 30 יום אחרי גניבת owner |

> *`witness_set_properties` החזיר 0 מפתחות בבדיקה (מקרה-קצה עם props ריקים) — לאימות ממוקד בעת הפעלת עד.

### 2.4 תובנות מהמטריצה שמשנות ארכיטקטורה
1. **כל BOT-2 (curation), BOT-8 (L2/תחרויות), BOT-9 (היגיינה) רצים על posting-key בלבד** —
   ניתן להריץ אותם על שרת זול ללא כל חשיפת-הון. דליפה = ספאם, לא גניבה.
2. **רק BOT-1/3/4/5/7 צריכים active** — ולכן הם על חשבון-הון נפרד עם תקרת-מסה יומית.
3. **הצבעת עדים דורשת active** — כלי-ממשל שלנו לא ירוצו על שרתי-תוכן.
4. `claim_reward_balance` על posting → בוט-ההיגיינה יכול לרוץ על חשבון-התוכן.

---

## 3. מה עושים עם המפתח — להשיג, לפתח, לעשות

### 3.1 להשיג (הכנסה — ממופה ל-EXECUTION_PLAYBOOK.md)
- **Posting בלבד** (חשבון-תוכן): curation trails, תוכן/תחרויות, custom_json L2-farming, תביעת-פרסים.
  → החשבון הזה לעולם לא מחזיק מסה נזילה; כל הרווחים מועברים החוצה באופן שגרתי.
- **Active** (חשבון-הון): שכירות SP, convert-peg, מסחר פנימי, escrow — עם מגבלות מסה.

### 3.2 לפתח (בניית אפליקציות על Steem)
- **דפוס אפליקציה למשתמשים**: אף פעם לא נוגעים במפתחות-משתמש. שתי דרכים רשמיות:
  - **SteemConnect (OAuth)** — המשתמש מאשר אפליקציה; חתימות בשרת SteemConnect לפי סקופ.
  - **Steem Keychain** — תוסף-דפדפן; חתימה מקומית אצל המשתמש.
- **דפוס הרשאת-חשבון**: אפשר להוסיף **חשבון אחר** (לא רק מפתח) ל-authority שלך:
  `posting: {account_auths: [["saos-posting-bot", 1]]}` — חשבון-בוט פועל בשמך בלי לראות מפתח.
  זה ה-mechanism ל-SAOS-multi-agent: סוכנים עם הרשאות-חלקיות לפי תפקיד.
- **Multi-sig אמיתי**: `weight_threshold > 1` + מספר מפתחות/חשבונות — קופת-SAOS ב-2-of-3.
- **custom_json = ה-SDK הפתוח**: כל פיצ'ר חדש (שוק, משחק, אורקל) = מרחב-id + סכמת-json;
  נמדד: אפשרי ברמת-posting (קריאה-בלבד) או active (כספי).

### 3.3 לעשות (מערך-תפעול יומי)
- חתימה אופליין (air-gapped) ושידור משרת מחובר — `signTransaction` + `broadcast` מופרדים.
- סבב-רוטציון: posting כל 30 יום; active כל 90 יום או מיידי בחשד; owner רק באירוע.
- בקרת-הרשאות שבועית: השוואת `get_accounts` מול תצורה-רצויה (בזק: שום דבר לא נוסף בלי ידיעתנו).

---

## 4. ארכיטקטורת המפתחות ב-SAOS (החלטה מחייבת)

```
קר (אוויר):   owner-keys של כל החשבונות            ← נייר, פעם באירוע
חם-A (תוכן):  posting-key של חשבון-תוכן            ← BOT-2/8/9, אין כסף בכלל
חם-B (הון):   active-key של חשבון-הון              ← BOT-1/3/4/5/7, תקרת-מסה יומית
memo:         מפתח-זיכרון של חשבון-הון              ← אישורי תשלום מוצפנים
```
- חשבון-תוכן וחשבון-הון **אינם מקושרים** בשום authority משותף (בידוד פריצה).
- תקרת-מסה יומית = פונקציה בקרנל: `if daily_emitted_value > cap → pause module`.
- ה-ChainAdapter במצב-live מקבל **רק** את מפתחות חם-A/חם-B מהסביבה (`STEEM_POSTING_KEY`, `STEEM_ACTIVE_KEY`) — לעולם לא נשמרים ב-repo.

---

## 5. קוד-התייחסות (steem-js 0.7.11 — נבדק קיים ב-npm)

```js
const steem = require('steem');
steem.api.setOptions({ url: 'https://api.steemit.com' });

// רמת-posting (בוט-תוכן) — הצבעה:
steem.broadcast.vote(postingWif, voter, author, permlink, weight, cb);

// רמת-active (בוט-הון) — המרה:
steem.broadcast.convert(activeWif, owner, requestId, amount, cb);

// custom_json דו-רמתי:
steem.broadcast.customJson(postingWif, [], [account], 'dw-kg', JSON.stringify(payload), cb);
steem.broadcast.customJson(activeWif, [account], [], 'dw-market', JSON.stringify(payload), cb);
```
- אימות-הרשאה לפני כל שידור (מה שהניסוי עשה ידנית): `get_potential_signatures` → התאמה ל-authorities — שכבת-הגנה מפני שליחת op במפתח הלא-נכון.

---

## 6. מה שמפתח **לא** יכול לעשות (מציאות, לא שיווק)
1. אין חוזים חכמים כלליים — הרחבה רק דרך `custom_json` (L2) או שדרוג-קונצנזוס.
2. אין הרשאה להרוויח ישירות — המפתח מבצע; הכסף מגיע ממקורות המדף (ראו EARNING_VECTORS_ANALYSIS.md).
3. owner גנוב + המתנה 30 יום = שליטה-גמורה; לכן owner קר תמיד וההרשאות נבדקות שבועית.
4. מפתח בלי SP מאחוריו = RC זעירים = בוט מרותק (מדדנו: RC גדל פרופורציונלית ל-SP).

---

*נמדד חי מ-`api.steemit.com` · ניסוי קריאה-בלבד (`get_potential_signatures`) · שום חתימה או שידור לא בוצעו.*
