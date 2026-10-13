/**
 * workloads.mjs — T-36 · THE WORKLOADS RAIL (google/ax doctrine, adopted
 * honestly — see lib.mjs header). The state layer of the declarative
 * orchestration plane:
 *
 *   DECLARED   workloads/*.json — saos.io/v1alpha1 Workload manifests,
 *              each generated from REAL code laws (step ids, state files,
 *              doctrine caps, verified reconcile flags). Validated
 *              fail-closed (lib.validateWorkloadManifest) — a manifest
 *              without a burn cap never reaches the plane.
 *   DESIRED    state/workloads-control.json — suspend/resume intents
 *              written by the control verb (engine /workloads/control,
 *              internal-only like every mutating verb, T-35 shield).
 *   ACTUAL     real state files read here — signals verified per rail
 *              (curator.json at/verdict, hyper-grid.json lastTickAt,
 *              exec-log.jsonl tail, convert-plan.json at, payouts.json at,
 *              daily-report.json finishedAt, hands.json lastRun,
 *              webintel.json fetchedAt).
 *   RECONCILE  lib.reconcileWorkloads plans flag writes ONLY where a real
 *              flag exists (verified consumed: curator.mjs:202,
 *              hypergrid.mjs:231); runWorkloads executes them and journals
 *              typed events. Everything else reports honestly.
 *   PHASES     lib.workloadPhase derives Pending/Running/Suspended/Failed
 *              from the signals — never declared by hope.
 *
 * Cadence law: runWorkloads runs as a REAL cycle step (daily.mjs) and
 * ALWAYS writes state/workloads.json — honest empty on failure, never a
 * silent skip (the T-30 promo-starvation lesson).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  parseWorkloadManifest, validateWorkloadManifest, workloadDesired,
  workloadPhase, reconcileWorkloads,
  applyWorkloadControl as applyWorkloadControlLib,
} from "./lib.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const DIR_MANIFESTS = path.join(DIR, "workloads");
const FILE_CONTROL = path.join(STATE, "workloads-control.json");
const FILE_STATE = path.join(STATE, "workloads.json");
const EVENTS_FILE = path.join(STATE, "events.jsonl");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

export const WORKLOADS_LAW =
  "saos.io/v1alpha1 Workload manifests (shape ax-inspired: github.com/google/ax, Apache-2.0): " +
  "every track DECLARED with goal/opClass/cadence + BURN CAP (missing cap = rejected fail-closed); " +
  "phases DERIVED from real state signals, never declared; suspend/resume is desired-state + reconcile " +
  "ONLY where a verified flag exists (curator.json:enabled, hyper-grid.json:conf.enabled) — " +
  "a suspend that suspends nothing is a lie and is refused.";

/* read + validate ALL manifests; skipped entries travel with the state */
export function readWorkloadManifests() {
  const out = { manifests: [], skipped: [] };
  let entries = [];
  try { entries = fs.readdirSync(DIR_MANIFESTS).filter((f) => f.endsWith(".json")); } catch (e) {
    out.skipped.push({ file: "*", reason: `dir-read-failed: ${String(e?.message ?? e).slice(0, 80)}` });
    return out;
  }
  for (const f of entries) {
    const m = parseWorkloadManifest(fs.readFileSync(path.join(DIR_MANIFESTS, f), "utf8"));
    const v = validateWorkloadManifest(m);
    if (!v.ok) { out.skipped.push({ file: f, reason: v.reason }); continue; }
    if (out.manifests.some((x) => x.metadata.name === v.name)) {
      out.skipped.push({ file: f, reason: `duplicate-name: ${v.name}` });
      continue;
    }
    out.manifests.push(m);
  }
  out.manifests.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
  return out;
}

/* the verified signal map — one entry per workload name; fields here were
 * each checked against the real state files before wiring (T-36). */
function readSignal(name) {
  switch (name) {
    case "curate": {
      const c = readJson(path.join(STATE, "curator.json"));
      if (!c) return {};
      const lastError = c.verdict === "BROADCAST-FAIL" ? "curator last verdict BROADCAST-FAIL" : null;
      return { lastRunAt: c.at ?? null, lastError, measuredSpendPerDayUsd: null };
    }
    case "hyper": {
      const h = readJson(path.join(STATE, "hyper-grid.json"));
      if (!h) return {};
      return { lastRunAt: h.lastTickAt ?? null, lastError: h.lastError ?? null, measuredSpendPerDayUsd: null };
    }
    case "convert": {
      const plan = readJson(path.join(STATE, "convert-plan.json"));
      const cs = readJson(path.join(STATE, "convert-state.json"));
      const pendingSbd = Number(cs?.pendingSbd ?? 0);
      return {
        lastRunAt: plan?.at ?? null,
        lastError: null, /* REFUSE verdicts are legit, not errors */
        measuredSpendPerDayUsd: isFinite(pendingSbd) ? pendingSbd : null, /* locked, ≈USD (SBD≈$1) */
      };
    }
    case "execute": {
      try {
        const lines = fs.readFileSync(path.join(STATE, "exec-log.jsonl"), "utf8").trim().split("\n").filter(Boolean);
        const last = lines.length ? JSON.parse(lines[lines.length - 1]) : null;
        if (!last) return {};
        return { lastRunAt: last.at ?? null, lastError: last.ok === false ? (last.error ?? "exec failed") : null, measuredSpendPerDayUsd: null };
      } catch { return {}; }
    }
    case "claim": {
      const p = readJson(path.join(STATE, "payouts.json"));
      if (!p) return {};
      return { lastRunAt: p.at ?? null, lastError: null, measuredSpendPerDayUsd: null };
    }
    case "report": {
      const d = readJson(path.join(STATE, "daily-report.json"));
      if (!d) return {};
      const repStep = d.steps?.report;
      return {
        lastRunAt: d.finishedAt ?? null,
        lastError: repStep?.ok === false ? (repStep.error ?? "report step failed") : null,
        measuredSpendPerDayUsd: null,
      };
    }
    case "hands": {
      const h = readJson(path.join(STATE, "hands.json"));
      if (!h) return {};
      const at = typeof h.lastRun === "string" ? h.lastRun : (h.lastRun?.at ?? null);
      return { lastRunAt: at, lastError: h.verdict === "UNREADABLE" ? "last judge verdict unreadable" : null, measuredSpendPerDayUsd: null };
    }
    case "webintel": {
      const w = readJson(path.join(STATE, "webintel.json"));
      if (!w) return {};
      return { lastRunAt: w.fetchedAt ?? null, lastError: null, measuredSpendPerDayUsd: null };
    }
    default:
      return {};
  }
}

/* actual flag values for the reconcile planner (name → boolean|null) */
function readActualFlags(manifests) {
  const actual = {};
  for (const m of manifests) {
    const r = m?.spec?.reconcile;
    if (!r) continue;
    const doc = readJson(path.join(STATE, r.file));
    if (!doc) { actual[m.metadata.name] = null; continue; }
    if (r.path === "enabled") actual[m.metadata.name] = doc.enabled === true;
    else if (r.path === "conf.enabled") actual[m.metadata.name] = doc?.conf?.enabled === true;
  }
  return actual;
}

export function controlState() { return readJson(FILE_CONTROL, {}); }

/** run one reconcile + phase-derivation pass — a REAL cycle step (daily.mjs):
 * executes planned flag writes, journals them, always writes state. */
export function runWorkloads({ now = new Date().toISOString() } = {}) {
  const doc = { at: now, ok: false, count: 0, skipped: [], workloads: [], reconciled: [], law: WORKLOADS_LAW };
  try {
    const { manifests, skipped } = readWorkloadManifests();
    doc.skipped = skipped;
    const control = controlState();
    const actual = readActualFlags(manifests);

    /* reconcile: desired → actual, verified flags only, journaled */
    for (const w of reconcileWorkloads(manifests, control, actual, { now })) {
      const doc2 = readJson(path.join(STATE, w.file));
      if (!doc2) { doc.reconciled.push({ ...w, applied: false, why: "state-file-missing" }); continue; }
      if (w.path === "enabled") doc2.enabled = w.value;
      else if (w.path === "conf.enabled") { doc2.conf = { ...(doc2.conf ?? {}), enabled: w.value }; }
      else { doc.reconciled.push({ ...w, applied: false, why: "path-not-allowlisted" }); continue; }
      try {
        writeJson(path.join(STATE, w.file), doc2);
        doc.reconciled.push({ ...w, applied: true });
        appendLine(EVENTS_FILE, { type: "workload.reconciled", at: now, name: w.name, file: w.file, path: w.path, value: w.value, reason: w.reason });
      } catch (e) {
        doc.reconciled.push({ ...w, applied: false, why: String(e?.message ?? e).slice(0, 80) });
      }
    }

    /* phases: derived from real signals, control-honoring */
    const nowMs = Date.parse(now);
    doc.workloads = manifests.map((m) => {
      const sig = readSignal(m.metadata.name);
      const desired = workloadDesired(control, m.metadata.name);
      const ph = workloadPhase(m, { ...sig, desired, nowMs });
      return {
        name: m.metadata.name,
        rail: m.metadata?.labels?.rail ?? null,
        stepId: m.spec.stepId,
        opClass: m.spec.opClass,
        cadenceMinutes: m.spec.cadenceMinutes,
        maxSpendPerDayUsd: m.spec.maxSpendPerDayUsd,
        guard: m.spec.guard ?? null,
        reconcilable: !!m.spec.reconcile,
        lastRunAt: sig.lastRunAt ?? null,
        desired,
        phase: ph.phase,
        conditions: ph.conditions,
      };
    });
    doc.count = doc.workloads.length;
    doc.control = control;
    doc.ok = true;
  } catch (e) {
    doc.error = String(e?.message ?? e).slice(0, 200);
  }
  try { writeJson(FILE_STATE, doc); } catch { /* state dir best-effort */ }
  return doc;
}

let cache = null; const CACHE_MS = 30_000;
export function workloadsState() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.state;
  cache = { at: now, state: readJson(FILE_STATE, null) };
  return cache.state;
}

/** the control verb — engine route calls this (IO stays in the state layer).
 * Fail-closed by lib.applyWorkloadControl: unknown name / non-reconcilable
 * / bad verb are REFUSED with typed reasons, never recorded-and-ignored. */
export function applyControl({ name, verb }, { now = new Date().toISOString(), source = "engine-route" } = {}) {
  const { manifests } = readWorkloadManifests();
  const control = controlState();
  const res = applyWorkloadControlLib(manifests, control, { name, verb }, now);
  if (!res.ok) return res;
  writeJson(FILE_CONTROL, res.control);
  appendLine(EVENTS_FILE, { type: "workload.control", at: now, name, verb, source, noop: !!res.noop });
  /* a control write changes desired state — reconcile immediately so the
   * verb is REAL within the same call (AX apply semantics, not "eventually") */
  const doc = runWorkloads({ now });
  return { ...res, reconciled: doc.reconciled.filter((r) => r.applied).length, phases: doc.workloads.reduce((a, w) => { a[w.phase] = (a[w.phase] ?? 0) + 1; return a; }, {}) };
}
