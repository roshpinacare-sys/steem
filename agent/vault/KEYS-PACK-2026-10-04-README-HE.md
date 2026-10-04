# KEYS-PACK-2026-10-04 — הוראות-פענוח לסוכנים (HE)

**מה זה:** חבילת-הבעלות-המלאה על צי-החיילים — מוצפנת לגיט לפי דוקטרינת אפס-הסודות (אין מפתח-גלוי בהיסטוריה, לעולם).

## תוכן החבילה (אחרי-פענוח)
| קובץ | מה יש בו |
|---|---|
| `vault.json` | כספת-החי: **15 חשבונות** (cashmachine, haran, israelnews, lsa, macrame, siq, tov, wic, wog, woq, ynet, headcorner, **hcsoldier4, hcsoldier5, hcsoldier6**) — מפתחות 4-התפקידים, מאומתים-מול-השרשרת 4/4 (soldier_auth_audit.json) |
| `hcsoldier4/5/6.json` | קבצי-מפתח-פרטניים לדור-החלופי (owner+posting+active+memo) |
| `wallets-registry.json` | רישום-הצי |
| `MANIFEST.txt` | sha256-פר-קובץ |

## פענוח
```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in KEYS-PACK-2026-10-04-r20a.zip.enc \
  -out KEYS-PACK.zip \
  -pass 'pass:<הסיסמה-שתועבר-ע"י-הבעלים-בערוץ-חוץ>'
unzip KEYS-PACK.zip && sha256sum -c <(grep -v '^#' MANIFEST.txt | sed 's|agent/keys/||')
```
- הסיסמה **לא-נמצאת-בגיט** — הבעלים מוסר-אותה-לסוכנים בערוץ-חוץ (צ'אט/מסירה-ישירה).
- אחרי-פענוח: מקמו-את-הקבצים ב-`agent/keys/` (gitignored) והריצו `node agent/soldier_auth_audit.cjs` — חייב 4/4-MATCH לכל-חשבון-פעיל.

## האמת-על hcsoldier1/2/3 (מאומת-על-השרשרת 2026-10-04)
- נוצרו 2026-09-29, owner=מפתח-בלבד, `owner_account_auths=[]` — **ל-headcorner אין-שום-סמכות** עליהם.
- המפתחות-המקוריים הוכרזו LOST-NO-CUSTODY לאחר-סוויפת-ראיות-מלאה (768-גזירות · דיסק · גיט · Actions · שתי-כספות) — **בלתי-ניתנים-לשחזור-קריפטוגרפית**.
- **הדור-החלופי hcsoldier4/5/6 נטבע-על-השרשרת 2026-10-04 15:25–15:26** (account_create בתשלום 3 STEEM כ"א ע"י headcorner, txids fb3a9be3…/9e37b385…/1c3aa596…) עם **עוגן-חילוץ headcorner ב-owner** — כך-שמעתה-ולעד יש-נתיב-התאוששות גם-אם-מאגר-מקומי-יאבד.
- hcsoldier1/2/3 נשארים-על-השרשרת-כהוכחת-העבר — לא-משמשים, לא-מקושרים, אין-להם-גישה.

## כללי-זהב
1. המפתחות-חיים-רק-ב-`agent/keys/` (מחוץ-לגיט) — בגיט רק-מוצפן.
2. שינוי-סמכויות-רק-דרך-עוגן-ה-owner של headcorner.
3. כל-חייל-חדש-נטבע-עם-עוגן-חילוץ-מיד (חוק-מ-R44).
