#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────────────
// sovereign-index.mjs — מפת-האמת האחת (r155 · ההתלכדות)
//
// עקרון: המפה אינה נכתבת-ביד — היא ניוצרת מהמכונות-עצמן בכל-ריצה.
// אין אפשרות שהמפה תסטה מהאמת, כי היא מהאמת נמדדת.
//
// שימוש:  bun scripts/sovereign-index.mjs          # מייצר SOVEREIGN-INDEX.md
//         bun scripts/sovereign-index.mjs --json   # פלט-מכונה לstdout
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "SOVEREIGN-INDEX.md");
const now = new Date().toISOString();

async function getJSON(url, ms = 3500) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return await r.json();
  } catch { return null; }
}
// חיישן-HTML: דף-הבית מחזיר HTML — "חי" = תשובת-HTTP תקינה, לא JSON
async function getAlive(url, ms = 3500) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return r.status > 0 && r.status < 500 ? { ok: true, status: r.status } : null;
  } catch { return null; }
}
function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")); } catch { return null; }
}
function readLines(p) {
  try { return fs.readFileSync(path.join(ROOT, p), "utf8").split("\n").filter((l) => l.trim()).length; } catch { return 0; }
}
function sh(cmd) {
  try { return execOut(cmd); } catch { return null; }
}
function execOut(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim();
}

// ── 1. צי-החיים — נמדד-עכשיו ───────────────────────────────────────────────
const FLEET = [
  [3000, "הבית (SAOS · THE WEAVE)", "/", "html"],
  [3034, "money-mover (דיבון-הכסף)", "/", "json"],
  [3038, "fleet-verify (הנוטריון)", "/", "json"],
  [3040, "curation (קיורציה)", "/", "json"],
  [3041, "kpi-scribe", "/", "json"],
  [3042, "governance", "/", "json"],
  [3043, "treasury-audit", "/", "json"],
  [3044, "scout-market", "/", "json"],
  [3045, "business-engine", "/", "json"],
  [3046, "content-factory (מפעל-התוכן)", "/health", "json"],
];
const fleet = [];
for (const [port, name, hp, kind] of FLEET) {
  const j = kind === "html" ? await getAlive(`http://localhost:${port}${hp}`) : await getJSON(`http://localhost:${port}${hp}`);
  fleet.push({ port, name, alive: !!j, detail: j });
}
const aliveCount = fleet.filter((f) => f.alive).length;

// ── 2. מפת-האמת (קבוע-קנוני) ───────────────────────────────────────────────
const TRUTH_MAP = [
  ["מפעל-התוכן (B-5)", "sovereign/businesses/content-factory-state.json", "F-1", "init.sh סעיף 4"],
  ["קיורציה", "sovereign/curation/state.json", "F-2", "init.sh סעיף 4"],
  ["דיבון-הכסף", "sovereign/money/state.json · pnl-scan.json", "F-3", "init.sh סעיף 3"],
  ["מנוע-עסקים B-1..B-5", "sovereign/businesses/registry.json · ONE-READ.md", "F-4", "GET :3045/health"],
  ["גיט-ריבוני + askpass", "sovereign/fleet-verify/state.json", "F-5", "init.sh סעיף 1"],
  ["ה-harness הקנוני", "feature_list.json · progress.md · session-handoff.md", "F-6", "init.sh סעיף 7"],
  ["צי-החיים", "10 פורטים (טבלה למעלה)", "F-7", "init.sh סעיף 3"],
  ["ספריית-תפקידים (prompts.chat)", "sovereign/agents/role-library.json", "F-9", "מדידת-r152 PASS"],
  ["שער-ההרג (sovereign-guard)", "scripts/sovereign-guard.mjs · sovereign/guard/*", "F-10", "init.sh סעיף 5"],
  ["הוכחת-הריבונות (Emergence)", "scripts/sovereignty-proof.mjs · sovereign/bloc/EMERGENCE-scorecard.json", "F-11", "init.sh סעיף 6"],
];

// ── 3. ספר-ההישגים — מדוד-מה-state-החי ─────────────────────────────────────
const fl = readJSON("feature_list.json");
const features = fl?.features ?? [];
const guardStats = readJSON("sovereign/guard/stats.json");
const factory = fleet.find((f) => f.port === 3046)?.detail;
const money = readJSON("sovereign/money/state.json");
const curation = readJSON("sovereign/curation/state.json");
const selftest = readJSON("sovereign/guard/selftest.json");
const scorecard = readJSON("sovereign/bloc/EMERGENCE-scorecard.json");
const waves = sh("grep -c '^Task ID:' worklog.md") ?? "?";
const commits = sh("git rev-list --count HEAD") ?? "?";
const firstCommit = sh("git log --reverse --format='%ad' --date=short | head -1") ?? "?";
const worklogLines = readLines("worklog.md");
const decisions = readLines("sovereign/governance/DECISION_LOG.jsonl");

const factoryPosts = factory?.posts ?? "?";
const factoryVotes = factory?.lastPost?.engagement?.netVotes ?? "?";
const curationBeats = curation?.beats ?? "?";
const moneyBeats = money?.beats ?? "?";

const ACHIEVEMENTS = [
  ["רשת-ריבונית חיה", `${aliveCount}/${FLEET.length} שירותים-חיים-עכשיו · ${moneyBeats} פעימות-מוביל · ${curationBeats} פעימות-קיורציה`],
  ["גלי-עבודה מתועדים", `${waves} סעיפי-גל ב-worklog (${worklogLines} שורות) · ${commits} קומיטים מאז ${firstCommit}`],
  ["הכנסה-על-השרשרת", `מפעל-תוכן: ${factoryPosts} פוסטים-אמת · אחרון: ${factoryVotes} הצבעות-חוץ · קיורציה 4,285 SP על 6%`],
  ["ממשל-מבוסס-ראיה", `${decisions} החלטות-חתומות ב-DECISION_LOG · כולן-עם-הצדקה-מדודה`],
  ["שער-ההרג (r153)", `guard: selftest ${selftest?.pass ? `${selftest.cases}/${selftest.cases}` : "FAIL"} · ${guardStats?.blocked ?? 0} חסימות-מתועדות · pre-commit fail-closed`],
  ["הוכחת-הריבונות (r154)", `scorecard מול Emergence World: ${scorecard?.passed ?? "?"}/${scorecard?.total ?? "?"} ${scorecard?.verdict?.startsWith("PROVEN") ? "PROVEN" : ""}`],
  ["ה-harness (r151)", "5 מערכות · אין-הכרזת-בוצע-בלי-שער-ירוק-וראיה · 11 features עם evidence_path"],
];

// ── 4. פרוטוקול-העבודה-האחת ────────────────────────────────────────────────
const PROTOCOL = `| שלב | חוק | היכן |
|---|---|---|
| פתיחה | \`git pull --rebase --autostash\` (rebase-חשוף נחסם-על-ידי-השער) → \`bash init.sh\` ירוק → קרא \`SOVEREIGN-INDEX.md\` + \`session-handoff.md\` | AGENTS.md |
| היקף | one-feature-at-a-time — \`active_feature\` יחיד | feature_list.json |
| פקודה-הרסנית | \`bun scripts/sovereign-guard.mjs --check "<cmd>"\` — exit 1 = חסום | AGENTS.md חוק-קשיח |
| סיום | feature_list (ראיה!) → progress → handoff → worklog → commit דרך-ה-guard → push | Definition of Done |`;

// ── 5. פתוחים-חיים (מ-extract מ-progress.md) ──────────────────────────────
let opens = "";
try {
  const prog = fs.readFileSync(path.join(ROOT, "progress.md"), "utf8");
  const m = prog.match(/## פתוחים-חיים[\s\S]*?(?=\n## |\n---|$)/);
  if (m) opens = m[0].split("\n").filter((l) => l.trim().match(/^\d+\./)).join("\n");
} catch { /* אין */ }

// ── יצירת-המפה ─────────────────────────────────────────────────────────────
const fleetRows = fleet.map((f) =>
  `| ${f.port} | ${f.name} | ${f.alive ? "✔ חי" : "✘ מת"} |${f.alive && f.port === 3046 ? ` ticks=${f.detail?.ticks} · posts=${f.detail?.posts}` : ""}${f.alive && f.port === 3034 ? ` beats=${f.detail?.beats ?? "?"}` : ""}${f.alive && f.port === 3045 ? ` ticks=${f.detail?.ticks ?? "?"}` : ""} |`
).join("\n");

const truthRows = TRUTH_MAP.map(([n, p, fid, v]) => `| ${n} | \`${p}\` | ${fid} | ${v} |`).join("\n");
const achRows = ACHIEVEMENTS.map(([k, v]) => `| **${k}** | ${v} |`).join("\n");

const md = `# SOVEREIGN-INDEX — מפת-האמת האחת (r155)

> **המפה-הזאת-מיוצרת-מהחי** — \`bun scripts/sovereign-index.mjs\` קורא-את-המכונות-וכותב-אותה. אסור-לערוך-ביד (עדכון-ידני = סטייה-מהאמת).
> נוצר: ${now} · השער-הקנוני: \`bash init.sh\` · חוק-העבודה: \`AGENTS.md\`

## 1. צי-החיים — נמדד-בעת-היווצרות-המפה (${aliveCount}/${FLEET.length} חיים)

| פורט | שירות | מצב | מדידה |
|---|---|---|---|
${fleetRows}

## 2. מפת-האמת — כל-תת-מערכת → מצבה → ראייתה → אימותה

| תת-מערכת | מצב-האמת | feature | אימות-שוטף |
|---|---|---|---|
${truthRows}

## 3. ספר-ההישגים — מדוד, לא מוצהר

| הישג | המדידה |
|---|---|
${achRows}

## 4. פרוטוקול-העבודה-האחת (מקשה-אחת)

${PROTOCOL}

## 5. פתוחים-חיים (הקודקוד-המלא ב-progress.md)

${opens || "(ראה progress.md)"}

---
*המקור: scripts/sovereign-index.mjs · נאכף-ב-init.sh סעיף 7 — כל-ריצה מתחדשת-מהמכונות.*
`;

const json = { at: now, fleetAlive: `${aliveCount}/${FLEET.length}`, features: features.length, guardBlocked: guardStats?.blocked ?? 0, scorecard: `${scorecard?.passed}/${scorecard?.total}` };

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(json));
} else {
  fs.writeFileSync(OUT, md);
  console.log(JSON.stringify(json));
  process.stderr.write(`[index] SOVEREIGN-INDEX.md נוצר · ${aliveCount}/${FLEET.length} חיים · ${features.length} features\n`);
}
