// ─────────────────────────────────────────────────────────────────────
// R208R MATRIX-RUNNER — מטריצת-סיבתיות-פקטוריאלית (§XII) + ארבעת-ההיפוכים
// (§XIII) + הפרדת-סמכות (§XIV/XV) + לחץ-משאבים (§XVI) + הוכחת-סף (§VII)
// trace 1a10dda614a62251
// ─────────────────────────────────────────────────────────────────────
import fs from "node:fs";

const H = "/home/z/my-project";
const OUT = `${H}/cognition/OBJECTIVE-CAUSALITY-MATRIX.json`;

// ── הצירים (§XII — מינימום-חובה) ───────────────────────────────────
const OBJECTIVE = ["ok-POSITIVE", "ok-NEGATIVE", "missing-OFF", "stale", "invalid-schema"] as const;
const PREF = ["absent", "active", "expired"] as const;
const AUTHORITY = ["valid", "absent-domain", "mutated-unanchored", "forbidden-legal"] as const;
const SENSOR = ["valid", "unmeasured", "unknown-stale", "invalid-unit"] as const;
const RESOURCE = ["sufficient", "insufficient"] as const;

const SBD_BY_SENSOR: Record<string, { value: number; unit?: string; ageSec?: number } | null> = {
  "valid": { value: 3.5 },               // POSITIVE לצורך-הציר (האובייקטיב נשלט-בנפרד כשצריך)
  "unmeasured": null,
  "unknown-stale": { value: 3.5, ageSec: 7200 },
  "invalid-unit": { value: 3.5, unit: "USD/STEEM" },
};

type World = { id: string; objectiveMode: string; prefMode: string; authMode: string; sbd: any; idleSteem: number; thresholdOverride?: number };

// לציר-objective: כשהמודל "ok" — ההבחנה POSITIVE/NEGATIVE נקבעת ע"י מדידת-ה-SBD
// המשמעותית; כשהמודל missing/stale/invalid — ההכרעה נדחית בלי-קשר למדידה.
function objectiveEnc(o: string, sensor: string): { objectiveMode: string; sbd: any } {
  const sensorSbd = SBD_BY_SENSOR[sensor] ?? null;
  if (o === "ok-POSITIVE") {
    const sbd = sensor === "valid" ? { value: 3.5 } : sensor === "invalid-unit" ? { value: 3.5, unit: "USD/STEEM" } : sensor === "unknown-stale" ? { value: 3.5, ageSec: 7200 } : null;
    return { objectiveMode: "ok", sbd };
  }
  if (o === "ok-NEGATIVE") {
    const sbd = sensor === "valid" ? { value: 0.015 } : sensor === "invalid-unit" ? { value: 0.015, unit: "USD/STEEM" } : sensor === "unknown-stale" ? { value: 0.015, ageSec: 7200 } : null;
    return { objectiveMode: "ok", sbd };
  }
  if (o === "missing-OFF") return { objectiveMode: "missing", sbd: sensorSbd };
  if (o === "stale") return { objectiveMode: "stale", sbd: sensorSbd };
  return { objectiveMode: "invalid-schema", sbd: sensorSbd };
}

const worlds: World[] = [];
for (const o of OBJECTIVE) for (const p of PREF) for (const a of AUTHORITY) for (const s of SENSOR) for (const r of RESOURCE) {
  const enc = objectiveEnc(o, s);
  worlds.push({
    id: `M|${o}|${p}|${a}|${s}|${r}`,
    objectiveMode: enc.objectiveMode,
    prefMode: p,
    authMode: a,
    sbd: enc.sbd,
    idleSteem: r === "sufficient" ? 210 : 100,
  });
}

// ── עולמות-מיוחדים: §VII הוכחת-סף ──────────────────────────────────
worlds.push(
  { id: "T|thr-0.5-sbd1.0-nopref", objectiveMode: "ok", prefMode: "absent", authMode: "valid", sbd: { value: 1.0 }, idleSteem: 210, thresholdOverride: 0.5 },
  { id: "T|thr-0.5-sbd1.0-nopref-authabsent", objectiveMode: "ok", prefMode: "absent", authMode: "absent-domain", sbd: { value: 1.0 }, idleSteem: 210, thresholdOverride: 0.5 },
  { id: "T|thr-3.0-sbd1.0-nopref-baseline", objectiveMode: "ok", prefMode: "absent", authMode: "valid", sbd: { value: 1.0 }, idleSteem: 210 },
  { id: "T|thr-0.5-sbd1.0-prefactive", objectiveMode: "ok", prefMode: "active", authMode: "valid", sbd: { value: 1.0 }, idleSteem: 210, thresholdOverride: 0.5 },
  { id: "T|thr-1e9-sbd3.5-nopref", objectiveMode: "ok", prefMode: "absent", authMode: "valid", sbd: { value: 3.5 }, idleSteem: 210, thresholdOverride: 1e9 },
);

// ── עולמות-מיוחדים: §XIII היפוכים-מדויקים (משתנה-יחיד) ─────────────
worlds.push(
  { id: "F1|flip-objective-neg", objectiveMode: "ok", prefMode: "absent", authMode: "valid", sbd: { value: 0.015 }, idleSteem: 210 },
  { id: "F1|flip-objective-pos", objectiveMode: "ok", prefMode: "absent", authMode: "valid", sbd: { value: 3.5 }, idleSteem: 210 },
  { id: "F2|flip-auth-absent", objectiveMode: "ok", prefMode: "absent", authMode: "absent-domain", sbd: { value: 3.5 }, idleSteem: 210 },
  { id: "F2|flip-auth-valid", objectiveMode: "ok", prefMode: "absent", authMode: "valid", sbd: { value: 3.5 }, idleSteem: 210 },
  { id: "F3|flip-sensor-valid", objectiveMode: "ok", prefMode: "absent", authMode: "valid", sbd: { value: 3.5 }, idleSteem: 210 },
  { id: "F3|flip-sensor-unmeasured", objectiveMode: "ok", prefMode: "absent", authMode: "valid", sbd: null, idleSteem: 210 },
  { id: "F4|flip-pref-active", objectiveMode: "ok", prefMode: "active", authMode: "valid", sbd: { value: 0.015 }, idleSteem: 210 },
  { id: "F4|flip-pref-expired", objectiveMode: "ok", prefMode: "expired", authMode: "valid", sbd: { value: 0.015 }, idleSteem: 210 },
);

// ── הרצה ───────────────────────────────────────────────────────────
async function runWorld(w: World): Promise<any> {
  const proc = Bun.spawn(["bun", `${H}/sovereign/tmp/r208r/world-child.mts`, JSON.stringify(w)], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  await proc.exited;
  try { return JSON.parse(out.trim().split("\n").pop()!); } catch { return { id: w.id, error: `child-failed: ${err.slice(0, 200)}` }; }
}

const results: any[] = [];
const t0 = Date.now();
const CONC = 6;
for (let i = 0; i < worlds.length; i += CONC) {
  const chunk = worlds.slice(i, i + CONC);
  const rs = await Promise.all(chunk.map(runWorld));
  results.push(...rs);
  if ((i / CONC) % 12 === 0) console.error(`... ${results.length}/${worlds.length} (${Math.round((Date.now() - t0) / 1000)}s)`);
}

// ── ניתוח ──────────────────────────────────────────────────────────
const byId = new Map(results.map((r) => [r.id, r]));
const agreementFails = results.filter((r) => r.error || r.agreement?.predictorVsActual === false || r.agreement?.builtinVsActual === false);
const predictionFails = results.filter((r) => !r.error && r.predictionWritten && r.predictionMatch === false);

// ארבעת-ההיפוכים מהעולמות-המיוחדים (§XIII)
const flips = {
  FLIP1_objective: {
    pair: ["F1|flip-objective-neg", "F1|flip-objective-pos"],
    neg: byId.get("F1|flip-objective-neg")?.actualDecision ?? null,
    pos: byId.get("F1|flip-objective-pos")?.actualDecision ?? null,
    changed: byId.get("F1|flip-objective-neg")?.actualDecision !== byId.get("F1|flip-objective-pos")?.actualDecision,
  },
  FLIP2_authority: {
    pair: ["F2|flip-auth-absent", "F2|flip-auth-valid"],
    absent: byId.get("F2|flip-auth-absent")?.actualDecision ?? null,
    valid: byId.get("F2|flip-auth-valid")?.actualDecision ?? null,
    changed: byId.get("F2|flip-auth-absent")?.actualDecision !== byId.get("F2|flip-auth-valid")?.actualDecision,
  },
  FLIP3_sensor: {
    pair: ["F3|flip-sensor-valid", "F3|flip-sensor-unmeasured"],
    valid: byId.get("F3|flip-sensor-valid")?.actualDecision ?? null,
    unmeasured: byId.get("F3|flip-sensor-unmeasured")?.actualDecision ?? null,
    changed: byId.get("F3|flip-sensor-valid")?.actualDecision !== byId.get("F3|flip-sensor-unmeasured")?.actualDecision,
  },
  FLIP4_preference: {
    pair: ["F4|flip-pref-active", "F4|flip-pref-expired"],
    active: byId.get("F4|flip-pref-active")?.actualDecision ?? null,
    expired: byId.get("F4|flip-pref-expired")?.actualDecision ?? null,
    changed: byId.get("F4|flip-pref-active")?.actualDecision !== byId.get("F4|flip-pref-expired")?.actualDecision,
    authorityUntouchedByPreference: (byId.get("F4|flip-pref-active")?.authorityForbidden === byId.get("F4|flip-pref-expired")?.authorityForbidden) && byId.get("F4|flip-pref-active")?.authorityForbidden === false,
  },
};

// §XIV: objective POSITIVE + authority ABSENT/forbidden ⇒ BLOCKED_BY_AUTHORITY ואפס-אקט
const xiv = results.filter((r) => r.axes?.objective === "ok" && r.inputs?.sbd === 3.5 && (r.axes?.authority === "absent-domain" || r.axes?.authority === "forbidden-legal") && r.axes?.pref === "absent" && r.axes?.sensor === "VALID" && r.axes?.resource === "SUFFICIENT");
const xivOk = xiv.every((r) => r.actualDecision === "BLOCKED_BY_AUTHORITY");
// §XV: authority VALID-permitting + objective NEGATIVE ⇒ WAIT (לא-ACT)
const xv = results.filter((r) => r.axes?.objective === "ok" && r.inputs?.sbd === 0.015 && r.axes?.authority === "valid" && r.axes?.pref === "absent" && r.axes?.sensor === "VALID" && r.axes?.resource === "SUFFICIENT");
const xvOk = xv.every((r) => r.actualDecision === "WAIT-MODEL");
// §XVI: לחץ-משאבים — INSUFFICIENT לעולם לא-ACT
const xvi = results.filter((r) => r.axes?.resource === "INSUFFICIENT");
const xviOk = xvi.every((r) => r.actualDecision !== "ACT");
// §XIV בדיקת-אפס-אקט: BLOCKED_BY_AUTHORITY לעולם לא מייצר פעולה
const blocked = results.filter((r) => r.actualDecision === "BLOCKED_BY_AUTHORITY");

// §VII — הוכחת-הסף
const thr = {
  baseline_3_0_sbd_1_0: byId.get("T|thr-3.0-sbd1.0-nopref-baseline")?.actualDecision ?? null,
  mutated_0_5_sbd_1_0: byId.get("T|thr-0.5-sbd1.0-nopref")?.actualDecision ?? null,
  thresholdMutationChangedDecision: (byId.get("T|thr-3.0-sbd1.0-nopref-baseline")?.actualDecision ?? "") !== (byId.get("T|thr-0.5-sbd1.0-nopref")?.actualDecision ?? ""),
  mutated_with_authority_absent: byId.get("T|thr-0.5-sbd1.0-nopref-authabsent")?.actualDecision ?? null,
  thresholdMutationCannotCreateAuthority: (byId.get("T|thr-0.5-sbd1.0-nopref-authabsent")?.actualDecision === "BLOCKED_BY_AUTHORITY"),
  mutated_with_pref_active: byId.get("T|thr-0.5-sbd1.0-prefactive")?.actualDecision ?? null,
  mutated_1e9: byId.get("T|thr-1e9-sbd3.5-nopref")?.actualDecision ?? null,
};

const matrix = {
  _meta: {
    schema: "r208r-objective-causality-matrix-v1",
    round: "R208R",
    trace: "1a10dda614a62251",
    at: new Date().toISOString(),
    dimensions: { objective: OBJECTIVE, pref: PREF, authority: AUTHORITY, sensor: SENSOR, resource: RESOURCE },
    totalWorlds: worlds.length,
    law: "אין-סיבתיות-מנתיב-מאושר-יחיד — כל-עולם: קלטים→תחזית→הכרעה→סמכות→שער→פעולה/סירוב",
    epistemic: "OBSERVED (הרצה-מעבדה-מבודדת) · העולם-החי נבדק-בנפרד",
  },
  summary: {
    worldsRun: results.length,
    worldsFailed: results.filter((r) => r.error).length,
    predictorAgreementFails: agreementFails.filter((r) => r.agreement?.predictorVsActual === false).length,
    builtinPredictionFails: agreementFails.filter((r) => r.agreement?.builtinVsActual === false).length,
    predictionBookMismatch: predictionFails.length,
    blockedByAuthorityCount: blocked.length,
    blockedNeverAct: blocked.every((r) => r.actualDecision !== "ACT"),
  },
  flips,
  sectionResults: { XIV_objectivePositiveAuthorityAbsent: { worlds: xiv.length, allBlockedByAuthority: xivOk }, XV_authorityValidObjectiveNegative: { worlds: xv.length, allWaitNotAct: xvOk }, XVI_resourcePressure: { worlds: xvi.length, neverAct: xviOk } },
  thresholdProvenance: thr,
  worlds: results,
};
fs.writeFileSync(OUT, JSON.stringify(matrix, null, 1));
console.log(JSON.stringify({
  worldsRun: matrix.summary.worldsRun,
  failed: matrix.summary.worldsFailed,
  predictorFails: matrix.summary.predictorAgreementFails,
  builtinFails: matrix.summary.builtinPredictionFails,
  predBookMismatch: matrix.summary.predictionBookMismatch,
  flips: Object.fromEntries(Object.entries(flips).map(([k, v]: any) => [k, v.changed])),
  flip4AuthorityUntouched: flips.FLIP4_preference.authorityUntouchedByPreference,
  xiv: matrix.sectionResults.XIV_objectivePositiveAuthorityAbsent,
  xv: matrix.sectionResults.XV_authorityValidObjectiveNegative,
  xvi: matrix.sectionResults.XVI_resourcePressure,
  threshold: thr,
  elapsedSec: Math.round((Date.now() - t0) / 1000),
}, null, 1));
