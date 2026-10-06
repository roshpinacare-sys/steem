# כספת-המפתחות של THE WEAVE (r180)

> דבר-המפעיל שבנה-את-זה: "ה-owner תמיד יכול לתת לך את כל המפתחות. תמשיך
> ואטום הכל בכספת לסוכנים שיוכלו להשתמש תמיד" (2026-10-03).

## החוקים

1. **מפתח-לעולם-לא-ב-argv** — קבלה-רק-דרך stdin. argv נשאר-בהיסטוריית-פקודות.
2. **מפתח-לעולם-לא-בלוג/בדוח** — רק טביעות-אצבע-ציבוריות (מפתח-ציבורי/כתובת/digest).
3. **המטריאל-חי-רק-ב-blob המוצפן** — scrypt(2^14)+aes-256-gcm, פורמט-הבית
   (WEAVE-KEYRING-1). ה-blob בגיט-וחסר-ערך-בלי-המשמרת.
4. **משמרת-מאסטר-אחת** — שרשרת `WEAVE_KEYRING_PASS || WEAVE_SEAL_PASSPHRASE || MAIN_KEY`
   (כמו-התאומים). ה-owner-מנהל-סוד-אחד לכל-הבית.
5. **סינון-בשער** — מטריאל-שטוען-להיות-מפתח-ואינו (wifToPublic/Wallet כשל)
   נדחה-בשער, לא-אחרי-החיתום.
6. **כתיבה-אטומית** — tmp+rename (R107b): הסוכנים-מעולם-לא-רואים-שבר.

## טקס-קליטה (ה-owner נותן מפתח)

```bash
export WEAVE_KEYRING_PASS=<המשמרת>
echo "<המפתח>" | bun scripts/vault-keyring.mjs add <alias> --type <steem-wif|hive-wif|evm-key|passphrase|other> --stdin --note "מקור"
bun scripts/vault-keyring.mjs list      # קבלה-ציבורית
bun scripts/vault-keyring.mjs status    # passMatch בלבד — אפס-חשיפה
```

## צריכת-סוכן (תמיד)

```bash
KEY=$(bun scripts/vault-keyring.mjs get <alias>)   # לצינור-בלבד, לעולם-לא-echo
```

עבור-הענן (Actions): מעבירים-את-המפתח-לסוד-הריפו-דרך `scripts/secret-relay.mjs`
(טופס-ה-sodium-הקיים) — הכספת-המקומית-היא-המקור, ה-Secret-הוא-העותק-לענן.

## מצב-חי (מדוד r180 · עודכן r181)

- טקס-מוכח-אנד-אנד: דחיית-זבל-בשער ✓ · קליטת-WIF-אמיתי (מפתח-ציבורי נגזר) ✓ ·
  status-passMatch ✓ · get-roundtrip ✓ · remove ✓ · self-test (AEAD דוחה-סיסמה-שגויה) ✓
- **r181 — התשובה לדבר-ה-owner ("יש לך הכל", trace 1a102dc504a2e6f9): המפתח-היה-אצלנו.**
  · כספת-הארנק המקומית (db/wallet-vault.db): **248 רשומות** — סוויטות-מלאות
    ל-headcorner/cashmachine/lsa/haran/tov/israelnews ועוד, ב-Steem/Hive/Blurt/BTC/SOL/EVM
    (`scripts/vault-inventory.mjs` — רשימה-ציבורית-בלבד).
  · **בעלות על posting של headcorner ב-Hive הוכחה** (שופט=הרשות החיה):
    `scripts/hive-key-prove.mjs` → `sovereign/vault/hive-key-proof.json` —
    entryPub ↔ derivedPub ↔ livePub (STM6u99…) · **verdict PROVED**.
  · הכספת-הענן (Domain): **HIVE_POSTING_WIF שם מאז 2026-09-23** (נמדד ב-API,
    13 סודות) — r179/r180 חיפשו את השם WEAVE_HIVE_WIF ולא ראו. קשירת-השם
    תוקנה ב-weave-anchor.ts + שני-ה-workflows.
  · דחיפה-מקומית-לענן מאומתת: PAT בעל secrets:write על Domain (probe 201/204).
