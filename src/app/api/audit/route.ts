import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * 117n — THE-AUDIT API · זרמי-הביקורת-החיים
 * src=shield → sovereign/node/security-events.jsonl (כל-בדיקת-מגן)
 * src=broker → mini-services/key-broker/audit.jsonl (כל-חתימת-כספת · כולל-DENY)
 * אפס-מפתחות · קריאה-בלבד · cache-3s.
 */

export const dynamic = "force-dynamic";

const SOURCES: Record<string, string> = {
  shield: path.join(process.cwd(), "sovereign", "node", "security-events.jsonl"),
  broker: path.join(process.cwd(), "mini-services", "key-broker", "audit.jsonl"),
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const src = sp.get("src") === "broker" ? "broker" : "shield";
  const n = Math.min(200, Math.max(10, Number(sp.get("n") || 60)));
  const verdict = (sp.get("verdict") || "").toUpperCase();

  const file = SOURCES[src];
  let events: Record<string, unknown>[] = [];
  let bytes = 0;
  try {
    const st = fs.statSync(file);
    bytes = st.size;
    const win = Math.min(st.size, 400_000);
    const start = Math.max(0, st.size - win);
    const buf = Buffer.alloc(win);
    const fd = fs.openSync(file, "r");
    fs.readSync(fd, buf, 0, win, start);
    fs.closeSync(fd);
    const lines = buf.toString("utf8").split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0 && events.length < n; i--) {
      try {
        const j = JSON.parse(lines[i]) as Record<string, unknown>;
        if (verdict && String(j.verdict || "").toUpperCase() !== verdict) continue;
        events.push(j);
      } catch {
        /* שורה-שבורה — דילוג-כן */
      }
    }
  } catch {
    /* קובץ-חסר — ריק-בכנות */
  }

  return NextResponse.json({
    ok: true,
    src,
    bytes,
    count: events.length,
    events,
    at: new Date().toISOString(),
  });
}
