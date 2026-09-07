import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/sovereign/borrow — מפעל-ההלוואות בתמונה-אחת (Task 52).
 *
 * החלון החי: הקפאת-דלק → הלוואת-vests → חציית-חומת-התביעה? → טיקט/מינט →
 * פריקה-נקייה. החומות שנמדדו (claim 6.000072T קבוע · creation-adjustment
 * 2,020,749 vests · סף-borrow-mint 9,920,604 vests) · המטח-52 (40 ops × 10
 * חותמים, 24 ops בבלוק-אחד) · התקדמות-האוצר אל הסף (curation + pending-returns).
 * הכל מקבצי-תוצאה של ריצות אמיתיות. לעולם לא 500.
 */

const AGENT_DIR = path.join(process.cwd(), "agent");

interface AgentJson {
  [k: string]: unknown;
}

async function readAgentJson(name: string): Promise<AgentJson | null> {
  try {
    return JSON.parse(await readFile(path.join(AGENT_DIR, name), "utf8")) as AgentJson;
  } catch {
    return null;
  }
}

// סף-החומה הנמדד (mint_borrow + verify WALL-52): ה-vests-העצמיים המזעריים
// שמהם האוצר יכול להלוות מספיק כדי שחייל יחצה את חומת-התביעה (6T RC).
const BORROW_THRESHOLD_VESTS = 9920604;

export async function GET() {
  try {
    const [borrow, salvo, status, rcMap, limits] = await Promise.all([
      readAgentJson("mint_borrow_result.json"),
      readAgentJson("salvo52_evidence.json"),
      readAgentJson("agent-status.json"),
      readAgentJson("rc_map.json"),
      readAgentJson("limits.json"),
    ]);

    const rcStatus = (status?.rc ?? null) as { max?: number; current?: number; pct?: number } | null;

    // התקדמות-האוצר אל סף-ההלוואה — הכיוון-כלכלי העיקרי של Task 52
    const steemMap = rcMap?.steem as { accounts?: Array<Record<string, unknown>> } | undefined;
    const headcorner = Array.isArray(steemMap?.accounts)
      ? (steemMap.accounts.find((a) => a.account === "headcorner") ?? null)
      : null;
    const ownVests = Number(String(headcorner?.vesting ?? "0").split(" ")[0]) || 0;
    const thresholdPct = ownVests > 0 ? Math.min(100, (100 * ownVests) / BORROW_THRESHOLD_VESTS) : 0;

    const salvoEv = salvo
      ? {
          ourOps: salvo.ourOps,
          signers: salvo.signers,
          heaviest: salvo.heaviest,
          scannedRange: salvo.scannedRange,
          at: salvo.at,
        }
      : null;

    const measuredWalls = [
      {
        wall: "claim_account",
        measured: "6.000072T RC — קבוע לכל-חשבון (יחידת-סבסוד-היווצרות היומית)",
        solution: "האוצר מלווה vests לחייל-מנט — אוטומטי מעל סף 9,920,604 vests",
      },
      {
        wall: "creation-adjustment",
        measured: "2,020,749 vests (~1,250 SP) נעולים לכל-חשבון — חשבון-קטן לא יכול להאציל כלל",
        solution: "רק האוצר (5,347 SP) מלווה; חיילים מקבלים",
      },
      {
        wall: "delegate-to-0 wipe",
        measured: "delegate-to-0 מוחק את כל-ההאצלה (לא דלתא) — לקח wic חי",
        solution: "החזרה תמיד לבסיס-הקבלה (mint_borrow מנהל baseline)",
      },
      {
        wall: "get_transaction lag",
        measured: "Unknown Transaction מעל 3 דק' ל-tx טרי",
        solution: "אימות בסריקת-בלוק ישירה (salvo52_evidence) — ההוכחה-החזקה",
      },
    ];

    return NextResponse.json({
      ok: true,
      at: new Date().toISOString(),
      borrowWindow: borrow
        ? {
            status: borrow.status,
            at: borrow.at,
            creator: borrow.creator,
            name: borrow.name,
            frozen: borrow.frozenCount,
            restored: borrow.restoredCount,
            haranBoost: borrow.haranBoost,
            claim: borrow.claim,
            mint: borrow.mint,
            measured: borrow.measured,
            runs: Array.isArray(borrow.history) ? borrow.history.length : 0,
          }
        : null,
      threshold: {
        vests: BORROW_THRESHOLD_VESTS,
        ownVests,
        pct: Math.round(thresholdPct * 10) / 10,
        note: "מעל הסף — הדמון מריץ mint_borrow --live אוטומטית (FACTORY_BORROW_VESTS) ומטביע זהות-דור-שני דרך חייל",
        pendingReturnsNote: "~969,893 vests (600 SP) בדרך-חזרה (7 ימי-צינון האצלה) — מתקרבים לסף",
      },
      salvo52: salvoEv,
      treasuryRc: rcStatus,
      measuredWalls,
      limitsProbes: Array.isArray(limits?.probes) ? (limits.probes as unknown[]).length : 0,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error).message || e).slice(0, 160) }, { status: 200 });
  }
}
