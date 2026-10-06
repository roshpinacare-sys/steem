// fleet-manifests-audit.mjs — r164 · r175: --manifests-only (server-side structural mode)
// Declared-vs-actual audit of the fleet manifest of record
// (sovereign/fleet/fleet.yaml, modeled on ax.io/v1alpha1).
// Evidence: probes each declared port/healthPath, maps listeners to pids,
// reads per-process RSS from /proc, scans 3000-3060 for undeclared listeners
// (manifest drift), writes sovereign/fleet/audit-latest.json.
// r175 --manifests-only: no runtime probes (GitHub-runner safe) — structural
// validation only: parse, uniqueness, required fields (FLO-2), phases, entry
// dirs exist, revive-lists ⊆ manifest. Exit: 0 = clean, 1 = violations.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAllDocuments } from "yaml";
import { execSync } from "node:child_process";

// ROOT derived from script location — works locally AND on GitHub runners
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = process.env.FLEET_MANIFEST ?? `${ROOT}/sovereign/fleet/fleet.yaml`;
const OUT = process.env.FLEET_AUDIT_OUT ?? `${ROOT}/sovereign/fleet/audit-latest.json`;
const MANIFESTS_ONLY = process.argv.includes("--manifests-only");

const docs = parseAllDocuments(readFileSync(MANIFEST, "utf8"))
  .map((d) => d.toJSON())
  .filter(Boolean);
const declared = docs.filter((d) => d.kind === "FleetService");

// --- structural validation (r175) — runs always; solo in --manifests-only ---
const structural = [];
const VALID_PHASES = new Set(["Running", "Suspended", "Standby"]);
const names = new Map();
const ports = new Map();
for (const svc of declared) {
  const name = svc?.metadata?.name;
  const spec = svc?.spec ?? {};
  if (!name) structural.push("FleetService missing metadata.name");
  else if (names.has(name)) structural.push(`duplicate service name: ${name}`);
  else names.set(name, spec);
  const port = spec.port;
  if (!Number.isInteger(port) || port < 3000 || port > 3060)
    structural.push(`${name ?? "?"}: port missing/outside 3000-3060 (${String(port)})`);
  else if (ports.has(port)) structural.push(`duplicate port ${port}: ${ports.get(port)} & ${name}`);
  else ports.set(port, name);
  if (!spec.healthPath) structural.push(`${name ?? "?"}: spec.healthPath missing`);
  if (!VALID_PHASES.has(spec.phase)) structural.push(`${name ?? "?"}: invalid phase '${String(spec.phase)}'`);
  const mem = spec.resources?.limits?.memoryMB;
  if (!Number.isInteger(mem) || mem <= 0)
    structural.push(`${name ?? "?"}: FLO-2 violation — no declared memory limit`);
  const entry = String(spec.entry ?? "");
  if (entry.startsWith("mini-services/")) {
    const dir = `${ROOT}/${entry.split(" ")[0].replace(/\/$/, "")}`;
    if (!existsSync(dir)) structural.push(`${name}: entry dir missing: ${dir}`);
  }
}

// revive-lists ⊆ manifest by port (drift between the sources of truth).
// NOTE: names differ across sources ("money" vs "money-mover") — port is the key.
for (const [file, re] of [
  ["scripts/daemons-revive.mjs", /name:\s*"([a-z0-9-]+)",\s*port:\s*(\d{4})/g],
  ["scripts/full-revive.mjs", /name:\s*"([a-z0-9-]+)",\s*port:\s*(\d{4})/g],
]) {
  const src = readFileSync(`${ROOT}/${file}`, "utf8");
  for (const m of src.matchAll(re)) {
    const [, rn, rp] = m;
    if (!ports.has(Number(rp)))
      structural.push(`${file}: revive entry ${rn}:${rp} not declared in fleet.yaml (FLO-1)`);
  }
}

if (MANIFESTS_ONLY) {
  const report = {
    schema: "fleet-audit-v1",
    mode: "manifests-only",
    auditedAt: new Date().toISOString(),
    declaredServices: declared.length,
    structuralViolations: structural.length,
    details: structural,
    services: declared.map((s) => ({ name: s.metadata?.name, port: s.spec?.port, phase: s.spec?.phase, memoryLimitMB: s.spec?.resources?.limits?.memoryMB ?? null })),
  };
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mode: "manifests-only", declared: report.declaredServices, structuralViolations: structural.length, details: structural }, null, 1));
  process.exit(structural.length ? 1 : 0);
}
if (structural.length) console.error("[manifest-structural] warnings (continuing to runtime audit):", structural);

// --- listeners: map port -> {pid, rssMB} -------------------------------------
let listeners = new Map(); // port -> {pid, rssMB}
try {
  const ss = execSync("ss -ltnp", { encoding: "utf8" });
  const pidByPort = new Map();
  for (const line of ss.split("\n")) {
    const pm = line.match(/:(\d{4,5})\b/);
    const pidm = line.match(/pid=(\d+)/);
    if (pm && pidm) pidByPort.set(Number(pm[1]), Number(pidm[1]));
  }
  for (const [port, pid] of pidByPort) {
    let rssMB = null;
    try {
      const st = readFileSync(`/proc/${pid}/status`, "utf8");
      const m = st.match(/VmRSS:\s+(\d+) kB/);
      if (m) rssMB = Math.round(Number(m[1]) / 1024);
    } catch { /* process vanished */ }
    listeners.set(port, { pid, rssMB });
  }
} catch (e) {
  console.error("ss scan failed:", e.message);
}

// --- probe health -------------------------------------------------------------
async function probe(port, path) {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 3500);
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: ac.signal });
    clearTimeout(t);
    return res.ok ? "alive" : `http-${res.status}`;
  } catch {
    return "dead";
  }
}

const rows = [];
for (const svc of declared) {
  const { port, healthPath = "/health" } = svc.spec;
  const declaredLimit = svc.spec.resources?.limits?.memoryMB ?? null;
  const actual = listeners.get(port) || null;
  const state = await probe(port, healthPath);
  const rssMB = actual?.rssMB ?? null;
  let verdict;
  if (svc.metadata.name === "decision-brain") {
    verdict = state === "alive" ? "ok-suspended-idle" : "dead";
  } else if (svc.spec.phase === "Running") {
    verdict = state === "alive" ? "ok" : "VIOLATION-declared-running-but-dead";
  } else {
    verdict = state === "alive" ? "ok" : `ok-${String(svc.spec.phase).toLowerCase()}`;
  }
  const overLimit = rssMB != null && declaredLimit != null && rssMB > declaredLimit;
  rows.push({
    name: svc.metadata.name,
    port,
    declaredPhase: svc.spec.phase,
    declaredMemoryLimitMB: declaredLimit,
    actualHealth: state,
    pid: actual?.pid ?? null,
    rssMB,
    memoryVerdict: overLimit ? "VIOLATION-over-limit" : "within-or-unknown",
    suspendPolicy: svc.spec.suspendPolicy ?? null,
    verdict,
  });
}

// --- undeclared listeners in the fleet port band (manifest drift) -------------
const declaredPorts = new Set(declared.map((d) => d.spec.port));
const undeclared = [...listeners.keys()]
  .filter((p) => p >= 3000 && p <= 3060 && !declaredPorts.has(p))
  .map((p) => ({ port: p, pid: listeners.get(p).pid, rssMB: listeners.get(p).rssMB }));

const violations = rows.filter((r) => r.verdict.startsWith("VIOLATION") || r.memoryVerdict.startsWith("VIOLATION"));
const report = {
  schema: "fleet-audit-v1",
  auditedAt: new Date().toISOString(),
  declaredServices: rows.length,
  alive: rows.filter((r) => String(r.actualHealth).startsWith("alive") || r.actualHealth.startsWith("http-2")).length,
  violations: violations.length,
  undeclaredListeners: undeclared,
  services: rows,
};
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  auditedAt: report.auditedAt,
  declared: report.declaredServices,
  alive: report.alive,
  violations: report.violations,
  undeclaredListeners: undeclared.length,
}, null, 1));
for (const r of rows) {
  console.log(`${r.verdict.padEnd(38)} ${String(r.name).padEnd(16)} :${r.port} phase=${r.declaredPhase} health=${r.actualHealth} rss=${r.rssMB ?? "?"}MB limit=${r.declaredMemoryLimitMB ?? "?"}MB`);
}
if (undeclared.length) console.log("UNDECLARED LISTENERS:", JSON.stringify(undeclared));
process.exit(violations.length ? 1 : 0);
