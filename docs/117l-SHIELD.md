# 117l — THE-SHIELD: דוקטרינת-האבטחה ומנוע-ההגנה
**תאריך**: 2026-09-08 · **מנדט**: "עכשיו כשאנחנו מחוברים לכל הרשתות — להבין פישינג, טוקנים מתחזים, וכל מה שמסכן אותנו על רשתות חכמות — שלא נשתמש בטעות בקוד זדוני. חדשנות + יכולות + הגנה מגנבים."

---

## 1. מודל-האיום (המפה המלאה של מה שמנסה לגנוב מאיתנו)

| # | איום | איך-זה-נראה | הגנה-ממומשת |
|---|------|-------------|--------------|
| T1 | **טוקן-מתחזה** | חוזה-חדש עם שם/סימול מפורסם ("USDT" מחוזה-זר), תווים-מטעים (С-רוסית, ɑ-יוונית), דצימלים-חריגים | `checkToken`: רישום-קאנוני (הכתובת-היא-האמת) · נורמליזציית-confusables · levenshtein≤2 מול-16-שמות-מפורסמים → BLOCK |
| T2 | **חוזה-זדוני** | פונקציות-טיהור ב-bytecode: `mint`, `setOwner`, `blacklist`, `pause`, `setTaxes`, `setMaxTxAmount` | סריקת-bytecode מול 14 סלקטורים (keccak-בזמן-ריצה — אין-טבלאות-מיושנות) → ניקוד-מצטבר |
| T3 | **חיקוי-דלת (פישינג-העברה)** | כתובת-גיטימית שנבחרה-להידמות לדלת שלנו — הצגת `TVkH6fq…5zkhjL` מטעה | `checkAddress`: prefix≥6 → BLOCK · ראש≥4+זנב≥3 → BLOCK · lev≤3 → BLOCK מול **כל 20 הדלתות** |
| T4 | **אישור-לא-מוגבל** | `approve(spender, 2²⁵⁶-1)` = הרשאת-משיכה-נצחית מהארנק · `setApprovalForAll` | `guardTx`: פענוח-סלקטור + זיהוי-approve-ללא-תקרה → BLOCK חד-משמעי · approve-עם-תקרה → מאושר |
| T5 | **ממו-פישינג** | "URGENT claim airdrop", דומייני-חיקוי-מותג (`steemitwallet-claim.xyz`), בקשות-מפתחות | `scanMemo`: רשימת-דומיינים-מותרים · 12 מילות-גיוס · זיהוי-צורת-סודות → BLOCK |
| T6 | **רעש-מהירות** | relay-spam שמנפח רוחב-פס/אנרגיה מהדלתות שלנו עד-שריפת-הכיסוי | `velocityCheck`: 8+/10min → WARN · 12+/10min → BLOCK (ledger-חי) |

**תגלית-דוקטרינה (מהמעבדה)**: base58check שובר החלפות-1-3-תווים בכתובות (checksum!) — לכן עוקץ-ההעברה האמת על TRON הוא **חיקוי-תצוגה** (vanity-gen של קידומת), והגלאי-שלנו בנוי-לזה. הוכחה: בנינו כתובת-תקפה `TVkH6fqiaRj2k4MEkd8Rdefqod1DDsreCv` (קידומת-28-משותפת עם המנפיק) → BLOCK-80.

## 2. הארכיטקטורה

```
sovereign/node/shield.cjs          ← המנוע (רישום+גלאים+למידה+CLI)
  ├── checkToken(addr)             T1+T2 · ריבוי-מארחים (3) · measured-flag
  ├── checkAddress(addr)           T3 · 20-דלתות · מוניטין-חיצוני best-effort
  ├── guardTx({to,data,value})     T4 · פענוח-סלקטור · נמען-פנימי-מפוענח-ונבדק
  ├── scanMemo(text)               T5 · URL/מילים/מותג/סודות
  ├── velocityCheck()              T6 · חלון-10-דק'
  ├── guardRelay(r)                ← השער-שה-relay קורא-לו לפני-כל-ביצוע
  ├── posture()                    דוח-עמדה חי
  └── selftest()                   9 בדיקות-ניצבות → ALL-GREEN 9/9
sovereign/node/security-state.json ← רשימות-אסורים/מותרים נלמדות + stats + velocity
sovereign/node/security-events.jsonl ← אודיט מלא (אירוע·נימוק·פסיקה)
```

**פסיקה**: score≥60 → **BLOCK** (הדלת-לא-נפתחת) · 20..59 → **WARN** (מבוצע-עם-רעש-כנה) · ≤19 → **ALLOW**.
**דוקטרינות שנשמרות**: אין-אמת-חלקית (לא-נמדד ≠ נקי → WARN-כנה) · אפס-מפתחות (המגן קורא רק נתוני-רשת-ציבוריים) · כל-אירוע-מאודיט · למידה-עצמית (כל-BLOCK נחרט-ל-denylist).

## 3. הכשרת-השטח (חיווט-לנתיב-הכסף)

`relay.cjs executeRelay` — כל-ביצוע-דלת (steem/tron/blurt) עובר **חובה** דרך `SHIELD.guardRelay` + `markActivity` לפני-כל-חתימה:
```js
const gate = await SHIELD.guardRelay(r);
if (gate.verdict === 'BLOCK') throw new Error('shield-BLOCK: ' + gate.reasons.join(';'));
if (gate.verdict === 'WARN') dlog('SHIELD ⚠ ' + r.ref + ' :: ' + gate.reasons.join(';'));
SHIELD.markActivity(r.via, r.ref);
```
guardian-respawn אומת: relayer-חי-עם-השער (pid 7045 · passes-תקינים · sent=9).

## 4. הוכחות-ביצועים (הכל חי, אפס-סימולציה)

1. **selftest → ALL-GREEN 9/9** — חיקוי-דלת נבנה+נחסם · own-door ALLOW · checksum-שגוי BLOCK · approve-לא-מוגבל BLOCK · approve-עם-תקרה לא-BLOCK · ממו-פישינג BLOCK · ממו-נקי ALLOW · velocity-spam BLOCK
2. **USDT-קאנוני-חי** → ALLOW · measured=true (רשת-אמת)
3. **דלת-הפקדות-רשמית TG6Srs** → ALLOW (own-door)
4. **חיקוי-חי `TVkH6fqiaRj2k4MEkd8Rdefqod1DDsreCv`** → BLOCK-80 (prefix=28 + learned-denylist)
5. **live-fire guardRelay**: פריים-ממאיר (payload-פישינג) → BLOCK-100 עם 5 נימוקים · פריים-נקי → ALLOW

## 5. הדרכת-סוכנים (איך עובדים-עם-המגן)

**לפני כל חתימה/אינטראקציה חדשה:**
```bash
node sovereign/node/shield.cjs check-token  <חוזה>   # בחירת-טוקן — רק ALLOW/WARN-מוצדק
node sovereign/node/shield.cjs check-address <כתובת> # יעד-חדש — BLOCK=אסור-לשלוח
node sovereign/node/shield.cjs guard <to> [data]     # טרנזקציה-מתוכננת
node sovereign/node/shield.cjs scan-memo "<ממו>"     # תוכן-יוצא/נכנס
node sovereign/node/shield.cjs posture               # דוח-עמדה מלא
node sovereign/node/shield.cjs selftest              # בריאות-המגן
```
**למידה**: `learn-deny <addr>` אחרי-אירוע-ממשי · `learn-allow <addr>` לשותפים-מאומתים.
**כלל-אצבע-לסוכנים**: כתובת-שלא-ציינו-אנחנו → WARN-כברירת-מחדל (נדרש-אישור-מפעיל) · טוקן-ששמו-מפורסם-וכתובתו-לא → BLOCK · אף-פעם לא מאשרים-approve-ללא-תקרה.

## 6. עמדה-ופתוחים

**נסגר-היום**: מנוע-ההגנה + שער-בנתיב-הביצוע + 20-דלתות-מוגנות + למידה-עצמית + 9/9.
**ידוע-ומתועד**:
- רשימת-המוניטין-החיצונית (TronScan) best-effort — כשל-שירות → unmeasured (לא חוסם, מתועד-כנה)
- `watch`-מצב-מובנה (לולאת-10-דק') — טרם-שולב-ב-guardian-fleet (המנוע-כבר-חי-בנתיב-ה-relay; שילוב-דמון-רשות)
- `wallets-registry.json` מכיל pk-גזורים (0600+gitignored — לא-בגיט מעולם) — הידוק-עתידי: גזירת-pk-מהרישום, נגזר-על-דרישה-דרך-הכספת
- הרחבות-הבאות: שער-guardTx-על-נתיב-broadcast-עתידי (חובה-לפני-הצתתו) · סריקת-טוקנים-בהפקדות-נכנסות · denylist-משותף-בין-סוכנים-דרך-הספר

---
**המוסר**: חיבור-להכל בלי מגן = חיבור-לכל-הגנבים. מעכשיו כל-דלת-נפתחת-רק-דרך-המגן.
