// ─────────────────────────────────────────────────────────────────────
// GET /api/economy/pnl — פנקס-הרווח-וההפסד האמיתי (r144-c · D-SCALE).
//
// האמת בלבד: realized ממילויי fill_order אמיתיים (ראיה: אינדקס-שרשרת),
// unrealized מפקודות פתוחות מול הפאריטה החיה (ראיה: orderid + מקור-שער),
// קבלות-מוביל עם txids. תמונות-מצב append-only hash-chained ב-
// sovereign/economy/pnl-snapshots.json — אותו דפוס prevHash→entryHash
// של יומן-ההחלטות. אפס מספרים מומצאים: חסר ⇒ "unmeasured".
//
//   GET ?snapshot=0  — מדידה בלבד, בלי כתיבה
//   GET (ברירת-מחדל) — מדידה + תמונה אם האחרונה ישנה (>30 דק')
//   GET ?force=1     — מדידה + תמונה מיידית
//
// עם תמונה ראשונה נחתמת החלטה D-r144-PNL ביומן-ההחלטות (חד-פעמית,
// אידמפוטנטית — מדידה בלבד, אפס חשיפה חדשה, D-O2 נשמר).
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { appendDecision, readDecisionLog, verifyDecisionLog } from "@/lib/weave/sovereign-decisions";
import { computePnl, snapshotIfStale, verifySnapshots } from "@/lib/economy/pnl-ledger";
import { refreshFillsCheckpoint } from "@/lib/weave/grid-pnl"; // r146-d — רענון-צ'קפוינט מילויים לפני המדידה
import { bookTruth } from "@/lib/weave/book-truth"; // r145-a — אמת-הספרים (SIM vs REAL)

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ACTIVATION_DECISION_ID = "D-r144-PNL";

/** חתימת החלטת-ההפעלה — פעם-אחת בלבד (אידמפוטנטי מול היומן). */
function ensureActivationDecision(pnl: Awaited<ReturnType<typeof computePnl>>, entryHash: string): {
  signed: boolean;
  decisionId: string;
  seq: number | null;
  note: string;
} {
  try {
    if (readDecisionLog().some((d) => d.decisionId === ACTIVATION_DECISION_ID)) {
      return { signed: false, decisionId: ACTIVATION_DECISION_ID, seq: null, note: "כבר חתומה — אידמפוטנטי" };
    }
    const daysRecordedNote =
      pnl.realized.trips > 0
        ? `realized trips=${pnl.realized.trips} capturedSbd=${pnl.realized.capturedSbd}`
        : "realized trips=0 (עדיין לא נסגר סבב — נמדד, לא מומצא)";
    const sealed = appendDecision({
      decisionId: ACTIVATION_DECISION_ID,
      class: "economy",
      chosen: "activate real PnL ledger from live order receipts",
      why:
        `operator directive 2026-10-01: turn the simulated economic array into real value, measured step by step. ` +
        `Measured at activation: open ladder orders=${pnl.unrealized.ordersOpen} (${pnl.unrealized.deployedSteem ?? "unmeasured"} STEEM deployed, valueFloor=${pnl.house.valueFloorState ?? "unmeasured"}), ` +
        `unrealized ladder premium over live parity=${pnl.unrealized.ladderPremiumSbd ?? "unmeasured"} SBD (parity=${pnl.marks.parity ?? "unmeasured"}, source=${pnl.marks.paritySource ?? "unmeasured"}), ` +
        `${daysRecordedNote}, chain fills=${pnl.realized.fillsTotal} (fill_order, checkpoint maxIndex=${pnl.scan.maxIndex ?? "unmeasured"}), ` +
        `receipts with txids=${pnl.receipts.withTxid}/${pnl.receipts.total}, openLongSteem=${pnl.realized.openLongSteem ?? "unmeasured"} marked to parity=${pnl.unrealized.openLongMarkSbd ?? "unmeasured"} SBD. ` +
        `D-SCALE evidence step: PnL decides the next scale step — no scale jump without a measured day-over-day number. ` +
        `PROVISIONAL (D-O2 bounded path, recorded not executed): idle STEEM measured outside the ladder=${pnl.house.idleSteem ?? "unmeasured"} — redeployment belongs to the money daemon's own REPRICE law within its 12/day quota; no new exposure signed here.`,
      boundary: "auto: measurement infrastructure only — no new exposure (D-O2 respected); append-only snapshots, zero secrets, keys never materialize",
      evidence: `sovereign/economy/pnl-snapshots.json entryHash=${entryHash.slice(0, 16)}… · fillsSource=chain:fill_order via pnl-scan.json · ordersSource=live /api/money (chain get_open_orders)`,
    });
    return { signed: true, decisionId: sealed.decisionId, seq: sealed.seq, note: "חתומה גיבוב ביומן-ההחלטות" };
  } catch (e) {
    return { signed: false, decisionId: ACTIVATION_DECISION_ID, seq: null, note: `חתימה נכשלה בכנות: ${String((e as Error)?.message ?? e).slice(0, 100)}` };
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    const writeEnabled = url.searchParams.get("snapshot") !== "0";

    // r146-d — ספר-ה-FIFO נמדד חי מאחורי האמת: הצ'קפוינט התקדם רק בביקורים
    // (נמדד פער 8.7ש' — savedAt 01:04 מול מילויים חדשים 09:44). מעתה כל קריאה
    // מרעננת צ'קפוינט-ישן (>10 דק') דרך מנוע-הסריקה (אינקרמנטלי, בד"כ עמוד אחד)
    // לפני המדידה — כישלון-רענון לא עוצר: computePnl יקרא את מה שקיים ויחשוף
    // את גיל-הצ'קפוינט במקור-הראיה (savedAt).
    try {
      const cpPath = "/home/z/my-project/sovereign/money/pnl-scan.json";
      const fs = await import("node:fs");
      const cp = JSON.parse(fs.readFileSync(cpPath, "utf8")) as { savedAt?: string };
      const age = cp?.savedAt ? Date.now() - new Date(cp.savedAt).getTime() : Infinity;
      if (age > 10 * 60_000) {
        await refreshFillsCheckpoint();
      }
    } catch {
      /* צ'קפוינט לא נקרא — computePnl ידווח כנות (unmeasured/stale) */
    }

    const pnl = await computePnl();

    let snapshot: { appended: boolean; seq: number; at: string; entryHash: string } | null = null;
    let decision: { signed: boolean; decisionId: string; seq: number | null; note: string } | null = null;
    if (writeEnabled) {
      const snap = snapshotIfStale(pnl, force);
      snapshot = { appended: snap.appended, seq: snap.entry.seq, at: snap.entry.at, entryHash: snap.entry.entryHash };
      if (snap.appended) {
        decision = ensureActivationDecision(pnl, snap.entry.entryHash);
      }
    }

    return NextResponse.json({
      ok: true,
      at: pnl.at,
      account: pnl.account,
      house: pnl.house,
      realized: pnl.realized,
      unrealized: pnl.unrealized,
      marks: pnl.marks,
      sources: pnl.sources,
      receipts: pnl.receipts,
      fillsLast: pnl.fillsLast,
      tripsLast: pnl.tripsLast,
      unmeasured: pnl.unmeasured,
      snapshot,
      decision,
      // r145-a — חוק אמת-הספרים: הפנקס הזה REAL (מקבלות-שרשרת); המדינות המלאות
      // (realBooks/simBooks + מונים) חשופות כאן — שום ספר-תביעות פנימי לא יכול
      // להיות מוצג כאמת-שרשרת.
      truth: await bookTruth(),
      snapshotChain: verifySnapshots(),
      decisionChain: verifyDecisionLog(),
      doctrine: [
        "כל מספר נושא ראיה: מילוי → אינדקס-שרשרת (idx) · פקודה → orderid · פעולה → txid",
        "unrealized = עמדה פתוחה מול הפאריטה החיה — לא רווח עד שהשוק סוגר אותו",
        "מלאי פתוח אינו רווח; סבב נסגר רק במכירה שסוגרת קנייה (FIFO)",
        "המרה לדולר בשערי-היום בלבד ומוצהרת ככזו; חסר ⇒ unmeasured, לא אפס",
      ],
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) },
      { status: 500 },
    );
  }
}
