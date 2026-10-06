# weave-core · THE WEAVE — רשת האימות הריבונית לסוכני AI

> הבית הריבוני של THE WEAVE. ריפו `Zip` הריק הוסב לבית הזה ב-2026-09-14
> (הוראת המפעיל: "הפוך, אל תמחק"). הריפו הוא האמת — הסנדבוקס הוא רק workspace.
> אמת-שם (r123): הריפו ב-GitHub נקרא `Zip` — "weave-core" הוא שם הפרויקט, לא
> כתובת ריפו; אין ריפו בשם weave-core (404, נמדד).

## מה חי כאן

| נתיב | מה |
|---|---|
| `src/` | הפלטפורמה המלאה — קונסולת Next.js + API + ספריות הקריפטו (`src/lib/weave/`) |
| `sovereign/ledger.json` | **הספר** — snapshot קנוני חסר-סודות של כל האימותים, checkpoints, סוכנים ושערים |
| `sovereign/weave-seal.enc` | ה-seal — מפתח הענן + מפתח הרשת (AES-256-GCM; ריפו פרטי) |
| `sovereign/anchor-baseline.leaves.json` | חומר ההוכחה של גזירת העוגנים — 86 קבצי הארכיון (נמדד 2026-10-02 מהקובץ עצמו: fileCount=86; היה 90 לפני דדופליקציית G6 שהפכה 4 עותקים למצביעים) ⇒ שורש מרקל בספר |
| `sovereign/beat-report.json` | הדוח של הפעימה האחרונה (מקומית או ענן) |
| `.github/workflows/weave-heart.yml` | **הלב הענן** — התאום הציבורי ב-`Domain` מריץ את הרשת שעתית (cron :13) על checkout של הבית הזה; המקור כאן — dispatch-בלבד (ריבונות המכסה, R71) |
| `SOVEREIGNTY.md` | מפת הריבונות: מה נגזר, מה חסר, מה העוגנים נותנים |
| `scripts/` | weave-beat (הפעימה) · weave-seal · anchor-baseline · sovereign-milestones · compile-anchor |

## איך הרשת חיה בלי אף אחד

```
bun scripts/weave-beat.ts --local   # פעימת ה-runner הראשי: verify → attest → checkpoint → push
                                     # (בענן: אותו סקריפט בדיוק, מ-weave-heart.yml)
```

שיפוט בריאות: השרשרת עצמה — טריות האימות האחרון + הדחיפה האחרונה.
סנדבוקס מת? הענן מזהה וממשיך לבד (TAKEOVER). שער-סודות חוסם כל דחיפה של מפתח.

## הרמה מ-clone נקי (SOV-3)

```bash
git clone https://github.com/roshpinacare-sys/Zip.git && cd Zip
bun install
bunx prisma generate && bunx prisma db push   # SQLite מקומי
cp .env.example .env                           # DATABASE_URL
bun scripts/weave-beat.ts --no-push            # ייבוא הספר + אימות מלא מחדש
bun run dev                                    # הקונסולה חיה
```

## חוקי הבית

1. **שום טענה בלי מדידה** — ראיה ריקה ⇒ UNMEASURED, לעולם לא VERIFIED.
2. **הספר הוא הספר** — `ledger.json` בגיט הוא האמת; SQLite הוא מטמון.
3. **מפתחות לא בגיט** — רק בתוך ה-seal (ריפו פרטי) או על מכונת הסוכן.
4. **כל דחיפה עוברת שער-סודות** — דפוס מפתח ב-diff ⇒ חסימה מוחלטת.
5. **תווית אמת מוצהרת תמיד** — REAL / LOCAL / NOT-YET.

*חלק מה-SAOS Ecosystem · org-בפועל: חשבון roshpinacare-sys · הצי חי ב-steem/weave (cloud-heart)*

## 🔐 gitleaks-triage (asOf 2026-10-02T13:0xZ · Task 15)
- Org run 2026-10-02T11:40Z flagged findingsHead=8 — ALL 8 = `sovereign/ledger.json` `.{encKey,keyIv,keyTag}` AES-256-GCM envelope fields of the by-design PUBLIC replay book (KEK lives only in the Zip operator DB — iron law). 0 real secrets.
- Root-cause fix (mirrors Console 14-a): NEW `.gitleaks.toml` NARROW rule-level allowlist (same-ID merge on generic-api-key, condition=and, path `sovereign/ledger.json` + hex-gated envelope fields only) — durable vs bots rewriting the ledger, line-fingerprint-proof.
- Negative test PROVEN with corrected methodology (multi-line JSON like production): envelope fields suppressed, a fake `apiKey` secret on its own line STILL FLAGGED. Full-history + HEAD-tree re-scans = 0.
