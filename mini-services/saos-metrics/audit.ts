/**
 * SAOS-METRICS / AUDIT MODULE — R218-b, "Step 2: claims-auditor"
 *
 * Purpose: productized R217. Recomputes the cockpit's data-layer claims from
 * ground truth (state files + this organ's own metrics.db) and compares them
 * against what the page ACTUALLY serves (/api/saos/status thin-proxy -> engine).
 *
 * Verdicts: MATCH | DRIFT | STALE | UNMEASURABLE
 * Two-strike doctrine (watchdog lineage): a DRIFT is confirmed only after one
 * re-read — engine mid-cycle writes between the two reads must not fake drift.
 * Bounded staleness: a run newer than 6h is served; older (or absent) -> run now.
 * Single-writer preserved: audits live in the same metrics.db, same writer.
 */

import fs from "fs";
import path from "path";
import type { Database } from "bun:sqlite";

export const STATE_DIR = "/home/z/my-project/mini-services/saos-engine/state";
const PROXY = "http://127.0.0.1:3000/api/saos/status";
const AUDIT_MAX_AGE_MS = 6 * 3600 * 1000;
const RETAIN_MS = 30 * 24 * 3600 * 1000;

export type Verdict = "MATCH" | "DRIFT" | "STALE" | "UNMEASURABLE";
export type Claim = {
  id: string;
  label: string;
  verdict: Verdict;
  expected: string;
  actual: string;
  detail: string;
};

export function initAudits(db: Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS audits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    ts TEXT NOT NULL,
    ts_epoch INTEGER NOT NULL,
    claim TEXT NOT NULL,
    label TEXT NOT NULL,
    verdict TEXT NOT NULL,
    expected TEXT,
    actual TEXT,
    detail TEXT
  );`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_audit_run ON audits(run_id);");
  db.exec(`DELETE FROM audits WHERE ts_epoch < ${Date.now() - RETAIN_MS}`);
}

/* ---------- helpers ---------- */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function readJson(p: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}
function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return String(Math.round(v * 1e6) / 1e6);
  if (typeof v === "object") return JSON.stringify(v).slice(0, 120);
  return String(v).slice(0, 120);
}
function ageSec(iso: unknown): number | null {
  if (typeof iso !== "string") return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.round((Date.now() - t) / 1000) : null;
}

async function proxyStatus(): Promise<any | null> {
  try {
    const r = await fetch(PROXY, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/* ---------- claim constructors ---------- */
function cmpNum(id: string, label: string, expected: unknown, actual: unknown, eps = 0, detail = ""): Claim {
  const base = { id, label, expected: fmt(expected), actual: fmt(actual), detail };
  if (expected === null || expected === undefined || actual === null || actual === undefined)
    return { ...base, verdict: "UNMEASURABLE", detail: detail || "מקור חסר — אין השוואה" };
  if (Math.abs((expected as number) - (actual as number)) <= eps) return { ...base, verdict: "MATCH", detail: detail || "זהה" };
  return { ...base, verdict: "DRIFT", detail: detail || `פער ${(expected as number) - (actual as number)}` };
}
function cmpEq(id: string, label: string, expected: unknown, actual: unknown, detail = ""): Claim {
  const base = { id, label, expected: fmt(expected), actual: fmt(actual), detail };
  if (expected === null || expected === undefined || actual === null || actual === undefined)
    return { ...base, verdict: "UNMEASURABLE", detail: detail || "מקור חסר — אין השוואה" };
  return { ...base, verdict: expected === actual ? "MATCH" : "DRIFT", detail: detail || (expected === actual ? "זהה" : "שונה") };
}
function cmpFresh(id: string, label: string, iso: unknown, maxAgeSec: number, what: string): Claim {
  const a = ageSec(iso);
  const base = { id, label, expected: `age ≤ ${maxAgeSec}s`, actual: a === null ? "—" : `${a}s`, detail: what };
  if (a === null) return { ...base, verdict: "UNMEASURABLE", detail: `${what} · חותמת חסרה` };
  return { ...base, verdict: a <= maxAgeSec ? "MATCH" : "STALE", detail: `${what} · נמדד לפני ${Math.round(a / 60)} דק` };
}

/* ---------- the claim table (state files + metrics.db vs proxy) ---------- */
function buildClaims(st: any | null, db: Database): Claim[] {
  const claims: Claim[] = [];
  const cur = readJson(path.join(STATE_DIR, "curator.json"));
  const obs = readJson(path.join(STATE_DIR, "observe.json"));
  const eco = readJson(path.join(STATE_DIR, "economics.json"));
  const daily = readJson(path.join(STATE_DIR, "daily-report.json"));
  const pay = readJson(path.join(STATE_DIR, "payouts.json"));
  const tank = readJson(path.join(STATE_DIR, "rc-tank.json"));
  const anchor = readJson(path.join(STATE_DIR, "custody-anchor.json"));

  /* curator claims: state file vs what the proxy serves */
  const pc = st?.curator ?? null;
  claims.push(cmpNum("curator.vpEff", "VP אפקטיבי %", cur?.vpEff ?? null, pc?.vpEff ?? null, 0.001));
  claims.push(cmpNum("curator.totalVotes", "סך-הצבעות", cur?.totalVotes ?? null, pc?.totalVotes ?? null));
  claims.push(cmpNum("curator.votesToday", "הצבעות-היום", cur?.votesTodayCount ?? null, pc?.votesToday ?? null));
  claims.push(cmpNum("curator.maxPerDay", "מכסה-יומית", cur?.maxPerDay ?? null, pc?.maxPerDay ?? null));
  claims.push(cmpEq("curator.verdict", "פסק-קיורציה", cur?.verdict ?? null, pc?.verdict ?? null));

  /* observe claims: raw chain-observed numbers */
  const po = st?.observe ?? null;
  claims.push(cmpNum("observe.parity", "פאריטי SBD/STEEM", obs?.parity?.parity ?? null, po?.parity?.parity ?? null, 1e-9));
  claims.push(cmpNum("observe.steemUsd", "מחיר STEEM$", obs?.steemUsd ?? null, po?.steemUsd ?? null, 1e-9));
  claims.push(cmpNum("observe.sbdUsd", "מחיר SBD$", obs?.sbdUsd ?? null, po?.sbdUsd ?? null, 1e-9));
  claims.push(cmpNum("observe.invSteem", "מלאי STEEM", obs?.inventory?.steem ?? null, po?.inventory?.steem ?? null, 1e-6));
  claims.push(cmpNum("observe.invSbd", "מלאי SBD", obs?.inventory?.sbd ?? null, po?.inventory?.sbd ?? null, 1e-6));
  claims.push(cmpFresh("observe.fresh", "טריות-תצפית", obs?.at ?? null, 15 * 60, "קבצי-מצב נכתבים כל מחזור (~10 דק)"));

  /* economics claims */
  const pe = st?.economics ?? null;
  const fileMm = Array.isArray(eco?.rails) ? eco.rails.find((r: any) => r?.id === "market-making") ?? null : null;
  const proxyMm = Array.isArray(pe?.rails) ? pe.rails.find((r: any) => r?.id === "market-making") ?? null : null;
  claims.push(
    cmpNum("econ.mmMeasured", "מדידת מעשה-שוק $/יום", fileMm?.measuredUsdPerDay ?? null, proxyMm?.measuredUsdPerDay ?? null, 1e-9,
      "null משני-הצדדים = תקין (אין חלון-מדידה)")
  );
  claims.push(cmpNum("econ.totalEst", "סך-מוערך $/יום", eco?.totalEstUsdPerDay ?? null, pe?.totalEstUsdPerDay ?? null, 1e-6));

  /* daily cycle claims */
  claims.push(cmpEq("daily.ok", "מחזור-יומי תקין", daily?.ok ?? null, st?.daily?.ok ?? null));
  claims.push(cmpFresh("daily.fresh", "טריות-מחזור", daily?.finishedAt ?? daily?.startedAt ?? null, 15 * 60, "מחזור מנוע ~10 דק"));

  /* payouts claims (if the proxy exposes them at all — honest scope) */
  const pp = st?.payouts?.pending ?? null;
  if (pp && pay?.pending) {
    claims.push(cmpNum("payouts.steem", "pending STEEM", pay.pending.steem ?? null, pp.steem ?? null, 1e-9));
    claims.push(cmpNum("payouts.sbd", "pending SBD", pay.pending.sbd ?? null, pp.sbd ?? null, 1e-9));
  } else {
    claims.push({ id: "payouts.pending", label: "pending-פרסים", verdict: "UNMEASURABLE", expected: "—", actual: "—", detail: "הפרוקסי אינו חושף payouts — מחוץ לטווח-הביקורת האוטומטית" });
  }

  /* soldiers LAW claim (T-80): keyless accounts must render FROZEN */
  const ps = st?.soldiers ?? null;
  if (ps && Array.isArray(ps.accounts) && ps.accounts.length > 0) {
    const allUnverified = ps.accounts.every((a: any) => a.custody !== "verified");
    const law = allUnverified ? ps.frozen === true : true;
    claims.push({
      id: "soldiers.frozenLaw", label: "חוק-הקפאת-חיילים (T-80)", verdict: law ? "MATCH" : "DRIFT",
      expected: "frozen=true כשאין custody-verified", actual: fmt(ps.frozen),
      detail: allUnverified ? "אין חשבונות-מאומתים — הצגת-הקפאה חוקית" : "יש חשבונות-מאומתים",
    });
  } else {
    claims.push({ id: "soldiers.frozenLaw", label: "חוק-הקפאת-חיילים (T-80)", verdict: "UNMEASURABLE", expected: "—", actual: "—", detail: "אין חיילים מוצבים — אין חוק לאמת" });
  }

  /* custody freshness (memory law: anchor ≤ 1/h + slack) */
  claims.push(cmpFresh("custody.fresh", "טריות-עד-משמורת", anchor?.at ? new Date(anchor.at).toISOString() : null, 75 * 60, "עיגון שעתי + מרווח"));

  /* self-audit: does THIS organ's time-series agree with the state files? */
  try {
    const row = db.prepare("SELECT ts, ts_epoch, vp_eff, fills_today, rc_tank_pct FROM snapshots ORDER BY id DESC LIMIT 1").get() as any;
    if (row) {
      claims.push(cmpFresh("metrics.fresh", "טריות-דגימת-מדדים", row.ts, 5 * 60, "דגימה כל 60s"));
      claims.push(cmpNum("metrics.vpEff", "מדדים↔קורטור VP", cur?.vpEff ?? null, row.vp_eff ?? null, 0.01, "שכבת-הזמן מסכימה עם מקור"));
      claims.push(cmpNum("metrics.fills", "מדדים↔כלכלה מילויים", fileMm?.meta?.fillsToday ?? null, row.fills_today ?? null, 0, "שכבת-הזמן מסכימה עם מקור"));
      claims.push(cmpNum("metrics.rcTank", "מדדים↔מיכל RC", tank?.rcPct ?? null, row.rc_tank_pct ?? null, 0.01, "שכבת-הזמן מסכימה עם מקור"));
    } else {
      claims.push({ id: "metrics.self", label: "ביקורת-עצמית מדדים", verdict: "UNMEASURABLE", expected: "—", actual: "—", detail: "אין דגימות עדיין" });
    }
  } catch {
    claims.push({ id: "metrics.self", label: "ביקורת-עצמית מדדים", verdict: "UNMEASURABLE", expected: "—", actual: "—", detail: "טבלת-הזמן אינה זמינה" });
  }

  if (!st) {
    claims.push({ id: "proxy.reach", label: "מסלול-ה-status של הדף", verdict: "UNMEASURABLE", expected: "200", actual: "—", detail: "הפרוקסי לא ענה — הביקורת השוותה קבצים בלבד" });
  }
  return claims;
}

/* ---------- run + persistence ---------- */
async function runOnce(db: Database): Promise<{ runId: string; at: string; claims: Claim[] }> {
  const runId = crypto.randomUUID();
  const at = new Date().toISOString();
  const st = await proxyStatus();
  let claims = buildClaims(st, db);

  /* two-strike: re-read drifted claims once before confirming */
  const drifted = claims.filter((c) => c.verdict === "DRIFT");
  if (drifted.length > 0) {
    await sleep(1500);
    const st2 = await proxyStatus();
    const pass2 = buildClaims(st2, db).filter((c) => drifted.some((d) => d.id === c.id));
    claims = claims.map((c) => {
      if (c.verdict !== "DRIFT") return c;
      const r2 = pass2.find((p) => p.id === c.id);
      if (r2 && r2.verdict !== "DRIFT") return { ...r2, detail: "two-strike: כתיבת-מחזור בין-הקריאות — התיישר בקריאה-שנייה" };
      return { ...c, detail: `${c.detail} · אושר בקריאה-שנייה` };
    });
  }

  const ins = db.prepare(
    `INSERT INTO audits (run_id, ts, ts_epoch, claim, label, verdict, expected, actual, detail)
     VALUES (?,?,?,?,?,?,?,?,?)`
  );
  const now = Date.now();
  for (const c of claims) ins.run(runId, at, now, c.id, c.label, c.verdict, c.expected, c.actual, c.detail);
  return { runId, at, claims };
}

export function latestAudit(db: Database): { runId: string; at: string; ageSec: number; counts: Record<string, number>; claims: Claim[] } | null {
  const last = db.prepare("SELECT run_id, ts, ts_epoch FROM audits ORDER BY id DESC LIMIT 1").get() as any;
  if (!last) return null;
  const rows = db.prepare("SELECT claim, label, verdict, expected, actual, detail FROM audits WHERE run_id = ? ORDER BY id ASC").all(last.run_id) as any[];
  const counts: Record<string, number> = { MATCH: 0, DRIFT: 0, STALE: 0, UNMEASURABLE: 0 };
  for (const r of rows) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
  return {
    runId: last.run_id,
    at: last.ts,
    ageSec: Math.round((Date.now() - last.ts_epoch) / 1000),
    counts,
    /* DB column is `claim` — expose as `id` for the cockpit contract */
    claims: rows.map((r) => ({ id: r.claim, label: r.label, verdict: r.verdict, expected: r.expected, actual: r.actual, detail: r.detail })) as Claim[],
  };
}

export async function maybeRunAudit(db: Database): Promise<{ ran: boolean; result: ReturnType<typeof latestAudit> }> {
  const last = latestAudit(db);
  if (last && last.ageSec * 1000 < AUDIT_MAX_AGE_MS) return { ran: false, result: last };
  await runOnce(db);
  return { ran: true, result: latestAudit(db) };
}

export async function forceRunAudit(db: Database): Promise<{ ran: boolean; result: ReturnType<typeof latestAudit> }> {
  await runOnce(db);
  return { ran: true, result: latestAudit(db) };
}
