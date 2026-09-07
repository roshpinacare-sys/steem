import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/dexquality — 112: בקרת-איכות הדקס ("מעקב-איכותי אחרי הדברים שנבין").
 *
 * לכל-צמד ב-poolsX מחשב-חי מהמצב-הריבוני:
 *  · עתודות a/b · mid · TVL (במונחי-SAOS) · feeBps
 *  · סחירות אריתמטית: minBuyIn — הקלט-המזערי ל-B2A שמוציא ≥1µ (a≤1 → ∞ = מת-אריתמטית)
 *  · פעילות אמת: סריקת-זנב-הארכיון — כמה pool_x על-הצמד + גובה-אחרון (לא-הצהרה — מדידה)
 *  · גיבוי: wrapped[sym] supply/locked + ref-הנעילה (קישור-אמת-חוץ ל-STEEM)
 *  · מפת-מחירים-פנימית: SAOS/STEEM דרך-WSTEEM מול-דרך-WTRX×(שוק-חוץ) — פער-ארביטרז' מתועד
 *  · insights — מה-אנחנו-מבינים עכשיו: כללים-דטרמיניסטיים + עובדות-112 (dex-facts.json)
 *
 * ה-API לעולם לא 500 — מצב-לא-זמין-הוא-מצב-מוצהר.
 */

const ROOT = process.cwd();
const SOV = path.join(ROOT, "sovereign", "node");
const ACTIVITY_WINDOW_LINES = 2600;

async function readJson<T = Record<string, unknown>>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(p, "utf8")) as T;
  } catch {
    return null;
  }
}

interface PoolRow {
  a: number;
  b: number;
  lpSupply: number;
  feeBps: number;
  symA: string;
  symB: string;
}

interface Facts {
  note?: string;
  events?: { at: string; kind: string; text: string; ref?: string; url?: string }[];
}

function tailLines(buf: string, n: number): string[] {
  const lines = buf.split("\n");
  return lines.slice(Math.max(0, lines.length - n));
}

export async function GET() {
  try {
    const snap = (await readJson<{ st?: Record<string, any>; height?: number }>(path.join(SOV, "state-snapshot.json"))) || { st: {} };
    const st = (snap.st || {}) as Record<string, any>;
    const pools = (st.poolsX || {}) as Record<string, PoolRow>;
    const wrapped = (st.wrapped || {}) as Record<string, { locked?: number; supply?: number; refs?: Record<string, boolean> }>;
    const prices = (st.assetPrices || {}) as Record<string, { px?: number }>;
    const facts = (await readJson<Facts>(path.join(SOV, "dex-facts.json"))) || {};
    const height = (st.meta && st.meta.height) || (snap.height as number) || 0;

    /* פעילות אמת מזנב-הארכיון — מדידה, לא-הצהרה */
    const activity: Record<string, { swaps: number; lastH: number | null; lastSide: string | null }> = {};
    try {
      const buf = await readFile(path.join(SOV, "chain-archive.jsonl"), "utf8");
      for (const line of tailLines(buf, ACTIVITY_WINDOW_LINES)) {
        if (!line || line[0] !== "{") continue;
        let b: { height?: number; txs?: { type?: string; pair?: string; side?: string }[] } | null = null;
        try {
          b = JSON.parse(line);
        } catch {
          continue;
        }
        for (const t of b?.txs || []) {
          if (t.type === "pool_x" && t.pair) {
            const k = t.pair;
            activity[k] = activity[k] || { swaps: 0, lastH: null, lastSide: null };
            activity[k].swaps += 1;
            activity[k].lastH = Number(b.height) || activity[k].lastH;
            activity[k].lastSide = t.side || activity[k].lastSide;
          }
        }
      }
    } catch {
      /* ארכיון-לא-זמין — פעילות נשארת ריקה בכנות */
    }

    const pairs = Object.entries(pools).map(([pair, p]) => {
      const [A, B] = pair.split("/");
      const a = p.a || 0;
      const b = p.b || 0;
      const mid = a > 0 ? b / a : null;
      /* minBuyIn: ה-B2A הקטן-שמוציא ≥1µ: in ≥ b/(a−1) כש-a>1; a≤1 → ∞ (מת-אריתמטית) */
      const minBuyIn = a > 1 ? Math.ceil(b / (a - 1)) : null;
      const minSellIn = b > 0 ? 1 : null;
      const tvlMu = mid != null ? b + a * mid : b; // במונחי-SAOS-µ
      const act = activity[pair] || { swaps: 0, lastH: null, lastSide: null };
      const ageBlocks = act.lastH ? Math.max(0, height - act.lastH) : null;
      const w = wrapped[A] || { locked: 0, supply: 0, refs: {} };
      const ratio = w.locked && w.supply != null ? w.supply / w.locked : null;
      const lockRef = Object.keys(w.refs || {})[0] || null;
      const isSteemNative = A === "WSTEEM";
      const verifyUrl = lockRef && isSteemNative ? "https://steemscan.com/transaction/" + lockRef : null;
      let badge: string;
      if (minBuyIn == null || b <= 0) badge = "יבש-מוכח · פתוח-להפקדה";
      else if (act.swaps > 0 && ageBlocks != null && ageBlocks < 4000) badge = "חי · זרימה-דו-כיוונית";
      else badge = "זמין-למסחר";
      return {
        pair,
        symA: A,
        symB: B,
        aMu: a,
        bMu: b,
        mid,
        midText: mid != null ? mid.toFixed(mid != 0 && Math.abs(mid) < 0.01 ? 5 : 3) : "—",
        tvlSaos: tvlMu / 1000,
        feeBps: p.feeBps ?? 30,
        lpSupply: p.lpSupply || 0,
        minBuyInMu: minBuyIn,
        minSellInMu: minSellIn,
        activity: { swaps: act.swaps, lastH: act.lastH, ageBlocks, lastSide: act.lastSide, windowLines: ACTIVITY_WINDOW_LINES },
        badge,
        backing: { sym: A, locked: w.locked || 0, supply: w.supply || 0, ratio, lockRef, verifyUrl },
      };
    });

    /* מפת-מחירים-פנימית — SAOS/STEEM בשתי-הדרכים */
    const wsteem = pools["WSTEEM/SAOS"];
    const wtrx = pools["WTRX/SAOS"];
    const steemPx = prices.WSTEEM && prices.WSTEEM.px ? prices.WSTEEM.px : null; // USD×1e9
    const tronPx = prices.WTRX && prices.WTRX.px ? prices.WTRX.px : null;
    let cross: Record<string, unknown> = null;
    if (wsteem && wsteem.a > 0 && wtrx && wtrx.a > 0) {
      const viaWsteem = wsteem.b / wsteem.a / 0.001; // SAOS per STEEM (1 WSTEEM = 0.001 STEEM)
      const saosPerTrx = wtrx.b / wtrx.a;
      const steemPerTrx = steemPx && tronPx ? steemPx / tronPx : null;
      const viaWtrx = steemPerTrx ? saosPerTrx / steemPerTrx : null; // SAOS per STEEM דרך-WTRX×שוק-חוץ
      const gapPct = viaWtrx ? ((viaWsteem - viaWtrx) / viaWtrx) * 100 : null;
      cross = {
        saosPerSteemViaWSTEEM: viaWsteem,
        saosPerSteemViaWTRX: viaWtrx,
        steemPerTrxMarket: steemPerTrx,
        gapPct,
        siblingW25: { steemPerSaos: 0.0302, note: "הבריכה של האח (W25) — SAOS על-STEEM; הפער-מולנו = מפת-ארביטרז' בין-שתי-ריבונויות" },
      };
    }

    /* insights — מה-אנחנו-מבינים (כללים-חיים על-המצב + עובדות-האירועים) */
    const insights: { at: string; kind: string; text: string; ref?: string; url?: string }[] = [];
    for (const p of pairs) {
      if (p.badge.startsWith("חי")) insights.push({ at: new Date().toISOString(), kind: "live", text: `${p.pair}: חי — ${p.activity.swaps} סוופים בחלון-המדידה, mid ${p.midText} ${p.symB}/${p.symA}, TVL ${p.tvlSaos.toFixed(1)} SAOS` });
      if (p.badge.startsWith("יבש")) insights.push({ at: new Date().toISOString(), kind: "open", text: `${p.pair}: יבש-מוכח (עתודת-מניעה ${p.aMu}µ) — אריתמטית-לא-ניתן-לקנות; דורש הפקדה-אמת של ${p.symA} (לא-מנפיחים-מחיר-בלי-גיבוי)` });
      if (p.backing.ratio != null && Math.abs(p.backing.ratio - 1) > 0.02) insights.push({ at: new Date().toISOString(), kind: "backing", text: `${p.symA}: סטיית-גיבוי ${((p.backing.ratio - 1) * 100).toFixed(1)}% (supply ${p.backing.supply}µ / locked ${p.backing.locked}µ) — נמדד, מפוקח` });
    }
    if (cross && typeof cross.gapPct === "number" && Math.abs(cross.gapPct) > 5)
      insights.push({ at: new Date().toISOString(), kind: "cross", text: `פער-פנימי SAOS/STEEM: דרך-WSTEEM ${(cross.saosPerSteemViaWSTEEM as number).toFixed(2)} מול-דרך-WTRX×שוק ${(cross.saosPerSteemViaWTRX as number).toFixed(2)} (${cross.gapPct.toFixed(1)}%) — מסלול-ארביטרז' פנימי מתועד; המסחר-החופשי יסגור-אותו` });
    insights.push(...(facts.events || []));

    return NextResponse.json(
      {
        ok: true,
        at: new Date().toISOString(),
        height,
        pairsCount: pairs.length,
        pairs: pairs.sort((x, y) => y.tvlSaos - x.tvlSaos),
        cross,
        insights: insights.slice(0, 40),
        factsNote: facts.note || null,
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message || e).slice(0, 140) }, { status: 200 });
  }
}
