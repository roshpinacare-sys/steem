/**
 * forge.mjs — T-40 · THE FORGE RAIL — the machine engineers ITSELF, leashed.
 *
 * mini-swe-agent laws ported to bun (examined live T-39; repo MIT-verified —
 * the LAWS are adopted, the python library is not needed):
 *   1. bash-only tool      — the model's only action is a shell command
 *   2. linear history      — messages append-only; trajectory == messages
 *   3. stateless actions   — every action is a fresh `bash -c`, killed on timeout
 *   4. limits BEFORE query — step/time/format-error/guard-loop caps, fail-closed
 *   5. exit-role convention— the loop ends when the last message role == "exit"
 *   6. save-after-every-step — the trajectory persists in a finally-equivalent
 *
 * THE LEASH (beyond mini — sovereignty WITH a seatbelt):
 *   - bashGuard (lib) classifies every command; unclassified/destructive = blocked
 *   - git history + dependency verbs are harness-only; the model never commits
 *   - candidate-eval-then-commit: selftest + lint gates decide keep-or-revert
 *   - new files only in the forge desk (skills/forge/**, docs/**); tracked-file
 *     edits anywhere are revertible (git restore) — widening earns its place
 *
 * Bridge: /api/saos/ai/forge (z-ai, backend-only law) — the bridge drafts a
 * step, the ENGINE decides (guard, gates, git). A blocked command is an
 * observation, not a crash — the model learns the leash mid-loop.
 * State: state/forge.json (verdicts) · state/forge-traj.json (trajectory) ·
 *        state/forge-tasks.json (operator-seeded queue, bounded).
 *
 * T-2c · SELF-FEED: an empty queue no longer starves — ONE task per cycle is
 * seeded from the highest-severity OPEN learning lesson (the pure seeder law
 * below; task text = the lesson's own words only, ≤300 chars, numbers must
 * trace into the lesson that produced them). The seed persists through the
 * SAME bounded write path the operator queue uses and then runs like any
 * queued task — the machine's self-engineering desk is fed by its own
 * learning rail.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { bashGuard, forgeQueryBlocked, forgeAppend, forgeIsExit, scopedTouched, forgeGateDecision, forgeSkillPromptNote, buildForgeSkillIndex, forgeRepeatCount, forgeRepeatDecision, FORGE_REPEAT_NUDGE, FORGE_LAWS_NOTE } from "./lib.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(DIR, "..", "..");
const STATE = path.join(DIR, "state");
const FILE = path.join(STATE, "forge.json");
const TRAJ_FILE = path.join(STATE, "forge-traj.json");
const TASKS_FILE = path.join(STATE, "forge-tasks.json");
const LEARN_FILE = path.join(STATE, "learning.json"); /* T-2c: the lesson source the seeder feeds from */

const BRIDGE = process.env.SAOS_AI_BRIDGE || "http://127.0.0.1:3000";
const BRIDGE_TOKEN = (() => { try { return fs.readFileSync(path.join(DIR, "..", "..", ".secrets", "bridge.token"), "utf8").trim(); } catch { return ""; } })();

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };
const sh = (cmd, { cwd = REPO, timeoutMs = 30_000 } = {}) => {
  try {
    const p = Bun.spawnSync(["bash", "-c", cmd], { cwd, stdout: "pipe", stderr: "pipe", timeout: timeoutMs });
    const out = `${p.stdout?.toString() ?? ""}${p.stderr?.toString() ?? ""}`;
    return { code: p.exitCode ?? -1, out: out.length > 16_000 ? out.slice(-16_000) : out, timedOut: p.signalCode === "SIGTERM" || p.signalCode === "SIGKILL" };
  } catch (e) { return { code: -1, out: String(e?.message ?? e).slice(0, 200), timedOut: false }; }
};

/* ── loop constants (mini law #4: explicit, checked BEFORE each query) ── */
const STEP_LIMIT = 8;                    /* one task ≈ read + write + verify */
const WALL_TIME_SEC = 300;
const MAX_CONSEC_FORMAT_ERRORS = 3;
const MAX_CONSEC_GUARD_BLOCKS = 3;
const ACTION_TIMEOUT_MS = 30_000;
const MAX_TRAJ_SENT = 24;                /* bridge send window (bounded cost) */

export const FORGE_LAW = "הפטיש אינו מחליט מה נבנה — הוא מכה במסמר שהחוק אישר: כלי-יחיד bash · היסטוריה-לינארית · פעולות-חסרות-מצב · גבולות-לפני-שאילתא · יציאה-בתפקיד-exit · שמירה-אחרי-כל-צעד · guard על כל פקודה · שערי-הערכה לפני commit · קבצים-חדשים רק בשולחן-הנפחות";

function forgeState() { return readJson(FILE, null); }
export { forgeState };

/* ── T-2c · THE SELF-FEED SEEDER (pure, fail-closed) ──
 * The forge rail starves when its queue is operator-seeded only, while the
 * learning rail produces severity-ranked lessons every cycle. Law: when the
 * queue is PROVEN empty and lessons exist, derive exactly ONE bounded task
 * from the highest-severity open lesson (high>medium>low; tie → first).
 * The task text carries ONLY the lesson's own words (verbatim slices,
 * ≤300 chars) — no invented numbers: the template is digit-free and every
 * digit-run in the composed text must trace back into the lesson's own
 * fields, so the composition cannot smuggle a number in. Typed refusals:
 * "no-lessons" / "queue-not-empty" / "no-eligible-lesson". */
const SEED_TASK_CAP = 300;      /* a task line, not an essay */
const SEED_MIN_FRAGMENT = 24;   /* a truncated tail shorter than this is noise, not context */
const SEVERITY_RANK = { high: 3, medium: 2, low: 1 }; /* the three ranks the learner emits */

/** pure: the ≤300-char task text — the lesson's own words, whitespace
 * collapsed to one line, greedy fill (LESSON → ACTION → EVIDENCE). */
function composeSeedTaskText({ id, severity, lesson, action, evidence }) {
  const parts = [`LESSON: ${lesson ?? ""}`, `ACTION: ${action ?? ""}`, `EVIDENCE: ${evidence ?? ""}`]
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  let text = `SELF-ENGINEERING TASK (seeded from learning lesson "${id}" · severity ${severity})`;
  for (const p of parts) {
    if (text.length + 3 + p.length <= SEED_TASK_CAP) { text = `${text} | ${p}`; continue; }
    const room = SEED_TASK_CAP - text.length - 4; /* " | " separator + ellipsis */
    if (room >= SEED_MIN_FRAGMENT) text = `${text} | ${p.slice(0, room)}…`;
    break;
  }
  return text.slice(0, SEED_TASK_CAP); /* hard cap even for a pathological id */
}

export function forgeSeedTaskFromLesson({ lessons, existingTasks, now } = {}) {
  /* fail-closed on the queue: only a PROVEN-empty array may be fed */
  if (!Array.isArray(existingTasks) || existingTasks.length > 0) return { seeded: false, reason: "queue-not-empty" };
  if (!Array.isArray(lessons) || lessons.length === 0) return { seeded: false, reason: "no-lessons" };
  /* highest-severity open lesson; tie → first (stable scan, strict >) */
  let best = null;
  for (const l of lessons) {
    if (!l || typeof l !== "object") continue;
    if (l.resolved === true || l.closed === true || l.open === false) continue; /* not open */
    const id = typeof l.id === "string" ? l.id.trim() : "";
    const severity = typeof l.severity === "string" ? l.severity.trim().toLowerCase() : "";
    if (!id || !SEVERITY_RANK[severity]) continue;
    const hasWords = ["lesson", "action", "evidence"].some((k) => typeof l[k] === "string" && l[k].trim());
    if (!hasWords) continue;
    if (!best || SEVERITY_RANK[severity] > SEVERITY_RANK[best.severity]) {
      best = { id, severity, lesson: l.lesson, action: l.action, evidence: l.evidence };
    }
  }
  if (!best) return { seeded: false, reason: "no-eligible-lesson" };
  const task = composeSeedTaskText(best);
  /* NUMBER-TRUTH leash: the template words are digit-free and every slice is
   * verbatim, so a violation is structurally impossible — this check is what
   * KEEPS it impossible (a future template edit cannot smuggle a number in). */
  const sourceBlob = `${best.id}${best.severity}${best.lesson ?? ""}${best.action ?? ""}${best.evidence ?? ""}`;
  const runs = task.match(/\d+/g) ?? [];
  if (runs.some((r) => !sourceBlob.includes(r))) return { seeded: false, reason: "no-eligible-lesson" };
  return {
    seeded: true,
    task: {
      id: `seed-${best.id}`,
      task,
      seededFromLesson: best.id,
      severity: best.severity,
      seededAt: typeof now === "string" && now.trim() ? now : null, /* honest null when the caller has no clock */
    },
  };
}

/* ── the bridge step: one LLM call per loop step (stateless bridge, linear
 * history engine-side). Contract: STRICT JSON — step {thought,command} or
 * done {finish:true,summary}. The bridge NEVER executes anything. ── */
async function queryForgeBridge({ task, head, history, bridgeError = null }) {
  try {
    const sent = history.length > MAX_TRAJ_SENT
      ? [`[history truncated: showing last ${MAX_TRAJ_SENT} of ${history.length} messages — the engine-side trajectory stays complete]`, ...history.slice(-MAX_TRAJ_SENT)]
      : history;
    const r = await fetch(`${BRIDGE}/api/saos/ai/forge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-saos-bridge": BRIDGE_TOKEN },
      body: JSON.stringify({ task, head, history: sent, laws: FORGE_LAWS_NOTE }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!r.ok) return { step: null, error: `bridge ${r.status}` };
    const j = await r.json();
    if (!j?.ok) return { step: null, error: String(j?.error ?? "bridge refused").slice(0, 160) };
    return { step: j.step ?? null, error: null };
  } catch (e) { return { step: null, error: String(e?.message ?? e).slice(0, 160) }; }
}

const obs = (content, extra = {}) => ({ role: "observation", content: String(content).slice(0, 4_000), extra });
const exitMsg = (status, submission) => ({ role: "exit", content: String(submission ?? status).slice(0, 2_000), extra: { exit_status: status, submission: String(submission ?? "").slice(0, 2_000) } });

/* ── progressive skill index (T-41 law): the prompt carries ONLY names +
 * descriptions; the full card loads on demand via the bash tool itself —
 * `cat` IS loadSkill in a bash-only loop. A malformed card is silently
 * absent from the index (typed in the builder's rejected list, never fatal). ── */
function collectSkillCards() {
  const skillDir = path.join(DIR, "skills", "forge");
  const cards = [];
  try {
    for (const e of fs.readdirSync(skillDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue; /* SELF.md stays a root law card, not an index entry */
      try {
        cards.push({
          path: `mini-services/saos-engine/skills/forge/${e.name}/SKILL.md`,
          content: fs.readFileSync(path.join(skillDir, e.name, "SKILL.md"), "utf8"),
        });
      } catch { /* unreadable card = absent from index */ }
    }
  } catch { /* desk missing = no skills */ }
  return cards;
}

/* ── THE AGENT LOOP (mini law, leashed) ── */
async function forgeLoop({ task, head, t0 }) {
  const skillNote = forgeSkillPromptNote(buildForgeSkillIndex(collectSkillCards()));
  let history = forgeAppend([], [
    { role: "system", content: `You are the forge agent of a sovereign autonomous machine, engineering its own repository (${REPO}). Task discipline: read before you write; small diffs; verify your work with the repo's own tools.` },
    { role: "user", content: `TASK: ${task}\nREPO HEAD: ${head}\n${skillNote}\nRules: one shell command per step. New files ONLY under mini-services/saos-engine/skills/forge/ or docs/. You may edit existing tracked files. Never: network, installs, git history verbs, state/, .secrets/, node_modules/. Finish with {"finish":true,"summary":"..."}.` },
  ]);
  let nCalls = 0, nFmt = 0, nGuardBlocks = 0, steps = 0, bridgeError = null;
  const persist = () => { try { writeJson(TRAJ_FILE, { task, head, startedAt: new Date(t0).toISOString(), messages: history, nCalls, steps, trajectoryFormat: "saos-forge-1" }); } catch { /* trajectory persistence must never kill the loop */ } };
  while (true) {
    const blocked = forgeQueryBlocked({ nCalls, stepLimit: STEP_LIMIT, startMs: t0, wallTimeLimitSec: WALL_TIME_SEC, nowMs: Date.now(), nConsecutiveFormatErrors: nFmt, maxConsecutiveFormatErrors: MAX_CONSEC_FORMAT_ERRORS, nConsecutiveGuardBlocks: nGuardBlocks, maxConsecutiveGuardBlocks: MAX_CONSEC_GUARD_BLOCKS });
    if (blocked) { history = forgeAppend(history, [exitMsg(blocked.reason, blocked.why)]); persist(); break; }
    const { step, error } = await queryForgeBridge({ task, head, history });
    nCalls++;
    if (!step) {
      bridgeError = error;
      history = forgeAppend(history, [exitMsg("BRIDGE-DOWN", `bridge step failed: ${error}`)]);
      persist();
      break;
    }
    if (step.finish === true) { history = forgeAppend(history, [exitMsg("Submitted", step.summary ?? "finish without summary")]); persist(); break; }
    const command = typeof step.command === "string" ? step.command : "";
    if (!command.trim()) {
      nFmt++;
      history = forgeAppend(history, [obs("FORMAT-ERROR: output strict JSON — {\"thought\":\"...\",\"command\":\"...\"} or {\"finish\":true,\"summary\":\"...\"}")]);
      persist();
      continue;
    }
    const guard = bashGuard(command);
    if (guard.cls === "destructive" || guard.cls === "unclassified") {
      nGuardBlocks++;
      history = forgeAppend(history, [obs(`BLOCKED by the leash (${guard.why ?? guard.cls}). The command never ran. Work within: read/inspect anywhere, write via cat > path <<EOF inside the repo (new files only in skills/forge/ or docs/), git status/diff/log allowed.`)]);
      persist();
      continue;
    }
    nGuardBlocks = 0; nFmt = 0; steps++;
    const r = sh(command, { cwd: REPO, timeoutMs: ACTION_TIMEOUT_MS });
    const tail = r.out.split("\n").slice(-40).join("\n");
    history = forgeAppend(history, [
      { role: "assistant", content: JSON.stringify({ thought: step.thought ?? "", command }) },
      obs(`$ exit=${r.code}${r.timedOut ? " TIMEOUT" : ""}\n${tail || "(no output)"}`, { command: command.slice(0, 200) }),
    ]);
    persist();
    /* trailing-repeat law (T-41 live-caught): executed-command degeneration is
     * invisible to the guard — nudge once at 2 identical, stop typed at 3 */
    const rep = forgeRepeatCount(history);
    const rd = forgeRepeatDecision(rep);
    if (rd.action === "stop") {
      history = forgeAppend(history, [exitMsg("REPEAT-LOOP", `the loop re-ran one identical command ${rep}× — stopped typed, trajectory saved`)]);
      persist();
      break;
    }
    if (rd.action === "nudge") {
      history = forgeAppend(history, [obs(FORGE_REPEAT_NUDGE)]);
      persist();
    }
    if (forgeIsExit(history[history.length - 1])) break; /* defensive: exit mid-observation never happens today */
  }
  return { history, nCalls, steps, bridgeError };
}

/* ── THE HARNESS: gates → commit | revert (the model never touches git
 * history — this is the only place a commit can be born). ── */
function collectTouched() {
  const por = sh("git status --porcelain", { timeoutMs: 15_000 });
  if (por.code !== 0) return { entries: [], error: por.out.slice(0, 120) };
  const entries = por.out.split("\n").filter(Boolean).map((l) => {
    const st = l.slice(0, 2).trim();
    const p = l.slice(3).trim().replace(/^"|"$/g, "");
    return { path: p, tracked: st !== "??" };
  });
  return { entries, error: null };
}

function evalGates() {
  const st = sh("bun selftest.mjs", { cwd: DIR, timeoutMs: 150_000 });
  const m = (st.out.match(/SELFTEST (\d+)\/(\d+) (PASS|FAIL)/) ?? []);
  const selftest = { ok: st.code === 0 && m[3] === "PASS", pass: m[1] ? Number(m[1]) : null, total: m[2] ? Number(m[2]) : null };
  const ln = sh("bun run lint", { cwd: REPO, timeoutMs: 240_000 });
  const lint = { ok: ln.code === 0, tail: ln.out.split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 300) };
  return { selftest, lint };
}

function revertTouched(touched) {
  /* LIVE-CAUGHT LAW (T-40 proof #1): "candidate reverts whole" means WHOLE —
   * illegal paths are reverted too (a typed SCOPE-ILLEGAL that leaves the
   * illegal file on disk is a lie: the tree stays dirty and the next run
   * trips FORGE-DIRTY-TREE). Untracked → deleted (recursively — porcelain
   * reports untracked dirs); tracked → git restore. */
  const done = [];
  const paths = [
    ...(Array.isArray(touched?.committable) ? touched.committable : []),
    ...(Array.isArray(touched?.illegal) ? touched.illegal.map((x) => x?.path).filter(Boolean) : []),
  ];
  for (const p of paths) {
    if (!p || p.startsWith("porcelain-error")) continue;
    const isTracked = sh(`git ls-files --error-unmatch ${JSON.stringify(p)}`, { timeoutMs: 10_000 }).code === 0;
    if (isTracked) { const r = sh(`git restore -- ${JSON.stringify(p)}`, { timeoutMs: 15_000 }); done.push({ path: p, how: r.code === 0 ? "restored" : `restore-failed:${r.code}` }); continue; }
    const abs = path.join(REPO, p);
    try {
      if (fs.existsSync(abs)) { const st = fs.statSync(abs); fs.rmSync(abs, { recursive: st.isDirectory(), force: true }); done.push({ path: p, how: "deleted" }); }
    } catch (e) { done.push({ path: p, how: `delete-failed:${String(e?.message ?? e).slice(0, 60)}` }); }
  }
  return done;
}

function commitTouched(touched, task, gates) {
  const paths = touched.committable.map((p) => JSON.stringify(p)).join(" ");
  const add = sh(`git add -- ${paths}`, { timeoutMs: 20_000 });
  if (add.code !== 0) return { ok: false, why: `git add failed: ${add.out.slice(0, 120)}` };
  const msg = `forge(T-40): ${task.slice(0, 72).replace(/[\\"]/g, "")} — gates green (selftest ${gates.selftest.pass ?? "?"}/${gates.selftest.total ?? "?"}, lint clean)`;
  const cm = sh(`git commit -m ${JSON.stringify(msg)} -- ${paths}`, { timeoutMs: 30_000 });
  if (cm.code !== 0) return { ok: false, why: `git commit failed: ${cm.out.slice(0, 160)}` };
  const head = sh("git rev-parse --short HEAD", { timeoutMs: 10_000 });
  return { ok: true, hash: head.out.trim().slice(0, 12), msg };
}

/* ── THE RAIL: one task per call; the queue is operator-seeded AND (T-2c)
 * self-fed when empty — bounded; failure of the MACHINE (bridge down, dirty
 * tree) returns the task — failure of the CANDIDATE (gates red, scope
 * illegal) consumes it honestly. ── */
export async function runForge({ now = new Date().toISOString() } = {}) {
  const t0 = Date.now();
  const prev = readJson(FILE, null);
  const tasks = readJson(TASKS_FILE, { tasks: [] });
  let queue = Array.isArray(tasks.tasks) ? tasks.tasks.filter((t) => t && typeof t.task === "string") : [];
  const head = sh("git rev-parse --short HEAD", { timeoutMs: 10_000 }).out.trim().slice(0, 12) || null;

  if (queue.length === 0) {
    /* T-2c · SELF-FEED SEED: the rail wakes ITSELF — ONE task per cycle max,
     * derived from the highest-severity open learning lesson (pure law above).
     * IO is fail-open: a missing/unreadable learning.json yields no lessons →
     * the seeder refuses (typed) → NO-TASK exactly as before. The seed
     * persists through the SAME bounded write path the operator queue uses
     * (queue was empty, so the 8-bound is untouched) and the rail then runs
     * it like any queued task — one task per call, existing mechanics. */
    const learn = readJson(LEARN_FILE, null);
    const lessons = Array.isArray(learn?.lessons) ? learn.lessons : [];
    const seed = forgeSeedTaskFromLesson({ lessons, existingTasks: queue, now });
    if (seed.seeded) {
      writeJson(TASKS_FILE, { tasks: [seed.task] });
      queue = [seed.task].filter((t) => t && typeof t.task === "string");
    }
  }

  if (queue.length === 0) {
    const doc = { at: now, verdict: "NO-TASK", taskId: null, task: null, steps: 0, exitStatus: null, head, queueLen: 0, law: FORGE_LAW, ms: Date.now() - t0 };
    writeJson(FILE, doc);
    return doc;
  }

  const dirty = sh("git status --porcelain", { timeoutMs: 15_000 });
  const dirtyEntries = dirty.out.split("\n").filter(Boolean);
  if (dirtyEntries.length > 0) {
    /* a dirty tree makes the candidate diff ambiguous — the rail never forges
     * on top of unknown changes; the task is RETURNED, nothing is lost */
    const task = queue[0];
    const doc = { at: now, verdict: "FORGE-DIRTY-TREE", taskId: task.id ?? null, task: task.task.slice(0, 200), steps: 0, exitStatus: null, head, dirtyFiles: dirtyEntries.length, queueLen: queue.length, law: FORGE_LAW, ms: Date.now() - t0 };
    writeJson(FILE, doc);
    return doc;
  }

  const task = queue.shift();
  writeJson(TASKS_FILE, { tasks: queue.slice(0, 8) });

  const { history, nCalls, steps, bridgeError } = await forgeLoop({ task: task.task, head, t0 });
  const last = history[history.length - 1] ?? {};
  const exitStatus = last.extra?.exit_status ?? "NO-EXIT";

  if (exitStatus === "BRIDGE-DOWN") {
    /* machine failure — the task goes back to the head of the queue */
    writeJson(TASKS_FILE, { tasks: [task, ...queue].slice(0, 8) });
    const doc = { at: now, verdict: "FORGE-BRIDGE-DOWN", taskId: task.id ?? null, task: task.task.slice(0, 200), steps, exitStatus, head, bridgeError, queueLen: queue.length + 1, law: FORGE_LAW, ms: Date.now() - t0 };
    writeJson(FILE, doc);
    return doc;
  }

  const { entries, error: porErr } = collectTouched();
  const touched = porErr ? { committable: [], illegal: [{ path: `porcelain-error: ${porErr}`, rule: "SCOPE-REPO" }], note: porErr } : scopedTouched(entries);
  const gates = evalGates();
  const decision = forgeGateDecision({ selftestPass: gates.selftest.ok, selftestTotal: gates.selftest.total, lintOk: gates.lint.ok, touched });

  let commit = null, revert = null, verdict;
  if (decision.action === "commit") {
    const c = commitTouched(touched, task.task, gates);
    if (c.ok) { commit = { hash: c.hash, msg: c.msg }; verdict = "FORGE-COMMITTED"; }
    else { revert = revertTouched(touched); verdict = "FORGE-REVERTED"; decision.why = c.why; }
  } else if (decision.action === "revert") {
    revert = revertTouched(touched);
    verdict = "FORGE-REVERTED";
  } else {
    verdict = "FORGE-NOOP"; /* gates green, nothing touched — a lawful read-only task */
  }

  const doc = {
    at: now, verdict, taskId: task.id ?? null, task: task.task.slice(0, 200),
    steps, nCalls, exitStatus,
    summary: String(last.extra?.submission ?? last.content ?? "").slice(0, 400),
    head, touched: { committable: touched.committable, illegal: touched.illegal },
    gates: { selftest: gates.selftest, lint: gates.lint },
    decision, commit, revert, bridgeError,
    queueLen: queue.length, law: FORGE_LAW, ms: Date.now() - t0,
  };
  writeJson(FILE, doc);
  return doc;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = await runForge({ now: new Date().toISOString() });
  console.log(JSON.stringify(out, null, 2));
  process.exit(["FORGE-COMMITTED", "FORGE-NOOP", "NO-TASK"].includes(out.verdict) ? 0 : 1);
}
