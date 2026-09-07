import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";

export const dynamic = "force-dynamic";

/**
 * 117 — THE-SWAP · גשר-ההמרה TRX ⇄ איתריום/סולנה אמת.
 *
 * המנדט-117: ״$1 איתריום-אמת + $1 סולנה-אמת כדי שתוכל ליישם״ · המשך-המנדט:
 * ״נסה להחליף את ה-TRX — הוא עדיין בארנק מחכה לניסוי שלך״.
 *
 * המודול swap.cjs עורך-סקר-חי (מחירי-בינאנס · מלאי-24-דלתות מהשרשרת ·
 * ציטוטי-ChangeNOW ללא-מפתח) ומוצא-כנות: ה-TRX היחיד (19.13 ≈ $6.39) יושב
 * על דלתות-גשר ישנות שהמפתח שלהן אבד ברולבק-115 — נעולות עד-גיבוי-טרום-רולבק.
 *
 * אפס-סודות: רק verdicts, מחירים וכתובות-פומביות. ה-POST מזריק-סקר detached.
 */
const ROOT = process.cwd();
const NODE = path.join(ROOT, "sovereign", "node");
const SURVEY = path.join(NODE, "swap-survey.json");
const STATE = path.join(NODE, "swap-state.json");

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch (_) {
    return null;
  }
}

interface SurveyShape {
  at: string;
  verdict: string;
  trxUsdt: number | null;
  ethUsdt: number | null;
  solUsdt: number | null;
  controlledTrx: number;
  inventoryUsd: number | null;
  lockedTrx: number;
  lockedUsd: number | null;
  inventory: { family: string; idx: number; agent: string | null; address: string; trx: number }[];
  lockedDoors: { address: string; role: string; trx: number; status: string }[];
  mandate: { present: boolean; active: boolean; quote: string | null };
  providerKey: { present: boolean; slot: string };
  provider: {
    changenow: {
      reach: string;
      keylessSurvey: boolean;
      keylessCreate: boolean;
      createAuth: string;
      pairs: Record<string, { minAmount?: number }>;
      estimates: Record<string, { est?: number; speed?: string }>;
    };
  };
  ms: number;
}

export async function GET() {
  const sv = readJson<SurveyShape>(SURVEY);
  const st = readJson<{ legs?: unknown[] }>(STATE);

  // freshness — סקר-טרי הוא < 30 דק׳
  const fresh = !!sv && Date.now() - Date.parse(sv.at) < 30 * 60 * 1000;

  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    fresh,
    verdict: sv?.verdict ?? null,
    surveyedAt: sv?.at ?? null,
    prices: { trx: sv?.trxUsdt ?? null, eth: sv?.ethUsdt ?? null, sol: sv?.solUsdt ?? null },
    inventory: {
      controlledTrx: sv?.controlledTrx ?? null,
      controlledUsd: sv?.inventoryUsd ?? null,
      doors: (sv?.inventory ?? []).length,
      allZero: (sv?.inventory ?? []).every((d) => d.trx === 0),
    },
    locked: {
      trx: sv?.lockedTrx ?? null,
      usd: sv?.lockedUsd ?? null,
      doors: sv?.lockedDoors ?? [],
    },
    mandate: sv?.mandate ?? null,
    providerKey: sv?.providerKey ?? null,
    provider: sv
      ? {
          changenow: {
            reach: sv.provider.changenow.reach,
            keylessSurvey: sv.provider.changenow.keylessSurvey,
            keylessCreate: sv.provider.changenow.keylessCreate,
            createAuth: sv.provider.changenow.createAuth,
            minAmounts: sv.provider.changenow.pairs,
            estimates: sv.provider.changenow.estimates,
          },
          exolix: "BLOCKED-CF",
          sideshift: "n/a",
        }
      : null,
    legs: st?.legs ?? [],
  });
}

/** POST → מזריק-סקר-חי detached (single-flight via pid file) */
export async function POST() {
  try {
    execFile("node", [path.join(NODE, "swap.cjs"), "survey"], { timeout: 10000 }, () => {});
    return NextResponse.json({ ok: true, spawned: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e).slice(0, 120) }, { status: 500 });
  }
}
