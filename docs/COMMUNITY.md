# הקהילה-הריבונית · COMMUNITY DOSSIER — hive-457262

**השאלה של-המפעיל (R254, מילולי): "האם פתחת קהילה ראיתי ששולמו 3 סטים לא יודע לאן זה מתועד בגיט אני מקווה"** — התשובה המתועדת כאן ובשרשרת: כן, וכאן כל-הראיות.

## 1 · מה-שולם ועל-מה (האמת-מהשרשרת, לא מהממשק)

| פריט | ערך-מדוד | מקור |
|---|---|---|
| עלות-יצירת-קהילה אמת | **3.000 STEEM** (ה-"100 STEEM" = מיתוס-ממשק) | `condenser_api.get_chain_properties` → `account_creation_fee` |
| עסקת-התשלום (fee-tx) | **`f526d3c0ff343257750d85c2c758a98b9d61981b`** | השרשרת, 2026-10-07T21:28:21Z |
| יתרה-מדודה | 13.494 → **10.494 STEEM** (חיתוך-חי) | get_accounts לפני/אחרי |
| עסקת-הגדרות | `6559ec692b5da4e523adc8e864ac2c1503dbfdc5` (setRole admin=headcorner + updateProps) | custom_json(id=community) |
| פוסט-מייסד | `77c21a926c9623d16c7041f8df75b386660d0617` · headcorner/sovereign-builders-is-open-founding-2026-10-07 · 703 מילים | comment-op חי |

## 2 · הקהילה

- **שם**: `hive-457262` — **"Sovereign Builders · בוני-ריבונות"**
- **מנהל**: headcorner (המפתחות נוצרו-רנדומלית, נשמרו-ב-0600: `.secrets/community-keys.json` — נכנס-לכספת-GEN-3 הבאה)
- **חברים**: 14/14 מהצי הצטרפו (subscribe custom_json — פורמט נמדד-מהיסטוריה): cashmachine, haran, israelnews, lsa, macrame, siq, tov, wic, wog, woq, hcsoldier4, hcsoldier5, hcsoldier6, headcorner. אפס-כשלים.

## 3 · איך-הפעילות זורמת-לשם (R254: "נעשה את זה מרוכז")

- **מסילת-קהילה 1:1** — כל-פוסט-שני של-כל-חשבון נכנס-הביתה (metadata.community + tags[0]=hive-457262 — חוזה-ה-hivemind). היה 1:2 ב-R246; המפעיל ביקש ריכוז.
- **סיבוב-קהילה-חד-פעמי** (`state/community-round.json`): כל-14-חשבונות פוסט-הבא שלהם נוחת בבית עד-09.10 10:57Z — ריכוז-מלא-מהפעלה-ראשונה.
- **חוקי-התוכן בתוך-הקהילה** = docs/SPAMINATOR-DOCTRINE.md §3: עבודה-מקורית, מדידות, סיום-בשאלה, 300+ מילים, תגים-כנים.
- **תמונות-חוקיות** (R254): Wikimedia Commons בלבד (PD/CC0/CC-BY/CC-BY-SA) + שורת-קרדיט-מחייבת בגוף + metadata.image — `illustrate.mjs`.

## 4 · איפה-זה חי בקוד (לביקורת)

| קובץ | תפקיד |
|---|---|
| `mini-services/saos-engine/community.mjs` | בוני-ops טהורים + מילסטונים אידמפוטנטיים |
| `mini-services/saos-engine/army-social.mjs` (doPublish) | הזרמת-פוסטים הביתה (1:1 + סיבוב) + תמונות |
| `mini-services/saos-engine/state/community.json` | המדינה החיה (txids, phase, members) |
| `docs/measured/convert-and-community-r246.md` | הפורנזיה-המקורית של-ה-3-STEEM |
