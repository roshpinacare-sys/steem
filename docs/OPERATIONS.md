# SAOS — ספר-ההפעלה (OPERATIONS RUNBOOK)

> איך מפעילים, מריצים, מאמתים ומשחזרים. הכל מהשורש `/home/z/my-project`.

---

## 1. הרצת-המערכת

```bash
# הדמון (חייב לרוץ תמיד — 19 לולאות):
cd agent && (node agent.cjs >> daemon.log 2>&1 &)   # detached
# בריאות: agent/agent-status.json (updatedAt טרי) · agent/daemon.log

# הקונסולה (Next.js dev — פורט 3000 בלבד):
bun run dev          # ברקע; לוג: dev.log
bun run lint         # איכות-קוד
# אין bun run build — אסור (סביבת-פיתוח-חיה)
```

## 2. exec-whitelist — כלי-השרת של הקונסולה

`src/app/api/ops/agent/exec/route.ts` — POST {script, params}. ברירת-מחדל יבשה; **`params.real:true` נדרש לשידור-חי**; cooldown פר-סקריפט; runs>30 דק' נגזזים.

| key | סקריפט | מה (מדוד) | cooldown |
|---|---|---|---|
| verify | verify_system.cjs | מטריצת-72-ההוכחות | 5m |
| keyscan | keyscan.cjs | סריקת-אימפריה 3-שרשראות | 10m |
| forkscan | forkscan.cjs | שרשראות-בת (Blurt/Serey/Golos…) | 15m |
| harden | harden_topology.cjs | סמכות-פרסום+RC לחיילים | 10m |
| limits | limits_probe.cjs | מדידת-חומות-פרוטוקול | 30m |
| registry/kv/site | net_*.cjs | SAOS-Net + KV + האתר-בשרשרת | 20m |
| escrow | escrow_rail.cjs | מסילת-נאמנות מקורית (מחזור 4 שלבים) | 20m |
| anchor | anchor.cjs | עוגן-EVM×Graphene (Steem+Hive+Blurt) | 15m |
| genesis | he_genesis.cjs | מדרגת-ערך → SAOS-on-HE | 45m |
| conforms | he_conforms.cjs | מטריצת-קצה לחוזים-חכמים-HE | 25m |
| liq | liq_seed.cjs | זריעת-בריכה/grid (dry default) | 10m |
| factory/factory2 | factory_*.cjs | מפעל זהויות (v2 = דטרמיניסטי+עוגן-חילוץ) | 10–15m |
| fuel / muster | fuel_line / muster | נציבות-SP+הון · גל-escrow-עצמי | 30/10m |
| he-ladder | he_ladder.cjs | סולם-גיוס-הון ל-bids חיים | 30m |
| rc-map / rc-salvo | rc_sovereign.cjs | מפת-דלק · מטח-צי (חומת-5) | 10/15m |
| hive-powerup | rc_sovereign.cjs | SWAP.HIVE→HP מדידה חיה | 45m |
| runner / chunk | sovereign_runner.cjs | מנוע-עומסים+עיגון · צ'אנקים>8192B | 10/20m |
| **cross-shard** | cross_shard.cjs --live | **פיצול-שרדים Steem+Hive (6 חותמים)** | 15m |
| **cross-collect** | cross_shard.cjs --collect | הרכבה-מחדש בלבד מההיסטוריה | 5m |
| **rebuild** | rebuild.cjs | **שחזור-עולם מההיסטוריה הציבורית** | 10m |
| **perf** | perf_bench.cjs | **מדידות-ביצועים + עיגון-digest** | 15m |

**להוסיף-סקריפט חדש**: קובץ-CJS ב-agent/ עם result-JSON + רישום ב-WHITELIST + (אם חי) label כולל "on-chain" + בדיקה ב-verify_system. **אין סקריפט מחוץ לרשימה.**

## 3. שערי-הוכחה G1–G6 (משמעת-מוצר)

- **G1** — אף באדג' בלי קובץ-תוצאה של ריצה-אמיתית.
- **G2** — כל שידור → אימות-קריאה עצמאי (get_transaction/history) לפני "חי".
- **G3** — כישלון = מצב-מדידה-כנה (throttled/pending), אף-פעם ירוק-מזויף.
- **G4** — מדידות דלתא-מצב (לפני/אחרי) — לא "broadcast הצליח".
- **G5** — ה-verifier (verify_system.cjs) הוא הרשות; 72 בדיקות, proofMap עם tier on-chain/proven-local.
- **G6** — המסמכים (ARCHITECTURE/LEDGER/LIMITS) מתעדכנים באותו-commit של היכולת.

## 4. נהלי-שחזור

### 4a. מפתחות-בוט/חייל
```bash
node agent/factory_v2.cjs --derive --name <חשבון>   # גזירה דטרמיניסטית מ-FACTORY_MASTER
# → אותם pubs בדיוק (נמדד ×3 ריצות); עוגן-חילוץ: headcorner ב-owner (threshold 1)
```
הכלל: מפעל-דור-2 לא יכול לאבד מפתחות; hcnova1 (דור-1) הוא הזומבי היחיד — 50 SP שלו כבר חזרו.

### 4b. אובייקט-מצב (שרדים/צ'אנקים)
```bash
node agent/cross_shard.cjs --collect   # איסוף משתי השרשראות + sha256 root
# או צ'אנקים-Steem-יחיד: sovereign_runner.cjs --chunk
```

### 4c. RC-חנוק (תקיעה בפעילות)
- Steem-חיילים: 97–100% תמיד (50 SP כ"א). אוצר: 58%+.
- Hive-אוצר: 0.5% — **אל תשדר מ-@headcorner ל-Hive עכשיו**; השתמש בחיילים (2.1G RC כ"א, Task 51) או חכה למכונת-hivePower.

### 4d. הדמון-מת/לולאה-תקועה
```bash
tail -50 agent/daemon.log
cat agent/agent-status.json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const s=JSON.parse(d);for(const[k,v]of Object.entries(s.loops||{}))console.log(k,v.status)})"
# restart: הרוג node agent.cjs והפעל מחדש (detached). הלולאות מתאוששות מצב-קובץ.
```

## 5. אימות-שגרה (יומי)

```bash
node agent/verify_system.cjs     # 72 בדיקות → verify_last.json (64/72; ה-8 ידועים-RC-gated)
node agent/rebuild.cjs           # העולם מההיסטוריה הציבורית — 11/11
node agent/perf_bench.cjs        # ביצועים + עיגון on-chain
git push                         # **חובה בכל-סוף-סבב** — ה-repo הוא זיכרון-המערכת
```

## 6. סודות-והיגיינה

- `agent/.env` + `agent/keys/` — git-ignored (נבדק check-ignore). WIFs מסוננים מלוגים (sanitize).
- שינוי-מפתחות = מפעל-דור-2 בלבד. אין הדפסת-WIF. אין key ישן בקוד.
