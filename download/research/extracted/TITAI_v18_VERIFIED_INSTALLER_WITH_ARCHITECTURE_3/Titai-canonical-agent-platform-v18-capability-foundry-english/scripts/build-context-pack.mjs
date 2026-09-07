import fs from "node:fs";
import path from "node:path";
const id = process.argv[2];
if (!id) { console.error("Usage: npm run canonical:context -- TASK-ID"); process.exit(1); }
const taskData = JSON.parse(fs.readFileSync("docs/canonical/tasks/TASKS.json", "utf8"));
const task = taskData.tasks.find((t) => t.id === id);
if (!task) { console.error(`Unknown task: ${id}`); process.exit(1); }
const claims = fs.readFileSync("docs/canonical/research/CLAIMS_LEDGER.jsonl", "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const claimMap = new Map(claims.map((c) => [c.id, c]));
const sources = JSON.parse(fs.readFileSync("docs/canonical/research/SOURCE_REGISTRY.json", "utf8")).sources;
const sourceMap = new Map(sources.map((s) => [s.id, s]));
const adrFiles = fs.readdirSync("docs/canonical/decisions").filter((f) => f.endsWith(".md"));
const adrById = new Map(adrFiles.map((f) => [f.match(/ADR-\d{4}/)?.[0], f]));
const out = [];
out.push(`# Context Pack: ${task.id} — ${task.title}`);
out.push("", "## Authority", "", "Read and obey `AGENTS.md`. This pack is bounded to one task and does not override accepted ADRs.");
out.push("", "## Task", "", "```json", JSON.stringify(task, null, 2), "```");
out.push("", "## Referenced claims");
for (const cid of task.claimRefs) {
  const c = claimMap.get(cid); if (!c) continue;
  out.push("", `### ${c.id} — ${c.type} / ${c.confidence}`, "", c.statement, "", `Implication: ${c.implication}`);
  for (const sid of c.sourceRefs || []) { const s=sourceMap.get(sid); if(s) out.push(`- Source: ${s.title} — ${s.url} (verified ${s.verifiedOn})`); }
}
out.push("", "## Referenced ADRs");
for (const aid of task.adrRefs) {
  const file = adrById.get(aid); if (!file) continue;
  out.push("", `### ${aid}`, "", fs.readFileSync(path.join("docs/canonical/decisions", file), "utf8"));
}
out.push("", "## Required gates", "", fs.readFileSync("docs/canonical/14_ACCEPTANCE_GATES.md", "utf8"));
out.push("", "## Execution instruction", "", "Inspect only code relevant to this task. State assumptions, implement the smallest coherent slice, produce required evidence, and stop at scope. A builder cannot mark the work verified.");
const content = out.join("\n");
const outDir = "artifacts/context-packs"; fs.mkdirSync(outDir,{recursive:true});
const target = path.join(outDir, `${task.id}.md`); fs.writeFileSync(target, content+"\n");
console.log(target);
