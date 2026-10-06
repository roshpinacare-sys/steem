// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · AUTONOMY GATE API — שער-העצירה והחשיבה (r197, trace 1a108e334b3129a9)
//
// הוראת-המפעיל: "חייב לעצור ולבחון מה הסוכנים עושים ושיחשבו תמיד לפני
// שהם עושים דברים כי הכל רץ אוטומטית בלי שכל ואינטילגנציה".
//
// GET  → מצב-השער + הדיונים האחרונים + סטטיסטיקות-עצירה (כנות מלאה).
// POST → המפעיל משנה מצב: PAUSED | THINKING | ACTIVE (עם סיבה; הכל מתועד
//        ביומן-ההחלטות הריבוני באותו קנון-גיבוב, ובספר-הדיונים).
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import fs from "node:fs";
import { createHash } from "node:crypto";
import {
  GATE_FILE,
  DELIB_FILE,
  AUTONOMY_DIR,
  readGate,
  writeGate,
  readDeliberations,
  validDeliberation,
  appendDeliberation,
} from "@/lib/autonomy-law";
import { db } from "@/lib/db";
import { operatorFromRequest } from "@/lib/operator-auth";

export const dynamic = "force-dynamic";

const DECISION_LOG = "/home/z/my-project/sovereign/governance/DECISION_LOG.jsonl";

/** רישום ההחלטה ביומן-ההחלטות הריבוני — אותו קנון-גיבוב של הממשל (סדר-שדות-דיסק נשמר) */
function appendDecisionLog(entry: { decisionId: string; chosen: string; why: string; boundary: string }): void {
  try {
    const raw = fs.readFileSync(DECISION_LOG, "utf8").trim();
    const lines = raw ? raw.split("\n") : [];
    const last = lines.length > 0 ? (JSON.parse(lines[lines.length - 1]!) as { seq?: number; entryHash?: string }) : null;
    const e = {
      seq: (last?.seq ?? 0) + 1,
      at: new Date().toISOString(),
      decisionId: entry.decisionId,
      class: "autonomy",
      chosen: entry.chosen,
      why: entry.why,
      boundary: entry.boundary,
      prevHash: last?.entryHash ?? "GENESIS",
    };
    e.entryHash = createHash("sha256").update(JSON.stringify(e)).digest("hex");
    fs.appendFileSync(DECISION_LOG, `${JSON.stringify(e)}\n`, "utf8");
  } catch {
    /* כשל-יומן לא חוסם את השער — קובץ-האמת (GATE.json) כבר נכתב */
  }
}

export async function GET() {
  try {
    const gate = readGate();
    const deliberations = readDeliberations(25).reverse(); // החדש ראשון
    const valid = deliberations.filter(validDeliberation).length;
    let refusedByAutonomy = 0;
    try {
      refusedByAutonomy = await db.txGate.count({
        where: { verdict: "REFUSED", decidedBy: { startsWith: "autonomy:" } },
      });
    } catch {
      refusedByAutonomy = -1; // כנות: ספירה נכשלה — לא ממציאים אפס
    }
    const daemonStates: Record<string, string | null> = {};
    const lastDecisions: Record<string, string | null> = {}; // r199: ההחלטה-האחרונה מוצגת-בנפרד — לא-מחליפה-מצב-שער (פער-שקיפות-r199-2b)
    for (const [name, p] of [
      ["money-mover", "/home/z/my-project/sovereign/money/state.json"],
      ["market-maker", "/home/z/my-project/sovereign/market-maker/state.json"],
      ["dex-grid", "/home/z/my-project/mini-services/dex-grid/state.json"],
    ] as const) {
      try {
        const s = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
        const ld = s.lastDecision as Record<string, unknown> | null;
        const mk = s.markets as Record<string, unknown> | null | undefined;
        const autonomyField =
          typeof s.autonomy === "string"
            ? (s.autonomy as string)
            : mk && typeof mk.autonomy === "string"
              ? (mk.autonomy as string)
              : undefined;
        daemonStates[name] =
          (s.autonomyMode as string) ??
          autonomyField ??
          null; // r199: רק-מצב-שער אמיתי — ההחלטה-האחרונה לא-מתחזה-לשער (was: ld?.kind fallback)
        lastDecisions[name] = (ld?.kind as string | undefined) ?? null;
      } catch {
        daemonStates[name] = null;
        lastDecisions[name] = null;
      }
    }
    return NextResponse.json({
      ok: true,
      gate,
      deliberationsTotal: readDeliberationsTotal(),
      deliberationsValid: valid,
      deliberations,
      refusedByAutonomy,
      daemonStates,
      lastDecisions,
      law: {
        file: GATE_FILE,
        dir: AUTONOMY_DIR,
        modes: ["PAUSED", "THINKING", "ACTIVE"],
        rule: "PAUSED=אף פעולה אוטונומית · THINKING=פעולה רק עם דיון מלא · ACTIVE=רגיל · fail-closed=PAUSED",
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 500 });
  }
}

function readDeliberationsTotal(): number {
  try {
    const raw = fs.readFileSync(DELIB_FILE, "utf8").trim();
    return raw ? raw.split("\n").length : 0;
  } catch {
    return 0;
  }
}

export async function POST(req: Request) {
  try {
    // r207 · איטום F-1 (ממצא שופט-הבטיחות r207-e): שינוי-מצב-שער הוא סמכות-מפעיל בלבד.
    // קודם-לכן כל לקוח מקומי/רשתי היה יכול להפוך THINKING→ACTIVE ולהוריד את
    // דרישת-הדיון — כלומר להרחיב-סמכות בלי-מפעיל. fail-closed: בלי-סשן = 401.
    const session = operatorFromRequest(req);
    if (!session) {
      return NextResponse.json(
        { ok: false, error: "OPERATOR-REQUIRED: שינוי-שער-האוטונומיה מותר למפעיל מחובר בלבד" },
        { status: 401 },
      );
    }
    const body = (await req.json().catch(() => ({}))) as { mode?: string; reason?: string; by?: string };
    const mode = String(body?.mode ?? "").toUpperCase();
    if (mode !== "PAUSED" && mode !== "THINKING" && mode !== "ACTIVE") {
      return NextResponse.json({ ok: false, error: "BAD-MODE: PAUSED|THINKING|ACTIVE בלבד" }, { status: 400 });
    }
    const reason = String(body?.reason ?? "").trim();
    if (reason.length < 4) {
      return NextResponse.json({ ok: false, error: "REASON-REQUIRED: סיבה מחייבת — כל שינוי-שער מתועד" }, { status: 400 });
    }
    // r207: ייחוס-אמת — מצב-השער נקבע תחת-סשן מאומת (מפתח-ציבורי-פעיל), לא תחת-טענה-חופשית
    const by = `operator:${session.pub.slice(0, 16)}…${String(body?.by ?? "").slice(0, 30)}`.slice(0, 60);
    const prev = readGate();
    const gate = writeGate({ mode, reason, setBy: by });

    appendDecisionLog({
      decisionId: `D-r197-GATE-${gate.since.replace(/[-:.TZ]/g, "").slice(0, 14)}`,
      chosen: `autonomy-gate: ${prev.mode} → ${gate.mode}`,
      why: reason.slice(0, 250),
      boundary: "הוראת-מפעיל · קובץ-אמת יחיד GATE.json · fail-closed",
    });

    // דיון על שינוי-השער עצמו — השער חושב גם על עצמו
    try {
      appendDeliberation({
        action: "gate-change",
        actor: by,
        claim: `שינוי שער-האוטונומיה ${prev.mode} → ${gate.mode}`,
        why: reason.slice(0, 380),
        expected: gate.mode === "PAUSED" ? "אף פעולה אוטונומית לא זזה בכל הצי" : gate.mode === "THINKING" ? "כל פעולה דורשת דיון מלא לפני" : "הרשת חוזרת לעבוד רגיל עם רישום-דיון",
        risk: gate.mode === "ACTIVE" ? "הפעולות האוטונומיות חוזרות — התקרות והשערים הקיימים נשארים" : "אפס-סיכון-כסף; עלות-הזדמנות בלבד",
        rollback: `שינוי-חזרה ל-${prev.mode} דרך אותו שער`,
      });
    } catch {
      /* רישום-דיון לא חוסם */
    }

    return NextResponse.json({ ok: true, prev: prev.mode, gate });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 500 });
  }
}
