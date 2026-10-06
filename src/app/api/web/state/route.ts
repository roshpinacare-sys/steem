// ─────────────────────────────────────────────────────────────────────
// /api/web/state — מצב רשת-האחסון v2: חבילות, משימות, מד RC חי,
// וסה"כ-מצטבר (באגים, תושבות, אומדני-הגירה כנים לכל חבילה חלקית).
// אינדקס הריפו הוא נוחות בלבד — כל אימות אמת עובר דרך /api/web/verify.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { readFile, readdir } from "fs/promises";
import path from "path";
import {
  probeStorageRc,
  webRepoPaths,
  anchorCapabilities,
  estimateMigration,
  WEB_ACCOUNT,
  type WebManifestRecord,
  type WebInboxJob,
  type MigrationEstimate,
} from "@/lib/web/netstore";

export const dynamic = "force-dynamic";

async function readJsonSafe<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(p, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function GET() {
  const t0 = Date.now();
  const root = process.cwd();
  const paths = webRepoPaths(root);

  // חבילות שפורסמו (מניפסטים שנכתבו על-ידי הענן אחרי אימות שרשרת)
  const packages: WebManifestRecord[] = [];
  try {
    for (const f of await readdir(paths.manifests)) {
      if (!f.endsWith(".json")) continue;
      const rec = await readJsonSafe<WebManifestRecord>(path.join(paths.manifests, f));
      if (rec?.manifest?.sha256) packages.push(rec);
    }
  } catch {
    /* ספרייה ריקה — אין חבילות עדיין */
  }
  packages.sort((a, b) => (b.manifest.at || "").localeCompare(a.manifest.at || ""));

  // משימות הממתינות לשידור ענן
  const inbox: WebInboxJob[] = [];
  try {
    for (const d of await readdir(paths.inbox)) {
      const job = await readJsonSafe<WebInboxJob>(path.join(paths.inbox, d, "job.json"));
      if (job) inbox.push(job);
    }
  } catch {
    /* אין דואר נכנס */
  }
  inbox.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  const rc = await probeStorageRc();

  // אומדני-הגירה הכנים: לכל חבילה חלקית, כמה תווים נותרו לשרשרת
  const migrations: Record<string, MigrationEstimate> = {};
  for (const p of packages) {
    if (p.status !== "partial") continue;
    const chars = (p.chain.chunks ?? []).reduce((s, c) => s + c.chars, 0);
    const remaining = Math.max(0, p.manifest.b64len - chars);
    if (remaining > 0) migrations[p.manifest.sha256] = estimateMigration(remaining, rc?.regenPerDay ?? null);
  }

  // סה"כ מצטבר — האמת המספרית של הרשת
  const totals = {
    packages: packages.length,
    sealed: packages.filter((p) => p.status !== "pending-seal").length,
    complete: packages.filter((p) => p.status === "complete").length,
    bytesTotal: packages.reduce((s, p) => s + p.manifest.bytes, 0),
    charsTotal: packages.reduce((s, p) => s + p.manifest.b64len, 0),
    charsOnChain: packages.reduce((s, p) => s + (p.chain.chunks ?? []).reduce((x, c) => x + c.chars, 0), 0),
    inboxWaiting: inbox.length,
  };
  totals.charsOnChain = Math.min(totals.charsOnChain, totals.charsTotal);
  const residencyPct = totals.charsTotal
    ? Math.round((totals.charsOnChain / totals.charsTotal) * 1000) / 10
    : 0;

  // אמת-מדידה גלויה: כל תשובה מפרסמת כמה זמן לקח לייצר אותה —
  // ה-header X-SAOS-Serve-Ms ניתן למדידה גם ב-curl -I בלי לפרסר גוף.
  const serveMs = Date.now() - t0;
  return NextResponse.json(
    {
      ok: true,
      account: WEB_ACCOUNT,
      at: new Date().toISOString(),
      serveMs,
      rc,
      packages,
      inbox,
      migrations,
      totals: { ...totals, residencyPct },
      caps: anchorCapabilities(),
    },
    { headers: { "X-SAOS-Serve-Ms": String(serveMs) } },
  );
}
