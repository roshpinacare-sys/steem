// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Sovereignty/Sync — משיכת הספר מהריפו אל ה-DB המקומי
//
// POST /api/weave/sovereignty/sync
//   1. git fetch origin main (אם יש remote; בלי — שגיאה ברורה)
//   2. קריאת sovereign/ledger.json מה-remote (לא מהקובץ המקומי!)
//   3. אם ה-remote חדש מה-DB → importLedger (משמר מפתחות מקומיים)
//   4. אימות מלא מחדש של השרשרת אחרי הייבוא — ההוכחה שהייבוא לא שבר כלום
//   5. דוח מלא חוזר ל-UI
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { db } from "@/lib/db";
import { jsonError, readJsonBody } from "@/lib/weave/api";
import { importLedger, parseLedgerSnapshot } from "@/lib/weave/ledger-sync";
import { verifyLedger } from "@/lib/weave/beat";

export const dynamic = "force-dynamic";

const ROOT = process.cwd();

function sh(cmd: string): string {
  return execSync(cmd, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024, // R91: הספר חצה את ה-1MB — בלי תקרה הוא נחנק בשקט (ENOBUFS)
    stdio: ["ignore", "pipe", "pipe"],
  }).toString().trim();
}

function gitOrNull(cmd: string): string | null {
  try {
    const out = execSync(cmd, {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 32 * 1024 * 1024, // R91: הספר חצה את ה-1MB — בלי תקרה הוא נחנק בשקט (ENOBUFS)
      stdio: ["ignore", "pipe", "pipe"],
    }).toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    await readJsonBody(request);

    if (!gitOrNull("git remote get-url origin")) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "אין remote origin בעותק המקומי — הסנכרון מהריפו דורש clone עם origin (הרץ: git remote add origin <url>)",
        },
        { status: 400 }
      );
    }

    // 1. fetch — בלי merge (לא נוגעים ב-working tree של הסנדבוקס)
    const fetchOut = gitOrNull("git fetch origin main") ?? "";
    if (fetchOut.toLowerCase().includes("fatal")) {
      return NextResponse.json(
        { ok: false, error: "git fetch נכשל — בדוק גישה לריפו" },
        { status: 502 }
      );
    }

    // 2. הספר מה-remote (לא מהקובץ המקומי!)
    const remoteRaw = gitOrNull("git show origin/main:sovereign/ledger.json");
    if (!remoteRaw) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "לא נמצא sovereign/ledger.json ב-origin/main — הריפו עדיין לא מחזיק ספר (הרץ פעימה ראשונה: bun scripts/weave-beat.ts --local)",
        },
        { status: 404 }
      );
    }
    const snap = parseLedgerSnapshot(remoteRaw);

    // 3. השוואה מול המקומי
    const [lastAtt, count] = await Promise.all([
      db.attestation.findFirst({ orderBy: { seq: "desc" } }),
      db.attestation.count(),
    ]);
    const localCount = count;

    if (snap.chainCount <= localCount) {
      const verify = await verifyLedger();
      return NextResponse.json({
        ok: true,
        synced: false,
        reason:
          snap.chainCount === localCount
            ? "העותק המקומי כבר מסונכרן עם הריפו"
            : `העותק המקומי חדש מהריפו (מקומי ${localCount} > ריפו ${snap.chainCount}) — דחוף beat`,
        remote: { chainCount: snap.chainCount, headHash: snap.headHash, exportedAt: snap.exportedAt },
        verify,
      });
    }

    // 4. ייבוא + שימור מפתחות מקומיים
    const res = await importLedger(snap);

    // 5. אימות מלא אחרי הייבוא — ההוכחה שהספר שלם במקומו החדש
    const verify = await verifyLedger();

    return NextResponse.json({
      ok: true,
      synced: true,
      imported: res.imported,
      keysPreserved: res.keysPreserved,
      remote: { chainCount: snap.chainCount, headHash: snap.headHash, exportedAt: snap.exportedAt },
      verify,
    });
  } catch (error) {
    return jsonError(error);
  }
}
