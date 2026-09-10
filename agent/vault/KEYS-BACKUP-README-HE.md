# 🔐 גיבוי-מפתחות ריבוני — 2026-09-09 (תקרית 117o)

> **מסמך זה אינו מכיל סודות.** הקובץ המוצפן לצדו מכיל את כל-המפתחות.
> **מדיניות-משמורת-מערכת (הוראת-מפעיל 2026-09-10)**: הסיסמה מאוכסנת בעתה
> ב-`agent/recovery-meta.json` בריפו-הפרטי (`keysBackupPass`) — משמורת-מערכת
> מלאה, ללא-תלות בהמשכיות-שיחה. הגרדיאן מאמת-פתיחות-ארכיונים בכל-טיק.

## מה יש בקובץ `KEYS-BACKUP-2026-09-09.tar.enc`

| קובץ | תוכן |
|---|---|
| `agent/keys/vault.json` | **11 חיילי-הצבא** (cashmachine, haran, israelnews, lsa, macrame, siq, tov, wic, wog, woq, ynet) — WIF מלא ל-owner/active/posting/memo, שתי השרשרות |
| `agent/keys/wallets-seed.json` | **השורש-הריבוני** (SOVEREIGN ROOT) — ממנו נגזרות כתובות-HD |
| `agent/keys/wallets-registry.json` | **120 כתובות-HD** — EVM (7 רשתות) + TRON + SOL + BTC, כל-המשתמשים |
| `agent/keys/tron-mnemonic.txt` | המנמוניק-הריבוני (דלתות sov:0..5) |
| `agent/keys/tron-legacy-mnemonic.txt` | המנמוניק-הישן (דלתות legacy:0,1) |
| `agent/keys/vault.enc` | כספת-V1 מוצפנת |
| `agent/keys/key-broker.token` | טוקן-גישה לשער-החתימה (3040) |
| `agent/.env` | WIFs של @headcorner **מלפני-ההסבה** (מתים-מול-השרשרת, אך הם רשות-ה-owner-האחרונה — נדרשת-לתרחיש-התאוששות) |
| `agent/fleet_keys.enc` + `fleet_keys.meta.json` | חותמת-הצי (AES-256-GCM) + סיסמתה |
| `agent/rotation_evidence.json` | עדות-הסבת @ynet (2026-09-04) |

## איך מורידים ופותחים

1. **הורדה**: GitHub → repo `roshpinacare-sys/steem` (פרטי) → תיקיית `agent/vault/` → `KEYS-BACKUP-2026-09-09.tar.enc` → Raw/Download.
2. **אימות-שלמות**:
   ```bash
   sha256sum KEYS-BACKUP-2026-09-09.tar.enc
   # מצופה (רענון-117p עם-המפתחות-המשוחזרים): 5753a90cdad893b2008e6a6abb4407d2a354ec89ac6be39adf6ea1d526fa8ac4
   ```
3. **פענוח** (הסיסמה — מהצ'אט):
   ```bash
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 300000 \
     -in KEYS-BACKUP-2026-09-09.tar.enc \
     -out keys-bundle.tar.gz -pass pass:הסיסמה-מהצ'אט
   tar xzf keys-bundle.tar.gz
   ```
   פענוח על מכונה-אוויר-גפ' מומלץ. הסיסמה אינה נשמרת בשום קובץ.

## ⚠️ מה שאין בגיבוי — ולמה

**המפתחות-החיים הנוכחיים של @headcorner** (שהוחלפו ב-2026-09-08 21:17 UTC ע"י סוכן) **לא נמצאים בשום מקום במערכת** — הסוכן-המסובב לא השאיר אותם ב-.env, בכספת, בחותמת, בעדות או בגיט. פירוט-מלא: `docs/117o-KEY-INCIDENT.md`.

## דוקטרינה

- אף-מפתח-פרטי לעולם לא בגיט בצורה-גלויה — רק גוש-מוצפן + סיסמה בערוץ-נפרד.
- מי שמסובב מפתחות **חייב להציב את החדשים בכספת לפני השידור** (vault-first) — מיושם-מעתה ב-`keyrotate.cjs`.
