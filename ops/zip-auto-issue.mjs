// zip-auto-issue.mjs — R364 · Zip auto-issue (owner execution order 2026-11-05).
// The heartbeat watch measured: identity-guard (the "Zip" lane) failed in runs
// of ≥2 consecutive with no mechanism opening a tracking issue — wounds were
// only chat-reported and got lost. LAW: open ONE issue per red-episode,
// idempotent (search open issues for the marker before creating), honest body
// (run links + timestamps, verdicts only). Never closes issues (human closes).
import { readFileSync } from "node:fs";

const PAT = (process.env.ZIP_PAT || readFileSync("/home/z/my-project/upload/Titi.secret", "utf8").split("\n")[0].trim());
const H = { Authorization: `Bearer ${PAT}`, "User-Agent": "fleet-patrol", Accept: "application/vnd.github+json" };
const REPO = "roshpinacare-sys/Pulse";
const MARKER = "[zip-auto-issue]";

const api = async (path, opts = {}) => {
  const r = await fetch(`https://api.github.com${path}`, { headers: H, ...opts });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.status === 204 ? null : r.json();
};

const runs = await api(`/repos/${REPO}/actions/workflows/identity-guard.yml/runs?per_page=10`);
const rs = (runs.workflow_runs ?? []).slice(0, 6);
const failures = [];
for (const r of rs) {
  if (failures.length && r.conclusion !== "failure") break;
  if (r.conclusion === "failure") failures.push(r);
}
const red = failures.length >= 2;
console.log(`zip-watch: last runs → ${rs.map(r => (r.conclusion ?? r.status)?.[0]).join("")} | consecutive_red=${failures.length}`);

if (!red) { console.log("ZIP-GREEN-NO-ISSUE"); process.exit(0); }

// idempotency: an open issue with the marker + the newest failing run id?
const issues = await api(`/repos/${REPO}/issues?state=open&per_page=30`);
const mine = (issues ?? []).filter(i => i.title?.includes(MARKER));
const newest = failures[0];
if (mine.some(i => i.body?.includes(newest.html_url))) {
  console.log(`ZIP-RED-ISSUE-EXISTS (#${mine[0].number}, newest failure already tracked)`);
  process.exit(0);
}
const body = [
  "Auto-opened by the fleet patrol (R364, owner execution order 2026-11-05).",
  "",
  `**Red episode**: ${failures.length} consecutive identity-guard failures, newest first:`,
  ...failures.map(f => `- ${f.html_url} (${f.created_at})`),
  "",
  "Known pattern (measured 2026-11-04): identity-guard failed 17:19Z/18:27Z/18:37Z and self-cleared by 20:02Z without any commit — suspected GitHub-side flake or timing skew, NOT a code change.",
  "This issue is a tracking anchor so red episodes are never lost again. Close when the lane is verified green.",
  "",
  MARKER,
].join("\n");
const iss = await api(`/repos/${REPO}/issues`, {
  method: "POST",
  headers: { ...H, "Content-Type": "application/json" },
  body: JSON.stringify({
    title: `${MARKER} identity-guard red ×${failures.length} (newest ${newest.created_at})`,
    body,
    labels: ["automated", "custody"],
  }),
});
console.log(`ZIP-RED-ISSUE-OPENED #${iss.number} → ${iss.html_url}`);
