import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const file = path.join(root, "docs/roast/ROAST_FINDINGS.json");
const errors = [];
if (!fs.existsSync(file)) errors.push("Missing docs/roast/ROAST_FINDINGS.json");
let data = { findings: [] };
if (!errors.length) {
  try { data = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { errors.push(`Invalid findings JSON: ${error.message}`); }
}
const allowedSeverity = new Set(["critical", "high", "medium", "low"]);
const allowedStatus = new Set(["fixed_in_v8", "fixed_in_v10", "fixed_in_v11", "fixed_in_v12", "fixed_in_v13", "fixed_in_v14", "fixed_in_v15", "fixed_in_v16", "fixed_in_v17", "fixed_in_v18", "partially_mitigated", "open", "environment_blocked", "accepted_risk"]);
const ids = new Set();
for (const finding of data.findings || []) {
  const label = finding.id || "Finding";
  for (const key of ["id", "title", "severity", "status", "confidence", "category", "description", "impact", "recommendation", "acceptanceTest"]) {
    if (typeof finding[key] !== "string" || !finding[key].trim()) errors.push(`${label} missing ${key}`);
  }
  for (const key of ["evidence", "canonicalTasks"]) {
    if (!Array.isArray(finding[key])) errors.push(`${label} missing array ${key}`);
  }
  if (!allowedSeverity.has(finding.severity)) errors.push(`${label} invalid severity ${finding.severity}`);
  if (!allowedStatus.has(finding.status)) errors.push(`${label} invalid status ${finding.status}`);
  if (ids.has(finding.id)) errors.push(`Duplicate finding ${finding.id}`);
  ids.add(finding.id);
  for (const evidence of finding.evidence || []) {
    const local = String(evidence).split("#")[0];
    if (local && !local.startsWith("runtime:") && !fs.existsSync(path.join(root, local))) {
      errors.push(`${label} missing evidence path ${local}`);
    }
  }
}
if (!Array.isArray(data.topProjectKillers) || data.topProjectKillers.length !== 20) errors.push("topProjectKillers must contain exactly 20 finding IDs");
for (const id of data.topProjectKillers || []) if (!ids.has(id)) errors.push(`Unknown topProjectKiller ${id}`);
if (!fs.existsSync(path.join(root, "docs/roast/evidence/roast-static-results.json"))) errors.push("Static roast evidence has not been generated");
if (errors.length) {
  console.error("Roast validation failed:");
  for (const error of [...new Set(errors)]) console.error(`- ${error}`);
  process.exit(1);
}
const counts = (data.findings || []).reduce((acc, finding) => {
  acc.total += 1;
  acc.bySeverity[finding.severity] = (acc.bySeverity[finding.severity] || 0) + 1;
  acc.byStatus[finding.status] = (acc.byStatus[finding.status] || 0) + 1;
  return acc;
}, { total: 0, bySeverity: {}, byStatus: {} });
console.log(`Roast validation passed: ${counts.total} findings, ${data.topProjectKillers.length} project killers.`);
