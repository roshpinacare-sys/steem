// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · SAOS-NET — השרשרת הכלכלית הריבונית של הצי ("המערכת שתחליף")
//
// GET /api/weave/saosnet — סטטוס + אימות עצמאי:
//   · replay דטרמיניסטי מלא: snapshot ⇒ בלוקים ⇒ שורש סופי מול הצהרת הצומת
//   · הכלכלה (חשבונות צי מה-pack), LP, נכסים עטופים (WSBD/PHIVE/…)
//   · ארנקי-הצבא: מספרם החי נספר מה-pack בזמן-ריצה (wallets.total) —
//     מספר הסעיף שבמפרט אינו מספר הארנקים
//   · הדלתות (relay) · הקציר (harvest) · האריגה (stamps/seals)
//
// ה-runner (scripts/saosnet-status.cjs) רץ ב-node נקי מחוץ ל-bundler —
// הקרנל (kernel.cjs) הוא קוד-מצב דטרמיניסטי טהור ואסור לו לעבור transpile.
// מטמון זיכרון מקומי 60 שניות — replay הוא מדידה כבדה יחסית.
// תווית אמת: האימות REAL (מתמטי); ה-pack עצמו DERIVED מריפו הפלטפורמה,
// וגילו מתויג בכנות (pack.state: LIVE-PACK / FROZEN-PACK) מ-r121 —
// replay מושלם על pack שלא התקדם מ-2026-09-14 אינו "מצב נוכחי".
// ─────────────────────────────────────────────────────────────────────

import * as path from "path";
import { execFile } from "child_process";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/weave/api";
import { lastSaosnetCrossAnchor } from "@/lib/weave/crosschain";

export const dynamic = "force-dynamic";

const ROOT = process.cwd();
const RUNNER = path.join(ROOT, "scripts", "saosnet-status.cjs");
const CACHE_TTL_MS = 60_000;

interface SaosnetStatus {
  ok: boolean;
  net?: Record<string, unknown>;
  verify?: Record<string, unknown>;
  economy?: Record<string, unknown>;
  weave?: Record<string, unknown>;
  doors?: Record<string, unknown>;
  harvest?: Record<string, unknown>;
  wallets?: Record<string, unknown>;
  truthLabel?: string;
  pack?: Record<string, unknown>;
}

let cache: { at: number; data: SaosnetStatus } | null = null;

function runStatusScript(): Promise<SaosnetStatus> {
  return new Promise((resolve, reject) => {
    execFile(
      "node",
      [RUNNER],
      { cwd: ROOT, timeout: 20_000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(new Error(`הרצת ה-runner של SAOS-NET נכשלה: ${error.message}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as SaosnetStatus);
        } catch {
          reject(new Error("פלט ה-runner של SAOS-NET אינו JSON תקין"));
        }
      }
    );
  });
}

export async function GET() {
  try {
    // אינדקס ההצלבה — אימות ה-CROSSCHAIN האחרון בספר (עוגן-עוגנים)
    const crosschain = await lastSaosnetCrossAnchor();
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
      return NextResponse.json({ ok: true, saosnet: cache.data, crosschain, cached: true });
    }
    const data = await runStatusScript();
    cache = { at: Date.now(), data };
    return NextResponse.json({ ok: true, saosnet: data, crosschain, cached: false });
  } catch (error) {
    return jsonError(error);
  }
}
