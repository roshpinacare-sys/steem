import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const tasksData = JSON.parse(fs.readFileSync(path.join(root, "docs/canonical/tasks/TASKS.json"), "utf8"));
const tasks = tasksData.tasks ?? tasksData;
const claims = fs.readFileSync(path.join(root, "docs/canonical/research/CLAIMS_LEDGER.jsonl"), "utf8")
  .trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const findingsData = JSON.parse(fs.readFileSync(path.join(root, "docs/roast/ROAST_FINDINGS.json"), "utf8"));
const findings = findingsData.findings ?? [];
const nodes = [];
const edges = [];
const addNode = (id, type, label, metadata = {}) => nodes.push({ id: `${type}:${id}`, type, label, metadata });
const addEdge = (fromType, fromId, relation, toType, toId) => edges.push({ from: `${fromType}:${fromId}`, relation, to: `${toType}:${toId}` });

for (const claim of claims) {
  addNode(claim.id, "claim", claim.statement, { type: claim.type, confidence: claim.confidence });
  for (const file of claim.repositoryEvidence ?? []) {
    addNode(file, "evidence", file, { exists: fs.existsSync(path.join(root, file)) });
    addEdge("claim", claim.id, "supported_by", "evidence", file);
  }
}
for (const task of tasks) {
  addNode(task.id, "task", task.title, { status: task.status, workstream: task.workstream, priority: task.priority });
  for (const claimId of task.claimRefs ?? []) addEdge("task", task.id, "grounds", "claim", claimId);
  for (const dependency of task.dependsOn ?? []) addEdge("task", task.id, "depends_on", "task", dependency);
  for (const adr of task.adrRefs ?? []) {
    addNode(adr, "adr", adr);
    addEdge("task", task.id, "decided_by", "adr", adr);
  }
  for (const file of task.evidenceRequired ?? []) {
    addNode(file, "evidence", file, { exists: fs.existsSync(path.join(root, file)) });
    addEdge("task", task.id, "requires", "evidence", file);
  }
}
for (const finding of findings) {
  addNode(finding.id, "finding", finding.title, { severity: finding.severity, status: finding.status, category: finding.category });
  for (const taskId of finding.canonicalTasks ?? []) addEdge("finding", finding.id, "remediated_by", "task", taskId);
  for (const file of finding.evidence ?? []) {
    const local = String(file).split("#")[0];
    if (!local || local.startsWith("runtime:")) continue;
    addNode(local, "evidence", local, { exists: fs.existsSync(path.join(root, local)) });
    addEdge("finding", finding.id, "observed_in", "evidence", local);
  }
}
const uniqueNodes = [...new Map(nodes.map((node) => [node.id, node])).values()];
const taskIds = new Set(tasks.map((task) => task.id));
const claimIds = new Set(claims.map((claim) => claim.id));
const diagnostics = {
  tasksWithoutClaims: tasks.filter((task) => !(task.claimRefs ?? []).length).map((task) => task.id),
  claimsWithoutTasks: claims.filter((claim) => !tasks.some((task) => (task.claimRefs ?? []).includes(claim.id))).map((claim) => claim.id),
  findingsWithoutTasks: findings.filter((finding) => !(finding.canonicalTasks ?? []).some((id) => taskIds.has(id))).map((finding) => finding.id),
  missingClaimRefs: tasks.flatMap((task) => (task.claimRefs ?? []).filter((id) => !claimIds.has(id)).map((id) => `${task.id}:${id}`)),
  missingEvidenceFiles: uniqueNodes.filter((node) => node.type === "evidence" && node.metadata.exists === false).map((node) => node.label),
};
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scope: "Repository traceability graph linking findings, canonical tasks, decisions, claims, and evidence paths.",
  summary: { nodes: uniqueNodes.length, edges: edges.length, tasks: tasks.length, claims: claims.length, findings: findings.length },
  diagnostics,
  nodes: uniqueNodes,
  edges,
};
const outDir = path.join(root, "docs/canonical/evidence/v12");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "traceability-graph.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`Traceability graph: ${report.summary.nodes} nodes, ${report.summary.edges} edges, ${diagnostics.missingClaimRefs.length} missing claim refs.`);
if (diagnostics.missingClaimRefs.length) process.exit(1);
