import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * 111 — THE-HARVEST (קציר-האנרגיה) · לוח-הקציר החי.
 *
 * השאלה-שהובילה-לכאן: ״יש טרנזקציה, יש אנרגיה שמתבזבזת, מישהו משלם —
 * איך אנחנו מרוויחים משחרור-האנרגיה של הטרנזקציות?״
 *
 * מקור-האמת: state-snapshot.json (st.harvest — המאגר-על-הספר, אותו-מצב
 * שהקרנל מאמת) + harvest-cursor.json (מצביעי-הקוצר) + harvest.log (יומן)
 * + trondex-live.json (מדידת-הכספת) + trongrid (עקומת-אנרגיה-חיה).
 * הכל חי — אפס-סטטי.
 */
const ROOT = process.cwd();
const SNAP = path.join(ROOT, "sovereign", "node", "state-snapshot.json");
const CURSOR = path.join(ROOT, "sovereign", "node", "harvest-cursor.json");
const HLOG = path.join(ROOT, "sovereign", "node", "harvest.log");
const DEXLIVE = path.join(ROOT, "sovereign", "node", "trondex-live.json");

const STREAM_HE: Record<string, string> = {
  pools: "עמלות-בריכות-הדקס (30bps → אוצר)",
  grid: "הכנסות-עמלות-הגריד",
  rail: "מסילת-הזרמות (memo saos:harvest/v1)",
  doors: "עמלות-שירות-דלתות v:3",
};
const PURPOSE_HE: Record<string, string> = {
  "writer-reward": "פרס-כותבים (חיילים-מאמתים)",
  "gas-subsidy": "סבסוד-תקציבי-דלת",
  "treasury-return": "החזר-לאוצר",
};

async function energyCurve(): Promise<{ energyFeeSun: number | null; energyFeeMaxSun: number | null; trc20CostTrx: number | null; trc20CostMaxTrx: number | null; vaultTrx: number | null; vaultAgeSec: number | null; why?: string }> {
  // עקומת-האנרגיה-האמתית: מחיר-יחידת-אנרגיה (sun/energy) מהשרשרת-עצמה + מדידת-הכספת שלנו.
  // טרון: getEnergyFee = המחיר-הבסיסי · getTransactionFee = המחיר-המוגדל (דינמי) — מציגים-טווח-כן.
  let energyFeeSun: number | null = null;
  let energyFeeMaxSun: number | null = null;
  try {
    const res = await fetch("https://api.trongrid.io/wallet/getchainparameters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    const j = (await res.json()) as { chainParameter?: { key: string; value: number }[] };
    const fee = (j.chainParameter || []).find((p) => p.key === "getEnergyFee");
    const feeMax = (j.chainParameter || []).find((p) => p.key === "getTransactionFee");
    if (fee) energyFeeSun = Number(fee.value);
    if (feeMax) energyFeeMaxSun = Number(feeMax.value);
  } catch (_) { /* כנות: צומת-לא-זמין */ }
  let vaultTrx: number | null = null;
  let vaultAgeSec: number | null = null;
  try {
    const d = JSON.parse(fs.readFileSync(DEXLIVE, "utf8")) as { sun?: number; at?: string };
    if (typeof d.sun === "number") vaultTrx = d.sun / 1e6;
    if (d.at) vaultAgeSec = Math.round((Date.now() - new Date(d.at).getTime()) / 1000);
  } catch (_) { /* כנות */ }
  const TRC20_ENERGY = 65000; // העברת-USDT סטנדרטית ≈ 64,895 — עיגול-כנה
  const trc20CostTrx = energyFeeSun ? (TRC20_ENERGY * energyFeeSun) / 1e6 : null;
  const trc20CostMaxTrx = energyFeeMaxSun ? (TRC20_ENERGY * energyFeeMaxSun) / 1e6 : null;
  return { energyFeeSun, energyFeeMaxSun, trc20CostTrx, trc20CostMaxTrx, vaultTrx, vaultAgeSec, why: energyFeeSun ? undefined : "trongrid-לא-זמין-כרגע" };
}

export async function GET() {
  try {
    const snap = JSON.parse(fs.readFileSync(SNAP, "utf8"));
    const st = snap.st || {};
    const H = (st.harvest || null) as Record<string, unknown> | null;
    const relay = (st.relay || {}) as Record<string, unknown>;
    const open = Object.values(relay.open || {}) as Array<Record<string, unknown>>;

    const byStream = Object.entries((H?.byStream || {}) as Record<string, number>).map(([k, µ]) => ({
      stream: k,
      he: STREAM_HE[k] || k,
      amountµ: Number(µ || 0),
    }));
    const releases = ((H?.releases || []) as Array<Record<string, unknown>>)
      .slice(-8)
      .reverse()
      .map((r) => ({
        to: String(r.to),
        amountµ: Number(r.amountµ || 0),
        purpose: String(r.purpose),
        purposeHe: PURPOSE_HE[String(r.purpose)] || String(r.purpose),
        ref: (r.ref as string) || null,
        h: Number(r.h || 0),
      }));

    // דלתות-v:3 — עמלות-הקציר-מהדלתות (ראיות-חוצות: txid STEEM/TRON)
    const feeDoors = open
      .filter((r) => Number(r.v) === 3)
      .map((r) => ({
        ref: String(r.ref),
        via: String(r.via),
        status: String(r.status),
        txid: (r.txid as string) || null,
        escrowµ: Number(r.escrowµ || 0),
        feeBps: Number(r.feeBps || 0),
        harvestFeeµ: Number(r.harvestFeeµ || 0),
        refundµ: (r.refundµ as number) ?? null,
      }))
      .sort((a, b) => a.ref.localeCompare(b.ref, "en", { numeric: true }));

    let cursor: Record<string, unknown> = {};
    try { cursor = JSON.parse(fs.readFileSync(CURSOR, "utf8")); } catch (_) { /* כנות */ }

    let logLines: string[] = [];
    try { logLines = fs.readFileSync(HLOG, "utf8").trim().split("\n").slice(-12); } catch (_) { /* כנות */ }

    const hc = ((st.accounts || {}).headcorner || {}) as Record<string, number>;
    const energy = await energyCurve();

    // 111 — שומר-עקביות-על-הסף: potµ אי-אפשר-שיעלה-על-הסה״כ-שנקצר (אינווריאנט-הקרנל).
    // אם-קריאה-תפסה-גרסה-סותרת (כתיבה-בשחיקה-בין-כותבים) — מציגים-כנות, לא-מספר-שקרי.
    const potµ = Number(H?.potµ || 0);
    const harvestedTotalµ = Number((st.meta as Record<string, unknown> | undefined)?.harvestTotalµ || 0);
    const inconsistent = potµ > harvestedTotalµ;

    return NextResponse.json({
      ok: true,
      at: new Date().toISOString(),
      height: (st.meta as Record<string, unknown> | undefined)?.height ?? null,
      potµ,
      harvestedTotalµ,
      inconsistent,
      releasedµ: Number(H?.releasedµ || 0),
      count: Number(H?.count || 0),
      byStream,
      releases,
      feeDoors,
      policy: {
        railTag: "saos:harvest/v1",
        railSteemPerSaos: 0.001,
        releaseFloorµ: 2000,
        releaseSharePct: 50,
      },
      cursor,
      issuerBalanceµ: { saos: Number(hc.saos || 0), lockedSaos: Number(hc.lockedSaos || 0) },
      energy,
      log: logLines,
      relayerAlive: (() => {
        try { return Date.now() - fs.statSync(HLOG).mtime.getTime() < 300000; } catch (_) { return false; }
      })(),
      explainer: "קציר-האנרגיה: כל-זרימה-שעוברת-במסילות-שלנו משאירה-עמלה-אמת-ביד-האוצר — הכרה-על-הספר (harvest) · גלגל-החוזר משחרר-לעבודת-הרשת (harvest_release) מוגבל-קשיח-במאגר",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, why: String((e as Error)?.message ?? e).slice(0, 160) }, { status: 200 });
  }
}
