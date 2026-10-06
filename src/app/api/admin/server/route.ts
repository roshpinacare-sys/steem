// ─────────────────────────────────────────────────────────────────────
// /api/admin/server — מצב השרת המקומי מול הענן: מרווח הסנכרון,
// מצב הגיט, ותהליכים. הכל במדידה כנה — מה שמת נראה מת.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { getMirror } from "@/lib/live/cloud";
import { operatorFromRequest } from "@/lib/operator-auth";

const execAsync = promisify(exec);

export const dynamic = "force-dynamic";

async function gitState() {
  try {
    const { stdout: head } = await execAsync("git rev-parse --short HEAD", { cwd: process.cwd() });
    const { stdout: branch } = await execAsync("git rev-parse --abbrev-ref HEAD", { cwd: process.cwd() });
    let behind = 0;
    let ahead = 0;
    try {
      await execAsync("git fetch origin main --quiet", { cwd: process.cwd(), timeout: 20000 });
      const { stdout: counts } = await execAsync(
        "git rev-list --left-right --count HEAD...origin/main",
        { cwd: process.cwd() }
      );
      const [a, b] = counts.trim().split(/\s+/).map(Number);
      ahead = Number.isFinite(a) ? a : 0;
      behind = Number.isFinite(b) ? b : 0;
    } catch {
      behind = -1; // fetch נכשל — לא ידוע
    }
    return { head: head.trim(), branch: branch.trim(), ahead, behind };
  } catch {
    return { head: "?", branch: "?", ahead: -1, behind: -1 };
  }
}

async function localLedgerFile() {
  try {
    const raw = await readFile(path.join(process.cwd(), "sovereign/ledger.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      attestations?: unknown[];
      checkpoints?: unknown[];
      headHash?: string;
      updatedAt?: string;
    };
    return {
      exists: true,
      attestations: Array.isArray(parsed.attestations) ? parsed.attestations.length : 0,
      checkpoints: Array.isArray(parsed.checkpoints) ? parsed.checkpoints.length : 0,
      headHash: parsed.headHash ?? null,
      updatedAt: parsed.updatedAt ?? null,
    };
  } catch {
    return { exists: false, attestations: 0, checkpoints: 0, headHash: null, updatedAt: null };
  }
}

export async function GET(req: Request) {
  // אזור-מפעיל: מצב השרת והסנכרון — רק לסשן חתום
  if (!operatorFromRequest(req)) {
    return NextResponse.json(
      {
        ok: false,
        error: "אזור האדמין נעול. התחבר עם מפתח ה-active של המפעיל.",
        locked: true,
      },
      { status: 401 },
    );
  }
  const startedAt = Date.now();
  try {
    const [localAtts, localCps, localAgents, git, ledgerFile, mirror] = await Promise.all([
      db.attestation.count().catch(() => -1),
      db.checkpoint.count().catch(() => -1),
      db.agent.count().catch(() => -1),
      gitState(),
      localLedgerFile(),
      getMirror().catch(() => null),
    ]);

    const cloud = mirror
      ? {
          attestations: mirror.stats.attestations,
          checkpoints: mirror.stats.checkpoints,
          agents: mirror.stats.agents,
          headHash: mirror.stats.headHash,
          generatedAt: mirror.generatedAt,
        }
      : null;

    return NextResponse.json({
      ok: true,
      server: {
        node: process.version,
        uptimeSec: Math.round(process.uptime()),
        platform: process.platform,
        pid: process.pid,
      },
      local: {
        db: {
          attestations: localAtts,
          checkpoints: localCps,
          agents: localAgents,
          note:
            localAtts >= 0 && localAtts <= 6
              ? "מסד הנתונים המקומי במצב seed — הסנדבוקס התחדש; האמת החיה בענן"
              : "מסד נתונים מקומי עם נתונים",
        },
        ledgerFile,
        git,
      },
      cloud,
      syncGap: cloud && localAtts >= 0 ? cloud.attestations - localAtts : null,
      measuredInMs: Date.now() - startedAt,
      servedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "מדידת השרת נכשלה",
      },
      { status: 500 }
    );
  }
}
