# SAOS — פנקס-האימפריה (EMPIRE LEDGER)

> המאסטר של "מה יש לנו". כל טענה עם txid — כל אחד יכול לאמת עצמאית.
> עדכון אחרון: Task 52 · 2026-09-04.

---

## 1. החשבונות (11 × דו-שרשרתי)

| חשבון | תפקיד | Steem | Hive | דלק (RC) |
|---|---|---|---|---|
| **headcorner** | אוצר/מנפיק/מפעל | 5,617 SP כולל · 1.16 STEEM נזיל | 10.8 HP (החנוקה) | 58–59% Steem · 0.5% Hive |
| cashmachine | חייל-אופרטור | 50 SP delegated | 3,421 VESTS | ~100% / 82% |
| haran · lsa · macrame · siq · tov · wic · wog · woq · ynet | חיילי-אופרטור | 50 SP כ"א (500 סה"כ) | קיימים, VESTS קטן | 97–100% כ"א |
| hcnova1 | **זומבי (דור-1)** | 0 SP (ה-50 שוחזרו לאוצר, txid d87c96f9) | — | — |

- **סה"כ-שליטה**: 22 חשבונות-רשת (11+11), controllable 22/22 (סריקת-אימפריה חיה).
- **כספת**: `agent/keys/vault.json` — כל-4-התפקידים לכל-חייל על שתי השרשראות.
- **EVM**: `0x299D2135491cA45b2F4530348Bcc244c6825915A` — נגזרת-חתימה של אותו סוד.

## 2. הנכסים

| נכס | מקום | כמות | ערך-מדוד |
|---|---|---|---|
| SAOS-1 (על-האוטובוס) | Steem custom_json | supply 191.995 (שוחזר מההיסטוריה) | bestAsk 0.017852 STEEM |
| בריכת-AMM SAOS:STEEM | אוטובוס-saos | 9.305 SAOS / 0.159264 STEEM · k שמור · LP 3.289595 | 11 swaps · עמלות שנלכדו 0.0213 STEEM + 0.001 SAOS |
| קרדיט-DEX (escrow) | מסילת-מקורית | ~0.455+ STEEM (escrow-חיילים חי) | כושר-פירעון נמדד תמיד |
| ארנק-HE | Hive-Engine | 9 טוקנים (LEO/CENT/VKBT/WAIV/AFIT/POBB…, 16,968 AFIT בעבר) | 2.98 SWAP.HIVE |
| SWAP.HIVE/HIVE/HP | Hive | מתחלף דרך ladder+powerup | — |

## 3. רישום-ה-txids המרכזיים (לפי משימה)

### Task 46 — האתר ששוכן בשרשרת
- `0c0e8990…` / `10b22bbc…` — פרסום HTML מלא כ-SAOS-KV (blk 109265870) · roundtrip sha256 VERIFIED ×2

### Task 47 — ממלכת-הנזילות
- `1ff9bacc…` — cancel מדף-תקוע + pool_init + pool_add + 2 grid
- `90c04cf3…` — השלמת L1-L3 · מניות √(0.2)=0.447214
- escrow-חיילים ראשונים: `93b49e80` `8bee7fc4` `a24fb7a3` `7795d3a8` (@cashmachine×2, @haran×2)
- **2 swaps עם עמלות-שנלכדו on-chain** (0.00264 STEEM) — ה-Uniswap שהשרשרת לא ידעה שהיא יכולה לארח

### Task 48 — דור-שני + פעימת-צי
- `d87c96f9…` — שחזור 50 SP מ-hcnova1-הזומבי לאוצר
- `62f3d31b…` (@cashmachine, blk 109269932) · `aae6ed81…` (@haran, blk 109270329) — fleet_ping ראשונים

### Task 49 — מסילת-הדלק ותעסוקה מלאה
- `7757fc33…` — **הנציבות הראשונה**: 10×delegate 50 SP (500 SP) אומת received_vesting 10/10
- `2ca68c70…` — 10×transfer `saos:fuel` (0.3 STEEM הון-חוזר)
- muster: 10 txids, 10 חותמים-עצמאיים, 10 בלוקים רצופים (109270913–109270931) · 0.239 STEEM
- HE-ladder: VKBT+CENT מכירות חיות בהיסטוריית-Hive הציבורית (idx 49587/49588)

### Task 50 — ריבונות-RC
- **בלוק 109271747**: 16 ops-צי בבלוק-אחד מ-4 חותמים (חומת-5 נפרצה ×3.2) · haran +4 ב-109271748
- `264ce1a0…` (@ynet, blk 109271790) — batch 4-ops · **עלות-op 54.9M RC נמדדת מנה-לפני/אחרי**
- `f48b9fc6…` (blk 109606143) — withdraw-Hive שנכלל (Engine טרם עיבד — מכונה-ממשיכה)
- צ'אנקים: מניפסט 20,409B → 4 חיילים → הרכבה sha256 match=true

### Task 51 — ריבונות מעל-השרשראות (הלילה)
- **פיצול-שרדים** (root `dd0d177db6248b4b…`, 3,556B → 6 שברים):
  - Steem: `fa61c446…` (@cashmachine #0) · `9df4acd4…` (@lsa #2) · `46965aa9…` (@siq #4)
  - Hive: `6970f9cf…` (@haran #1) · `be6aa4da…` (@macrame #3) · `792be141…` (@tov #5) — **חתימות-חייל ראשונות על Hive**
  - הרכבה מההיסטוריה הציבורית של שתי השרשראות: **sha256 match** — אף-שרשרת-לא-מחזיקה-לבדה
- **מדידות-ביצועים** (`perf_bench_result.json`, עוגן `8ad92b3d…` / digest `62eaeacf…`):
  - מנוע: **449,065 ops/sec** (2µs/op) באפס-RC על עתודות-חיות
  - חבירה-לבלוק: **Steem 3.144s** (blk 109273613, txid fb5d3040…) · **Hive 3.141s** (blk 109607932, txid 89b8c54b…)
  - מרוץ-RPC: 4 צמתים p50 738–885ms · race 727ms
- **שחזור-עולם**: 2,020 ops → 11/11 התאמות (מנוע-עצמאי שני) — השרשרת = מסד-הנתונים

### Task 52 — מפעל-ההלוואות · מטח-40 · פריקה-נקייה (הבוקר)

| פעולה | txid / עדות | אימות |
|---|---|---|
| הקפאת-דלק ×9 (מפעל-ההלוואות) | haran=d4fc7d0f · lsa=5168f786 · macrame=2a184f81 · siq=2bd8e781 · tov=453ec435 · wic=b78ec192 · wog=b50d82a6 · woq=ddcb9a52 · ynet=a0e5f6d3 | delegate_vesting_shares=0 — get_transaction |
| שחרור-דלק ×9 (פריקה-נקייה) | haran=05e50af8 · lsa=5f302441 · macrame=6199b188 · siq=67a0d471 · tov=4ec62fc0 · wic=3bab82fb · wog=ba57dce5 · woq=f96f5c70 · ynet=e4280778 | 10/10 חיילים עם 80,824 vests (UNWIND-52 ירוק) |
| מטח-52 (ריצה-ראשונה) | 40 ops × 10 חותמים · בלוק-כבד **109275412: 24 ops** | סריקת-בלוק ישירה — salvo52_evidence.json |
| מטח-52 (ריצת-UI שנייה) | 10/10 txs ב-6.2s (runId 80945853) | exec_80945853….log |
| cross-shard סבב-2 | steem: 1ddf050c(@cashmachine) · 58f56fbb(@lsa) · beb29074(@siq) + hive ×3 | הרכבה 6/6 · root match · אותו-מצב, חתימות-טריות |
| חלון-ההלוואה-שנדחה | required 6,870,048 > available 6,183,610 (assert-מדוד) | הסף-המדויק נגזר: 9,920,604 vests — חמוש-בדמון |
| שחזור-דלק-wic (probe) | probe-restore bf941f15 (hash-שידור) | wic=80,824 vests on-chain |

## 4. איך לאמת בעצמך (בלי-לסמוך-עלינו)

```bash
# שבר-שרד על Steem (דוגמה):
curl -s https://api.steemit.com -d '{"jsonrpc":"2.0","method":"condenser_api.get_transaction",
  "params":["fa61c446d123628ac270ba50ac9f4404cb7dcb77"],"id":1}'
# → operations[0] = custom_json id=saos action=shard i=0 sha=<hash> chunk=<…>

# שבר-שרד על Hive:
curl -s https://api.hive.blog -d '{"jsonrpc":"2.0","method":"condenser_api.get_transaction",
  "params":["6970f9cf7cd2cb4029…"],"id":1}'
# → required_posting_auths=["haran"] — חייל חותם על Hive

# עלות-op / תעסוקה / נציבות: החלף txid מהטבלה למעלה באותו get_transaction.
# העולם-כולו: node agent/rebuild.cjs  (קריאה-בלבד, בלי-מפתחות)
# מטריצה-מלאה: node agent/verify_system.cjs   (76 בדיקות, 66/76 ירוקות — ה-10 הנותרות RC-gated/דמון-מתחמם ידועים)
```


## Task 53 — מנוע-ערך ריבוני (2026-09-04): txids לאימות עצמי

| פעולה | שרשרת | חותם | txid / בלוק | איך לאמת |
|---|---|---|---|---|
| value_lock #1 (pool_add 3 SAOS + pool_lock 100%) | Steem | headcorner | e98ee5b558a367412dff7234ebb32704056a0a91 | get_account_history headcorner (boylikegirl, 600) → action=pool_lock |
| מניפסט value_lock #1 → Hive | Hive | wic | 68be200af9d69bcf7758605f1fac615b3997f606 | get_transaction על api.hive.blog |
| value_lock #2 (UI חי — כפתור ״נעילת-ערך״) | Steem | headcorner | 3ed2a16982733348… | כנ״ל |
| checkpoint הוכחת-עתודה #3 (5 ops: 4 עוגנים + checkpoint דקס-מלא) | Hive | **wic (חייל!)** | 532124f9a4dddfcd6fc3e267f7b137ff5e00daaa · blk 109610701 | get_transaction → op[4]=checkpoint · dex.supply=187.616 · steemWallet=1.163 STEEM |
| מפל-1: החלטה אחת → 3 חתימות | Steem+Hive | headcorner + cashmachine + haran | Steem blk 109276622 (×2) · Hive blk 109610942 (txid 1a2260cdf306…) | get_block 109276622 → 2 ops עם digest 176770fe… · get_transaction Hive |
| מפל-2 (ריצת-אימות חוזרת) | Steem+Hive | headcorner + cashmachine + haran | Steem blk 109277502 (×2) · Hive blk 109611825 (txid 7eb79203d009…) | אותו מהלך · digest f4cf352d… |
| עוגני-גשר דרך ראוטר-צי (רוטציה) | Hive | woq / siq / cashmachine | be75188de2f50654… · 6516c80caa09… · 995021038876fd64… | get_transaction פר-חותם |

מצב-העולם אחרי Task 53: עומק-בריכה 15.305 SAOS · **LP נעול-לצמיתות 2.568392** (מרוויח-עמלות, בלתי-נשלף) · lpSupply 5.410773 · checkpoints-על-Hive 3 (מסירה-חיילית) · ממסר-מפל מאומת ×2.


## Task 54 — מנוע-רפלקס-בלוק (2026-09-04): txids לאימות עצמי

**ההוכחה**: "תגובות בבלוק בלי עלות-אנרגיה דרך ריבונות" — מטח-חתום-מראש: כל-התגובות חתומות-לפני-הטריגר, נשדרות ברגע-זיהוי-בלוק, נוחתות בבלוק N+1. 30 תגובות · 10 חותמים · avg 1.17 בלוקים · אפס-עלות-נזילה · עלות-mana ~0.1%/תגובה (מתחדשת). **HIVE-DRILL**: סבב-מארח-חסר מלא על Hive בלבד (המנוע ריבוני — רץ על כל שרשרת-גרפין).

| פעולה | שרשרת | חותמים | txid / בלוק | איך לאמת |
|---|---|---|---|---|
| טריגר-רפלקס סבב 1 | Steem | headcorner | daa9e1ae5578cc9384f8274e5122ebb3684c8ed1 · blk 109278724 | get_block 109278724 → custom_json t=reflex phase=trig n=rmtmlnbm1v66el9-1 |
| טריגר-רפלקס סבב 2 | Steem | headcorner | 1caa2de36fe6c39ad70531970d9a54ad40085ec5 · blk 109278727 | get_block 109278727 → custom_json t=reflex phase=trig n=rmtmlnbm1v66el9-2 |
| טריגר-רפלקס סבב 3 | Steem | headcorner | 316c4d96f966821499506641a8d305d1c1459b79 · blk 109278730 | get_block 109278730 → custom_json t=reflex phase=trig n=rmtmlnbm1v66el9-3 |
| תגובות-צי סבב 1 (10 חיילים) | Steem | cashmachine, haran, lsa, macrame, siq, tov, wic, wog, woq, ynet | blk 109278725 (latency ≤2) | get_block 109278725 → count t=reflex phase=resp |
| תגובות-צי סבב 2 (10 חיילים) | Steem | cashmachine, haran, lsa, macrame, siq, tov, wic, wog, woq, ynet | blk 109278728 (latency ≤2) | get_block 109278728 → count t=reflex phase=resp |
| תגובות-צי סבב 3 (10 חיילים) | Steem | cashmachine, haran, lsa, macrame, siq, tov, wic, wog, woq, ynet | blk 109278731 (latency ≤2) | get_block 109278731 → count t=reflex phase=resp |
| עוגן-digest מטח על Hive | Hive | @lsa | 3d1c3d564ed71f002c4f8bd1139d328bf2c9a5e6 · blk 109613062 | get_transaction |
| HIVE-DRILL (מארח-חסר): טריגר-חייל→9 תגובות | Hive | @lsa + 9 חותמים | blk 109613064 · maxLatency 1 | get_block 109613064..+2 → t=reflex-h |
| נעילת-ערך עמוקה #4 (10 SAOS → בריכה + LP נעול) | Steem+Hive | headcorner + @cashmachine | 1572f6fba4dfdd59b6625688ae484c27bc2b26bd · Hive f4ee1142280514c5f93e56fc43720d5dc5dbed85 | get_account_history → pool_lock · get_transaction Hive |

מצב-העולם אחרי Task 54: עומק-בריכה 28.305 SAOS (נעול +10 נוספים) · **LP נעול-לצמיתות 7.164** · 19 SAOS cumulative נעולים · מטריצת-הוכחות 78/85 (5 הוכחות-רפלקס חדשות ירוקות) · דימון 20 לולאות (reflex נוסף, תרגיל-אוטונומי כל 4 שעות).


## 5. קבצי-ראיה (agent/*.json — git-tracked)

`verify_last.json` (מטריצה+proofMap) · `cross_shard_result.json` · `rebuild_result.json` · `perf_bench_result.json` · `rc_map.json` · `rc_sovereign_result.json` · `sovereign_runner_result.json` · `fuel_result.json` · `muster_result.json` · `he_ladder_result.json` · `limits.json` (החומות) · `worldlog.json` (שרשור-האש) · `exec_runs.json` (רישום-ריצות) · `net_site_result.json` (האתר) · `he_genesis_state.json` (המדרגה) · `mint_borrow_result.json` (חלון-ההלוואה) · `salvo52_evidence.json` (מטח-40/בלוק-כבד) · `value_lock_state.json`+`value_lock_result.json` (נעילות-ערך) · `cascade_result.json` (מפל 3-רגלי)

> הקבצים הם אינדקס בלבד — **השרשרת היא האמת**; כל txid נבדק get_transaction.

## Task 55 — Vault-v2 + רפלקס-אירוע-חיצוני (2026-09-04): txids לאימות עצמי

| פעולה | שרשרת | חותם | ראיה | אימות-עצמאי |
|---|---|---|---|---|
| סקר-דלק: האצלת-בדיקה headcorner→@lsa (1616.463628 VESTS) | Steem | headcorner | condenser get_account_history — delegate_vesting_shares | rc_api לפני/אחרי: מנת-המאסטר-לא-השתנתה (71.0→71.0%) |
| סקר-דלק הפוך: @lsa→headcorner | Steem | @lsa | delegate_vesting_shares | stored-אוצר 5.161→5.163T (ריג'ן-בלבד — **מיתוס-המנה-המלאה-נשבר**) |
| **הסבת-מפתחות @ynet — Steem** (account_update: owner+active+posting+memo → נגזרי-FACTORY_MASTER) | Steem | @ynet-owner | rotation_evidence.json | get_accounts → 4/4-תפקידים == נגזרים ✓ |
| **הסבת-מפתחות @ynet — Hive** (אותו-op, chain_id-swap) | Hive | @ynet-owner | rotation_evidence.json | get_accounts Hive → 4/4 ✓ — דו-שרשרתי |
| **קליטת-Vault-v2** (username+master → גזירה-מקומית → התאמה-מול-הסמכות-החיה 4/4 ×2-שרשראות → vault → ריסט-דמון) | מקומי+2-שרשראות | — | vault.json mode=master-derive · chains steem[4]+hive[4] | POST /api/ops/vault/master ריצה-חיה |
| **קליטה-לצי (ADMISSION)**: @ynet-מגיב-במטח-החי-מהמפתחות-הנגזרים-בלבד | Steem | @ynet | blk 109279689 · txid 1ae62398770cf077… · latency 2 בלוקים | get_block 109279689 → סריקת-בלוק |
| **רפלקס-אירוע-חיצוני (drill)**: העברה @lsa→headcorner 0.001 STEEM memo=saos-drill → **צי 10/10 בבלוק-הבא בדיוק** | Steem | @lsa + 10 חותמים | transfer-txid 9cd2cf8674bbf7525cf75dc2862d1cb8f38fa918 · blk 109279814 · avg latency 1.00 | get_block 109279814..+2 → src=external payloads |
| עוגן-המטח-החיצוני-על-Hive | Hive | @macrame | blk 109614148 · verified | get_transaction Hive |

מצב-העולם אחרי Task 55: **@ynet-זהות-בלתי-אובדת** (נגזרת-מ-user+FACTORY_MASTER-לנצח, דו-שרשרתית) · הצי-מגיב-לאירועים-חיצוניים-בבלוק-הבא (לא-רק-לטריגרים-שלו) · transferWatch→רפלקס-חי-בדמון · מטריצת-הוכחות 82/89 (4-הוכחות-חדשות: KEYROT/VAULTV2/ADMISSION/EXREFLEX-55) · דימון 20-לולאות.

## Task 59 — פריצת-גבולות: שוק · חסכונות · ממשל · חילוץ-צי · אנרגיה (2026-09-04): txids לאימות עצמי

| פעולה | שרשרת | חותם | ראיה | אימות-עצמאי |
|---|---|---|---|---|
| **חילוץ-זהות-צי: change_recovery_account ×10 חיילים → headcorner** (owner-signed לכל-חייל מהכספת) | Steem | owner של כל-חייל | sovereign_59_evidence.json → fleetRecovery | get_transaction(txid) → op=change_recovery_account (3/3-נדגמו ✓) · תוקף-אחרי-דיליי-30-יום-פרוטוקול |
| **שוק-פנימי: limit_order_create → הזמנה-על-הספר → limit_order_cancel → נעלמה** (orderid 1827792549 @5.0×-מדד) | Steem | headcorner-active | market.roundTrip=true | get_open_orders הכיל-אחר-יצירה, לא-הכיל-אחר-ביטול · txids 614e6a6e… / 757e2e1c… |
| **חסכונות: transfer_to_savings + transfer_from_savings** (0.001 STEEM, request_id 1827557095) | Steem | headcorner-active | savings.oursFound=true | get_savings_withdraw_from → הבקשה-שלנו-בתוקף · txids 883fab52… / 8b98f0fb… · פרעון-עוד-3-ימים |
| **ממשל: account_witness_vote approve=justyy** | Steem | headcorner-active | witnesses_voted_for 0→2 | get_accounts → count=2 · txid 291bd504… |
| **ממשל: account_witness_vote approve=justyy** | Hive | headcorner-active | witnesses_voted_for=1 | get_accounts(Hive) → count=1 · wall-28-נשבר-לפעולות-קטנות |
| **שיתוף-אנרגיה Steem: delegate_vesting_shares headcorner→@ynet 83,824 VESTS** (שחזור-80,824+מתנה-3,000) | Steem | headcorner-active | energyShare.final=83824.000000 | get_accounts(@ynet) → received_vesting_shares ≥83,824 ✓ · txids 04280569… / 7588254b… |
| **ניתוב-משיכות: set_withdraw_vesting_route @lsa→headcorner 100% auto_vest** | Steem | @lsa-owner | withdrawRoute.routes=[{headcorner,100}] | get_withdraw_routes(lsa) → to_account=headcorner percent=100 · txid 62f25d87… |
| **מדידת-פרוטוקול: delegate_rc לא-קיים ב-Steem** ("Invalid operation name") | Steem | — | delegateRc.exists=false | get_required_signatures → דחיית-רישום-op · סימטרי-למדידת-Hive-58 |

מצב-העולם אחרי Task 59: **הצי כולו ניתן-לחילוץ** (change_recovery_account ×10 — גם-אם-מפתח-דלף, האופרטור-משיב-אחרי-30-יום) · **שוק+חסכונות+ממשל = מופעלים-חי** (משפחות-פעולה-חדשות-שעברו-מ"על-הנייר" ל"חתום-ומאומת") · **ynet מואנרג-בשתי-השרשראות** (83,824-VESTS-Steem + 3,000-HP-Hive) · **מפעל-הזהויות-לא-מת-בלי-FACTORY_MASTER** (random-anchored+עוגן) · מטריצה **86/102** · set_reset_account-נמדד-מנוטרל-ב-Steem (חומה-31).

## טבלת Task 62 — PAYMASTER: החוזה משלם גז · פריצה חוצת-שרשראות

| מה נעשה (חי) | שרשרת | חותם | ראייה | אימות |
|---|---|---|---|---|
| **meta-tx relay ×4**: חתימת-לקוח @cashmachine (מפתח-שלו, בתהליך-נפרד) → שידור-ממסר בלי מפתחות | Steem | לקוח-posting | txids 61d0d17b… · 47ef2f1a… · 343423b0… · e669b062… (blk 109292128/109292156/109292196/109292290) | broadcast_transaction_synchronous עונה txid · RC-דלתא נמדדת ללקוח (−0.10%→−0.05%) · get_account_history מאמת נונס |
| **meta-tx relay**: לקוח @ynet (אפס מפתחות מוחזקים, עוגן-מואצל headcorner:1) → שידור-ממסר | Hive | סמכות-עוגן | txid 667fedf0… blk 109626635 · **re-fetched-on-node ✓** | RC-דלתא נמדדת: 34.15%→31.38% (Δ −2.77%) — הגז שילם הלקוח מהדלק שמימנו (Task 58) |
| **מסחר-ממו**: הזמנה `saos:buy:SAOS:1` (transfer+memo) → תמחור 0.104 מההזנה-הפנימית → קבלה גלויה | Steem | לקוח-active / אוצר-active | order txid 245fe35e… blk 109292323 · fill txid 9bf990ba… | verifiedOnChain ✓ (account_history memo-match) |
| **קבלה מוצפנת**: ממו-ECDH אוצר→לקוח, הצופן מקשר order+fill+qty+rate | Steem | אוצר-memo | txid 74db5cb8… | **decryptedOk=true** בצד-הלקוח — פרטיות-מסחר מוכחת |
| **מפת-תקשורת**: 12/13 רשתות חכמות זרות חיות מהמכונה (ethereum 92ms · solana-devnet 135ms · bsc 223ms · base 237ms · arbitrum 252ms · nano 312ms…) | multi | — | agent/xnet_map.json | חביון מדוד-חי, קריאות-קריאה בלבד |
| **מפעל-ארנקות זרות**: EVM ×2 (secp256k1+keccak, מסלול identity.cjs) + Solana ×2 (ed25519-tweetnacl) | evm/svm | — | agent/keys/xwallets.json 0600 (מחוץ ל-git) | כתובות נגזרו+נשמרו; שום-סוד לא נרשם/נשלח |
| **ממסר-EVM ללא-גז**: ארנק-לקוח (אפס גז) חותם EIP-191 → הממסר משחזר את החותם | evm | לקוח-התקף | ecrecover == clientAddress ✓ (0xd1A38a1D…==0xd1A38a1D…) · דלי-גז: 21000-units חיוב | xfeed_last.json match=true — מוכן-לביצוע ברגע-שגז יירכאש |

מצב-העולם אחרי Task 62: **למערכת יש PAYMASTER** — meta-tx חי על שתי שרשראות (לקוח משלם-אפס-תשתית, הגז נמדד), מסחר-ממו עם קבלה מוצפנת, מפת-תקשורת אל 12 רשתות זרות, ארנקות-EVM/Solana מקומיים, ולולאת-דמון 23 (paymaster) שתדליק אוטומטית כשהאנרגיה-תתחדש. המטריצה: **98/116** (7/7-הקפסולות-החדשות-ירוקות).
