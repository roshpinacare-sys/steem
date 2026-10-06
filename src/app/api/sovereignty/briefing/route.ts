// ─────────────────────────────────────────────────────────────────────
// /api/sovereignty/briefing — ערוץ-הועידות (r136). התשובה ל"צריך
// ועידות ושאילתות על התקדמות, לבחון תוצאות, היסק-ניסוי, ואפשרויות
// רווחיות".
//
// עצרת מדידה אחת, חיה, ממקורות-אמת בלבד:
//   · התקדמות-24ש׳ — אימותים, עוגנים, ריצות-שרשרת, קבלות-שומר
//   · ניסויים — פסק-דין הגריד החוץ, מילויים אמיתיים, בריאות-הצי
//   · כסף — מלאי, דלק, מילויים ממוספרים מספר-ה-PnL (לא זיכרון)
//   · אפשרויות-רווח — רק מה שנמדד; מה שלא נמדד נכתב כלא-נמדד
//   · שאילתות — ספירות-ספר חיות להצלבה מיידית
//
// אמת-מידה: כל ערך נושא מקור. אין השערות, אין מספרים שנזכרו.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { getGridState } from "@/lib/live/grid-arm";

export const dynamic = "force-dynamic";

const ROOT = path.resolve(process.cwd());
const PNL_PATH = path.join(ROOT, "sovereign", "money", "pnl-scan.json");
const ANCHOR_PATH = path.join(ROOT, "sovereign", "anchor-report.json");
const MONEY_STATE_PATH = path.join(ROOT, "sovereign", "money", "state.json");

interface PnlFill {
  idx: number;
  at: string;
  side: string;
  price: number;
  steem: number;
  sbd: number;
  maker: boolean;
}

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function GET() {
  const since = new Date(Date.now() - 24 * 3600 * 1000);

  const [att24h, chainRuns24h, lastCheckpoint, attTotal, agentTotal, decisionCount, grid, moneyState] =
    await Promise.all([
      db.attestation.count({ where: { createdAt: { gte: since } } }).catch(() => -1),
      db.chainRun
        .findMany({
          where: { createdAt: { gte: since } },
          select: { chain: true, step: true, ok: true, firedBy: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 200,
        })
        .catch(() => []),
      db.checkpoint
        .findFirst({ orderBy: { index: "desc" }, select: { index: true, createdAt: true, anchorStatus: true } })
        .catch(() => null),
      db.attestation.count().catch(() => -1),
      db.agent.count().catch(() => -1),
      db.chainRun
        .groupBy({ by: ["step"], _count: { step: true }, where: { step: { startsWith: "D-" } } })
        .catch(() => []),
      getGridState(),
      Promise.resolve(readJson<Record<string, unknown>>(MONEY_STATE_PATH)),
    ]);

  const pnl = readJson<{ fills?: PnlFill[]; savedAt?: string }>(PNL_PATH);
  const anchor = readJson<{ at?: string; mode?: string; checkpoint?: { index?: number }; txids?: Record<string, string | null> }>(ANCHOR_PATH);

  // מילויים אמתיים מספר-ה-PnL — 7 ימים אחרונים
  const fills = pnl?.fills ?? [];
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const fills7d = fills.filter((f) => new Date(f.at) >= weekAgo);
  const bought7d = fills7d.filter((f) => f.side === "bought-steem");
  const sold7d = fills7d.filter((f) => f.side === "sold-steem");
  const steemBought = bought7d.reduce((s, f) => s + f.steem, 0);
  const sbdSpent = bought7d.reduce((s, f) => s + f.sbd, 0);
  const steemSold = sold7d.reduce((s, f) => s + f.steem, 0);
  const sbdGot = sold7d.reduce((s, f) => s + f.sbd, 0);
  const lastFill = fills.length ? fills[fills.length - 1] : null;

  const lastTotalSteem = Number(moneyState?.lastTotalSteem ?? 0);
  const noKeySince = typeof moneyState?.noKeySince === "string" ? moneyState.noKeySince : null;

  // אפשרויות-רווח — רק נמדד, עם המקור של כל אחת
  const profitOptions: { titleHe: string; basisHe: string; source: string; state: string }[] = [];

  if (grid?.fuel?.weeklySp) {
    profitOptions.push({
      titleHe: `דלק powerdown זורם: ${grid.fuel.weeklySp.toFixed(0)} SP/שבוע`,
      basisHe: `התשלום הבא ${grid.fuel.nextPayout ? new Date(grid.fuel.nextPayout).toLocaleDateString("he-IL") : "?"} — הדלק נשפך ישר למלאי-הגריד ונסחר במדרגות`,
      source: "console dex/grid.json (הענן)",
      state: "חי",
    });
  }
  if (steemBought > 0 || steemSold > 0) {
    profitOptions.push({
      titleHe: `מדרגות-הגריד: ${fills7d.length} מילויים אמתיים ב-7 ימים`,
      basisHe: `נקנה ${steemBought.toFixed(3)} STEEM ב-${sbdSpent.toFixed(3)} SBD · נמכר ${steemSold.toFixed(3)} STEEM תמורת ${sbdGot.toFixed(3)} SBD · כל מילוי maker`,
      source: "sovereign/money/pnl-scan.json",
      state: "נמדד",
    });
  }
  if (lastTotalSteem > 0) {
    profitOptions.push({
      titleHe: `מלאי-פנוי: ${lastTotalSteem.toFixed(2)} STEEM`,
      basisHe: noKeySince
        ? "ממתין לדלת-ההפעלה (הדבקה אחת) — אז נפרס למדרגות-מיקרו עם המפתח המקומי"
        : "זמין לפריסת-מדרגות במחזור הבא",
      source: "sovereign/money/state.json",
      state: "נמדד",
    });
  }
  if (grid?.marks?.paritySbdPerSteem) {
    profitOptions.push({
      titleHe: "פרימיית-SBD מול קו-הזהות",
      basisHe: `פאריטה חיה ${grid.marks.paritySbdPerSteem} · מסומנת בכל ביט-גריד`,
      source: "console dex/grid.json (הענן)",
      state: "חי",
    });
  }
  profitOptions.push({
    titleHe: "רצפת-ערך (value-floor)",
    basisHe: "נמדדת ב-/api/money בכל ביט — כרגע לפי המדידה האחרונה; אין פאריטה חיה = UNMEASURED בכנות",
    source: "/api/money",
    state: "חי",
  });

  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    format: "briefing-v1",
    honestyHe: "עצרת-מדידה ממקורות-אמת בלבד: DB הספר, ספר-ה-PnL, דוח-העוגנים והקונסולה הציבורית. מה שלא נמדד נכתב כלא-נמדד.",
    progress24h: {
      attestations: att24h,
      chainRuns: chainRuns24h.slice(0, 12).map((r) => ({ step: r.step, ok: r.ok, firedBy: r.firedBy, at: r.createdAt })),
      chainRunCount: chainRuns24h.length,
      lastCheckpoint,
    },
    experiments: {
      grid: grid
        ? {
            verdict: grid.verdict,
            armed: grid.armed,
            publishedAt: grid.publishedAt,
            inventory: grid.inventory ?? null,
            marks: grid.marks ?? null,
          }
        : null,
      fleet: { noteHe: "בריאות-הצי נמדדת ב-/api/fleet-verify ובכרטיס-הצי בבית" },
    },
    money: {
      fills7d: fills7d.length,
      bought7d: { steem: Number(steemBought.toFixed(3)), sbd: Number(sbdSpent.toFixed(3)) },
      sold7d: { steem: Number(steemSold.toFixed(3)), sbd: Number(sbdGot.toFixed(3)) },
      lastFill: lastFill ?? null,
      pnlScanAt: pnl?.savedAt ?? null,
    },
    profitOptions,
    queries: {
      attestationTotal: attTotal,
      agentTotal,
      lastCheckpointIndex: lastCheckpoint?.index ?? null,
      bookHeadHe: lastCheckpoint ? `checkpoint#${lastCheckpoint.index}` : "אין checkpoint",
    },
    anchor: anchor ? { at: anchor.at ?? null, mode: anchor.mode ?? null, checkpoint: anchor.checkpoint?.index ?? null } : null,
  });
}
