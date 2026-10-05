# R216 HARDENING — מה נבנה, מה נחסם, מה נדרש מהאופרטור

**תאריך**: 2026-10-05 · **מסגרת**: פקודת אופרטור "בצע כל מה שחסר + הוסף מה שתגלה"

## ניסיונות סמכות-שרת (נחסמו — מתועד במדויק)

| ניסיון | תוצאה | סיבה |
|---|---|---|
| PUT branch protection (saos-cockpit) | 403 | תוכנית Free: "Upgrade to GitHub Pro or make this repository public" |
| POST rulesets (force/deletion lock) | 403 | אותה מגבלת תוכנית |
| POST /user/gpg_keys (רישום מפתח חתימה) | 403 | ל-PAT אין הרשאת-משתמש לכתיבת מפתחות |

**הפקודה המוכנה** (רץ רגע ש-GitHub Pro פעיל או PAT עם Administration:write):
`PUT /repos/roshpinacare-sys/steem/branches/saos-cockpit/protection` — body: `{"required_status_checks":null,"enforce_admins":true,"required_pull_request_reviews":null,"restrictions":null,"required_linear_history":false,"allow_force_pushes":false,"allow_deletions":false,"block_creations":false}`

## פיצויים ריבוניים שבוצעו (בסמכות מכונה)

1. **חתימת קומיטים (GPG)**: מפתח ed25519 נוצר, FP `8828E34B91582C3191EA8FE63C8D59BD01322DA1`, המפתח הציבורי מוטמע במאגר (`signing/w1-signing-key.asc`) — עוגן-אימות עצמי. מהקומיט הראשון-החתום והלאה, כל קומיט של גוף זה (orchestrator + custodian) חתום (`-S`). רישום-GitHub נותר אופרטור-גייט (403).
2. **עדות-חוץ על שרשרת Steem (custody witness)**: `custom_json id=saos-git-custody-v1` — op-id **18 נקבע באמת-שרשרת** (get_transaction_hex probe, בייט 0x12; שיטת R209). סריאליזציה נוספה למקור-היחיד (steemtx.mjs) ואומתה **בייט-מול-בייט** מול הצומת. שידור ראשון: txid `3512810eb9b792b8a3a7f69d018bbd19c27623f2`, **אומת בשרשרת** בבלוק 110186627 (branch/tip/at/fp c056922c). מעתה: המשמר עוגן כל tip חדש (מקס 1/שעה) — לכל כתיבה-מחדש של GitHub תהיה עדות חוץ מטופסטמת.
3. **שער-המחשבה**: לא נגענו — custom_json אינו transfer/delegation, עבר ALLOW עם custody VERIFIED.

## עדיין אופרטור-גייט

- GitHub Pro (או מאגר-ציבורי — לא מומלץ) → הגנת-ענף מיידית עם הפקודה למעלה
- רוטציית PAT **לפני 2026-12-12** (תפוגת הנוכחי) + הוספת הרשאת-מפתחות אם רוצים רישום-GPG
- הצהרה על PROPOSED-SINGLE-WRITER-LAW.md (טיוטה מוכנה בשורש)
