import { NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/trondex — 110: THE-DEX (דקס-המפלצת) — הדקס-האמת על-הרשת-החינמית.
 *
 * התשובה-הריבונית ל"דקס-מפלצתי-בטרון-בלי-גז":
 *  · ספר/התאמות/בריכות על-השרשרת-שלנו — אפס-גז (קרנל pool_x · 30bps → LP+אוצר).
 *  · WTRX = קרדיט-טרון-עטוף 1:1 מול-כספת-חיה — **מתוקנן-חי** (trondex.cjs מודד
 *    טרונגריד ומכוון supply/locked לכיסוי-אמת; המדידה-הטרייה כאן בקובץ-החי).
 *  · התיישבות = דלתות-relay (אפס-עמלה) — פדיון-WTRX → TRX אמת בין-כתובות-הכספת
 *    → txid + tronscan. קריאות-חוזה-חכם (TRC20) — חומת-אנרגיה-כנה (נמדד 0).
 *  · אימות-אח — המופע-התאום-מאמת-את-הדלתות-שלנו-מהשרשרת (W22) ואנחנו-את-שלו
 *    (kernel-110 op sibling · sibling.cjs) — לולאת-אימות-הדדית-על-שתי-השרשרות.
 *
 * ה-API לעולם לא 500 — מצב-לא-זמין-הוא-מצב-מוצהר, לא-שגיאה.
 */

const ROOT = process.cwd();
const SOV = path.join(ROOT, "sovereign", "node");

async function readJson(p: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(p, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function ageSec(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 1000));
}

interface RelayRec {
  ref?: string;
  status?: string;
  txid?: string | null;
  payload?: { chain?: string; amountSun?: number; toIdx?: number; note?: string };
  escrowµ?: number;
  spentSun?: number;
  refundµ?: number;
}
interface SiblingRec {
  txid: string;
  kind: string;
  verdict: string;
  contract?: string | null;
  step?: number | null;
  note?: string | null;
  at?: string | null;
}

export async function GET() {
  try {
    const snap = (await readJson(path.join(SOV, "state-snapshot.json"))) as { st?: Record<string, any>; height?: number } | null;
    const st = (snap && snap.st) || {};
    const daemonBook = (await readJson(path.join(SOV, "state.json"))) as Record<string, any> | null;
    const live = (await readJson(path.join(SOV, "trondex-live.json"))) as { sun?: number; block?: number; at?: string; per?: { idx: number; addr: string; sun: number }[] } | null;

    const wrapped = (st.wrapped && (st.wrapped.WTRX as { supply?: number; locked?: number; redeemed?: number })) || { supply: 0, locked: 0 };
    const pool = (st.poolsX && (st.poolsX["WTRX/SAOS"] as { a?: number; b?: number; lpSupply?: number; feeBps?: number })) || null;
    const hc = (st.accounts && (st.accounts.headcorner as { saos?: number; wrapped?: Record<string, number> })) || { saos: 0, wrapped: {} };
    const relayOpen = ((st.relay && (st.relay.open as Record<string, RelayRec>)) || {}) as Record<string, RelayRec>;
    const dexDoors = Object.values(relayOpen)
      .filter((r) => r.payload && r.payload.chain === "monster-dex")
      .map((r) => ({
        ref: r.ref,
        status: r.status,
        txid: r.txid || null,
        amountSun: r.payload?.amountSun ?? null,
        toIdx: r.payload?.toIdx ?? null,
        note: r.payload?.note ?? null,
        verifyUrl: r.txid ? "https://tronscan.org/#/transaction/" + r.txid : null,
      }));

    const siblings = (st.siblings as { recs?: SiblingRec[] } | null) || { recs: [] };
    const sibRecs = siblings.recs || [];

    const supply = wrapped.supply || 0;
    const locked = wrapped.locked || 0;
    const liveMu = live && typeof live.sun === "number" ? Math.round(live.sun / 1000) : null;
    const coverage =
      liveMu != null
        ? {
            supplyMu: supply,
            lockedMu: locked,
            liveMu,
            supplyTrx: supply / 1000,
            lockedTrx: locked / 1000,
            liveTrx: liveMu / 1000,
            perfect: supply === locked && locked === liveMu,
            status: supply === locked && locked === liveMu ? "1:1-אמת" : "דריפה-נמדדת",
          }
        : null;

    const doorsLogAge = await stat(path.join(SOV, "relay-doors.log"))
      .then((s) => Math.max(0, Math.round((Date.now() - s.mtimeMs) / 1000)))
      .catch(() => null);

    const nativeBook = (daemonBook && (daemonBook.book as { lastPrice?: number })) || {};

    return NextResponse.json(
      {
        ok: true,
        at: new Date().toISOString(),
        height: (st.meta && st.meta.height) || (snap && snap.height) || null,
        pair: "WTRX/SAOS",
        coverage,
        vault: live
          ? { sun: live.sun || 0, tronBlock: live.block || null, at: live.at || null, ageSec: ageSec(live.at), per: (live.per || []).map((p) => ({ idx: p.idx, addr: p.addr, trx: (p.sun || 0) / 1e6 })) }
          : null,
        pool: pool
          ? { aMu: pool.a || 0, bMu: pool.b || 0, aTrx: (pool.a || 0) / 1000, bSaos: (pool.b || 0) / 1000, mid: pool.a > 0 ? (pool.b || 0) / pool.a : null, lpSupply: pool.lpSupply || 0, feeBps: pool.feeBps ?? 30 }
          : null,
        swapsX: (st.meta && st.meta.swapsX) || 0,
        issuer: { saos: (hc.saos || 0) / 1000, wtrx: ((hc.wrapped && hc.wrapped.WTRX) || 0) / 1000 },
        nativeBookLastPrice: typeof nativeBook.lastPrice === "number" ? nativeBook.lastPrice : null,
        settlement: { doors: dexDoors, sent: dexDoors.filter((d) => d.status === "sent").length, queued: dexDoors.filter((d) => d.status !== "sent").length },
        relayerAlive: doorsLogAge != null && doorsLogAge < 180,
        siblings: {
          total: (st.meta && st.meta.siblingsTotal) || sibRecs.length,
          verified: (st.meta && st.meta.siblingsVerified) || sibRecs.filter((r) => r.verdict !== "rejected").length,
          peer: "steem-engeiner-W22",
          recs: sibRecs.slice(-8).reverse(),
        },
        energyWall: {
          measured: "אנרגיה-0 בכל-6-כתובות-הכספת (נמדד 110 · העברת-TRC20 ≈ 65,000-אנרגיה)",
          freeRails: "TRX-מקורי: Bandwidth-חינם-בין-כתובות-משלנו · ספר+התאמות: אפס-גז-על-השרשרת-שלנו",
          paths: ["האצלת-אנרגיה-אלינו (חינם-למאציל-ולנו) → קריאות-חוזה-חינם-מיידיות", "פיקדון-GAS-SETTLE (109) — החוזה-משלם-את-ההוצאה-המדודה", "התיישבות-native-TRX — כבר-חיה-ומוכחת-בכל-דלת"],
        },
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message || e).slice(0, 140) }, { status: 200 });
  }
}
