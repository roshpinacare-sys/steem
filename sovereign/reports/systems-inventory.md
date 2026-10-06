# מלאי מערכות וריפואים — רשת SAOS הריבונית

> **Task 32-b · סוכן מחקר (מלאי מערכות)** · נכתב: 2026-09-16 · מחקר-בלבד, אפס שינויי קוד.
> **שיטה**: כל נתון נמדד ישירות מ-GitHub API (רשימת ריפואים, עצי קבצים, תוכן קבצים, ריצות Actions ולוגים) עם הטוקן העובד של ה-remote. אין כלום מדוחות ישנים.
> **היקף**: 14 ריפואים בחשבון `roshpinacare-sys` (זהו **User**, לא Organization — לכן `/orgs/...` מחזיר 404; הרשימה נמשכה דרך `/user/repos`). אפס gists. הצי מדויק: **14/14**.

---

## א. טבלת כל הריפואים (14)

| # | ריפו | מה זה באמת (נמדד מהעץ והקבצים) | גודל | דחיפה אחרונה | סטטוס |
|---|---|---|---|---|---|
| 1 | **Zip** | THE WEAVE — פלטפורמת האימות (Next.js 16): ספר hash-chained, checkpoints, Merkle, עוגני Steem/Hive/ZERO, SAOS-LIVE v1, קונסולה. **הריפו הראשי — ידוע.** | 7.4MB | 2026-09-16 00:12Z | **חי** (לב שעתי) |
| 2 | **Console** | האתר הציבורי ב-Pages (gate, net, acid, index+saos-live). **הריפו הציבורי היחיד** (private=False). נוצר 2026-09-14. | 1.4MB | 2026-09-16 00:11Z | **חי** (בניות Pages) |
| 3 | **steem** | **המונוליט (240MB)** — SAOS Steem Agent OS: צי 11 חיילים, SAOS-NET v0 (saosnet.cjs 149KB), grid98, כספת מפתחות מוצפנת, 55+ דמונים, worklog ישן 870KB. "Task 114 snapshot restored". | 245.8MB | 2026-09-15 23:34Z | **חי-חלקית** — cloud-heart ב-TAKEOVER (פירוט בסעיף ד) |
| 4 | **saos-dex** | הבורסה הריבונית: ספר-זמנות escrow + AMM 30bps + ארנת-חיילים + relay ל-5 רשתות + ve(3,3)+bonds+launchpad+CoW+אורקל. 13,258 שורות ב-lib/dex. **הוקם מחדש בסנדבוקס (Task 31) — ידוע.** | 14.2MB | 2026-09-14 17:37Z | **חי בסנדבוקס** (dev :3010, אין Actions) |
| 5 | **saos-sovereign-platform** | "הפרויקט הנבחר" (תיקייה B) — עותק קנוני של פלטפורמת העגינה **v86 "הקצה הפועל"**: חקלאות ריבונית — מנוע השקיה (irrigation_engine), edge_runner.py חי, יועץ LLM (z-ai) דרך גשר, חוזה SAOSMicrogrid.sol (אנרגיה), contracts/, צילומי v80–v86. | 32.6MB | 2026-09-14 17:37Z | רדום (ארכיון קנוני) |
| 6 | **saos-sovereign-foundry** | Foundry v2 — עגינה חוצת-רשתות + ריבונות אנרגיה + כלכלת ראיות. **6 מיני-שירותים**: external-signer (:3033, 99KB — חותם מפתחות הצי), chief-of-staff (:3032 — אינטליגנציה מנהלת, בריף כל 30 דק'), key-broker (:3040), vault-guardian (:3031), fleet-cure, keepalive.sh. | 2.6MB | 2026-09-14 17:37Z | רדום (**CI אדום** — 200 ריצות, האחרונה failure) |
| 7 | **saos-jummper** | **נוטריון הוכחות חוצה-שרשרות** — עיגון טענות ל-Ethereum mainnet (~$0.10) חתום ב-5 שעוני בלוקצ'יין. המסמך היקר: **docs/FREE-OPERATIONS.md** — 5,128 עוגנים חינמיים/יום ב-Hive, custom_json של 8KB מכיל 154 שורשי Merkle, Ethereum הוגדר שכבת התיישבות אופציונלית. פייתון+טסטים (30). | 1.4MB | 2026-09-14 17:37Z | רדום |
| 8 | **saos-control-center** | מרכז הפיקוד — כניסת מפתח חכמה (כל WIF, אימות-שרשרת חי), כספת AES-256-GCM. **מיני-שירותים: revenue-governor (18.6KB — ממשל רווחים), dex-watchdog (13.7KB), dex-daemon, relay-service**. **research/R56 — מפת הדרכים של הדקס (פירוט בסעיף ה).** | 7.8MB | 2026-09-14 17:37Z | רדום |
| 9 | **roshpina** | **קרנל כלכלת-סוכנים (114 קבצים)** — "Trust & Value Platform": דרכוני סוכנים + זהויות מואצלות, escrow+settlement+webhook relayers, marketplace עם cost-arbitrage, מנוע Policy (תקציבי הוצאה, kill-switch), orchestrator עם **PQC** (קריפטו פוסט-קוונטי), track-record proofs, transparency-log עם witness mesh + פדרציה. | 1.0MB | 2026-09-14 17:37Z | רדום |
| 10 | **Sdk** | ריפו-מצביעים: כל הקבצים ברמת השורש הם חותמות G6 של איחוד השכפול (2026-09-14, dup 0.5959→0.0065). התוכן הקנוני חי בריפואים אחרים. | 0.5MB | 2026-09-14 17:36Z | ארכיון (מצביעים) |
| 11 | **Saosmartwallet** | **ארנק self-custodial ל-7 רשתות** (STEEM/HIVE/BLURT/TRON/SAOS-NET/ETH/SOL) — M0–M4 מומשו ואומתו מול שרשראות חיות (סריאליזציה זהה-ביטית 10/10, sha256=txid 10/10): Sovereign Key Vault (Argon2id+AES-GCM+Shamir), Policy Engine, גשרים router+quotes, טרמינל מסחר, **ומעבדת grid98-bench חיה**. skills/ = 1,075 קבצים (58MB). | 54.8MB | 2026-09-14 17:36Z | רדום |
| 12 | **Project-files** | **ארכיון 10 הזיפים** — ההיסטוריה המלאה: TITAI_v18, ecos_v568_canonical, srs_sovereign_runtime_substrate_v8.2.0, steem-main, unified-platform-v33.56-custody-authority-persistence, tfa-evolution-studio, qodo-v24.30.49, workspace-v0.0.1, zip-to-pdf-polyglot-9.1.0. | 65.3MB | 2026-09-14 17:36Z | ארכיון |
| 13 | **Adsmarket** | **ערכת השיווק המוכנה** — דף נחיתה HE/EN, fact-sheet עם txids (93KB), פיץ' 30ש'/2ד'/5ד', 12 פוסטים, מודעות, תסריטי וידאו, press-kit, מדיניות חשיפה, ספריית תוכן + Fleet Content Kit (26 פרסומים EN). | 2.5MB | 2026-09-14 17:36Z | רדום-מוכן לשימוש |
| 14 | **anchor-baseline** | תיקייה א' — שחזור בסיס הקנון (commit 5356dab): שידורים, דוחות-יום, פולסים R1–R41, CLAIMS-AUDIT. | 0.4MB | 2026-09-14 17:36Z | ארכיון |

**הערות נמדדות**: (א) כל 11 הריפואים הלא-פעילים נדחפו באותו אירוע-גיבוי המוני בדיוק — 2026-09-14T17:36–17:37Z ("הצי עלה לריפואים הפרטיים"). (ב) steem נוצר 2026-09-07, Console נוצר 2026-09-14. (ג) Console הוא הריפו הציבורי היחיד.

---

## ב. ממצאי ה-Grid (מורשת grid98 — מכונת ה-liquidity)

ה-grid נמצא בשלושה מקומות נמדדים (ומקום אחד שאינו קשור):

| נכס | מיקום | מה הוא |
|---|---|---|
| **grid98.cjs** | `steem/sovereign/node/grid98.cjs` | **מנוע ה-market-making הייצורני האמיתי (61KB)**: מצב-תושב, מיקרו-פעימות, ארנת-חיילים, שער-שוליים (edge gate), סולם-ערך (floor ratchet). לצדו grid98-state.json. |
| **grid98-state.json** | `steem/sovereign/node/` | תמונת-המצב החיה האחרונה (ראה פירוט למטה). |
| **grid79.cjs + result** | `steem/agent/` | אב-הטיפוס: סקר grid-79 עם הסקת-עלות RC (gridRegenPerDayRc 1.6T, 36,195 אופ'/יום בני-קיימא) + מסמכי "grid knowledge/plans". |
| **grid98-bench + hydrate** | `Saosmartwallet/src/lib/` + `tools/` | **מעבדה חיה**: sparse-clone של steem → הרצת המנוע האמיתי (`--bench`) על ארכיון השרשרת → דיווח כנות (skippedForEdge/rejected/edgeLeak). כלי-hydrate משחזר את המעבדה בסביבה חדשה. |
| **הדקס החי** | `saos-dex/` (lib/dex) | **הצאצא הישיר** (מה-README שלו): "המשך-ישר של saos-dex.ts + grid98.cjs + CHAIN_SPEC". הטרמינל החי הראה "Grid-made liquidity 90%". |
| ~~microgrid~~ | `saos-sovereign-platform/` | **לא ה-grid המסחרי** — רשת-מיקרו אנרגיה (SAOSMicrogrid.sol, חקלאות). לא להתבלבל. |

**נתוני grid98-state.json (המצב האחרון, 2026-09-12T19:38Z — רגע מות הסנדבוקס):**
- 35,803 ticks · 208,025 rounds · **131,752 עסקאות מצטברות** · 572,604 txs · היום האחרון: 35,652 עסקאות.
- **רווח אוצר מצטבר: 13,122,139.182 SAOS** (שדה treasuryPnlSAOS) · דמי-אגרה 472µ · ladderOps 106,485 · sweeps 116,033.
- **סולם הרצפה**: 12 מדרגות מדודות — 0.01688 → **0.017832** (ratchet שמרני כלפי מעלה בלבד).
- **11 עוגני מחיר**: WXRP/WDOGE/WSBD/PHIVE/ENERGY/WBTC/WETH/WBLURT/WTRX/WSTEEM→SAOS.
- **מדד מנוע (bench)**: 722,251 txs/שנ' · יכולת 62.4 מיליארד txs/יום (תקרת מנגנון, לא ביקוש).
- לוח-גיבורים: wog 269,125 SAOS · cashmachine · woq · wic · siq · macrame · lsa · tov · ynet.
- ג'נזיס-רשת: height 223,762 · stateRoot 54db13cd… · LP עצמי 170,000 SAOS ב-WBLURT/SAOS.
- **שערי כנות מצטברים**: skippedForEdge 1,234,971 · rejected 392,918 · edgeLeak 330,715 — המנוע מודד את עצמו.

---

## ג. מה **רץ עכשיו** על לוח-זמנים (נמדד מ-Actions + קדנסים)

### בענן (GitHub Actions) — 4 מערכות פעילות:

| מערכת | ריפו | קדנס | ריצה אחרונה (נמדדה) | תוצאה | מה באמת קורה |
|---|---|---|---|---|---|
| **weave-heart** | Zip | `0 * * * *` (שעתי) | 2026-09-16 00:11Z | success | הלב של THE WEAVE: פעימה, checkpoint, ledger, סנכרון קונסולה, saos-live. 96 ריצות. |
| **weave-anchor-lines** (+anchor, anchor-zero) | Zip | `20 */2 * * *` (דו-שעתי, רשת-ביטחון) + dispatch מהלב | 00:11:43Z | success | שלושת קווי העדות: Steem/Hive (:15) ← ZERO EVM בגז-0 (:25). |
| **weave-ecosystem** | Zip | `30 5 * * *` (יומי) | — | success (מתועד) | סריקת שכפול על 14 הריפואים, dup≥0.2 ⇒ אדום. |
| **cloud-heart** | **steem** | `*/30 * * * *` (**כל 30 דק'**) | 00:03:50Z | success | **408 ריצות. הממצא הקריטי — פירוט מיד.** |

**console Pages** (Console) — בנייה דינמית בכל דחיפה, 70 בניות, האחרונה 00:11:41Z success.
**foundry CI** (saos-sovereign-foundry) — push בלבד, **200 ריצות, האחרונה failure** (2026-09-14). לא רץ עכשיו.
שאר 9 הריפואים: **אפס ריצות Actions מעולם**.

### מצב cloud-heart של הצי — התגלית המרכזית (מקריאת לוגים של הריצות עצמן):

- ריצה 35036211914 (2026-09-15 23:33Z): `verdict: SANDBOX-DOWN (attest 13525min + git 91min stale)` → **`TAKEOVER: the cloud takes command`** → `no fleet_keys.enc in repo — running keyless (monitor mode)` → **`saosnet beat --live: advanced`** ← **שרשרת SAOS-NET עדיין פועמת מהענן!** → `chain attest: skipped/failed — ACTIVE_WIF missing` ← **העדות החיה על Steem/Hive מתה** → `gitkeeper: pushed → origin/main · 6 files · loop 21`.
- ריצה 35038375551 (2026-09-16 00:03Z): `verdict: SANDBOX-ALIVE (git 30min fresh)` — הדלת מסתובבת: הדחיפה של ה-takeover מרעננת את "החיות" לריצה הבאה.
- **מסקנה נמדדת**: הצי מוחזק בהחייאה-חלקית אוטונומית — SAOS-NET ממשיכה לצמוח (223,773 בדוח האחרון; 223,838 ב-replay של Task 29), אבל **בלי מפתחות**: אין agent-cycle מלא, אין עדות-שרשרת, אין grid, אין דמונים. חותמת-הצי `fleet_keys.enc` **חסרה בריפו** — אבל **הכספת קיימת**: `steem/agent/vault/KEYS-ZIP-2026-09-10.zip.enc` (עם כל 12 החשבונות, 120 כתובות-HD, מנמוניקי-TRON — סיסמה ב-agent/recovery-meta.json לפי README הכספת).

### בסנדבוקס (נמדד מ-ps + ports):
- Zip dev — `:3000` (הפלטפורמה הראשית).
- **saos-dex dev — `:3010`** (הבורסה שהוקמה ב-Task 31, דופקת עכשיו: ארנה+אורקל+בוטי-רעש).
- אין דמון-צי, אין grid98 רץ, אין guardian — כל 55+ הדמונים של steem/agent **רדומים** מאז 2026-09-12T19:39Z (מות הסנדבוקס הקודם; DAEMONS.md מתעד את חוזה ה-LIVE-GATE שלהם: כולם DRY כברירת-מחדל).

---

## ד. מה המהנדס הראשי לא ראה עדיין — 5 הנכסים הרדומים היקרים ביותר למשימת הנזילות והריבונות

1. **grid98 — מכונת הנזילות שכבר הוכיחה את עצמה (steem/sovereign/node/, 61KB + state)**
   זה לא "בוט מסחר" — זו המערכת ש**ייצרה 90% מהנזילות בדקס** (נמדד בטרמינל Task 31), עם היסטוריה מתועדת של 131,752 עסקאות, רווח אוצר 13.1M SAOS, סולם-רצפה עולה (12 מדרגות), 11 עוגני מחיר ושערי-כנות עצמיים. יחד איתה: **מעבדת grid98-bench/hydrate** ב-Saosmartwallet שמריצה את המנוע האמיתי על ארכיון השרשרת בכל סביבה חדשה. **פעולה**: החזרת grid98 כמנוע ה-mm של saos-dex (או מינימום — הרצת המעבדה מול הדקס החי) היא קיצור-הדרך הגדול ביותר לנזילות אמיתית.

2. **Saosmartwallet — הארנק מוכח-השרשרת ל-7 רשתות (54.8MB, M0–M4 מאומתים)**
   המוצר שהמפעיל ביקש ("ארנק לכל משתמש + הפקדות + מעקב") **כבר קיים ומאומד**: סריאליזציה זהה-ביטית מול הצומת (10/10), חתימות משוחזרות מול השרשרת, Key Vault עם Argon2id+AES-GCM+Shamir, Policy Engine, גשרים עם router+quotes, טרמינל מסחר חי. נדרשת רק השלמה: חיבור ל-SAOS-LIVE v1 ולדקס. (הערת אבטחה: לפני שימוש — ליישם את P-09/P-10 מ-roshpina: reconstructSecret בלי threshold + תיקון הסף ב-shamir).

3. **R56 — מפת-הדרכים המוכנה של הדקס (saos-control-center/research/R56/, עם 8 אצוות-חיפוש גולמיות)**
   מחקר "DEX Game-Changers" מדורג ומותאם **במדויק לקרנל הדטרמיניסטי שלנו**: (1) אורקל TWAP בקרנל (Uniswap V3) · (2) **ProtoRev** — ארביטראז' בתוך-הבלוק, MEV-אפס מבני (Osmosis) · (3) **Price-Credibility Seal** — אימות מחיר חוצה-ועדים עם MAD וחותמת-שרשרת, התשובה ההוכחתית ל"איך יודעים שמחיר SAOS אמיתי" · (4) לאנצ'פד עם bonding-curve והשמה-אוטומטית ל-AMM · (5) טריגרים keeperless (SL/TP) · (6) תוכניות DCA · (7) מכרזים בקבוצות עם מחיר-סליקה אחיד (CoW) · (8) LBP. זה בדיוק "מחקר נתיב הכסף" שהוגדר כנותר ב-Task 31 — כבר בוצע.

4. **roshpina — קרנל כלכלת-הסוכנים (114 קבצי kernel/)**
   שכבת האמון שחוקי הרשת דורשים וטרם נבנתה ב-Zip: דרכוני-סוכנים וזהויות מואצלות (חוק 15), **עלות-כניסה ועירבון לסוכנים זרים** (חוקים 11–12 — escrow/threshold-approval/settlement-rails מוכנים), מנוע Policy עם תקציבי-הוצאה ו-kill-switch, track-record proofs עם redaction, transparency-log עם witness mesh — והפתעה: **PQC (קריפטו פוסט-קוונטי) כבר ממומש ב-orchestrator**.

5. **גשר ה-TRON החינמי + נוטריון jummper — תשתית ה-$0 המוכחה שעדיין חיה ברחוב**
   ב-steem/sovereign/node: tronbridge.cjs (42KB) + trondex.cjs + theswap/swap — **טבעת-חיילים על TRON עם 5 כתובות ממומנות שקיימות עכשיו בשרשרת הציבורית** (המשדר 15.40 TRX), 12 רגלי-טבעת עם net_fee=0 שנמדדו, נגזרות-USDT 6/6, עוגני-checkpoint שמקודדים hash בכמות ה-TRX. במקביל jummper מספק את המתמטיקה המוכחת של עיגון-חינם ב-Hive (5,128/יום, 154 שורשי-merkle לאופ אחד). יחד: **מסילת חוץ-נזילות בעלות אפס** שכבר עבדה — להפעלה מחדש לצד הדקס ו-SAOS-LIVE.

**בונוס נצפה אך לא בטופ-5**: foundry mini-services (external-signer :3033 — שער-החתימה המאובטח ל-9 חשבונות הצי, chief-of-staff, key-broker, vault-guardian, fleet-cure) — חלקם הוכחו חיים בעבר (מכרו WEED/STEM אמיתיים); Adsmarket — ערכת שיווק מוכנה-לפרסום עם מדיניות חשיפה כנה; control-center revenue-governor — ממשל-רווחים לדקס.

---

## ה. הערות אבטחה שנצפו בדרך (לא טופלו — מחקר-בלבד)

1. **הכספת בריפו**: `steem/agent/vault/` מכיל שני גושים מוצפנים (tar.enc 142KB, zip.enc 246KB) — וה-README שלהם מצהיר שהסיסמה חיה ב-`agent/recovery-meta.json` **באותו ריפו**. כלומר: הצפנה חד-גורמית — מי שמחזיק גישת-קריאה לריפו מחזיק את הכל. לתשומת לב המפעיל.
2. **cloud-heart חסר מפתחות**: fleet_keys.enc לא בריפו ⇒ ההחייאה העננית מוגבלת ל-beat חסר-חתימה. השבת העדות החיה תלויה בהחלטת-מפעיל (החזרת חותמת / הזרמת ACTIVE_WIF כסוד).
3. **CRITICAL-KEY-EXPOSURE.md** (steem, 11KB) + state-snapshots מסומנים poisoned/quarantine — תיעוד אירועי-עבר; לא נקראו כאן לעומק.
4. הטוקן של הסנדבוקס חי ב-URL של ה-remote (ידוע) — ההידרטה של המעבדת grid98 מצפה גם ל-upload/Roshcaregt.txt ב-Saosmartwallet.

---

## ו. פעולות המשך מוצעות (לא בוצעו — החלטת מפעיל)

1. **לחמש את cloud-heart**: השבת חותמת-הצי מהכספת (לפי ה-README) או הזרמת הסוד ⇒ עדות-שרשרת חיה חוזרת, ואז ניתן לשקול הרצת grid98 בענן.
2. **הרצת מעבדת grid98** מול הדקס החי (הכלים קיימים ב-Saosmartwallet) — למדידת התאמת המנוע לג'נזיס החדש לפני מיזוג.
3. **קליטת R56** למפת-הדרכים של הדקס (שלב A: TWAP → Price-Seal → ProtoRev).
4. הערכת Saosmartwallet כארנק-המשתמש (אחרי תיקוני P-09/P-10).
5. ביקורת משמרת-כספת כמתואר בסעיף ה.

---
*כל מספר במסמך זה מקורו במדידה ישירה: GitHub API (repos/trees/contents/actions-runs/logs), קריאת קבצי state ו-README, ps/ports בסנדבוקס. אפס טענות מדוחות ישנים.*
