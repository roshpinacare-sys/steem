import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * 108 — THE-DOOR (דבר-גורר-דבר) · לוח-הדלתות החי.
 *
 * מקור-האמת: state-snapshot.json (st.relay — אותו-מצב שהקרנל מאמת) +
 * relay-doors.log (יומן-המבצע). הכל חי — אפס-סטטי.
 */
const ROOT = process.cwd();
const SNAP = path.join(ROOT, "sovereign", "node", "state-snapshot.json");
const DOORLOG = path.join(ROOT, "sovereign", "node", "relay-doors.log");
const FAILS = path.join(ROOT, "sovereign", "node", "relay-fails.json");
const SENDERS = path.join(ROOT, "sovereign", "node", "relay-senders.json");

function readJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch (_) {
    return fallback;
  }
}

export async function GET() {
  try {
    const snap = JSON.parse(fs.readFileSync(SNAP, "utf8"));
    const st = snap.st || {};
    const relay = st.relay || { nextBy: {}, open: {}, log: [], sent: 0, issued: 0 };
    const open = Object.values(relay.open || {}) as Array<Record<string, unknown>>;

    const fails = readJson<Record<string, { count?: number; lastAt?: number; lastErr?: string }>>(FAILS, {});

    const doors = open
      .map((r) => {
        const payload = (r.payload || {}) as Record<string, unknown>;
        const f = fails[String(r.ref)] || {};
        return {
          ref: String(r.ref),
          via: String(r.via),
          act: String(r.act),
          status: String(r.status),
          txid: (r.txid as string) || null,
          tries: Number(r.tries || 0),
          chain: (payload.chain as string) || null,
          from: (payload.from as string) || null,
          note: (payload.note as string) || null,
          budgetSun: (payload.budgetSun as number) || null,
          escrowµ: (r.escrowµ as number) || null,
          spentSun: (r.spentSun as number) || null,
          gasPaidµ: (r.gasPaidµ as number) || null,
          refundµ: (r.refundµ as number) || null,
          failCount: Number(f.count || 0),
          lastErr: f.lastErr || null,
        };
      })
      .sort((a, b) => a.ref.localeCompare(b.ref, "en", { numeric: true }));

    // הוכחת-רשת-מרוחקת: הדלת-האחרונה-שנסגרה — אפשר לאמת אותה חוץ-למערכת
    const steemProof = doors.filter((d) => d.via === "steem" && d.status === "sent" && d.txid).slice(-1)[0] || null;
    const tronProof = doors.filter((d) => d.via === "tron" && d.status === "sent" && d.txid).slice(-1)[0] || null;

    let doorLogAgeSec: number | null = null;
    let relayerAlive = false;
    try {
      doorLogAgeSec = Math.round((Date.now() - fs.statSync(DOORLOG).mtime.getTime()) / 1000);
      relayerAlive = doorLogAgeSec < 180; // tick 45s — 3 דק' = מת
    } catch (_) {}

    /* 117g — סריקת-השולחים-החיה (מה-cache-של-ה-relayer) — כנות-מלאה-למפעיל */
    type ScanDoor = { family?: string; idx?: number; address?: string; bal?: number; freeLeft?: number; activated?: boolean; err?: string };
    const scan = readJson<{ at?: number; pick?: { family: string; idx: number; address: string; bal: number; freeLeft: number } | null; reason?: string; readsFailed?: number; degraded?: boolean; doors?: ScanDoor[] } | null>(SENDERS, null);
    const senderScan = scan
      ? {
          at: scan.at ? new Date(scan.at).toISOString() : null,
          ageSec: scan.at ? Math.round((Date.now() - scan.at) / 1000) : null,
          reason: scan.reason || null,
          pick: scan.pick || null,
          readsFailed: Number(scan.readsFailed || 0),
          degraded: !!scan.degraded,
          doorsScanned: (scan.doors || []).length,
          fundedDoors: (scan.doors || []).filter((x) => Number(x.bal || 0) > 0).length,
          withBandwidth: (scan.doors || []).filter((x) => Number(x.freeLeft || 0) >= 300).length,
          /* 117i — זהות-מרופאת: הזרע-הריבוני-המקורי (v1) חולץ-מחותמת-הצי בגיט-היסטוריה
           * (749e7db) ואומת 12/12 מול-המניפסט-המעוגן. הדלתות-הנשלטות = נמלי-ההפקדות
           * המעוגנים. הפקדת-TRX-לנמל כלשהו = הדלת-נפתחת-אוטומטית. */
          fuelDoors: (scan.doors || [])
            .filter((x) => x.address)
            .map((x) => ({ family: x.family || "?", idx: x.idx ?? -1, address: x.address, bal: Number(x.bal || 0), freeLeft: Number(x.freeLeft || 0) })),
        }
      : null;

    return NextResponse.json(
      {
        ok: true,
        at: new Date().toISOString(),
        height: snap.height || null,
        metaIssuer: (st.meta && st.meta.issuer) || null,
        issued: relay.issued || 0,
        sent: relay.sent || 0,
        gasSettledSun: relay.gasSettledSun || 0,
        queued: doors.filter((d) => d.status === "queued").length,
        nextSeqBy: relay.nextBy || {},
        relayerAlive,
        doorLogAgeSec,
        doors,
        senderScan,
        remoteProof: {
          steem: steemProof ? { txid: steemProof.txid, ref: steemProof.ref, verify: "https://steemscan.com/transaction/" + steemProof.txid } : null,
          tron: tronProof ? { txid: tronProof.txid, ref: tronProof.ref, verify: "https://tronscan.org/#/transaction/" + tronProof.txid } : null,
        },
        explainer:
          "חוזה-חכם על הרשת-החינמית שלנו (relay · אפס-גז) מכריח טרנזקציה אמת על רשת-מרוחקת — steem custom_json (אפס-עמלה, RC) · tron transfer (Bandwidth חינם) — והוכחת-txid חוזרת-לספר שלנו (relay_ack). דבר-גורר-דבר: payload.next מצית את-הדלת-הבאה.",
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error).message || e) }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
}
