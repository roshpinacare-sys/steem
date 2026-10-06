// ─────────────────────────────────────────────────────────────────────
// /api/health — האימות-העצמי החי של השרת הריבוני.
//
// "האמת היא אימות השרת על הרשת" — נקודת-קצה אחת שכל אדם (או מוניטור
// חיצוני) יכול להפעיל ולקבל: האם כל מרכיבי הקונסולה באמת עובדים, עכשיו.
//
// כל בדיקה נמדדת בנפרד (ok/false + זמן באלפיות-שנייה). שום דבר לא
// מומר "ידע" — כישלון מדווח ככישלון. הבדיקות:
//   db       — SQLite חי (שאילתת בדיקה דרך Prisma)
//   vault    — מחסן-החבילות קריא (מניפסטים + בייטים)
//   integrity— sha256 של הבייטים במחסן מול החותם שנחתם בשרשרת
//   rpc      — צומת Steem עונה (מדידת-רשת חיה תמיד — fresh, בלי מטמון)
//   seals    — לכל חבילה: כתובת-בלוק ומספר-צ׳אנקים על-השרשרת
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { readFile, readdir, stat } from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import {
  probeStorageRc,
  webRepoPaths,
  WEB_ACCOUNT,
  type WebManifestRecord,
} from "@/lib/web/netstore";
import { startFleetGuard } from "@/lib/weave/fleet-guard";
import { startSelfBoot } from "@/lib/weave/self-boot";

export const dynamic = "force-dynamic";

// D-016 · הפעלה-עצמית כפולה: בקשת-הבריאות הראשונה מדליקה את שומר-הצי
// בתוך השרת (fleet-guard). זו נקודת-ההצתה העצלה: keeper פוגע כאן כל 30ש',
// לכן השומר קם גם ב-dev וגם אחרי כל החייאת-שרת, בלי סדר-עלייה תלוי.
// לולאה-יחידה ב-globalThis — קריאות חוזרות הן no-op.
startFleetGuard();

// D-027 · אתחול-עצמי ריבוני: אותה הצתה-עצלה מרימה את self-boot — סכימה,
// ספר וכספת קמים מעצמם אם נמדדו חסרים. אידמפוטנטי; קריאה חוזרת no-op.
startSelfBoot();

// R86: סנדבוקס מתאפס מדי יום — ספריית המניפסטים לא נוצרה עדיין. ״מחסן
// ריק״ הוא מצב תקין לפי ההגדרה שלעיל (0 חבילות = תקין); תיקייה-שאינה־קיימת
// היא אותו מצב בדיוק, לא כשל. זרימת הפרסום יוצרת אותה בכתיבה הראשונה.
async function readManifestFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch (e) {
    if (e instanceof Error && (e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

async function timed<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<{ name: string; ok: boolean; ms: number; detail: T | string }> {
  const t0 = Date.now();
  try {
    const detail = await fn();
    return { name, ok: true, ms: Date.now() - t0, detail };
  } catch (e) {
    return {
      name,
      ok: false,
      ms: Date.now() - t0,
      detail: String(e instanceof Error ? e.message : e).slice(0, 200),
    };
  }
}

export async function GET() {
  const t0 = Date.now();
  const root = process.cwd();
  const paths = webRepoPaths(root);

  // ① מסד-הנתונים — שאילתה חיה (לא "מחובר", אלא עונה בפועל)
  const dbCheck = timed("db", async () => {
    const rows = await db.$queryRaw`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'`;
    const n = Number((rows as Array<{ n: number | bigint }>)[0]?.n ?? 0);
    if (n < 1) throw new Error(`db-empty (${n} tables)`);
    return { tables: n };
  });

  // ② המחסן — מניפסטים קריאים ולכל אחד בייטים על-הדיסק
  const vaultCheck = timed("vault", async () => {
    const files = await readManifestFiles(paths.manifests);
    if (files.length === 0) return { packages: 0, note: "אין חבילות עדיין — מחסן ריק תקין" };
    let bytesOnDisk = 0;
    for (const f of files) {
      const hash = f.replace(/\.json$/, "");
      const bin = path.join(paths.packages, `${hash}.bin`);
      const st = await stat(bin); // זורק אם חסר — כישלון כנה
      bytesOnDisk += st.size;
    }
    return { packages: files.length, bytesOnDisk };
  });

  // ③ שלמות — הבייטים במחסן מוכרחים לחשב לבד לחותם שנחתם בשרשרת
  const integrityCheck = timed("integrity", async () => {
    const files = await readManifestFiles(paths.manifests);
    if (files.length === 0) return { verified: 0, note: "אין חבילות לאמת" };
    const results: Array<{ hash: string; match: boolean; bytes: number; status: string }> = [];
    for (const f of files) {
      const hash = f.replace(/\.json$/, "");
      const rec: WebManifestRecord | null = await readFile(
        path.join(paths.manifests, f),
        "utf8",
      )
        .then((t) => JSON.parse(t) as WebManifestRecord)
        .catch(() => null);
      const bin = await readFile(path.join(paths.packages, `${hash}.bin`)).catch(() => null);
      if (!rec || !bin) {
        results.push({ hash, match: false, bytes: bin?.length ?? 0, status: "missing" });
        continue;
      }
      const actual = createHash("sha256").update(bin).digest("hex");
      results.push({
        hash,
        match: actual === hash,
        bytes: bin.length,
        status: rec.status,
      });
    }
    const bad = results.filter((r) => !r.match);
    if (bad.length > 0)
      throw new Error(`sha256-mismatch: ${bad.map((b) => b.hash.slice(0, 8)).join(",")}`);
    return { verified: results.length, all: results };
  });

  // ④ RPC — צומת Steem עונה עכשיו. זהו מסלול-האמת של הבדיקה: מדידת-רשת
  // חיה תמיד (fresh), בלי פשרות-מטמון — התצוגה מהירה, האימות נוקשה.
  // גג-זמן 12 שניות: צומת תלוי-מדי מדווח ככישלון כנה, לא תולה את הבדיקה.
  const rpcCheck = timed("rpc", async () => {
    const rc = await Promise.race([
      probeStorageRc(undefined, { fresh: true }),
      new Promise<null>((_, rej) =>
        setTimeout(() => rej(new Error("rpc-timeout-12s")), 12_000),
      ),
    ]);
    if (!rc) throw new Error("steem-rpc-unreachable");
    return {
      account: rc.account,
      pct: rc.pct,
      headBlock: rc.headBlock,
      measuredAgoSec: rc.measuredAgoSec ?? 0,
      stale: rc.stale ?? false,
    };
  });

  // ⑤ חותמים — לכל חבילה כתובת-בלוק על שרשרת ציבורית + צ׳אנקים
  const sealsCheck = timed("seals", async () => {
    const files = await readManifestFiles(paths.manifests);
    const out: Array<{
      name: string;
      status: string;
      sealBlock: number | null;
      chunksOnChain: number;
      residencyPct: number;
    }> = [];
    for (const f of files) {
      const rec: WebManifestRecord | null = await readFile(
        path.join(paths.manifests, f),
        "utf8",
      )
        .then((t) => JSON.parse(t) as WebManifestRecord)
        .catch(() => null);
      if (!rec) continue;
      const chars = (rec.chain.chunks ?? []).reduce((s, c) => s + c.chars, 0);
      out.push({
        name: rec.manifest.name,
        status: rec.status,
        sealBlock: rec.chain.manifestOp?.block ?? null,
        chunksOnChain: rec.chain.chunks?.length ?? 0,
        residencyPct: rec.manifest.b64len
          ? Math.round((chars / rec.manifest.b64len) * 1000) / 10
          : 0,
      });
    }
    return { packages: out };
  });

  const [dbR, vaultR, integrityR, rpcR, sealsR] = await Promise.all([
    dbCheck,
    vaultCheck,
    integrityCheck,
    rpcCheck,
    sealsCheck,
  ]);

  const checks = [dbR, vaultR, integrityR, rpcR, sealsR];
  const ok = checks.every((c) => c.ok);
  const totalMs = Date.now() - t0;

  return NextResponse.json(
    {
      ok,
      service: "SAOS · THE WEAVE — sovereign console",
      account: WEB_ACCOUNT,
      at: new Date().toISOString(),
      totalMs,
      verdict: ok
        ? "כל המרכיבים עובדים — נמדד עכשיו, לא מונח"
        : "יש כשל — מדווח בכנות למטה",
      checks: Object.fromEntries(checks.map((c) => [c.name, c])),
    },
    {
      status: ok ? 200 : 503,
      headers: { "X-SAOS-Serve-Ms": String(totalMs) },
    },
  );
}
