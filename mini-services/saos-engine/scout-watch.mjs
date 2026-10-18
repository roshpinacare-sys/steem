// scout-watch.mjs — CONTINUOUS SOVEREIGN DISCOVERY LOOP (T-526).
// Turns the one-shot scout into a persistent cadence: every cycle it runs
// ONE rotated query through scout.mjs (child process = crash isolation),
// merges verdicts into scout-state/LEDGER.json (cumulative memory), and
// Git-pushes the ledger ONLY when something new was learned (no noise for
// peers). The owner-curated channel (pinoyfreecoder github-finds) stays in
// rotation and will self-heal when the origin revives (CF 522 observed
// 2026-10-18 through two independent proxies — recorded honestly).
//
// LAUNCH (survival pattern): ( cd <engine dir> && setsid nohup bun scout-watch.mjs > /tmp/scout-watch.log 2>&1 < /dev/null & )
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const DIR = import.meta.dir;
const STATE = path.join(DIR, "scout-state");
const LEDGER = path.join(STATE, "LEDGER.json");
const LASTRUN = path.join(STATE, "last-run.json");
const CYCLE_MS = Number(process.env.SCOUT_CYCLE_MIN ?? 30) * 60_000;
const LIMIT = Number(process.env.SCOUT_LIMIT ?? 8);

// Rotation: sovereign-stack-relevant research themes. The owner-curated
// github-finds channel rides inside scout.mjs every cycle (free when CF 522).
const QUERIES = [
  "autonomous ai agent framework",
  "MCP model context protocol server",
  "sqlite drift detection schema governance",
  "secrets vault api key management cli",
  "agent swarm orchestration protocol",
  "signed heartbeat proof of existence chain",
];

fs.mkdirSync(STATE, { recursive: true });
const loadLedger = () => { try { return JSON.parse(fs.readFileSync(LEDGER, "utf8")); } catch { return { protocol: "saos.scout.ledger.v1", repos: {}, cycles: 0 }; } };

function newestReport() {
  const files = fs.readdirSync(STATE).filter((f) => /^[0-9a-f]{10}\.json$/.test(f));
  if (!files.length) return null;
  files.sort((a, b) => fs.statSync(path.join(STATE, b)).mtimeMs - fs.statSync(path.join(STATE, a)).mtimeMs);
  try { return JSON.parse(fs.readFileSync(path.join(STATE, files[0]), "utf8")); } catch { return null; }
}

function merge(ledger, report) {
  let changed = false;
  const order = ["REJECT", "FLAG", "PASS"];
  for (const s of report.screened ?? []) {
    if (!s.repo || s.verdict === "UNSCREENED") continue; // only learned facts
    const prev = ledger.repos[s.repo];
    if (!prev) {
      ledger.repos[s.repo] = { firstSeen: report.at, lastSeen: report.at, bestVerdict: s.verdict, worstVerdict: s.verdict, stars: s.stars ?? null, license: s.license ?? null, ageDays: s.ageDays ?? null, reasons: s.reasons ?? [], query: report.query };
      changed = true;
    } else {
      prev.lastSeen = report.at;
      if (order.indexOf(s.verdict) < order.indexOf(prev.worstVerdict)) { prev.worstVerdict = s.verdict; changed = true; }
      if (order.indexOf(s.verdict) > order.indexOf(prev.bestVerdict)) prev.bestVerdict = s.verdict;
      if ((s.stars ?? 0) > (prev.stars ?? 0)) { prev.stars = s.stars; changed = true; }
      if (JSON.stringify(prev.reasons) !== JSON.stringify(s.reasons ?? [])) { prev.reasons = s.reasons ?? []; changed = true; }
    }
  }
  ledger.cycles = (ledger.cycles ?? 0) + 1;
  ledger.updatedAt = new Date().toISOString();
  return changed;
}

async function sh(cmd) {
  return new Promise((res) => {
    const p = spawn("bash", ["-lc", cmd], { cwd: path.join(DIR, "../..") });
    let o = "";
    p.stdout.on("data", (d) => (o += d));
    p.stderr.on("data", (d) => (o += d));
    p.on("close", (code) => res({ code, out: o }));
  });
}

async function gitPushLedger() {
  // HARD LAW (learned T-526): this loop must NEVER destroy uncommitted work.
  // reset --hard on push-conflict would wipe any dirty path outside the
  // ledger — so if the worktree is dirty beyond the ledger, REFUSE to push
  // (ledger stays on disk; next cycle retries). Sovereign processes protect
  // the tree; they do not bulldoze it.
  const dirty = await sh("git status --short");
  const dirtyOutsideLedger = dirty.out
    .split("\n")
    .map((l) => l.trim().replace(/^\S+\s+/, ""))
    .filter((p) => p && p !== "mini-services/saos-engine/scout-state/LEDGER.json");
  if (dirtyOutsideLedger.length) return { pushed: false, why: "worktree-dirty-refusing-reset", paths: dirtyOutsideLedger.slice(0, 4) };
  const br = (await sh("git branch --show-current")).out.trim();
  const msg = `scout-ledger: discovery memory update (${new Date().toISOString().slice(0, 16)}Z) [auto]`;
  const addCommit = () => sh("git add -f mini-services/saos-engine/scout-state/LEDGER.json").then(() => sh(`git commit -m "${msg}"`));
  let c = await addCommit();
  if (c.code !== 0) return { pushed: false, why: "nothing-to-commit" };
  await sh("git fetch origin");
  let p = await sh(`git push origin ${br}`);
  if (p.code === 0) return { pushed: true };
  // Peer advanced the branch (first-claim-wins): take origin state, re-commit
  // our ledger on top. NOTE: reset --hard deletes the tracked file if origin
  // lacks it → snapshot bytes BEFORE reset, restore AFTER.
  const snap = fs.readFileSync(LEDGER);
  await sh(`git reset --hard origin/${br}`);
  fs.writeFileSync(LEDGER, snap);
  c = await addCommit();
  if (c.code !== 0) return { pushed: false, why: "recommit-failed" };
  p = await sh(`git push origin ${br}`);
  return { pushed: p.code === 0, why: p.code === 0 ? "rebased-over-peer" : "push-failed-2" };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let qi = 0;
console.log(JSON.stringify({ t: new Date().toISOString(), started: true, cycleMin: CYCLE_MS / 60000, limit: LIMIT, queries: QUERIES.length }));

for (;;) {
  const t0 = Date.now();
  const query = QUERIES[qi % QUERIES.length];
  qi++;
  const ledger = loadLedger();
  let result = { ok: false };
  try {
    const child = spawn("bun", ["scout.mjs", query, "--limit", String(LIMIT)], { cwd: DIR, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 10 * 60_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    result = await new Promise((res) => child.on("close", (code) => { clearTimeout(timer); try { res(JSON.parse(out.trim().split("\n").pop())); } catch { res({ ok: false, code, err: (err || out).slice(-200) }); } }));
  } catch (e) { result = { ok: false, err: String(e).slice(0, 200) }; }

  let merged = null, push = { pushed: false, why: "cycle-failed" };
  if (result.ok) {
    const rep = newestReport();
    if (rep) {
      merged = merge(ledger, rep);
      fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
      push = merged ? await gitPushLedger() : { pushed: false, why: "no-new-knowledge" };
    }
  }
  fs.writeFileSync(LASTRUN, JSON.stringify({ protocol: "saos.scout.watch.v1", at: new Date().toISOString(), query, cycle: ledger.cycles, scoutOk: !!result.ok, candidates: result.candidates ?? null, verdicts: result.verdicts ?? null, ledgerRepos: Object.keys(ledger.repos).length, git: push }, null, 2));
  console.log(JSON.stringify({ t: new Date().toISOString(), cycle: ledger.cycles, query, ms: Date.now() - t0, scoutOk: !!result.ok, verdicts: result.verdicts ?? null, ledgerRepos: Object.keys(ledger.repos).length, git: push.pushed ? "pushed" : push.why }));
  await sleep(CYCLE_MS);
}
