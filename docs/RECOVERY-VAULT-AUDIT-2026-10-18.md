# RECOVERY-VAULT-AUDIT — 2026-10-18 · L-SEC lane receipt

> סוכן: Z.ai Code (סשן execution-fabric, trace 1a14f2a0eeaefb29) · מסלול: L-SEC (ריבונות-שחזור/כספת)
> חוק-כניסה: AGENTS.md נקרא · COLD-START בוצע · אפס-גישה-לתוכן-סודות (שמות+sha בלבד)

## הוכחות-חיות (כולן מדידות-היום, אפס-הצהרות)

| מבחן | תוצאה | ראיה |
|---|---|---|
| selftest מנוע (עותק-עבודה) | **1823/1823 PASS** (2.9s) | `mini-services/saos-engine/state/selftest-last-run.json` |
| selftest מ-clone-טרי | **1823/1823 PASS** | BOOTSTRAP-OK למטה |
| doctrine-audit | **PASS — 177 נכסים, D1-D6** | `node scripts/doctrine-audit.mjs` |
| divergence | **0/0 SYNCED** | `scripts/divergence-check.sh` |
| עוגן-שרשרת-ציבורית | **anchored:true · drift:false** | tip `1d96ed5b` · block **110545181** · `scripts/chain-anchor-probe.mjs` |
| תחייה-מגיט-בלבד | **BOOTSTRAP-OK** — clone-טרי + install + selftest, ראש `c9ef042` זהה | `scripts/sovereign-bootstrap.sh /tmp/saos-fresh` |
| שלמות-הכספת | **3/3 sha-pins MATCH** (מטה) | sha256 מול `agent/recovery-meta.json` |
| אתחול-מנוע-מ-clone-טרי | **חי — HTTP :3040, 17 מסלולים** | `/health /status /payouts /fleet ...` |

### שלמות-הכספת (בלי-פענוח — sha-pins בלבד)
- `KEYS-ZIP-2026-10-12-MASTER.zip.enc` — sha256 **MATCH** ל-keysZipSha256
- `KEYS-BACKUP-2026-09-09.tar.enc` — sha256 **MATCH** ל-keysBackupSha256
- `KEYS-SEED-2026-10-04.zip.enc` — sha256 **MATCH** ל-seedVaultSha256
- עוגן-GPG ציבורי `signing/w1-signing-key-r5-2026-10-08.asc` קיים (404 בתים)
- inner-sha pins קיימים במטא (אימות-פענוח-רץ-ב-Actions עם `STEEM_VAULT_PASSES`)

### מדידות-כלכליות-חיות (מהמנוע-החי, אפס-המצאה)
- `/payouts` — verdict **MEASURED** (ה-flip-מומש) · pending 0 · VP 29.5% (84.6h-למלא)
- שעון-פאייאוט-הבא: **2026-10-22** (95.5h) · phase pre-payout
- מהדור-התוכן: **4 פריטים-broadcast-ready** (compilation-בלבד — לא-שודר)
- custody-צבא: 0/14 (fail-closed-כן — בלי-סוד-מפעיל-אין-פענוח-כספת)

## ממצא-מרכזי: שורש-ה-SIGNING-DEAD (השערה-מנומקת, מדוד-מול-מוערך)

- `/exec-status`: credential חסר-מ-**2026-09-30** · 96 התראות · agents-מושפעים: curate/execute/soldiers/promo
- `MAIN_KEY` (GitHub Secret) עודכן-לאחרונה **09-21** (מדידת signing-health W5, קומיט `d7b9926`)
- רוטציית **MASTER-DERIVE בוצעה 2026-10-12** (txid `f6283d2e9fd37dbd` — עוגן-על-השרשרת)
- **ההשערה**: הסוד `MAIN_KEY` מחזיק סיסמה-קודמת-לרוטציה → הרשויות-החיות-לא-תואמות → חתימה-מתה
- **תרופות-אפשריות** (החלטת-מפעיל/מסלול-custody — לא-מסלול-זה):
  1. המפעיל מעדכן את סוד-`MAIN_KEY` לסיסמה-שאחרי-הרוטציה (owner-held root לפי recovery-meta.rotation.scheme)
  2. מסלול-custody החי (agent-9 t18) מרחיב גזירת-מפתחות-מהכספת-ה-sha-pinned ב-Actions (`STEEM_VAULT_PASSES` פותח את `KEYS-ZIP-2026-10-12-MASTER`) — כך-הסוד-המיושן-לא-נדרש
- נצפה-ולא-נגענו: `hive-custody-revival` נשלח-ידנית-כל-2-4 דק' ונכשל-בכנות — מסלול-חי-של-agent-9 (t18)

## כנות-כפולה (fail-closed כערך)
- `sovereign-selfcustody.mjs revive` מקומית: **WRITER-IDENTITY-PARTIAL** (GIT-CUSTODY-FAIL + SIGNING-REVIVE-FAIL) — נכון-לחלוטין: `SAOS_VAULT_PASS` הוא סוד-מפעיל (GitHub Secrets), אסור-שיחיה-בסנדבוקס (חוק §3)
- קומיט-זה checkpoint-ניטרלי-לא-חתום לפי סעיף 2.5 — כי-הפענוח-המקומי-נחסם-כחוק; העבודה-עצמה-הוכחה-במדידות-למעלה

## MTT (Mortality-Transfer Test) — מה-שורד-מוות-סנדבוקס
- **הוכח-היום**: מוות-מלא-של-כל-הסנדבוקסים לא מאבד דבר — `sovereign-bootstrap.sh` משחזר מוח-מלא (selftest 1823/1823) מגיט-בלבד
- **הסודות**: בכספת-ה-sha-pinned (בגיט) + סיסמאות-מפעיל-בלבד (GitHub Secrets) — שחזור-מלא-מחייב-את-שניהם, לפי-עיצוב
- **עוגן**: HEAD נעוגן-על-השרשרת-הציבורית (block 110545181) — קיומו-של-העץ-מוכח-לכל-צד-שלישי

אפס-סודות-נוגעו/הודפסו · אפס-מחיקה · אפס-force-push · כל-כישלון-נרשם-בשמו.
