# r193-a — מודיעין-שווקים DEX (גל-r193) · 2026-10-04

שיטה ושקיפות: שירות web-search של z-ai היה תקוע ב-429 לאורך כל הגל (ניסיונות חוזרים 40+ מדודים); Bing-דרך-curl מחזיר תוצאות-זבל אנטי-בוט (נמדד — אין לסמוך). עקב-כך בוצעו 8-שאילתות-החובה כ-**מדידות-חיות-ישירות + גרירת מקורות-קנוניים** — כל טענה כאן עם URL שנשלף בפועל. מדידות-חי: 2026-10-04T09:00–09:35Z.

## 1. שיא-הטכנולוגיה

- **Uniswap v4 hooks**: כל-בריכה יכולה להתחבר לחוזה-hook חיצוני בעת `PoolManager.initialize` — ה-hook חדיר לנקודות-חיים של הבריכה (רשות, לא חובה). מקור: https://docs.uniswap.org/contracts/v4/concepts/hooks
- **עמלות-דינמיות ב-v4**: ה-fee משתנה בזמן-אמת, עד פר-swap, בכל אחוז; הרציונל הרשמי — תמחור תנודתיות "כמו ספרדים בבורסה מסורתית" והבחנת-זרימת-הזמנות (ארביטראז מול מודיע). **אימות-ישיר לחוק-L3 שלנו (fee≥תנודתיות×√interval, רצפת-ספרד)**. מקור: https://docs.uniswap.org/contracts/v4/concepts/dynamic-fees
- **UniswapX (2023→)**: מודל-כוונות (intents) — מכרז-הולנדי, רשת-fillers חיצונית מתחרה על המילוי; היתרונות המוצהרים: מחירים טובים מצבירת-נזילות, סוופ ללא-גז, הגנת-MEV, אפס-עלות-עסקאות-כושלות. מקור: https://blog.uniswap.org/uniswapx-protocol
- **CoW Protocol**: ההזמנה היא **חתימה על הודעת-כוונה** (לא טרנזקציה-מבצעת); solvers מתחרים על הסטלמנט, כולל CoW — התאמת-רצונות-הפוכים P2P במחיר-פאריטה. מקור: https://docs.cow.fi/cow-protocol/concepts/intents
- **1inch (Fusion/Business)**: פלטפורמת-תשתית SaaS — סוופים intent-based וחוצי-שרשרות על 15+ רשתות, מפתח-API אחד, ו-**"AI-ready": כל API מחזיר JSON נקי + שרת MCP** לסוכנים. הכיוון-המסחרי שבו אנחנו כבר (עם שער-הסוכנים). מקור: https://docs.1inch.io/docs/fusion/introduction
- **ERC-7683**: ממשק-סטנדרטי פונה-לסולברים לפרוטוקולי-כוונות — הפרוטוקול חושף הזמנות כ-payload אטום + חוזה-resolver שהסולבר קורא ב-eth_call; המנוע לראוטינג-חוצה-שרשרות בלי לבנות סולבר-פרטי. מקור: https://eips.ethereum.org/EIPS/eip-7683
- **x402**: תשלומי-HTTP-נייטיב לסוכנים (HTTP 402 → תשלום → retry), middleware בשורה-אחת, **אפס-עמלות-פרוטוקול**. סטטיסטיקה חיה-מוצהרת באתר (30-ימים): **75.41M טרנזקציות · $24.24M ווליום · 94.06K קונים · 22K מוכרים**. מקור: https://x402.org
- **מרכוז-נזילות-ניהולי על בריכות (דפוס-ה"גריד-על-בריכות")**: Steer Protocol — ניהול-נזילות-מרוכזת אוטומטי על 27+ רשתות/32-DEX, hooks ל-Uni-v4/Algebra/Pancake-v4 עם **rebalancing אוטומטי וארכיטקטורת-vault ERC-4626**. תשתית-מוכנה למי שרוצה גריד-על-AMM — לא לבנות מחדש. מקור: https://docs.steer.finance/

## 2. נוף-Steem/Hive/Blurt (מדוד-חי)

- **שוק-פנימי-Steem**: פיד 0.10409 SBD/STEEM (58.269M SBD / 559.743M STEEM); top-ask 0.10436 (362 STEEM בלבד), top-bid 0.10009, עומק-בידים סביר (200.17 SBD, 133.8 SBD, 100.9 SBD) ופניות-דקות — **ספרד ~418bps**; `get_market_history` 24h מחזיר 0-נקודות גם על api.steemit.com וגם על api.justyy.com (תנועה-נמדדת ≈ אפס). עדכון-חי של ממצאי r192-d (−88..−200bps מול CEX, skew 0.923). מקורות (JSON-RPC condenser_api): https://api.steemit.com · https://api.justyy.com
- **שוק-פנימי-Hive**: פיד 0.056 HBD/HIVE; הספר דו-צדדי **ועם-עומק-אמיתי**: bids עד 93,381 HIVE (5.25 HBD) ו-61,012 HIVE (5.63 HBD) ברמה הראשונה; asks החל מ-0.05638 (2,022 HIVE) — הספר היחיד מבין השלושה שנושם. מקור: https://api.hive.blog
- **Hive-Engine**: 24h-ווליום Σ-100-השווקים המובילים ≈ **33,424 SWAP.HIVE ≈ $1.9K/יום** בלבד. חלוקה: DEC 13.8K · SWAP.LTC 9.5K · SWAP.BTC 3.4K · BEE 1.8K · SWAP.HBD 987 · **SWAP.STEEM 505**. מקור: https://api.hive-engine.com/rpc/contracts (market.metrics). הערת-כנות-לשאילתה "BeDEX": לא עולה כפרויקט-DEX מבוסס על Hive-Engine — תג beedex על-השרשרת הוא פוסט-איירדרופ-יחיד-מ-2022 (נמדד: https://api.hive.blog, get_discussions_by_created tag=beedex); ה-DEX האמיתי שם הוא ה-frontend של hive-engine.com/TribalDex (טוקן BEE) — https://hive-engine.com/
- **Blurt**: **הספר-הפנימי ריק לחלוטין** (get_order_book[50] → 0 asks/0 bids, נמדד-חי: https://rpc.blurt.blog); אין-מנגנון-SBD בכלל (השיטה get_current_median_history_price אינה-קיימת ב-RPC — החוב הוסר בפורק); supply 607.28M BLURT; קיים BLURT-עטוף-BEP20 `0xb0458283033e5a3f7867f409477f53754b667dcc` (https://api.coinpaprika.com/v1/search/?q=blurt). CoinPaprika מסמן **גם SBD וגם BLURT is_active:false / rank 0** — הוסרו ממדדי-השוק (https://api.coinpaprika.com/v1/search/?q=steem%20dollar).
- **מסקנת-הנוף**: על שלושת-הפסים אין נזילות-מסחרת חוץ-מספר-Hive — מי שבונה שם AMM/גריד מתחרה בריק; הספרים הפנימיים הם המקום-היחיד שבו נוכל להיות **עושה-השוק** (וממילא עושה-שוק נוכחי אין — ספר-Steem שוקק 362-STEEM בפניות).

## 3. מה-מיישמים-עכשיו (קשר-ישיר ל-r192 שנסגר)

- סולם-הפאריטה v1.3.1-r192 עם עמלות-דינמיות+HALT-skew — זהה-מהותית ל-v4-dynamic-fees; הקנון שלנו כבר בשיא-התעשייה (worklog r192-a).
- שער-הסוכנים /api/exchange/agent (ERC-8004 13/13 + x402-402 + קפסות) — חי (worklog r192-c); x402 עצמו מוכיח דפוס HTTP-402-חתימה.
- גלאי-ארביטראז :3050 — סורק בדיוק את הספרים שנמדדו כאן; המדידות שלעיל הן הקלט למיקום-הסולם.
- W1-חוזים (AMM-30bps) ממתינים לרשות-פריסה על Zero — היזהר: אין להציב AMM-מול-ספר-חי (ראו §2).

## 4. איך-מנצחים: ראוטר-סוכנים-ראשון (ERC-8004+x402)

1. **השוק של תשלומי-סוכנים כבר-התבגר** (75M-tx/30d ב-x402) ואילו על פסי Steem/Hive/Blurt אין אף שחקן — הצטלבות נדירה: תשתית-סוכנים קיימת אצלנו (8004+x402+קפסות) מול שוק-ריק-לגמרי של מתחרים.
2. **דפוס-1inch**: API-אחד keyless-לציטוט + AI/MCP-ready JSON — השער שלנו כבר מוציא quote ציבורי; להשלים דוק-MCP דק בכתיבה-אחת.
3. **דפוס-CoW/UniswapX**: אין לנו מה להרוויח מרשת-solvers עוד-לא — אבל עקרון-הכוונה-החתומה (בלי-טרנזקציה-מבצעת) כבר מיושם אצלנו בחתימת-personal_sign; חיזוק-EIP-712 הוא הצעד הבא המוצהר.
4. **ראוטינג-חוצה-שרשרות דרך ERC-7683**: כשיהיה ווליום — להציג את ההזמנות שלנו בחוזה-resolver תואם-7683 ולתת לסולברים קיימים למלא — בלי גשר-משלנו (חוק-L4).
5. **גריד-על-בריכות**: לא לבנות — להיעזר (מתכונת Steer/hooks) רק אחרי שלבריכות W תהיה עומק; עוד-לפני-זה, גריד-על-**ספר** הוא המנוע-הנכון והוא חי.
6. **פדיון-אמת-1:1+PoR** נשאר המואץ הבלעדי על הפסים (אף רכיב מקומי לא מציע — נמדד §2).

## 5. סיכונים

- **נזילות-ריקה**: ספר-Steem ~418bps ספרד ופניות-362STEEM; HE $1.9K/יום; Blurt ריק — כל-ארביטראז/גריד חייב עומק-בר-ביצוע לפי-L1, אחרת מדידה-יפה-שלא-ניתנת-לביצוע.
- **סטטיסטיקת-x402 מוצהרת-ע"י-הפרויקט עצמו** (אין-ביקורת-חיצונית בעמוד) — להשתמש ככיוון, לא כערובה. מקור: https://x402.org
- **חלון-היתרון מצטמצם**: 1inch כבר משווקת AI/MCP כמוצר-SaaS — מי-שמבשל-שער-סוכנים-זהים-מהר-ירוויח; איחור = ריפוד-תחרותי. מקור: https://docs.1inch.io/docs/fusion/introduction
- **כלי-החיפוש של הסביבה שבירים** (z-ai 429 ממושך; Bing-curl מזויף) — מודיעין-עתידי חייב ערוץ-גיבוי (מדידות-RPC-ישירות, כמו-כאן) ולא לסמוך על מנוע-אחד.
- **ERC-7683 עדיין Draft** (לא-Final) — תלות-סטנדרטית לפני-התייצבות. מקור: https://eips.ethereum.org/EIPS/eip-7683
- **Blurt ללא-עוגן-מחיר** (אין-פיד/ספר-ריק) — כל-WBLURT הוא-אשראי-שלנו בלבד; פדיון-1:1 חייב רזרבה-מוכחת-PoR לפני-כל-מינט. מקור: https://rpc.blurt.blog

## 6. מפת-מדידות-חיות (לשימוש-חוזר של הגלים-הבאים)

כל-אחת מהנקודות הבאות נשלפה בפועל בגל-זה (curl/JSON-RPC, keyless, קריאה-בלבד):

- `POST https://api.steemit.com` · `condenser_api.get_order_book[10]` · `get_current_median_history_price` · `get_market_history(86400,3600)` — ספר-Steem ופיד.
- `POST https://api.justyy.com` — אותן-השיטות (הקנון-הריבוני: steemit→justyy).
- `POST https://api.hive.blog` — ספר-Hive, פיד, וחיפוש-דיונים על-השרשרת (get_discussions_by_created, תג beedex/bedex).
- `POST https://rpc.blurt.blog` — ספר-Blurt (ריק), בדיקת-קיום-שיטות, dgpo (supply 607.28M).
- `POST https://api.hive-engine.com/rpc/contracts` — method `find` על `market.metrics` (ווליום-24h לכל-טוקן).
- `GET https://api.coinpaprika.com/v1/search/?q=...` — סטטוס is_active/rank של SBD/BLURT.
- עמודי-קנון שנשלפו ופוענחו: docs.uniswap.org (hooks, dynamic-fees) · blog.uniswap.org (UniswapX) · docs.cow.fi (intents) · docs.1inch.io (fusion) · eips.ethereum.org (EIP-7683) · x402.org · docs.steer.finance.
- **לא-עבדו בגל-זה**: z-ai web_search (429 ממושך) · Bing-via-curl (תוצאות-מזויפות) · CoinGecko-API (429) · rpc.blurt.world (לא-עונה) — לא להסתמך עליהם בלבד.
