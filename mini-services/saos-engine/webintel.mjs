/**
 * webintel.mjs — T-22 · THE WEB-INTEL TEAM (עיניים-חיצוניות למכונה).
 * Operator order: "צריך עוד צוותים של בדיקות חיפוש הבנות והתפתחות בצורה
 * חכמה מאוד" and "אני לא רוצה להיות תלוי רק בדברים שאני מציע". This is the
 * machine's own standing external-intelligence team: a rotating set of
 * queries scans the STEEM/SBD ecosystem (price news, chain developments,
 * SBD market status, competing chains) and lands as dated, SOURCED findings
 * in state/webintel.json. The AI bridge lives in the Next backend
 * (/api/saos/ai/webintel — z-ai-web-dev-sdk, backend-only law); this module
 * is cadence-gated (6h), fail-isolated, and every finding carries url+date —
 * a finding without a source is not a finding.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { normalizeWebIntel, webIntelFresh } from "./lib.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const FILE = path.join(STATE, "webintel.json");
const BRIDGE = process.env.SAOS_AI_BRIDGE || "http://127.0.0.1:3000";
const CADENCE_MS = 6 * 3600_000; // 4 scans/day — bounded, honest

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};

/** the rotating recon plan — each scan answers ONE standing question */
export const QUERY_PLAN = [
  { id: "steem-price", q: "STEEM coin price news today", note: "price sentiment for the market rails" },
  { id: "steem-chain", q: "Steem blockchain development update", note: "chain developments affecting ops" },
  { id: "sbd-market", q: "Steem Dollar SBD market news", note: "the SBD print-path rail's external truth" },
  { id: "competitors", q: "Hive blockchain vs Steem 2026", note: "competitive landscape for the sovereign bloc" },
];

export function webintelState() { return readJson(FILE, null); }

export async function runWebIntel({ now = new Date().toISOString(), force = false } = {}) {
  const prev = readJson(FILE, null);
  const lastMs = prev?.fetchedAt ? Date.parse(prev.fetchedAt) : 0;
  if (!force && Number.isFinite(lastMs) && Date.now() - lastMs < CADENCE_MS) {
    return { verdict: "CADENCE-GATED", lastAt: prev.fetchedAt, nextInMs: Math.max(0, CADENCE_MS - (Date.now() - lastMs)) };
  }
  const t0 = Date.now();
  const scans = [];
  let totalFindings = 0, totalDropped = 0, failed = 0;
  for (const plan of QUERY_PLAN) {
    try {
      const r = await fetch(`${BRIDGE}/api/saos/ai/webintel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: plan.q, num: 5 }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!r.ok) throw new Error(`bridge ${r.status}`);
      const d = await r.json();
      const norm = normalizeWebIntel({ results: d?.results ?? [], query: plan.q, fetchedAt: now });
      totalFindings += norm.count; totalDropped += Math.max(0, norm.dropped);
      scans.push({ id: plan.id, note: plan.note, ...norm });
    } catch (e) {
      failed++;
      scans.push({ id: plan.id, note: plan.note, findings: [], count: 0, error: String(e?.message ?? e).slice(0, 120) });
    }
  }
  const doc = {
    fetchedAt: now,
    verdict: totalFindings > 0 ? "INTEL-OK" : failed >= QUERY_PLAN.length ? "BRIDGE-DOWN" : "INTEL-EMPTY",
    totalFindings, droppedJunk: Math.max(0, totalDropped), failedScans: failed,
    scans,
    ms: Date.now() - t0,
    law: "כל ממצא נושא מקור (url+תאריך) — ממצא בלי-מקור אינו ממצא",
  };
  /* history: last 3 runs, newest first — the trend is evidence too */
  writeJson(FILE, { ...doc, history: [{ fetchedAt: now, totalFindings, verdict: doc.verdict }, ...(Array.isArray(prev?.history) ? prev.history : []).slice(0, 2)] });
  return { verdict: doc.verdict, totalFindings, failedScans: failed, ms: doc.ms };
}

/** recruiter evidence: fresh intel (<26h) with sourced findings */
export function webIntelEvidence(nowMs = Date.now()) {
  const fresh = webIntelFresh(readJson(FILE, null), nowMs);
  return fresh ? `state/webintel.json: ${fresh.findings} sourced findings, age ${Math.round(fresh.ageMs / 3600000)}h — external recon live` : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWebIntel({ force: true }).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error("WEBINTEL-FAIL", e); process.exit(1); });
}
