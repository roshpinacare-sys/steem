// ─────────────────────────────────────────────────────────────────────
// /api/charter/anchor — העוגן החיצוני לצ'רטרים (R91)
//
// GET:  מצב-אמת חי לכל צופה — השורש הנוכחי, הסחף מאז העיגון האחרון,
//       ואימות העוגן האחרון מול ההיסטוריה החיה של Steem.
// POST: עיגון עכשיו. בלי סשן-מפעיל — כמו /api/publish, ההרשאה
//       היא החוקים שבקוד: דה-דופליקציה לפי שורש · צינון 15 דק׳ ·
//       תקציב 8/יום · posting בלבד · אישור רק מקריאה-חזרה מהשרשרת.
//
// דוקטרינת הכנות: broadcast שלא אומת מההיסטוריה אינו הצלחה;
// אין מפתח בסנדבוקס — אין שידור; אין פרויקטים — אין עיגון.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  anchorCharterOnSteem,
  anchorStatusView,
  CharterAnchorError,
  CHARTER_ANCHOR_OP_ID,
} from "@/lib/weave/charter-anchor";
import { createCheckpointNow } from "@/lib/weave/beat";
import { publishCanon, secretGate, CHARTER } from "@/lib/charter";

export const dynamic = "force-dynamic";

function he(err: unknown): { msg: string; status: number } {
  if (err instanceof CharterAnchorError) return { msg: err.message, status: err.status };
  return { msg: String((err as Error)?.message ?? err).slice(0, 200), status: 500 };
}

export async function GET() {
  try {
    const view = await anchorStatusView();
    return NextResponse.json({
      ok: true,
      opId: CHARTER_ANCHOR_OP_ID,
      policy: {
        minIntervalMin: 15,
        maxPerDay: 8,
        authority: "posting בלבד (headcorner) · אישור מההיסטוריה בלבד",
      },
      anchor: view,
    });
  } catch (e) {
    const { msg, status } = he(e);
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

export async function POST(req: Request) {
  let payload: { action?: string } = {};
  try {
    payload = (await req.json()) as { action?: string };
  } catch {
    /* גוף ריק תקין — ברירת-מחדל anchor */
  }
  if (payload.action && payload.action !== "anchor") {
    return NextResponse.json({ ok: false, error: "פעולה לא מוכרת — נתמכת: anchor" }, { status: 400 });
  }

  try {
    const result = await anchorCharterOnSteem();

    // סולם ההוכחות: עדות חדשה נכתבה ⇒ checkpoint מכסה מיד
    let checkpoint: { index: number; root: string } | null = null;
    if (result.status === "ATTESTED" && result.attSeq !== null) {
      const cp = await createCheckpointNow();
      if (cp) checkpoint = { index: cp.index, root: cp.root };
    }

    // יומן העוגנים לקנון — אחרי שער-הסודות, כדוקטרינה
    let canon: { ok: boolean; path: string; error?: string } | null = null;
    if (result.status === "ATTESTED") {
      const log = {
        format: "charter-anchors-v1",
        opId: CHARTER_ANCHOR_OP_ID,
        chain: "steem",
        account: "headcorner",
        updatedAt: new Date().toISOString(),
        note: "יומן עוגנים — כל רשומה אומתה מההיסטוריה של Steem לפני הכתיבה (confirmedBy=chain-read).",
        anchors: [] as Array<Record<string, unknown>>,
      };
      const witness = await db.agent.findUnique({ where: { name: "weave-charter-anchor" } });
      if (witness) {
        const rows = await db.attestation.findMany({
          where: { claimType: "ANCHOR", agentId: witness.id, evidence: { contains: `op=${CHARTER_ANCHOR_OP_ID}` } },
          orderBy: { seq: "desc" },
          take: 50,
        });
        log.anchors = rows.map((r) => {
          const field = (key: string): string | null => {
            const m = r.evidence.match(new RegExp(`(?:^| · )${key}=([^ ·]+)`));
            return m ? m[1] : null;
          };
          return {
            attSeq: r.seq,
            at: r.createdAt.toISOString(),
            root: field("root"),
            txid: field("txid"),
            block: field("block") != null ? Number(field("block")) : null,
            projects: field("projects") != null ? Number(field("projects")) : null,
            events: field("events") != null ? Number(field("events")) : null,
          };
        });
      }
      const gate = secretGate(JSON.stringify(log));
      if (gate) {
        canon = { ok: false, path: CHARTER.registryPath, error: `שער-הסודות חסם: ${gate}` };
      } else {
        canon = await publishCanon(
          "charter/anchors.json",
          JSON.stringify(log, null, 2) + "\n",
          `charter-anchor: external anchor receipt (att ${result.attSeq})`,
        );
      }
    }

    return NextResponse.json({ ok: true, result, checkpoint, canon });
  } catch (e) {
    const { msg, status } = he(e);
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
