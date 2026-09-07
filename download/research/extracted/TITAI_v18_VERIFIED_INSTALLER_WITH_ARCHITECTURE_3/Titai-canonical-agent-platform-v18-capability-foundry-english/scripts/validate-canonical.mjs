import fs from "node:fs";
import { spawnSync } from "node:child_process";

const fail = [];
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const requiredString = (object, key, label) => {
  if (typeof object[key] !== "string" || object[key].trim() === "") fail.push(`${label} missing ${key}`);
};
const requiredArray = (object, key, label) => {
  if (!Array.isArray(object[key]) || object[key].length === 0) fail.push(`${label} missing ${key}`);
};

const manifest = readJson("docs/canonical/CANONICAL_MANIFEST.json");
const manifestPaths = new Set();
for (const document of manifest.documents) {
  requiredString(document, "id", "Manifest document");
  requiredString(document, "path", document.id || "Manifest document");
  if (manifestPaths.has(document.path)) fail.push(`Duplicate manifest path: ${document.path}`);
  manifestPaths.add(document.path);
  if (!fs.existsSync(document.path)) fail.push(`Missing manifest document: ${document.path}`);
}

const taskData = readJson("docs/canonical/tasks/TASKS.json");
const statusModel = new Set(taskData.statusModel || manifest.statusModel || []);
const tasks = taskData.tasks;
const ids = new Set();
const byId = new Map();
for (const task of tasks) {
  requiredString(task, "id", "Task");
  requiredString(task, "title", task.id || "Task");
  requiredString(task, "workstream", task.id || "Task");
  requiredString(task, "priority", task.id || "Task");
  if (!statusModel.has(task.status)) fail.push(`${task.id} has invalid status ${task.status}`);
  if (ids.has(task.id)) fail.push(`Duplicate task: ${task.id}`);
  ids.add(task.id);
  byId.set(task.id, task);
  for (const key of ["dependsOn", "adrRefs", "claimRefs"]) {
    if (!Array.isArray(task[key])) fail.push(`${task.id} missing array ${key}`);
  }
  for (const key of ["scope", "acceptance", "evidenceRequired", "rollback", "risks", "outOfScope"]) requiredArray(task, key, task.id);
  if (task.status === "blocked" && !task.blockedReason) fail.push(`${task.id} blocked without blockedReason`);
  if (task.status !== "blocked" && task.blockedReason) fail.push(`${task.id} has blockedReason but status is ${task.status}`);
}
for (const task of tasks) {
  for (const dependency of task.dependsOn) if (!byId.has(dependency)) fail.push(`${task.id} missing dependency ${dependency}`);
  if (task.status === "ready" && task.dependsOn.some((dependency) => byId.get(dependency)?.status !== "done")) {
    fail.push(`${task.id} is ready with incomplete dependency`);
  }
}
const visiting = new Set();
const visited = new Set();
function visit(id, stack = []) {
  if (visiting.has(id)) { fail.push(`Task cycle: ${[...stack, id].join(" -> ")}`); return; }
  if (visited.has(id)) return;
  visiting.add(id);
  for (const dependency of byId.get(id)?.dependsOn || []) visit(dependency, [...stack, id]);
  visiting.delete(id);
  visited.add(id);
}
for (const id of ids) visit(id);

const claimLines = fs.readFileSync("docs/canonical/research/CLAIMS_LEDGER.jsonl", "utf8").trim().split(/\r?\n/).filter(Boolean);
const claims = claimLines.map((line, index) => {
  try { return JSON.parse(line); } catch (error) { fail.push(`Invalid claim JSON at line ${index + 1}: ${error.message}`); return {}; }
});
const claimIds = new Set();
for (const claim of claims) {
  requiredString(claim, "id", "Claim");
  requiredString(claim, "type", claim.id || "Claim");
  requiredString(claim, "confidence", claim.id || "Claim");
  requiredString(claim, "statement", claim.id || "Claim");
  requiredString(claim, "implication", claim.id || "Claim");
  if (!Array.isArray(claim.sourceRefs)) fail.push(`${claim.id} missing sourceRefs`);
  if (claimIds.has(claim.id)) fail.push(`Duplicate claim: ${claim.id}`);
  claimIds.add(claim.id);
}

const sourceData = readJson("docs/canonical/research/SOURCE_REGISTRY.json");
const sourceIds = new Set();
for (const source of sourceData.sources) {
  for (const key of ["id", "title", "organization", "url", "kind", "verifiedOn", "notes"]) requiredString(source, key, source.id || "Source");
  if (sourceIds.has(source.id)) fail.push(`Duplicate source: ${source.id}`);
  sourceIds.add(source.id);
  try {
    const url = new URL(source.url);
    if (!['https:', 'http:'].includes(url.protocol)) fail.push(`${source.id} has unsupported URL protocol`);
  } catch { fail.push(`${source.id} has invalid URL`); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source.verifiedOn)) fail.push(`${source.id} has invalid verifiedOn date`);
}
for (const claim of claims) for (const source of claim.sourceRefs || []) if (!sourceIds.has(source)) fail.push(`${claim.id} missing source ${source}`);

const adrFiles = fs.readdirSync("docs/canonical/decisions").filter((file) => file.endsWith(".md"));
const adrIds = new Set(adrFiles.map((file) => file.match(/ADR-\d{4}/)?.[0]).filter(Boolean));
for (const task of tasks) {
  for (const claim of task.claimRefs) if (!claimIds.has(claim)) fail.push(`${task.id} missing claim ${claim}`);
  for (const adr of task.adrRefs) if (!adrIds.has(adr)) fail.push(`${task.id} missing ADR ${adr}`);
}

const domains = readJson("docs/canonical/research/COVERAGE_DOMAINS.json").domains;
const domainIds = new Set();
const workstreams = new Set(tasks.map((task) => task.workstream));
for (const domain of domains) {
  requiredString(domain, "id", "Coverage domain");
  requiredString(domain, "description", domain.id || "Coverage domain");
  if (domainIds.has(domain.id)) fail.push(`Duplicate coverage domain: ${domain.id}`);
  domainIds.add(domain.id);
  if (!workstreams.has(domain.id)) fail.push(`Coverage domain has no task: ${domain.id}`);
}
for (const workstream of workstreams) if (!domainIds.has(workstream)) fail.push(`Task workstream has no coverage domain: ${workstream}`);

const experiments = readJson("docs/canonical/research/EXPERIMENT_CATALOG.json").experiments;
const experimentIds = new Set();
for (const experiment of experiments) {
  for (const key of ["id", "title", "hypothesis", "decisionRule", "status"]) requiredString(experiment, key, experiment.id || "Experiment");
  if (!((Array.isArray(experiment.metrics) && experiment.metrics.length) || (typeof experiment.metrics === "string" && experiment.metrics.trim()))) fail.push(`${experiment.id} missing metrics`);
  if (experimentIds.has(experiment.id)) fail.push(`Duplicate experiment: ${experiment.id}`);
  experimentIds.add(experiment.id);
}

const language = spawnSync(process.execPath, ["scripts/validate-english-only.mjs"], { encoding: "utf8" });
if (language.status !== 0) fail.push(language.stderr || language.stdout || "English-only validation failed");
if (fail.length) {
  console.error("Canonical validation failed:");
  for (const error of [...new Set(fail)]) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`Canonical validation passed: ${tasks.length} tasks, ${claims.length} claims, ${sourceIds.size} sources, ${adrIds.size} ADRs, ${domainIds.size} coverage domains, ${experiments.length} experiments.`);
