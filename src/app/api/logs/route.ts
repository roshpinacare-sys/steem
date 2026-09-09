import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * 117n — THE-LOGS API · מציג-הלוגים-החי
 * זנב-לוגים-ריבוניים ברשימת-היתר-סגורה — אפס-מפתחות · אפס-סודות (לוגים-נבדקו-ידנית: תפעול-בלבד).
 * cache-2s.
 */

export const dynamic = "force-dynamic";

const LOGS: Record<string, string> = {
  guardian: "agent/guardian.log",
  relay: "sovereign/node/relay-doors.log",
  deposits: "sovereign/node/deposits.log",
  harvest: "sovereign/node/harvest.log",
  agent: "agent/agent.log",
  anchor: "agent/anchor.log",
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const f = sp.get("f") || "guardian";
  const file = LOGS[f];
  if (!file) {
    return NextResponse.json({ ok: false, error: "unknown-log", allowed: Object.keys(LOGS) }, { status: 400 });
  }
  const n = Math.min(300, Math.max(10, Number(sp.get("n") || 120)));
  const q = (sp.get("q") || "").trim().toLowerCase();

  const abs = path.join(process.cwd(), file);
  let lines: string[] = [];
  let bytes = 0;
  try {
    const st = fs.statSync(abs);
    bytes = st.size;
    const win = Math.min(st.size, 300_000);
    const start = Math.max(0, st.size - win);
    const buf = Buffer.alloc(win);
    const fd = fs.openSync(abs, "r");
    fs.readSync(fd, buf, 0, win, start);
    fs.closeSync(fd);
    let all = buf.toString("utf8").split("\n").filter((l) => l.trim());
    if (q) all = all.filter((l) => l.toLowerCase().includes(q));
    lines = all.slice(-n).reverse();
  } catch {
    /* קובץ-חסר — כנות */
  }

  return NextResponse.json({ ok: true, f, bytes, count: lines.length, lines, at: new Date().toISOString() });
}
