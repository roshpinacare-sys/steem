// R208 §II — ZERO-POINT: live snapshot BEFORE modification. Read-only.
// Tags: OBSERVED | VERIFIED | INFERRED | UNKNOWN | CONTRADICTED
import fs from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

const H = "/home/z/my-project";
const sha = (p: string) => { try { return createHash("sha256").update(fs.readFileSync(p)).digest("hex"); } catch { return null; } };
const T = (v: unknown, tag: string) => ({ v, tag });
const out: Record<string, unknown> = { _meta: { schema: "r208-zero-point-v1", at: new Date().toISOString(), trace: "1a10d7a051e822d1", law: "אין הופכים כישלון-API לאפס · אין הופכים נתון-ישן לחי · כל שדה נושא תג" } };

// 1. git
try {
  const head = execSync("git rev-parse HEAD", { cwd: H }).toString().trim();
  const dirty = execSync("git status --porcelain", { cwd: H }).toString().trim().split("\n").filter(Boolean);
  out.git = { head: T(head, "OBSERVED"), dirtyCount: T(dirty.length, "OBSERVED"), note: T("head=add01df2 (r207 ניקוי) — קוד-ההעדפות-החי ב-decide() כבר-ב-commit", "VERIFIED") };
} catch (e) { out.git = { error: T(String(e).slice(0, 120), "OBSERVED") }; }

// 2. live processes
const probe = async (url: string) => { try { const r = await fetch(url, { signal: AbortSignal.timeout(5000) }); return r.ok; } catch { return false; } };

// 3. preference book live state
import { verifyChain, activeDown, readPreferences } from "../../../mini-services/preferences";
const chain = verifyChain();
const p1 = activeDown("grid-pool-seed");
out.preferences = {
  chainOk: T(chain.ok, "OBSERVED"), chainCount: T(chain.count, "OBSERVED"),
  P1_active: T(p1 ? { seq: p1.seq, direction: p1.direction, scope: p1.scope, confidence: p1.confidence, expiresAt: p1.expiresAt, evidenceHashes: (p1.evidence ?? []).map(e => e.sha256.slice(0, 12)) } : null, "OBSERVED"),
  full: T(readPreferences(), "OBSERVED"),
  classification_hypothesis: T("P#1 חיה-בספר-החי (פוגה 10-12) · צרכן-יחיד ב-decide() · מעולם לא הפיקה WAIT-PREFERENCE חי (0 בהיסטוריה) — עדיין DOCUMENTED_PREFERENCE עד-הוכחה-התנהגותית", "INFERRED"),
};

// 4. objective model files
const model: Record<string, unknown> = {};
for (const f of ["objectives.json", "options.json", "capabilities.json", "authority-map.json"]) {
  const p = `${H}/sovereign/objectives/${f}`;
  let meta: Record<string, unknown> | null = null;
  try { meta = (JSON.parse(fs.readFileSync(p, "utf8")) as any)._meta ?? null; } catch {}
  model[f] = { sha256: T(sha(p), "OBSERVED"), builtAt: T(meta?.builtAt ?? null, "OBSERVED"), schema: T(meta?.schema ?? null, "OBSERVED") };
}
const ageMin = Math.round((Date.now() - new Date("2026-10-05T18:05:00Z").getTime()) / 60000);
model._freshness = T({ builtAt: "2026-10-05T18:05:00Z", ageMinutes: ageMin, verdict: ageMin < 24 * 60 ? "FRESH" : "STALE" }, "VERIFIED");
out.objectiveModel = model;

// 5. consumers of the model (grep ground truth)
let grepOut = "";
try { grepOut = execSync(`grep -rl "sovereign/objectives" src mini-services --include=*.ts --include=*.tsx 2>/dev/null | sort`, { cwd: H }).toString().trim(); } catch {}
out.modelConsumers = T({ files: grepOut ? grepOut.split("\n") : [], verdict: "הצרכנים-היחידים: מודול-ההעדפות (אזכור-נתיב-כראיה-טקסטואלית) · decide() לא מייבא/טוען את-המודל" }, "VERIFIED");

// 6. decision state + gate
try {
  const moneyState = JSON.parse(fs.readFileSync(`${H}/sovereign/money/state.json`, "utf8"));
  out.decisionState = {
    lastDecision: T(moneyState.lastDecision, "OBSERVED"),
    lastTotalSteem: T(moneyState.lastTotalSteem, "OBSERVED"),
    lastStreamDay: T(moneyState.lastStreamDay, "OBSERVED"),
    actionsToday: T(`${moneyState.actionsToday}/12`, "OBSERVED"),
    waveReacheableNow: T("דורש עלייה ≥200 STEEM בהון-הכולל מעל lastTotalSteem — מהחי הנוכחי לא-צפוי-במהלך-הסבב → צפוי OUTCOME_UNOBSERVED חי (מותר: רק-מעבדה)", "INFERRED"),
  };
} catch (e) { out.decisionState = { error: T(String(e).slice(0, 120), "OBSERVED") }; }
try {
  const gate = JSON.parse(fs.readFileSync(`${H}/sovereign/autonomy/GATE.json`, "utf8"));
  out.authorityGate = { mode: T(gate.mode, "OBSERVED"), updatedAt: T(gate.updatedAt ?? gate.at ?? null, "OBSERVED") };
} catch (e) { out.authorityGate = { error: T(String(e).slice(0, 120), "OBSERVED") }; }

// 7. predictions book (must NOT exist yet)
out.predictionBook = T({ exists: fs.existsSync(`${H}/sovereign/objectives/predictions.jsonl`), verdict: "אין ספר-תחזיות-טרום-פעולה — פער §VII פתוח" }, "OBSERVED");

// 8. live sensor (money API fresh) — unit-tagged
try {
  const r = await fetch("http://127.0.0.1:3000/api/money?fresh=1", { signal: AbortSignal.timeout(15000) });
  const j: any = await r.json();
  if (j?.ok) {
    out.sensor = {
      ok: T(true, "OBSERVED"),
      idleSteem: T({ v: j.idleSteem, unit: "STEEM" }, "OBSERVED"),
      deployedSteem: T({ v: j.deployedSteem, unit: "STEEM" }, "OBSERVED"),
      parity: T({ v: j.marks?.parity, unit: "SBD/STEEM", note: "לעולם לא USD/STEEM — לקח r207 (0.1041)" }, "OBSERVED"),
      sbdArming: T({ v: { state: j.sbdArming?.state, balance: j.sbdArming?.balance, commitable: j.sbdArming?.commitable }, unit: "SBD" }, "OBSERVED"),
      orders: T(Array.isArray(j.orders) ? j.orders.length : null, "OBSERVED"),
    };
  } else out.sensor = T({ ok: false, body: String(JSON.stringify(j)).slice(0, 200) }, "OBSERVED");
} catch (e) { out.sensor = T({ ok: false, error: String(e).slice(0, 150) }, "OBSERVED"); }

// 9. daemon liveness
out.daemons = {
  money3034: T(await probe("http://127.0.0.1:3034/"), "OBSERVED"),
  next3000: T(await probe("http://127.0.0.1:3000/api/health"), "OBSERVED"),
};

fs.writeFileSync(`${H}/sovereign/tmp/r208/zero-point.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ written: true, at: out._meta, prefs: out.preferences.P1_active, freshness: model._freshness, gate: out.authorityGate, sensor: out.sensor?.ok ?? out.sensor, consumers: out.modelConsumers, predictionBook: out.predictionBook }, null, 1));
