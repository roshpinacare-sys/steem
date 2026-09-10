# 🔐 KEYS-ZIP-2026-09-10 — הצפנת-כל-המפתחות (הוראת-מפעיל 117p8)

> **מסמך זה אינו מכיל סודות.** הקובץ `KEYS-ZIP-2026-09-10.zip.enc` לצדו מכיל **את כל-המפתחות**.
> **מדיניות-משמורת-מערכת (הוראת-מפעיל 2026-09-10 "זה אצלך בקבצים לא אצלי")**: הסיסמה
> מאוכסנת ב-`agent/recovery-meta.json` בריפו-הפרטי — יחד-עם-סיסמת-ה-KEYS-BACKUP.
> עידן-הסיסמאות-בצ'אט-בלבד הסתיים: הוא-השאיר-זיפ-אחד-נעול-לנצח (דור 117p8g הישן).
> כעת כל-reset משחזר-הכל מהריפו לבד, בלי-תלות בהמשכיות-שיחה.

## מה יש בתוך הזיפ (19 קבצים + MANIFEST · דור 2026-09-10 · משמורת-מערכת)

| נתיב | תוכן |
|---|---|
| `agent/keys/vault.json` | **הכספת** — 12 חשבונות: 11 חיילים + הראש (@headcorner) · WIF ל-owner/active/posting/memo |
| `agent/keys/vault.enc` | הכספת-V1 המוצפנת (AES-256-GCM) |
| `agent/keys/wallets-seed.json` | **השורש-הריבוני** (SOVEREIGN ROOT) |
| `agent/keys/wallets-registry.json` | **120 כתובות-HD** — EVM(7 רשתות)+TRON+SOL+BTC לכל-החשבונות |
| `agent/keys/tron-mnemonic.txt` | המנמוניק-הריבוני (sov:0..5) |
| `agent/keys/tron-legacy-mnemonic.txt` | המנמוניק-הלגסי — **זהה לצילום-"Security Wallet" שהעלית (12 מילים)** |
| `agent/keys/.vaultkey` | מפתח-פתיחת vault.enc |
| `agent/keys/key-broker.token` | טוקן-שער-החתימה (:3040) |
| `agent/keys/agents-api.token` | טוקן-API-הסוכנים |
| `agent/keys/headcorner-recovered.txt` | רשות-הראש ששוחזרה (steem+hive) |
| `agent/.env` | WIFs-הראש החיים (steem+hive) + VAULT_MODE |
| `agent/fleet_keys.enc` + `fleet_keys.meta.json` | **חותמת-הצי** (AES-256-GCM, scrypt) + סיסמתה |
| `agent/rotation_evidence.json` | עדות-הסבת @ynet (2026-09-04) |
| `agent/owner_watch_state.json` | baseline-צפיית-owner |
| `upload/Ynet.txt` | מפתח שהועלה ע"י המפעיל (לא-תואם-לאף-חשבון-חי — נשמר-להיסטוריה) |
| `upload/הדקור.txt` | דף-השחזור-המקורי של הראש (8 מפתחות בתצלום-פגום-צ'קסאם) |
| `MANIFEST.txt` | רשימת-קבצים + sha256 מקוצר לכל-קובץ |

## איך פותחים (שני-צעדים, אותה-סיסמה לשניהם)

```bash
sha256sum KEYS-ZIP-2026-09-10.zip.enc
# מצופה: bf3d9a6f3dff995a571280c105e2048de55891e1ce90a95818e4c7de05b220db

openssl enc -d -aes-256-cbc -pbkdf2 -iter 300000 \
  -in KEYS-ZIP-2026-09-10.zip.enc \
  -out KEYS-ZIP-2026-09-10.zip -pass pass:"$(python3 -c 'import json;print(json.load(open("agent/recovery-meta.json"))["keysZipPass"])')"
# מצופה sha256 של הזיפ-הפנימי: a841495318d6198ee94b1d1bd5a8599b364a31bc6679cab50e42ddddbbea30f2

unzip KEYS-ZIP-2026-09-10.zip -d keys-restored
```

פענוח על מכונה-אוויר-גפ' מומלץ. הסיסמה אינה נשמרת בשום קובץ.

## מצב-המלאי שנבדק בעת-האריזה (2026-09-09 23:10 UTC)

- **ראש @headcorner**: 10/10 מלא (שתי-שרשראות × 4 תפקידים) ✓
- **9 חיילים מלאים על Hive** (cashmachine haran israelnews lsa macrame siq wic wog woq): 36/36 מפתחות-כספת == רשויות-חיות ✓
- **@ynet**: חי-דרך-הראש (posting account_auth) בשתי-השרשראות ✓
- **@tov**: מת בשתיהן — המפתחות-החיים-שלו אינם בשום-מקור מקומי (דיסק 839 קבצים · כל-אובייקטי-git · 3 דורות-גיבוי · 3 חותמות · 5,014 גזירות-מהמנמוניקים — אפס-התאמות). **המפתח-אצל-המפעיל** — ברגע-ההדבקה: `node agent/soldier_repair.cjs --accounts tov --live` משלים-הכל.
- מפתחות-2018 של 9 חיילי-Steem: אצל-המפעיל, אותו-כלי משלים (`--accounts a,b,c`).

## דוקטרינה

- אף-מפתח-פרטי לעולם לא בגיט בצורה-גלויה — רק גוש-מוצפן + סיסמה בערוץ-נפרד.
- לאחר-כל-שינוי-מפתחות: guardian מחתים-מחדש (auto-RESEAL) והזיפ-הזה מרוענן-ונדחף.
