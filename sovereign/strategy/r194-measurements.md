# r194-b — מדידות-חיות לגל-r194 · 2026-10-04T11:00–11:05Z

שיטה: bun-scripts keyless קריאה-בלבד (sovereign/tmp/r194b-m1..m5.mjs), timeout 6–7ש', ניסיון-אחד, כשלים-כנים. דאמפים: sovereign/tmp/r194b-*.json.

## 1. בדיקות-מקור-מחיר BLURT + SBD (המשימה-הקריטית: מרכז-הגריד)

| מקור | BLURT | SBD | הערה |
|---|---|---|---|
| CoinGecko simple/price | **עובד — $0.00130526** | **עובד — $0.600405** | ה-429 ההיסטורי נפתח-בחלון-זה; נמדד-פעמיים |
| CoinPaprika ticker | 404 (id קיים, is_active:false) | 404 (sbd-steem-dollars, is_active:false) | search עובד: רק STEEM/HIVE פעילים |
| CryptoCompare | 401 | 401 | **מדיניות-השתנתה — נדרש API-key מאז-r193** |
| CoinCap v2 | אין-חיבור | אין-חיבור | השירות נפל/הופסק |
| MEXC/Poloniex/Binance | 400 (אין-רישום) | — | אין-BLURT-ב-CEX-אלה |
| Coinlore top-100 | לא-קיים | — | — |
| DexScreener (BEP20 0xb045…7dcc) | pairs:null | — | אין-בריכות |
| GeckoTerminal (BEP20) | טוקן-קיים, price:null, reserve $31.46 | — | אבק |
| **גזירה** (paprika-STEEM÷פיד-Steem) | — | **$0.608** (Δ1.3% מ-CG) | 0.06330÷0.10410 |
| **גזירה** (SWAP.BLURT×paprika-HIVE) | **$0.000983** (Δ~25% מ-CG) | — | ספר-HE-דק |

## 2. ספרים-פנימיים (רענון-טרי)

- **Steem** (api.steemit.com): פיד 0.10410 SBD/STEEM (58.269M/559.747M) · spread **417.6bps** (bid 0.10009 / ask 0.10436) · top-5: bids 3,934.8 STEEM ≈ 393.7 SBD מול asks 65.8 STEEM ≈ 6.9 SBD — **סקיו-מכירות-עמוק** · get_volume: 2,408.3 STEEM / 247.6 SBD.
- **Hive** (api.hive.blog): פיד 0.056 HBD/HIVE · spread **15.5bps** (bid 0.056202 / ask 0.056290) · top-5: bids 154.4 HIVE (8.7 HBD), asks 452.2 HIVE (25.5 HBD) · get_volume: 9,016.9 HIVE / 507.5 HBD — **הספר-הנושם-היחיד**.

## 3. Hive-Engine (market.metrics, 200-שווקים)

- Σ-ווליום-כפי-שדווח (יחידות-מעורבות-לכל-טוקן) **39,146.6** · top: DEC 12,507 · SWAP.LTC 9,491 · SWAP.BTC 3,503 · **SWAP.BLURT 2,363.7** · BEE 1,791.8 · ANTS 1,750 · BEECASH 1,303 · **SWAP.HBD 986.9** · ICON 885.9 · SWAP.DOGE 818.1 · SWAP.STEEM 504.5.
- **SWAP.BLURT: bid 0.01747396 / ask 0.01748521 HIVE** (ספרד-נומינלית ~0.6bps) — מחיר-BLURT-החי-היחיד-על-דקי-הרשתות; SWAP.HIVE-עצמו אין-שורת-metrics (שלילה-נמדדת); SWAP.HBD 17.67 HIVE ↔ פיד-השרשרת 17.86 — עקבי.

## 4. TRON (keyless, trongrid)

- TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy: **2.000002 TRX · TRC-20: [] (אפס-USDT)** — הארנק-ריק-מהותית.

## 5. Gateway-מקומי (127.0.0.1:3000)

- /api/health 200: account cashmachine · headBlock **110,144,185** · db 23-טבלאות · כל-הבדיקות-תקינות ("נמדד-עכשיו"). /api/sovereign: timeout>6ש' — דולג-בכנות.

## 6. משמעות-ל-r194

1. **מרכז-BLURT-ל-WBLURT/USDS: CoinGecko הוא-המקור-היחיד-שעובד** ($0.001305) — לחוות-אותו-כ-fallback-ראשון-בגריד עם backoff+cache ל-429; גזירת-חירום SWAP.BLURT×HIVE (paprika-HIVE $0.05628 פעיל) כשה-CG-חסום; בלי-אף-אחד מהם — להשהות-צד-BLURT-בכנות, לא-להמציא-מרכז.
2. **עקביות-מאומתת**: גזירת-SBD-מ-STEEM×פיד = $0.608 מתלכדת-עם-CG-$0.6004 (Δ1.3%) — הפיד-וה-CEX-מצביעים-ביחד; **SBD-מוסח-בכנות-סביב-$0.60, לא-$1** — ייחוס-USDS-חייב-להישאר-L5 (משווק-ל-SBD-אמיתי).
3. **ספר-Steem-עוד-יותר-משופע-למכירות** (asks-$6.9-בלבד ב-top-5) — ה-L3-SKEW-HALT-צודק; כל-גל-ה-convert-יגיע-לספר-ריק-ממכרות → הגריד-שלנו-הוא-הנזילות.
4. **Hive-Engine-התעורר-מעט** (Σ39.1K מול 33.4K ב-r193) ו-SWAP.BLURT-עם-ווליום-אמיתי — רגל-BLURT-על-HE-היא-מקור-הצלבה-שני-וגם-מקום-אפשרי-לגריד-השני.
5. **TRON-ריק (2-TRX)** — כל-רגל-TRC-20-מחייבת-זריעת-גז-קודם; לא-לתכנן-החלפות-שם-לפני-כן.
