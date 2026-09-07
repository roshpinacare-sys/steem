import { NextResponse } from "next/server";
import { bookBlocks, replayWeave, CHECKPOINT_EVERY } from "@/lib/weave";

export const dynamic = "force-dynamic";

/**
 * GET /api/weave/stats — סטטיסטיקת-הספר לפנקס (הכל מחושב-חי, לא מוצק).
 */
export async function GET() {
  const all = bookBlocks();
  const rp = replayWeave();

  const byType: Record<string, number> = {};
  let txTotal = 0;
  let gasTotal = 0;
  const gasPerBlock: { height: number; gas: number }[] = [];
  const opsPerHour: Record<string, number> = {};
  let stamps24h = 0;

  const dayAgo = Date.now() - 24 * 3600 * 1000;

  for (const b of all) {
    const txs = (b.txs || []) as any[];
    const results = (b.results || []) as any[];
    txTotal += txs.length;
    let g = 0;
    for (let i = 0; i < txs.length; i++) {
      const t = String(txs[i]?.type || "?");
      byType[t] = (byType[t] || 0) + 1;
      const rg = Number(results[i]?.gas ?? 0);
      g += rg;
      if (t === "stamp") {
        const at = txs[i]?.at ? new Date(String(txs[i].at)).getTime() : new Date(String(b.time || 0)).getTime();
        if (Number.isFinite(at) && at >= dayAgo) stamps24h++;
      }
    }
    gasTotal += Number(b.gasUsed || 0) || g;
    gasPerBlock.push({ height: Number(b.height), gas: Number(b.gasUsed || 0) || g });

    // פעולות-לשעה (ל-24 השעות האחרונות)
    const t0 = b.time ? new Date(String(b.time)).getTime() : NaN;
    if (Number.isFinite(t0) && t0 >= dayAgo) {
      const hk = new Date(t0).toISOString().slice(13, 15) + ":00";
      opsPerHour[hk] = (opsPerHour[hk] || 0) + txs.length;
    }
  }

  // קצב-איטום: פער-ממוצע בדקות בין האיטומים האחרונים
  const seals = (rp.weave?.seals as any[] | undefined) || [];
  let sealCadenceMin: number | null = null;
  if (seals.length >= 2) {
    const last = seals.slice(-10);
    let sum = 0;
    for (let i = 1; i < last.length; i++) {
      sum += new Date(last[i].at).getTime() - new Date(last[i - 1].at).getTime();
    }
    sealCadenceMin = Math.round(sum / (last.length - 1) / 60000);
  }

  const w = rp.weave || {};
  const totalWitness = Number(rp.st?.meta?.totalWitness ?? 0) || 0;
  const totalSeals = Number(rp.st?.meta?.totalSeals ?? 0) || 0;

  return NextResponse.json({
    ok: true,
    height: rp.height ?? (all.length ? Number(all[all.length - 1].height) : 0),
    totalBlocks: all.length,
    txTotal,
    byType,
    stamps24h,
    gasTotal,
    gasPerBlock: gasPerBlock.slice(-50),
    opsPerHour: Object.entries(opsPerHour).slice(-24).map(([hour, n]) => ({ hour, n })),
    sealCadenceMin,
    checkpointEvery: CHECKPOINT_EVERY,
    checkpoints: rp.cps ?? null,
    totals: {
      stamps: Number(w.total ?? 0),
      liveStamps: Object.keys(w.stamps || {}).length,
      seals: totalSeals,
      witnesses: totalWitness,
    },
  });
}
