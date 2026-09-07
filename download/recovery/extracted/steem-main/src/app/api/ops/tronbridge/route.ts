import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/tronbridge — Task 90: הגשר הריבוני SAOS-NET ⇄ TRON.
 *
 * "הרשת שלנו נבחנת מול שרשרת חיצונית": ה-API מצליב בזמן-אמת מול TronGrid —
 *  · כיוון 1 (SAOS→TRON): הכמות על השרשרת === encodeAmount(checkpointHash) —
 *    כל אחד יכול לגזור את הכמות מה-hash ולהשוות (הוכחת-קשר ציבורית)
 *  · כיוון 2 (TRON→SAOS): ה-TXID עצמו נמצא בבלוק tron-anchor בספר הריבוני
 *    (הבלוק נקרא מ-chain.json — הספר עצמו מעיד)
 *  · ה-API לעולם לא 500 — מצב-לא-חי הוא מצב, לא שגיאה.
 */

const SOV = path.join(process.cwd(), "sovereign", "node");
const RPC = "https://api.trongrid.io";
const CACHE_MS = 60_000;

let cache: { at: number; body: Record<string, unknown> } | null = null;

async function tg<T>(p: string, timeoutMs = 8000): Promise<T | null> {
  /* retry ×2 — TronGrid מגביל-קצב קריאות לא-מאומתות; הימנעות-מפסימיות-שקרית */
  for (let i = 0; i < 2; i++) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeoutMs);
      const r = await fetch(RPC + p, { signal: ac.signal, cache: "no-store" });
      clearTimeout(t);
      if (r.ok) return (await r.json()) as T;
    } catch {}
    if (i === 0) await new Promise((r2) => setTimeout(r2, 1200));
  }
  return null;
}

/* אותו קידוד ציבורי כמו tronbridge.cjs — ניתן לשחזור עצמאי מה-hash בלבד */
function encodeAmount(cpHash: string): number {
  return 1_000_000 + (parseInt(String(cpHash).slice(0, 6), 16) % 1_000_000);
}

interface TronState {
  address?: string;
  addressRelay?: string;
  guards?: Record<string, unknown>;
  squadAddresses?: string[];
  squad?: SquadState;
  /* 92: pulse + נגזרות (מדינת-הגשר) */
  pulse?: { tronHeight?: number; tronBlockId?: string | null; at?: string; notedHeight?: number | null };
  derivatives?: { at?: string; contract?: string; readOnly?: boolean; usdt?: Array<{ role?: string; idx?: number; address?: string; usdt?: number | null }>; usdtTotal?: number; measured?: string };
  squadBound?: { at?: string; notedHeight?: number | null; count?: number; addresses?: string[] };
  anchors?: Array<{
    cpHeight: number;
    cpHash: string;
    txid: string;
    block?: number | null;
    netFeeSun?: number;
    amountSun: number;
    fractionHex?: string | null;
    verified?: boolean;
    notedHeight?: number | null;
    at: string;
  }>;
  wallet?: {
    sender?: { balanceTrx?: number; freeNetLeft?: number; freeNetLimit?: number };
    relay?: { balanceTrx?: number };
  };
  log?: string[];
}

interface SovState {
  tron?: {
    address?: string;
    relay?: string;
    anchors?: number;
    lastAnchor?: {
      cpHeight?: number;
      txid?: string;
      tronBlock?: number | null;
      netFeeSun?: number;
      amountSun?: number;
      notedHeight?: number | null;
    };
    height?: number;
    at?: string;
    /* 92: pulse 24/7 + קשירת-סדוגה + נגזרות */
    pulse?: { tronHeight?: number; tronBlockId?: string | null; at?: string; notedHeight?: number | null; error?: string };
    squadBound?: { notedHeight?: number; count?: number; at?: string };
    derivatives?: { usdtTotal?: number; measured?: string | null; at?: string; readOnly?: boolean; notedHeight?: number | null; valueInNotedHeight?: number | null };
  };
}

interface TronTxFull {
  ret?: Array<{ contractRet?: string }>;
  blockNumber?: number;
  raw_data?: { contract?: Array<{ parameter?: { value?: { amount?: number } } }> };
}
interface TronTxInfo {
  blockNumber?: number;
  receipt?: { net_fee?: string | number };
}
interface TronAccount {
  balance?: number;
}
interface TronResource {
  freeNetLimit?: number;
  freeNetUsed?: number;
}

/* 91: SQUAD — טבעת-החיילים על TRON (מבנה-המדינה של tronbridge.cjs) */
interface SquadMember { idx: number; address: string; activated?: boolean; balanceTrx?: number; balanceSun?: number; freeNetLeft?: number }
interface SquadFunding { idxTo: number; to: string; from: string; amountSun: number; txid: string; block?: number | null; netFeeSun?: number; burnSun?: number; verified?: boolean; notedHeight?: number | null }
interface SquadLeg { n: number; idxFrom: number; idxTo: number; from: string; to: string; amountSun: number; linked?: { kind?: string; ref?: string }; txid: string; block?: number | null; netFeeSun?: number; verified?: boolean; notedHeight?: number | null }
interface SquadRing { id: number; at: string; legs?: SquadLeg[]; closed?: boolean; zeroFeeAll?: boolean; verified?: boolean; burnSun?: number; notedHeight?: number | null; notedBlockHash?: string | null }
interface SquadState {
  version?: number;
  indices?: number[];
  members?: SquadMember[];
  funding?: SquadFunding[];
  rings?: SquadRing[];
  burnLedger?: { activationsSun?: number; netFeeSun?: number; totalSun?: number };
}
/* אותו קידוד ציבורי של רגלי-הטבעת — ניתן לשחזור עצמאי מה-ref בלבד */
function encodeLegAmount(refHex: string): number {
  return 400_000 + (parseInt(String(refHex).replace(/^0x/, "").slice(0, 6), 16) % 100_000);
}

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json({ ...cache.body, cached: true });
  }

  const out: Record<string, unknown> = {
    ok: true,
    task: 90,
    at: new Date().toISOString(),
  };

  try {
    const [tbRaw, sovRaw, chainRaw] = await Promise.all([
      readFile(path.join(SOV, "tron-bridge-state.json"), "utf8").catch(() => null),
      readFile(path.join(SOV, "state.json"), "utf8").catch(() => null),
      readFile(path.join(SOV, "chain.json"), "utf8").catch(() => null),
    ]);

    const tb: TronState | null = tbRaw ? (JSON.parse(tbRaw) as TronState) : null;
    const sov: SovState | null = sovRaw ? (JSON.parse(sovRaw) as SovState) : null;

    out.address = tb?.address ?? null;
    out.relay = tb?.addressRelay ?? sov?.tron?.relay ?? null;
    out.guards = tb?.guards ?? null;
    out.sovNote = sov?.tron ?? null;

    const anchors = (tb?.anchors ?? []).slice(0, 8);
    let liveOk = false;

    if (tb?.address) {
      /* קריאות חיות מול TronGrid (שרת-צד בלבד) */
      const [acct, res, acctR] = await Promise.all([
        tg<TronAccount>(`/wallet/getaccount?address=${tb.address}&visible=true`),
        tg<TronResource>(`/wallet/getaccountresource?address=${tb.address}&visible=true`),
        out.relay && out.relay !== tb.address
          ? tg<TronAccount>(`/wallet/getaccount?address=${out.relay}&visible=true`)
          : Promise.resolve(null),
      ]);
      if (acct !== null || res !== null) liveOk = true;
      out.wallet = {
        senderBalanceSun: acct?.balance ?? null,
        relayBalanceSun: acctR?.balance ?? null,
        freeNetLeft: Math.max(0, Number(res?.freeNetLimit ?? 0) - Number(res?.freeNetUsed ?? 0)),
        freeNetLimit: Number(res?.freeNetLimit ?? 0),
        live: liveOk,
      };

      /* הצלבה פר-עוגן: מהעסקה על TRON מול הקידוד של ה-cpHash מהספר שלנו */
      const enriched: Array<{
        cpHeight: number;
        cpHash: string;
        txid: string;
        expectedAmountSun: number;
        amountOnChainSun: number | null;
        encodedMatch: boolean | null;
        onChain: boolean;
        liveChecked: boolean;
        contractRet: string | null;
        tronBlock: number | null;
        netFeeSun: number;
        notedHeight: number | null;
        at: string;
      }> = [];
      for (const a of anchors) {
        const [tx, info] = await Promise.all([
          tg<TronTxFull>(`/wallet/gettransactionbyid?value=${a.txid}`),
          tg<TronTxInfo>(`/wallet/gettransactioninfobyid?value=${a.txid}`),
        ]);
        const amountOnChain = tx?.raw_data?.contract?.[0]?.parameter?.value?.amount ?? null;
        const ret = tx?.ret?.[0]?.contractRet ?? null;
        /* ret[0].contractRet קיים רק על עסקה מוכלת-בבלוק — עדות-הכלה בפני עצמו */
        const blk = info?.blockNumber ?? tx?.blockNumber ?? a.block ?? null;
        const liveChecked = tx !== null;
        enriched.push({
          cpHeight: a.cpHeight,
          cpHash: a.cpHash,
          txid: a.txid,
          expectedAmountSun: encodeAmount(a.cpHash),
          amountOnChainSun: amountOnChain,
          encodedMatch: amountOnChain !== null ? amountOnChain === encodeAmount(a.cpHash) : null,
          /* אמת-חיה כשזמינה; במגבלת-קצב → נופל בכנות לאימות-העבר (confirm read-back),
           * מסומן liveChecked=false כדי שהתצוגה לא תמכור ודאות שלא נמדדה עכשיו */
          onChain: ret === "SUCCESS" || (!liveChecked && !!a.verified),
          liveChecked,
          contractRet: ret,
          tronBlock: blk,
          netFeeSun: Number(info?.receipt?.net_fee ?? a.netFeeSun ?? 0),
          notedHeight: a.notedHeight ?? sov?.tron?.lastAnchor?.notedHeight ?? null,
          at: a.at,
        });
      }
      out.anchors = enriched;

      /* כיוון 2 — הספר הריבוני עצמו מעיד: בלוק tron-anchor מכיל את ה-TXID */
      const last = enriched.find((x) => x.notedHeight);
      if (last?.notedHeight && chainRaw) {
        try {
          const chain = JSON.parse(chainRaw) as {
            blocks?: Array<{ height: number; txs?: Array<{ type?: string; note?: string }> }>;
          };
          const nb = (chain.blocks ?? []).find((b) => b.height === last.notedHeight);
          const note = nb?.txs?.[0]?.note ?? "";
          out.reaction = {
            saosBlock: last.notedHeight,
            blockFound: !!nb,
            noteHasTxid: note.includes(String(last.txid).slice(0, 16)),
            note: note || null,
            interleaved: !!nb && note.includes(String(last.txid).slice(0, 16)),
          };
        } catch {
          out.reaction = null;
        }
      }
    }

    const all =
      (out.anchors as Array<{ netFeeSun: number; onChain: boolean; encodedMatch: boolean | null }> | undefined) ?? [];
    out.totals = {
      count: all.length,
      onChain: all.filter((x) => x.onChain).length,
      bindingProven: all.filter((x) => x.encodedMatch === true).length,
      burnSunTotal: all.reduce((s2, x) => s2 + (x.netFeeSun || 0), 0),
    };

    /* 91: SQUAD — הצלבה חיה פר-רגל: הכמות על השרשרת === קידוד ה-ref (cpHash/prev-txid) */
    const sq = tb?.squad ?? null;
    if (sq && (sq.indices ?? []).length) {
      const liveSquad = liveOk; /* אותה זמינות TronGrid שנמדדה למעלה */
      const funding = [] as Array<{
        idxTo: number; from: string; to: string; txid: string;
        expectedSun: number; amountOnChainSun: number | null; match: boolean | null;
        onChain: boolean; netFeeSun: number; burnSun: number; verified: boolean; notedHeight: number | null;
      }>;
      for (const f of (sq.funding ?? []).slice(0, 8)) {
        const tx = await tg<TronTxFull>(`/wallet/gettransactionbyid?value=${f.txid}`);
        const amountOnChain = tx?.raw_data?.contract?.[0]?.parameter?.value?.amount ?? null;
        funding.push({
          idxTo: f.idxTo, from: f.from, to: f.to, txid: f.txid,
          expectedSun: f.amountSun, amountOnChainSun: amountOnChain,
          match: amountOnChain != null ? amountOnChain === f.amountSun : null,
          onChain: tx?.ret?.[0]?.contractRet === "SUCCESS" || (!tx && !!f.verified),
          netFeeSun: f.netFeeSun ?? 0, burnSun: f.burnSun ?? 0,
          verified: !!f.verified, notedHeight: f.notedHeight ?? null,
        });
      }
      const rings = [] as Array<{
        id: number; at: string; closed: boolean; verified: boolean; zeroFeeAll: boolean;
        burnSun: number; notedHeight: number | null;
        legs: Array<{ n: number; from: number; to: number; txid: string; linkedKind: string | null; expectedSun: number | null; amountOnChainSun: number | null; linkedMatch: boolean | null; onChain: boolean; netFeeSun: number; notedHeight: number | null }>;
      }>;
      for (const r of (sq.rings ?? []).slice(0, 6)) {
        const legs = [] as Array<{ n: number; from: number; to: number; txid: string; linkedKind: string | null; expectedSun: number | null; amountOnChainSun: number | null; linkedMatch: boolean | null; onChain: boolean; netFeeSun: number; notedHeight: number | null }>;
        for (const l of r.legs ?? []) {
          const tx = await tg<TronTxFull>(`/wallet/gettransactionbyid?value=${l.txid}`);
          const amountOnChain = tx?.raw_data?.contract?.[0]?.parameter?.value?.amount ?? null;
          const expected = l.linked?.ref ? encodeLegAmount(l.linked.ref) : null;
          legs.push({
            n: l.n, from: l.idxFrom, to: l.idxTo, txid: l.txid,
            linkedKind: l.linked?.kind ?? null, expectedSun: expected, amountOnChainSun: amountOnChain,
            linkedMatch: amountOnChain != null && expected != null ? amountOnChain === expected : null,
            onChain: tx?.ret?.[0]?.contractRet === "SUCCESS" || (!tx && !!l.verified),
            netFeeSun: l.netFeeSun ?? 0, notedHeight: l.notedHeight ?? null,
          });
        }
        rings.push({
          id: r.id, at: r.at, closed: !!r.closed,
          verified: !!r.verified || legs.every((l) => l.onChain),
          zeroFeeAll: legs.length > 0 && legs.every((l) => l.netFeeSun === 0),
          burnSun: r.burnSun ?? legs.reduce((s2, l) => s2 + l.netFeeSun, 0),
          notedHeight: r.notedHeight ?? null, legs,
        });
      }
      out.squad = {
        indices: sq.indices ?? [],
        members: sq.members ?? [],
        activated: (sq.members ?? []).filter((m) => m.activated).length,
        burnLedger: sq.burnLedger ?? null,
        live: liveSquad,
        funding,
        rings,
        totals: {
          fundingProven: funding.filter((f) => f.match === true && f.onChain).length,
          legsTotal: rings.reduce((s2, r) => s2 + r.legs.length, 0),
          legsZeroFee: rings.reduce((s2, r) => s2 + r.legs.filter((l) => l.netFeeSun === 0).length, 0),
          legsLinkedProven: rings.reduce((s2, r) => s2 + r.legs.filter((l) => l.linkedMatch === true).length, 0),
          activationBurnSun: sq.burnLedger?.totalSun ?? 0,
        },
      };
    }
    out.live = {
      ok: liveOk,
      note: liveOk ? null : "TronGrid לא נגיש מהסנדבוקס כרגע — מצב-מדידה-אחרונה מוצג בכנות",
    };

    /* 92: PULSE 24/7 + SQUAD-BOUND + נגזרות + כיבולת — הערך-הנגזר-מהכתובות-הריבוניות */
    out.pulse = sov?.tron?.pulse ?? tb?.pulse ?? null;
    out.squadBound = sov?.tron?.squadBound ?? (tb?.squadBound ? { notedHeight: tb.squadBound.notedHeight, count: tb.squadBound.count, at: tb.squadBound.at } : null);
    out.derivatives = sov?.tron?.derivatives ?? (tb?.derivatives ? { usdtTotal: tb.derivatives.usdtTotal, measured: tb.derivatives.measured, at: tb.derivatives.at, readOnly: tb.derivatives.readOnly } : null);
    const addrCount = 2 + (tb?.squadAddresses?.length ?? 0);
    out.capacity = { addresses: addrCount, dailyFreeBytes: addrCount * 600, estFreeTxPerDay: Math.floor((addrCount * 600) / 268) };
  } catch (e) {
    out.ok = true;
    out.degraded = String((e as Error)?.message || e).slice(0, 120);
  }

  cache = { at: Date.now(), body: out };
  return NextResponse.json(out);
}
