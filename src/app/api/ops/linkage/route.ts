import { NextResponse } from "next/server";
import { execFile, execFileSync, spawn } from "child_process";
import fs from "fs";
import path from "path";

import { AGENT_DIR } from "@/lib/agent-env";

// ─────────────────────────────────────────────────────────────────────────────
// /api/ops/linkage — L9 אחדות-הצי (Task 87): קישוריות חיילים↔ראש, חיה מהשרשראות.
//
//   GET  → מצב הקישוריות. מקור: linkage_report.json (נכתב על-ידי לולאת הדמון
//          כל 90 דק׳). אם הדוח ישן מ-15 דק׳ — הרצת audit חיה (חסרת-מפתחות)
//          עם fallback כנה לדוח הישן אם הרשת איטית. אפס-סודות חוצים את
//          הגבול: רק נתונים-ציבוריים מהשרשראות + טביעות-אצבע מקומיות.
//   POST → מצית ריצת --fix מנותקת (חתימת account_update במפתח-ה-active של
//          החייל עצמו; ה-op רק *מוסיף* רשות-חשבון — אף מפתח לא נמחק/מסובב).
//          מיד מחזיר dispatched — התוצאה נקראת ב-GET הבא (report file).
// ─────────────────────────────────────────────────────────────────────────────

interface LinkageChain {
  exists: boolean;
  linked: boolean;
  weight: number | null;
  threshold: number | null;
  keysIntact: Record<string, boolean> | null;
}
interface LinkageSoldier {
  username: string;
  mode: string;
  steem: LinkageChain;
  hive: LinkageChain;
  rc: { steem: number | null; hive: number | null };
  fixes: unknown[];
}
interface LinkageReport {
  at: string;
  head: string;
  layer: string;
  soldiersTotal: number;
  linkedChains: number;
  chainsTotal: number;
  allLinked: boolean;
  fixedNow: number;
  soldiers: LinkageSoldier[];
}

const REPORT = path.join(AGENT_DIR, "linkage_report.json");
const FRESH_MS = 15 * 60 * 1000;

function readReport(): LinkageReport | null {
  try {
    const raw = JSON.parse(fs.readFileSync(REPORT, "utf8")) as Record<string, unknown>;
    if (!raw || !Array.isArray(raw.soldiers)) return null;
    return normalizeReport(raw as unknown as LinkageReport);
  } catch {
    return null;
  }
}

/** linkage_report.json is written in the nested shape (chains:{steem,hive})
 *  by linkage.cjs, while --json stdout (and this API contract) is flat
 *  (steem/hive at the soldier level). Normalize defensively — the console
 *  must never crash on a shape drift. */
function normalizeReport(r: LinkageReport): LinkageReport {
  const soldiers = r.soldiers.map((s) => {
    const nested = (s as unknown as { chains?: { steem?: LinkageChain; hive?: LinkageChain } }).chains;
    const steem = s.steem ?? nested?.steem;
    const hive = s.hive ?? nested?.hive;
    if (!steem || !hive) return null;
    return { ...s, steem, hive } as LinkageSoldier;
  });
  return { ...r, soldiers: soldiers.filter((s): s is LinkageSoldier => s !== null) };
}

function reportAgeMs(r: LinkageReport | null): number | null {
  if (!r?.at) return null;
  const t = new Date(r.at).getTime();
  return Number.isFinite(t) ? Math.max(0, Date.now() - t) : null;
}

async function auditLive(): Promise<LinkageReport | null> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["linkage.cjs", "--audit", "--json"],
      { cwd: AGENT_DIR, timeout: 40_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) return resolve(null);
        try {
          const parsed = JSON.parse(String(stdout)) as LinkageReport;
          if (parsed && Array.isArray(parsed.soldiers)) resolve(normalizeReport(parsed));
          else resolve(null);
        } catch {
          resolve(null);
        }
      },
    );
  });
}

export async function GET() {
  let report = readReport();
  const age = reportAgeMs(report);
  if (!report || (age !== null && age > FRESH_MS)) {
    const live = await auditLive();
    if (live) report = live;
  }
  if (!report) {
    return NextResponse.json(
      { ok: false, error: "אין דוח-קישוריות זמין — לולאת linkage תכתוב בריצתה הבאה" },
      { status: 503 },
    );
  }
  const finalAge = reportAgeMs(report);
  return NextResponse.json({
    ok: true,
    report,
    ageSec: finalAge === null ? null : Math.round(finalAge / 1000),
    stale: finalAge !== null && finalAge > FRESH_MS,
  });
}

export async function POST() {
  // ריצה מנותקת — אפס-חסימה; התוצאה תיקרא ב-GET הבא (linkage_report.json).
  try {
    const out = fs.openSync(path.join(AGENT_DIR, "linkage.log"), "a");
    const child = spawn(
      process.execPath,
      ["linkage.cjs", "--fix", "--json"],
      { cwd: AGENT_DIR, detached: true, stdio: ["ignore", out, out] },
    );
    child.unref();
    // ריצת-סנכרון קצרה של audit בלבד, כדי שה-GET המיידי אחרי הכפתור יראה
    // לפחות את המצב-החי (ה-fix עצמו ייכתב על-ידי הריצה המנותקת)
    let sync = false;
    try {
      execFileSync(process.execPath, ["linkage.cjs", "--audit", "--json"], {
        cwd: AGENT_DIR,
        timeout: 40_000,
        stdio: "pipe",
        maxBuffer: 4 * 1024 * 1024,
      });
      sync = true;
    } catch {
      sync = false;
    }
    return NextResponse.json({ ok: true, dispatched: true, syncAudit: sync, pid: child.pid ?? null });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message ?? e).slice(0, 120) },
      { status: 500 },
    );
  }
}
