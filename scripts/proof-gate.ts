#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · PROOF-GATE (R208P) — שער-פתיחת-מושב חוקי
//
// חוק-עבודה מחייב (ראה AGENTS.md §ספר-ההוכחות): כל מושב/סבב חדש מריץ
//   bun run scripts/proof-gate.ts
// לפני כל עבודה. השער:
//   1. מאמת את שרשרת ספר-ההוכחות (hash-chain מחושב-מחדש) — fail-closed.
//   2. מאמת כל עדות (קיום + sha256) — כל סטייה = EVIDENCE-DRIFT, כישלון.
//   3. מדפיס את מיון-הטענות: PROVEN (אסור-לפתוח-מחדש; רק-להפריך) ·
//      OPEN (רשימת-עדויות-חסרות בדיוק) · REFUTED.
//   4. --reprove: מריץ בחי את פקודות-השחזור ומצרף תוצאות לדוח.
//   5. כותב sovereign/proofs/gate-report.json (ראש-הספר + מיון) —
//      זהו המסמך שכל סבב חייב לצטט במקום לשכוח.
// קוד-יציאה: 0 = ספר-תקין · 1 = שרשרת/עדות-שבורה (אסור-לעבוד).
// ─────────────────────────────────────────────────────────────────────

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  GENESIS,
  REGISTRY_PATH,
  hashEntry,
  headHash,
  readRegistry,
  verifyRegistry,
  type ProofEntry,
} from "./proof-ledger";

const REPROVE = process.argv.includes("--reprove");
const REPORT = path.resolve(
  import.meta.dir,
  "../sovereign/proofs/gate-report.json",
);

interface EvidenceCheck {
  claimId: string;
  seq: number;
  path: string;
  expected: string;
  actual: string | null;
  ok: boolean;
  reason: string;
}

function checkEvidence(entries: ProofEntry[]): EvidenceCheck[] {
  const out: EvidenceCheck[] = [];
  for (const e of entries) {
    for (const ev of e.evidence) {
      let actual: string | null = null;
      let reason = "ok";
      try {
        actual = crypto
          .createHash("sha256")
          .update(fs.readFileSync(ev.path))
          .digest("hex");
        if (actual !== ev.sha256) reason = "EVIDENCE-DRIFT — התוכן השתנה מהרישום";
      } catch {
        reason = "EVIDENCE-MISSING — קובץ-עדות נעדר";
      }
      out.push({
        claimId: e.claimId,
        seq: e.seq,
        path: ev.path,
        expected: ev.sha256.slice(0, 16),
        actual: actual?.slice(0, 16) ?? null,
        ok: reason === "ok",
        reason,
      });
    }
  }
  return out;
}

interface ReproResult {
  claimId: string;
  cmd: string;
  exit: number;
  expect: string;
  ok: boolean;
  durSec: number;
  tail: string;
}

async function reprove(entries: ProofEntry[]): Promise<ReproResult[]> {
  const out: ReproResult[] = [];
  // הכרעה-אחרונה-ל-claimId (חוק P1): הרוויזיה-האחרונה היא שקובעת את
  // פקודת-השחזור והציפייה — לא הרישום-המקורי.
  const chosen = new Map<string, ProofEntry>();
  for (const e of entries) {
    if (e.reproduction) chosen.set(e.claimId, e);
  }
  for (const e of chosen.values()) {
    const repro = e.reproduction!;
    const t0 = Date.now();
    try {
      const proc = Bun.spawn(["bash", "-c", repro.cmd], {
        cwd: path.resolve(import.meta.dir, ".."),
        stdout: "pipe",
        stderr: "pipe",
      });
      const timer = setTimeout(() => proc.kill(), 600_000);
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const exit = await proc.exited;
      clearTimeout(timer);
      const tail = (stdout || stderr).trim().split("\n").slice(-3).join(" | ").slice(0, 300);
      out.push({
        claimId: e.claimId,
        cmd: repro.cmd,
        exit,
        expect: repro.expect,
        ok: exit === 0 && (repro.expect === "" || tail.includes(repro.expect) || stdout.includes(repro.expect)),
        durSec: Math.round((Date.now() - t0) / 1000),
        tail,
      });
    } catch (err) {
      out.push({
        claimId: e.claimId,
        cmd: repro.cmd,
        exit: 127,
        expect: repro.expect,
        ok: false,
        durSec: Math.round((Date.now() - t0) / 1000),
        tail: String(err).slice(0, 200),
      });
    }
  }
  return out;
}

async function main() {
  if (!fs.existsSync(REGISTRY_PATH)) {
    console.error("✗ ספר-ההוכחות נעדר לחלוטין — אסור לעבוד בלי ספר. הרץ רישום ראשון.");
    process.exit(1);
  }
  const entries = readRegistry();
  const chain = verifyRegistry(entries);
  if (!chain.ok) {
    console.error(`✗ שרשרת-ההוכחות שבורה ב-seq ${chain.brokenAt}: ${chain.reason}`);
    console.error("  אסור לעבוד על ספר שבור — נדרשת חקירה-מלאה (מי שינה, מה שרד).");
    process.exit(1);
  }
  const ev = checkEvidence(entries);
  // מדיניות-סטייה: רשומה-אחרונה-ל-claimId עם עדות-סוטה = כישלון;
  // רשומה-היסטורית-שהוחלפה (יש-עוקבת לאותו claimId) = אזהרה-בלבד
  // (ארטיפקטים-נגזרים כמו מטריצת-הריצה נוצרים-מחדש בכל שחזור — ההיסטוריה אינה נמחקת).
  const seqOfLatest = new Map<string, number>();
  for (const e of entries) seqOfLatest.set(e.claimId, e.seq);
  const evWithScope = ev.map((x) => ({ ...x, isLatest: seqOfLatest.get(x.claimId) === x.seq }));
  const drift = evWithScope.filter((x) => !x.ok && x.isLatest);
  const driftHistorical = evWithScope.filter((x) => !x.ok && !x.isLatest);
  const repro = REPROVE ? await reprove(entries) : [];
  const reproFails = repro.filter((r) => !r.ok);

  // מיון-הכרעות: הכרעה-אחרונה-ל-claimId
  const latest = new Map<string, ProofEntry>();
  for (const e of entries) latest.set(e.claimId, e);

  const proven = [...latest.values()].filter((e) => e.verdict === "PROVEN" || e.verdict === "STRENGTHENED" || e.verdict === "RESOLVED-BY-DECISION");
  const open = [...latest.values()].filter((e) => e.verdict === "OPEN" || e.verdict === "UNOBSERVED");
  const refuted = [...latest.values()].filter((e) => e.verdict === "REFUTED");

  const head = headHash(entries);
  const report = {
    at: new Date().toISOString(),
    law: "שער-פתיחת-מושב (R208P): אין עבודה בלי אימות-ספר · PROVEN אינו נפתח-מחדש — רק מופרך · ההפרכה נרשמת",
    genesis: GENESIS.slice(0, 16),
    head,
    totalEntries: entries.length,
    claims: { proven: proven.length, open: open.length, refuted: refuted.length },
    chainOk: true,
    evidenceChecks: { total: ev.length, drift: drift.length, historicalDrift: driftHistorical.length },
    evidenceDrift: drift,
    historicalDrift: driftHistorical,
    repro: REPROVE ? { ran: repro.length, failed: reproFails.length, results: repro } : { ran: 0, failed: 0, results: [] },
    verdicts: {
      proven: proven.map((e) => ({ claimId: e.claimId, seq: e.seq, scope: e.scope, verdict: e.verdict, at: e.at })),
      open: open.map((e) => ({ claimId: e.claimId, seq: e.seq, scope: e.scope, verdict: e.verdict, claim: e.claim.slice(0, 160) })),
      refuted: refuted.map((e) => ({ claimId: e.claimId, seq: e.seq, verdict: e.verdict })),
    },
  };
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 1));

  // ── דוח ──
  console.log("═══ שער-פתיחת-מושב · ספר-ההוכחות הריבוני (R208P) ═══");
  console.log(`ראש-הספר: ${head.slice(0, 24)}… · ${entries.length} רשומות · שרשרת-תקינה ✓`);
  console.log(`טענות: ${proven.length} PROVEN · ${open.length} OPEN · ${refuted.length} REFUTED`);
  console.log(`עדויות: ${ev.length} נבדקו · ${drift.length} סטיות-חיות · ${driftHistorical.length} סטיות-היסטוריות (אזהרה)`);
  if (driftHistorical.length) {
    console.log("⚠ HISTORICAL-DRIFT (רשומות-שהוחלפו — לא חוסמות):");
    for (const d of driftHistorical) console.log(`  - #${d.seq} ${d.claimId}: ${d.path.split("/").pop()} (${d.reason})`);
  }
  if (drift.length) {
    console.log("✗ EVIDENCE-DRIFT:");
    for (const d of drift) console.log(`  - #${d.seq} ${d.claimId}: ${d.path} (${d.reason})`);
  }
  if (REPROVE) {
    console.log(`שחזור-חי: ${repro.length} הורצו · ${reproFails.length} נכשלו`);
    for (const r of repro)
      console.log(`  ${r.ok ? "✓" : "✗"} ${r.claimId} (exit=${r.exit}, ${r.durSec}ש') ${r.ok ? "" : "→ " + r.tail.slice(0, 120)}`);
  }
  if (open.length) {
    console.log("── OPEN · חסרות-עדות בדיוק (כנות — לא להמציא):");
    for (const o of open) console.log(`  · [${o.scope}] ${o.claimId}: ${o.claim.slice(0, 120)}`);
  }
  console.log("חוק: PROVEN אינו נפתח-מחדש — רק מופרך; ההפרכה עצמה נרשמת בספר.");
  console.log(`דוח מלא: ${REPORT}`);

  if (drift.length || reproFails.length) {
    console.error("✗ השער נכשל — אין עבודה עד יישוב.");
    process.exit(1);
  }
  process.exit(0);
}

main();
