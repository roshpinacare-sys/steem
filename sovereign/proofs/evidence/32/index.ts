// ─────────────────────────────────────────────────────────────────────
// PROOF-LAW · המאכף-העומד של ספר-ההוכחות (R209 · פריצה-1 מתוכנית-ההנדסה)
//
// הבעיה: חוק-השער (proof-gate · R208P) היה טקס-פתיחת-מושב — רץ כשסוכן
// זוכר. התלונה-המייסדת: "אחרי שאתם מוכיחים — פתאום זה לא קיים". מרגע
// זה החוק לא תלוי-זיכרון: דיבון-עומד שמריץ את השער כל 5 דק' —
//   1. אימות-שרשרת מלא (hash-chain מחושב-מחדש מהג'נסיס) — fail-closed.
//   2. אימות-כל-עדות (קיום + sha256) — סטייה-חיה = אזעקה.
//   3. שחזור-חי מסתובב: פעימה-אחת מריצה את פקודת-השחזור של הטענה
//      הכי-ותיקה-שלא-נבדקה (מינימום 6 שעות בין-ריצות-לאותה-טענה) —
//      ההוכחה לא רק רשומה: היא **נרצית בחי** באופן-קבוע.
//   4. אזעקות: שרשרת-שבורה · סטיית-עדות-חיה · שחזור-נכשל · ספר-נעדר.
//
// חוקי-ברזל (כשאר-הצי):
//   · אפס סודות · קריאה בלבד לכל הספרים — הכתיבה היחידה: קובץ-המצב
//     של עצמו (sovereign/proofs/proof-law-state.json) בכתיבה אטומית.
//   · אפס-נגיעה ברישום — הספר append-only דרך appendProof בלבד (P1);
//     תוצאות-השחזור כאן נשמרות **מחוץ** לספר, בקובץ-המצב.
//   · טיימר-יחיד · שרת-יחיד · בלי-חפיפת-פעימות (דגל-ריצה).
// ─────────────────────────────────────────────────────────────────────

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import {
  GENESIS,
  headHash,
  readRegistry,
  verifyRegistry,
  type ProofEntry,
} from "../../scripts/proof-ledger";

declare const Bun: {
  serve: (opts: {
    port: number;
    hostname?: string;
    fetch: (req: Request) => Promise<Response> | Response;
  }) => unknown;
};

const PORT = 3052;
const BEAT_SEC = 5 * 60; // פעימה כל 5 דק'
const MIN_REPRO_GAP_SEC = 6 * 3600; // מינימום 6 שעות בין שחזורים-חיים-שלאותה-טענה
const REPRO_TIMEOUT_MS = 600_000;
const REPROS_PER_BEAT = 1; // קלילות: שחזור-חי אחד לפעימה
const HOME = "/home/z/my-project";
const STATE_FILE = path.join(HOME, "sovereign", "proofs", "proof-law-state.json");
const VERSION = "1.0.0";

interface ReproRecord {
  claimId: string;
  seq: number;
  at: string;
  exit: number;
  ok: boolean;
  durSec: number;
  tail: string;
}

interface LawState {
  version: string;
  at: string;
  beatCount: number;
  book: {
    exists: boolean;
    totalEntries: number;
    head: string | null;
    genesis: string;
    chainOk: boolean;
    chainBrokenAt?: number;
    chainReason?: string;
    claims: { proven: number; open: number; refuted: number; other: number };
  };
  evidence: { total: number; driftLive: number; driftHistorical: number };
  repro: {
    candidates: number;
    ranThisBeat: ReproRecord[];
    history: ReproRecord[]; // 200 אחרונות
    lastAt: string | null;
    failsTotal: number;
  };
  alarms: { id: string; severity: "CRITICAL" | "WARN"; detail: string; at: string }[];
  lastOkAt: string | null;
}

let busy = false;
let beatCount = 0;
let reproHistory: ReproRecord[] = [];
let failsTotal = 0;
let lastOkAt: string | null = null;

function atomicWrite(file: string, data: unknown): void {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
}

function loadState(): void {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as Partial<LawState>;
    reproHistory = s.repro?.history ?? [];
    failsTotal = s.repro?.failsTotal ?? 0;
    lastOkAt = s.lastOkAt ?? null;
    beatCount = s.beatCount ?? 0;
  } catch {
    /* פעימה-ראשונה */
  }
}

function lastReproAt(claimId: string): number {
  const rec = reproHistory.find((r) => r.claimId === claimId);
  return rec ? new Date(rec.at).getTime() : 0;
}

/** אימות-עדויות — אותו-כלל של השער: סטייה-בהכרעה-האחרונה = חיה; בהיסטוריה = אזהרה. */
function checkEvidence(entries: ProofEntry[]): {
  total: number;
  driftLive: number;
  driftHistorical: number;
  liveList: { claimId: string; seq: number; path: string; reason: string }[];
} {
  const latestSeq = new Map<string, number>();
  for (const e of entries) latestSeq.set(e.claimId, e.seq);
  let driftLive = 0;
  let driftHistorical = 0;
  const liveList: { claimId: string; seq: number; path: string; reason: string }[] = [];
  let total = 0;
  for (const e of entries) {
    for (const ev of e.evidence) {
      total++;
      let reason = "ok";
      try {
        const actual = crypto
          .createHash("sha256")
          .update(fs.readFileSync(ev.path))
          .digest("hex");
        if (actual !== ev.sha256) reason = "EVIDENCE-DRIFT";
      } catch {
        reason = "EVIDENCE-MISSING";
      }
      if (reason !== "ok") {
        if (latestSeq.get(e.claimId) === e.seq) {
          driftLive++;
          liveList.push({ claimId: e.claimId, seq: e.seq, path: ev.path, reason });
        } else {
          driftHistorical++;
        }
      }
    }
  }
  return { total, driftLive, driftHistorical, liveList };
}

/** שחזור-חי של פקודת-שחזור אחת (הכרעה-אחרונה-ל-claimId, PROVEN/STRENGTHENED בלבד). */
async function runOneRepro(entries: ProofEntry[]): Promise<ReproRecord | null> {
  const chosen = new Map<string, ProofEntry>();
  for (const e of entries) {
    if (!e.reproduction) continue;
    if (e.verdict !== "PROVEN" && e.verdict !== "STRENGTHENED" && e.verdict !== "RESOLVED-BY-DECISION")
      continue;
    chosen.set(e.claimId, e); // אחרון גובר (P1)
  }
  const candidates = [...chosen.values()]
    .filter((e) => Date.now() - lastReproAt(e.claimId) >= MIN_REPRO_GAP_SEC * 1000)
    .sort((a, b) => lastReproAt(a.claimId) - lastReproAt(b.claimId)); // הכי-ותיקה-שלא-נבדקה
  if (!candidates.length) return null;
  const target = candidates[0]!;
  const repro = target.reproduction!;
  const t0 = Date.now();
  try {
    const proc = Bun.spawn(["bash", "-c", repro.cmd], {
      cwd: HOME,
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => proc.kill(), REPRO_TIMEOUT_MS);
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exit = await proc.exited;
    clearTimeout(timer);
    const tail = (stdout || stderr).trim().split("\n").slice(-3).join(" | ").slice(0, 300);
    const ok = exit === 0 && (repro.expect === "" || tail.includes(repro.expect) || stdout.includes(repro.expect));
    return {
      claimId: target.claimId,
      seq: target.seq,
      at: new Date().toISOString(),
      exit,
      ok,
      durSec: Math.round((Date.now() - t0) / 1000),
      tail: ok ? tail : tail + ` · expect="${repro.expect}"`,
    };
  } catch (err) {
    return {
      claimId: target.claimId,
      seq: target.seq,
      at: new Date().toISOString(),
      exit: 127,
      ok: false,
      durSec: Math.round((Date.now() - t0) / 1000),
      tail: String(err).slice(0, 200),
    };
  }
}

async function beat(): Promise<LawState> {
  const at = new Date().toISOString();
  const alarms: LawState["alarms"] = [];
  const push = (id: string, severity: "CRITICAL" | "WARN", detail: string) =>
    alarms.push({ id, severity, detail, at });

  const exists = fs.existsSync(
    path.join(HOME, "sovereign", "proofs", "proof-registry.jsonl"),
  );
  let book: LawState["book"] = {
    exists: false,
    totalEntries: 0,
    head: null,
    genesis: GENESIS.slice(0, 16),
    chainOk: false,
    claims: { proven: 0, open: 0, refuted: 0, other: 0 },
  };
  let ev = { total: 0, driftLive: 0, driftHistorical: 0, liveList: [] as { claimId: string; seq: number; path: string; reason: string }[] };
  let candidates = 0;
  const ranThisBeat: ReproRecord[] = [];

  if (!exists) {
    push("BOOK-MISSING", "CRITICAL", "ספר-ההוכחות נעדר — אין אמת-משיכה; אסור עבודה בלי ספר");
  } else {
    const entries = readRegistry();
    const chain = verifyRegistry(entries);
    const latest = new Map<string, ProofEntry>();
    for (const e of entries) latest.set(e.claimId, e);
    const vals = [...latest.values()];
    book = {
      exists: true,
      totalEntries: entries.length,
      head: headHash(entries),
      genesis: GENESIS.slice(0, 16),
      chainOk: chain.ok,
      chainBrokenAt: chain.brokenAt,
      chainReason: chain.reason,
      claims: {
        proven: vals.filter((e) => e.verdict === "PROVEN" || e.verdict === "STRENGTHENED" || e.verdict === "RESOLVED-BY-DECISION").length,
        open: vals.filter((e) => e.verdict === "OPEN" || e.verdict === "UNOBSERVED").length,
        refuted: vals.filter((e) => e.verdict === "REFUTED").length,
        other: vals.filter((e) => e.verdict !== "PROVEN" && e.verdict !== "STRENGTHENED" && e.verdict !== "RESOLVED-BY-DECISION" && e.verdict !== "OPEN" && e.verdict !== "UNOBSERVED" && e.verdict !== "REFUTED").length,
      },
    };
    if (!chain.ok)
      push("CHAIN-BROKEN", "CRITICAL", `שרשרת שבורה ב-seq ${chain.brokenAt}: ${chain.reason} — חקירה-מלאה נדרשת`);
    ev = checkEvidence(entries);
    if (ev.driftLive > 0)
      push("EVIDENCE-DRIFT", "CRITICAL", `${ev.driftLive} סטיות-עדות-חיות: ${ev.liveList.map((d) => `#${d.seq} ${d.claimId} (${d.reason})`).join(" · ").slice(0, 240)}`);
    // שחזור-חי מסתובב
    const chosen = new Map<string, ProofEntry>();
    for (const e of entries) if (e.reproduction) chosen.set(e.claimId, e);
    candidates = [...chosen.values()].filter(
      (e) => e.verdict === "PROVEN" || e.verdict === "STRENGTHENED" || e.verdict === "RESOLVED-BY-DECISION",
    ).length;
    for (let i = 0; i < REPROS_PER_BEAT; i++) {
      const rec = await runOneRepro(entries);
      if (!rec) break;
      ranThisBeat.push(rec);
      reproHistory.unshift(rec);
      if (!rec.ok) {
        failsTotal++;
        push("REPRO-FAILED", "CRITICAL", `שחזור-חי נכשל: ${rec.claimId} exit=${rec.exit} · ${rec.tail.slice(0, 160)}`);
      }
    }
    reproHistory = reproHistory.slice(0, 200);
  }

  if (!alarms.some((a) => a.severity === "CRITICAL")) lastOkAt = at;
  beatCount++;
  const state: LawState = {
    version: VERSION,
    at,
    beatCount,
    book,
    evidence: { total: ev.total, driftLive: ev.driftLive, driftHistorical: ev.driftHistorical },
    repro: {
      candidates,
      ranThisBeat,
      history: reproHistory,
      lastAt: reproHistory[0]?.at ?? null,
      failsTotal,
    },
    alarms,
    lastOkAt,
  };
  atomicWrite(STATE_FILE, state);
  return state;
}

let currentState: LawState | null = null;

async function safeBeat(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    currentState = await beat();
    const crit = currentState.alarms.filter((a) => a.severity === "CRITICAL").length;
    console.log(
      `[proof-law] beat#${currentState.beatCount} · chain=${currentState.book.chainOk} · entries=${currentState.book.totalEntries} · drift-live=${currentState.evidence.driftLive} · repro=${currentState.repro.ranThisBeat.length ? currentState.repro.ranThisBeat.map((r) => `${r.claimId}:${r.ok ? "ok" : "FAIL"}`).join(",") : "-"} · alarms=${currentState.alarms.length}(crit=${crit})`,
    );
  } catch (err) {
    console.error("[proof-law] beat-exception:", String(err).slice(0, 200));
  } finally {
    busy = false;
  }
}

loadState();
console.log(`[proof-law] v${VERSION} · port ${PORT} · beat ${BEAT_SEC}s · מאכף-עומד של ספר-ההוכחות`);
await safeBeat();
setInterval(safeBeat, BEAT_SEC * 1000);

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  fetch: async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health")
      return Response.json({
        ok: true,
        service: "proof-law",
        version: VERSION,
        at: new Date().toISOString(),
        beatCount,
        lastOkAt,
        criticalAlarms: currentState?.alarms.filter((a) => a.severity === "CRITICAL").length ?? 0,
      });
    if (url.pathname === "/" || url.pathname === "/state")
      return Response.json({ ok: true, service: "proof-law", port: PORT, state: currentState ?? (await beat()) });
    if (url.pathname === "/beat" && req.method === "POST") {
      await safeBeat();
      return Response.json({ ok: true, forced: true });
    }
    return Response.json({ ok: false, error: "not-found" }, { status: 404 });
  },
});
