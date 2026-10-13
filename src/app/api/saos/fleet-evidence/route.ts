import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { deDashDeep } from "@/lib/clean-dashes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * R269 · fleet-evidence: the operator SEES the connection instead of being
 * told. Zero keys, zero writes: this route only READS measured state files
 * (the R269 fleet-matrix probe output, the engine's own per-cycle custody
 * verdicts, and the R268 forensics timeline) and composes one honest JSON.
 * The connection answer itself (who/keys/receipts) is the R268-measured
 * verdict, pinned in ATLAS §9 and docs/measured/hive-connection-forensics-r268.md.
 */
const STATE = path.join(process.cwd(), "mini-services", "saos-engine", "state");

function readJson(name: string): unknown {
  try {
    return JSON.parse(readFileSync(path.join(STATE, name), "utf8"));
  } catch {
    return null;
  }
}

type Blog = Record<string, { created?: string; permlink?: string; title?: string }[]>;

export async function GET() {
  const matrix = readJson("fleet-matrix-r269.json") as FleetMatrixRaw | null;
  const hiveCustody = readJson("hive-custody.json") as HiveCustodyRaw | null;
  const armyCustody = readJson("army-custody.json") as ArmyCustodyRaw | null;
  const posts = readJson("r268-hive-posts.json") as { blog?: Blog } | null;

  /* measured post timeline on Hive (connection era onward), straight from the
   * re-runnable R268 forensics probe output, not from anyone's memory */
  const timeline: { day: string; count: number; authors: string[]; sample: string }[] = [];
  const blog = posts?.blog;
  if (blog && typeof blog === "object") {
    const byDay = new Map<string, { count: number; authors: Set<string>; sample: string }>();
    for (const [author, arr] of Object.entries(blog)) {
      for (const p of arr ?? []) {
        const day = String(p?.created ?? "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < "2026-09-25") continue;
        const rec = byDay.get(day) ?? { count: 0, authors: new Set<string>(), sample: "" };
        rec.count += 1;
        rec.authors.add(author);
        if (!rec.sample) rec.sample = p?.permlink ?? p?.title ?? "";
        byDay.set(day, rec);
      }
    }
    for (const [day, v] of [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      timeline.push({ day, count: v.count, authors: [...v.authors].sort(), sample: v.sample });
    }
  }

  return NextResponse.json(deDashDeep({
    ok: true,
    at: new Date().toISOString(),
    connection: {
      verdict: "CONNECTED · 9/9",
      who: "הבית-המקביל של האורגניזם עצמו: economy-engine[bot] (גל-הכנסות Task 17, מצב real-votes). לא המפעיל, לא זר.",
      keys: "מפתחות-הדור-הראשון (GEN-1) מהכספת-ב-git · sha-pinned · זיכרון-בלבד, אמת-המפעיל \"המפתח-הראשון-שלי-זהה-לסטים\" מאומתת 9/9 posting+active בכל-מחזור",
      receiptCommits: ["8906af68 · 02.10 · receipts r5", "f9f54a72 · 04.10 · r3 (7 txid)", "868378fe · 04.10 · r4 (2 txid)"],
      probes: ["probe-r268-hive-forensics.mjs", "probe-r268-hive-posts.mjs", "probe-r269-fleet-matrix.mjs"],
      whaleBoundary: "headcorner-על-Hive נשאר רוטציה (תחום-מפעיל · פסק-R267/R268), בקבלות אפס שידורי-headcorner",
    },
    custody: {
      steem: {
        at: armyCustody?.at ?? null,
        verdict: armyCustody?.verdict ?? null,
        verified: armyCustody?.after?.verified ?? null,
        total: armyCustody?.after?.total ?? null,
      },
      hive: {
        at: hiveCustody?.at ?? null,
        verdict: hiveCustody?.verdict ?? null,
        verified: hiveCustody?.verified ?? null,
        total: hiveCustody?.total ?? null,
      },
    },
    timeline,
    matrix,
  }));
}

interface FleetMatrixRaw {
  at?: string
  probe?: string
  law?: string
  chains?: { steem?: unknown; hive?: unknown }
}
interface HiveCustodyRaw {
  at?: string
  verdict?: string
  verified?: number
  total?: number
}
interface ArmyCustodyRaw {
  at?: string
  verdict?: string
  after?: { verified?: number; total?: number }
}
