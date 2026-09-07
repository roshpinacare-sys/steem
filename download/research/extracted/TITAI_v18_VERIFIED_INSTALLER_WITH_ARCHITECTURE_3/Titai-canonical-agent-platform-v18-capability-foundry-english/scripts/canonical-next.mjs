import fs from "node:fs";
const data = JSON.parse(fs.readFileSync("docs/canonical/tasks/TASKS.json", "utf8"));
const byId = new Map(data.tasks.map((t) => [t.id, t]));
const rank = { P0: 0, P1: 1, P2: 2, P3: 3 };
const ready = data.tasks.filter((t) => t.status === "ready" && t.dependsOn.every((id) => byId.get(id)?.status === "done"));
ready.sort((a,b) => rank[a.priority]-rank[b.priority] || a.id.localeCompare(b.id));
if (!ready.length) { console.log("No dependency-ready task is available."); process.exit(0); }
console.log("Dependency-ready tasks:");
for (const t of ready) console.log(`${t.priority} ${t.id}  ${t.title}`);
