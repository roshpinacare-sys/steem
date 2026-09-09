import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import path from "path";

/**
 * 117n — THE-SCANNER API · כלי-הבדיקה-החי-מול-THE-SHIELD
 *
 * POST {mode:"address"|"token"|"memo", value:string}
 * → מריץ את מנוע-המגן-האמת (sovereign/node/shield.cjs) בתהליך-מבודד — אפס-סימולציה:
 *   address → check-address (base58check + חיקוי-20-דלתות)
 *   token   → check-token (registry-קאנוני + confusables + levenshtein)
 *   memo    → scan-memo (URL-מותאם · דומייני-חיקוי · מילות-גיוס · צורת-סודות)
 *
 * אפס-מפתחות: המגן-קורא-נתוני-רשת-ציבוריים-בלבד. timeout-15s.
 */

export const dynamic = "force-dynamic";

const SHIELD = path.join(process.cwd(), "sovereign", "node", "shield.cjs");

const CMD: Record<string, string> = {
  address: "check-address",
  token: "check-token",
  memo: "scan-memo",
};

export async function POST(req: NextRequest) {
  let body: { mode?: string; value?: string };
  try {
    body = (await req.json()) as { mode?: string; value?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "bad-json" }, { status: 400 });
  }
  const mode = body.mode && CMD[body.mode] ? body.mode : "address";
  const value = String(body.value || "").trim().slice(0, 400);
  if (!value) {
    return NextResponse.json({ ok: false, error: "empty-value" }, { status: 400 });
  }

  const verdict = await new Promise<{ code: number; out: string; err: string }>((resolve) => {
    execFile("node", [SHIELD, CMD[mode], value], { timeout: 15_000, maxBuffer: 1024 * 256 }, (err, stdout, stderr) => {
      resolve({ code: err && !stdout ? 1 : 0, out: String(stdout || ""), err: String(stderr || "") });
    });
  });

  if (!verdict.out.trim()) {
    return NextResponse.json({ ok: false, error: "shield-silent", stderr: verdict.err.slice(0, 200) }, { status: 502 });
  }
  try {
    const j = JSON.parse(verdict.out) as Record<string, unknown>;
    return NextResponse.json({ ok: true, mode, value: value.slice(0, 64), shield: j, at: new Date().toISOString() });
  } catch {
    return NextResponse.json({ ok: false, error: "shield-unparseable", raw: verdict.out.slice(0, 300) }, { status: 502 });
  }
}
