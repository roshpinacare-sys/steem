import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * 117n — THE-BOOK API · סייר-הספר-הריבוני
 *
 * הספר שלנו חי ב-sovereign/node/chain-archive.jsonl (66k+ בלוקים אמת) + chain.json (הזנב-החי).
 * עד-עכשיו ה-UI הסתיר-את-זה-לגמרי. עכשיו: זנב-חי · קפיצה-לפי-גובה (byte-seek) · חיפוש-זנב.
 *
 * אפס-מפתחות · קריאה-בלבד · cache-5s.
 */

export const dynamic = "force-dynamic";

const NODE = path.join(process.cwd(), "sovereign", "node");
const ARCHIVE = path.join(NODE, "chain-archive.jsonl");
const CHAIN = path.join(NODE, "chain.json");

type BlockRec = {
  height: number;
  time: string;
  prevHash: string;
  txs: Array<Record<string, unknown>>;
};

function parseLine(l: string): BlockRec | null {
  try {
    const j = JSON.parse(l) as Record<string, unknown>;
    const txs = Array.isArray(j.txs) ? (j.txs as Array<Record<string, unknown>>) : [];
    const height = typeof j.height === "number" ? j.height : 0;
    if (!height) return null;
    return {
      height,
      time: String(j.time || ""),
      prevHash: String(j.prevHash || ""),
      txs,
    };
  } catch {
    return null;
  }
}

/** זנב-הקובץ — קורא רק מיגה-בייטים אחרונים (קובץ-ענק, מהירות-אמת) */
function tailBlocks(bytes = 1_500_000): BlockRec[] {
  try {
    const st = fs.statSync(ARCHIVE);
    const size = Math.min(st.size, bytes);
    const start = Math.max(0, st.size - size);
    const buf = Buffer.alloc(size);
    const fd = fs.openSync(ARCHIVE, "r");
    fs.readSync(fd, buf, 0, size, start);
    fs.closeSync(fd);
    const lines = buf.toString("utf8").split("\n").filter(Boolean);
    const out: BlockRec[] = [];
    for (let i = lines.length - 1; i >= 0; i--) {
      const b = parseLine(lines[i]);
      if (b) out.push(b);
    }
    return out;
  } catch {
    return [];
  }
}

/** קפיצה-לגובה — byte-seek משוערך (הבלוקים-סדרתיים-בקובץ) */
function blockAtHeight(h: number): BlockRec | null {
  try {
    const st = fs.statSync(ARCHIVE);
    // זנב-קבוע ראשון — רוב-הבקשות-חיות-שם
    const tail = tailBlocks(400_000);
    const oldest = tail.length ? tail[tail.length - 1].height : 0;
    if (h >= oldest) return tail.find((b) => b.height === h) || null;
    // byte-seek משוערך לפי יחס-גובה/גובה-הזנב
    const guess = Math.floor((st.size * h) / Math.max(1, oldest));
    const win = Math.min(st.size, 1_500_000);
    const start = Math.max(0, Math.min(st.size - win, guess - win / 2));
    const buf = Buffer.alloc(win);
    const fd = fs.openSync(ARCHIVE, "r");
    fs.readSync(fd, buf, 0, win, start);
    fs.closeSync(fd);
    const lines = buf.toString("utf8").split("\n").filter(Boolean);
    let best: BlockRec | null = null;
    let bestD = Infinity;
    for (const l of lines) {
      const b = parseLine(l);
      if (b && Math.abs(b.height - h) < bestD) {
        best = b;
        bestD = Math.abs(b.height - h);
        if (bestD === 0) break;
      }
    }
    return best && bestD <= 40 ? best : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") || "").trim().toLowerCase();
  const h = Number(sp.get("h") || 0);
  const n = Math.min(60, Math.max(5, Number(sp.get("n") || 25)));

  // חיפוש-טקסט — בזנב (3000-בלוקים-אחרונים, ישיר-וכן)
  if (q) {
    const tail = tailBlocks(3_500_000).slice(0, 3000);
    const hits = tail
      .filter((b) => {
        if (/^\d+$/.test(q) && b.height === Number(q)) return true;
        if (b.prevHash.toLowerCase().includes(q)) return true;
        if (b.time.toLowerCase().includes(q)) return true;
        return b.txs.some((t) => JSON.stringify(t).toLowerCase().includes(q));
      })
      .slice(0, n);
    return NextResponse.json({ ok: true, mode: "search", q, scanned: tail.length, blocks: hits, at: new Date().toISOString() });
  }

  // קפיצה-לגובה
  if (h > 0) {
    const b = blockAtHeight(h);
    return NextResponse.json({ ok: true, mode: "height", h, blocks: b ? [b] : [], at: new Date().toISOString() });
  }

  // זנב-חי: ארכיון + השלמה מ-chain.json (בלוקים-שטרם-נארכבו)
  const archive = tailBlocks(1_200_000).slice(0, n);
  let chainTail: BlockRec[] = [];
  try {
    const j = JSON.parse(fs.readFileSync(CHAIN, "utf8")) as { blocks?: unknown[] };
    chainTail = (j.blocks || [])
      .map((b) => parseLine(JSON.stringify(b)))
      .filter((b): b is BlockRec => !!b);
  } catch {
    /* אין-זנב-חי — כנות */
  }
  const seen = new Set(archive.map((b) => b.height));
  const merged = [...chainTail.filter((b) => !seen.has(b.height)).sort((a, b) => b.height - a.height), ...archive].slice(0, n);

  return NextResponse.json({
    ok: true,
    mode: "tail",
    blocks: merged,
    head: merged[0]?.height || 0,
    at: new Date().toISOString(),
  });
}
