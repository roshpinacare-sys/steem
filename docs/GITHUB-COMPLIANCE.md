# תקנון ציות GitHub — מסמך-האם של מניעת-חסימת-חשבון (R250)

**למה המסמך הזה קיים**: בעבר סוכן פרסם טוקן חשוף והחשבון נחסם. GitHub סורקת כל דחיפה
(סודות-סריקה + push-protection); דליפת-טוקן = שלילה-אוטומטית של הטוקן, ולעתים השעיה של
החשבון עצמו. הפרויקט מת ולא אמור למות בשביל מעשה-סוכן טיפשי. **המסמך הזה הוא חוק.**

**אכיפה מכנית**: `scripts/github-guard.sh` רץ בתוך `scripts/sovereign-push.sh` (סעיף 3.5)
לפני **כל** דחיפה — fail-closed. מה שעובר את השער נחשב ציותני; מה שנכשל — לא יוצא לעולם.

---

## 1. חוקי הברזל (הפרה = סיכון חסימה)

| # | חוק | למה |
|---|-----|-----|
| 1 | **אפס סודות בגיט** — לא בקוד, לא בהיסטוריה, לא ב-state | GitHub מסריקה; דליפה = שלילת-טוקן + דגל-חשבון. ההיסטוריה לעולם נשארת |
| 2 | **טוקנים רק ב-`upload/`** (gitignored, הוכח `.gitignore:57`) או ב-environment-secrets של Actions | מקום-אחד, פיקוח-אחד |
| 3 | **התחמקות-ממגבלות אסורה** — טוקנים-מרובים כדי לעקוף rate-limit = ToS `4101` evasion → חסימה | GitHub מצהירה על זה ב-Acceptable Use |
| 4 | **לא ספאם, לא תוכן-אוטומטי בלי-ערך, לא יצירת-מעורבות-מזויפת** | Acceptable Use Policies |
| 5 | **לא מכרה-קריפטו ב-Actions** — גם דקות-חינם-ציבוריות; שימוש-חורג/מכרה = סגירת-ריצות + חסימת-ראנרים | Actions ToS |
| 6 | **rate-limit REST 5,000/שעה** — agents חייבים back-off מדוד; השער (G4) חוסם דחיפה מתחת ל-200 | secondary-limits |
| 7 | **Pages**: repo ≤1GB, רוחב-פס ~100GB/חודש (soft), builds ≤10/שעה, תוכן חוקי-בלבד | Pages docs |
| 8 | **זכויות-מינימום לטוקן** — fine-grained לקוד; classic `write:packages` רק לפרסום-חבילות; תוקף קצר + רוטציה | least-privilege |
| 9 | **אם חשבון נחסם — אסור לפתוח חשבון-שני** (ban-evasion = חסימה-קבועה-של-הכל). ערעור דרך support בלבד | GitHub policy |
| 10 | **ריבונות בתוך הכללים**: כל אוטומציה דרך API הרשמי בלבד, ללא גירוד-מחוץ-הממשק | AUP |

## 2. מה השער בודק (G1–G4)

- **G1** — סריקת-סודות על כל-העץ-העקוב: טוקני GitHub (`ghp_/github_pat_/gho_/ghs_/ghu_`),
  AWS `AKIA`, Slack `xox`, npm `glpat`, מפתחות-live, PEM, ותבנית-WIF (מפתחות-Steem פרטיים).
- **G2** — היגיינת-כספת: `upload/` מנותק-מגיט ומנוטר כ-untracked.
- **G3** — סריקת-ה-patch היוצא (מה שבאמת עוזב את המכונה בדחיפה הקרובה).
- **G4** — ראש-משאב של rate-limit לפני דחיפה (דורש back-off כשנגמר).

## 3. טוקן-הפרסום ל-GitHub Packages — האמת הנמדדת (E403 ×3)

- טוקן-נוכחי: **fine-grained** (`github_pat_`, 93B) על חשבון **User** (`roshpinacare-sys`,
  GET /user: type=User) — בממשק-fine-grained אין-כלל הרשאת-Packages לחשבון-אישי;
  Packages מופיע רק תחת **Organization permissions** → לכן המפעיל לא מצא אותו, וזה לא
  באשמתו. הוכחה-חיה: publish E403 ב-19:50Z, ב-R248, וב-**2026-10-07T20:27:53Z** —
  `permission_denied: The token provided does not match expected scopes`.
- **הנתיב-היחיד**: classic PAT עם `write:packages` → `docs/OPERATOR-PAT-STEPS.md`
  → אחר-כך פקודה-אחת: `bash scripts/publish-github-packages.sh`
- בינתיים ההפצה-החיה קיימת בלי-npm: GitHub-Release `saos-agents-v0.1.0` (id 406106235,
  tarball 17,199B state=uploaded).

## 4. אם בכל-זאת סימנו אותנו

1. לא פותחים חשבון-חדש (אווירה של התחמקות = החמרה).
2. אוספים-עובדות: run-id, מזהי-דחיפה, שעות — הכל אמור-מלמעלה ב-guard.
3. ערעור דרך GitHub Support / forms (קטגוריה: account suspension appeal).
4. מביאים את הראיות שהאוטומציה עומדת ב-לוחות-המגבלות וב-AUP (המסמך-הזה = מדיניות-כתובה).

## 5. עדכונים-לעתיד

- push-protection: מומלץ-למפעיל להדליק ב-repo settings (Code security → Secret scanning
  + Push protection) — השער המקומי (G1–G3) מכסה את החלל עד-אז.
- Dependabot/CodeQL אינם-חובה-כאן (אין-תלויות-ריצה-בקוד-הציבורי); ה-selftest 674/674 הוא
  מגן-האיכות.
