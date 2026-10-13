/**
 * hands.mjs — T-33 · THE HANDS RAIL (computer-use loop, CUA-inspired).
 * Operator order: "בוא נבין מה יש לנו בידיים וננסה לתת לאוטונומיה הריבונית
 * עוד יכולות ועוד כוח" — with trycua/cua named as the example.
 *
 * What CUA is (read live from the repo, not from memory): Driver — tools to
 * inspect and operate real interfaces; Spaces — a desktop an agent can use;
 * CUA-S1 — decision models for what the screen shows; Bench — the law of
 * their quickstart: "compute 6×7 in Calculator and VERIFY the app displays
 * 42". The essence is the loop: ACT → PERCEIVE → JUDGE → VERIFY.
 *
 * SAOS already had hands over APIs and chain-RPC. What it never had is eyes
 * and hands over RENDERED interfaces. This rail adds exactly that loop,
 * using the sandbox's real tooling (agent-browser = the Driver, the z-ai
 * vision CLI = the decision model, the pure verdict parser = the Bench law):
 *
 *   ACT      agent-browser (headless Chromium, named session `saos-hands`)
 *   PERCEIVE DOM text + screenshots on disk (state/hands/*.png)
 *   JUDGE    the z-ai vision CLI (glm-5v-turbo, backend-only), parsed
 *            STRICTLY in pure code — a judge that cannot be parsed is
 *            "unreadable", never "ok" (fail-closed, the sensor-lies law;
 *            chat.completions image_url is 400-rejected on this deploy —
 *            measured live — so the dedicated vision rail is the judge)
 *   JOURNAL  state/hands.json + append-only events.jsonl
 *
 * LAWS (a sovereign gets hands only with a leash in code):
 *   · ALLOWLIST  — navigation is permitted ONLY to hosts in HANDS_ALLOWLIST
 *                  (the machine's own cockpit + the steem frontends). The
 *                  open web is not one command away; a blocked host is
 *                  journaled with a typed event, never navigated silently.
 *   · READ-ONLY  — no form submission, no credentials, no logins, no
 *                  downloads; the signing keys never touch this rail.
 *   · SENSE-CLASS— hands never broadcast and never spend: the tipping
 *                  posture KEEPS them in MINIMUM (survival needs eyes —
 *                  wired into lib.minimumViablePosture keeps[]).
 *   · CADENCE    — bounded like every sensor (6h self-inspect, 24h
 *                  presence), force-able for proofs.
 *
 * TASKS:
 *   self-inspect — the machine opens its OWN cockpit (desktop+mobile
 *                  viewports), screenshots both, checks the DOM anchor and
 *                  asks the VLM for an independent visual verdict. This
 *                  automates what was until T-32 a manual operator ritual.
 *   presence     — the machine opens its own daily transparency post on
 *                  steemit.com (today's deterministic permlink, falling
 *                  back to yesterday's) and verifies the PUBLIC page
 *                  actually renders — chain-truth through the GUI layer,
 *                  the same artifact the API layer already claims.
 *   cockpit-tour — T-52 · THE ACT RUNG. The machine CLICKS through its own
 *                  cockpit's section nav (the five tabs measured live from
 *                  SectionNav.tsx) at the mobile viewport — the only viewport
 *                  where sections are filtered by state (lg+ renders all) —
 *                  and judges each section with TWO independent signals:
 *                  aria-selected (the tab state machine, free DOM truth) +
 *                  the VLM on the section screenshot (what is DISPLAYED).
 *                  A static self-inspect cannot see a broken hidden tab;
 *                  the operator only finds out when they click. Now the
 *                  machine clicks first.
 *
 * THE ACT LEASH (T-52): intent laws in code — actStepLaw admits ONLY
 * click-class steps {nav, click, wait, read}; type/fill/press/upload/download/
 * eval/keyboard are NOT step kinds (fail-closed). Form-filling waits for its
 * own credential law. Every nav re-walks the allowlist; a stuck section is
 * typed and the tour continues (one dead tab must not blind the rest).
 */
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const FILE = path.join(STATE, "hands.json");
const SHOTS = path.join(STATE, "hands");
const EVENTS_FILE = path.join(STATE, "events.jsonl");
const BRIDGE = process.env.SAOS_AI_BRIDGE || "http://127.0.0.1:3000"; // kept for future rails; the vision judge runs the z-ai CLI directly
const COCKPIT_URL = process.env.SAOS_COCKPIT_URL || "http://127.0.0.1:3000";
const ACCOUNT = process.env.SAOS_ACCOUNT || "headcorner";
const SESSION = "saos-hands";
const AB_TIMEOUT_MS = 45_000;

const HANDS_CADENCE_MS = {
  "self-inspect": 6 * 3600_000,
  "presence": 24 * 3600_000,
  "cockpit-tour": 12 * 3600_000,
};

/* the leash, in code: the ONLY hosts the hands may ever navigate */
export const HANDS_ALLOWLIST = ["127.0.0.1", "localhost", "steemit.com"];

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };
const dayOf = (iso) => String(iso ?? new Date().toISOString()).slice(0, 10).replace(/-/g, "");
const stamp = (iso) => String(iso).replace(/[^0-9]/g, "").slice(0, 14);

/* ─── PURE LAWS (selftest-vectorable) ─────────────────────────────────── */

/** host normalization: scheme/case/port/path/whitespace never fool the leash */
export function normalizeHost(raw) {
  let s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `http://${s}`;
  try { return new URL(s).hostname; } catch { return null; }
}

/** the leash verdict: exact host match after normalization; subdomains,
 * lookalikes, ports and paths cannot smuggle a host past it */
export function allowlistAllows(raw, list = HANDS_ALLOWLIST) {
  const h = normalizeHost(raw);
  if (!h) return false;
  const hosts = (Array.isArray(list) ? list : []).map((x) => normalizeHost(x)).filter(Boolean);
  const bare = h.replace(/^www\./, "");
  return hosts.includes(h) || (bare !== h && hosts.includes(bare));
}

/** strict verdict parser: only real booleans pass; fences, prose, missing
 * fields, "true"-as-string → null (the caller records "unreadable") */
export function parseVisionVerdict(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const t = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let v;
  try { v = JSON.parse(t); } catch { return null; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const b = (x) => (typeof x === "boolean" ? x : null);
  const rendered = b(v.rendered);
  if (rendered === null) return null;
  return {
    rendered,
    blank: b(v.blank),
    errorVisible: b(v.errorVisible),
    summary: String(v.summary ?? "").slice(0, 300) || null,
  };
}

/** cadence math: unknown/garbage history means DUE (a sensor may never
 * skip forever because its own history file rotted) */
export function cadenceDue(lastAt, cadenceMs, nowIso) {
  if (!(cadenceMs > 0)) return true;
  const now = Date.parse(nowIso ?? new Date().toISOString());
  if (!Number.isFinite(now)) return true;
  if (!lastAt) return true;
  const prev = Date.parse(lastAt);
  if (!Number.isFinite(prev)) return true;
  return now - prev >= cadenceMs;
}

/* ─── T-52 · THE ACT RUNG: intent laws (pure) ───────────────────────── */

/** the ONLY lawful step kinds. Everything else a browser can do — type,
 * fill, press, upload, download, eval, keyboard — is NOT a kind: an intent
 * that asks for power outside this table is refused, never approximated. */
export const ACT_STEP_KINDS = ["nav", "click", "wait", "read"];

/** one step, lawful or null. Bounds are the leash: a step is bounded power,
 * not a passthrough to whatever the caller typed. */
export function actStepLaw(step) {
  if (!step || typeof step !== "object" || Array.isArray(step)) return null;
  const kind = String(step.kind ?? "");
  if (!ACT_STEP_KINDS.includes(kind)) return null;
  if (kind === "nav") {
    const url = String(step.url ?? "").trim();
    if (!url || url.length > 200 || !allowlistAllows(url)) return null;
    return { kind, url };
  }
  if (kind === "wait") {
    const ms = Number(step.ms);
    if (!Number.isFinite(ms) || ms < 50 || ms > 15_000 || Math.floor(ms) !== ms) return null;
    return { kind, ms };
  }
  /* click | read: a bounded CSS selector — length-capped, one line, no
   * angle brackets, and it must LOOK like a selector (#id, .class, [attr], body) */
  const sel = String(step.sel ?? "").trim();
  if (!sel || sel.length > 120 || /[<>\n\r]/.test(sel)) return null;
  if (sel !== "body" && !/^[#.\[]/.test(sel)) return null;
  return { kind, sel };
}

/** an intent: a name + 1..16 lawful steps. One unlawful step voids the whole
 * intent (fail-closed — a half-lawful plan is still unlawful). */
export function actIntentLaw(intent) {
  if (!intent || typeof intent !== "object" || Array.isArray(intent)) return null;
  const name = String(intent.name ?? "").trim();
  if (name.length < 3 || name.length > 40) return null;
  if (!Array.isArray(intent.steps) || intent.steps.length < 1 || intent.steps.length > 16) return null;
  const steps = [];
  for (const s of intent.steps) {
    const lawful = actStepLaw(s);
    if (!lawful) return null;
    steps.push(lawful);
  }
  return { name, steps };
}

/** the cockpit's section ids — MEASURED live from SectionNav.tsx (T-21d's
 * segmented nav; aria-selected flips on click, probed live T-52) */
export const COCKPIT_SECTIONS = [
  { id: "command", label: "פיקוד" },
  { id: "market", label: "שוק" },
  { id: "army", label: "צבא" },
  { id: "economy", label: "כלכלה" },
  { id: "system", label: "מערכת" },
];

/** which tasks run this round (force ⇒ everything, proofs included) */
export function buildTasks(last, nowIso, force = false) {
  const tasks = [];
  if (force || cadenceDue(last?.tasks?.["self-inspect"]?.at, HANDS_CADENCE_MS["self-inspect"], nowIso)) tasks.push("self-inspect");
  if (force || cadenceDue(last?.tasks?.["presence"]?.at, HANDS_CADENCE_MS["presence"], nowIso)) tasks.push("presence");
  if (force || cadenceDue(last?.tasks?.["cockpit-tour"]?.at, HANDS_CADENCE_MS["cockpit-tour"], nowIso)) tasks.push("cockpit-tour");
  return tasks;
}

/* ─── THE LOOP ────────────────────────────────────────────────────────── */

async function ab(args) {
  const res = await run("agent-browser", ["--session", SESSION, ...args], { timeout: AB_TIMEOUT_MS });
  return String(res.stdout ?? "").slice(0, 8000);
}

/** the leash lives at the only door: open() */
async function abOpen(url) {
  if (!allowlistAllows(url)) {
    appendLine(EVENTS_FILE, { type: "hands.allowlist-blocked", at: new Date().toISOString(), host: normalizeHost(url), url: String(url).slice(0, 200) });
    throw new Error(`allowlist-blocked: ${normalizeHost(url)}`);
  }
  return ab(["open", url]);
}

/** the decision model: z-ai vision CLI (glm-5v-turbo, backend-only),
 * verdict parsed strictly by parseVisionVerdict — fail-closed */
async function visionJudge(pngPath, prompt) {
  const out = path.join(SHOTS, `vision-${process.pid}-${Date.now()}.json`);
  try {
    await run("z-ai", ["vision", "-p", prompt, "-i", pngPath, "-o", out], { timeout: 120_000 });
    const doc = JSON.parse(fs.readFileSync(out, "utf8"));
    const content = doc?.choices?.[0]?.message?.content;
    return parseVisionVerdict(typeof content === "string" ? content : "");
  } finally {
    try { fs.rmSync(out, { force: true }); } catch { /* tmp cleanup best-effort */ }
  }
}

const VISION_PROMPT = [
  "You are the independent visual judge of a web dashboard (the Bench law: verify what is DISPLAYED, not what the code claims).",
  'Answer STRICT JSON only, no markdown: {"rendered":boolean,"blank":boolean,"errorVisible":boolean,"summary":"<=40 words"}',
  "rendered=true ONLY if a real application UI is visible — not a blank page, not a browser error page, not a server error.",
  "errorVisible=true ONLY for real failures: framework error overlays (Next.js/React error boundary), stack traces, 'Application error' screens, or browser/HTTP error pages.",
  "NOT errors (must stay false): amber/yellow INFORMATIONAL notes about system state; the words 'rails', 'dormant', 'blocked', 'paused', 'pending', 'no reward ops' inside normal dashboard cards; empty-value placeholders.",
  "The expected app is a dark operations dashboard titled 'SAOS SOVEREIGN COCKPIT' with Hebrew and English cards.",
].join("\n");

const VIEWPORTS = [
  { name: "desktop", w: 1280, h: 900 },
  { name: "mobile", w: 375, h: 812 },
];
const COCKPIT_ANCHOR = "SAOS"; // the header's fixed token — visible in EVERY viewport ("SOVEREIGN" hides on mobile: measured live)

/* self-inspect: the machine looks at its own face, both viewports */
async function taskSelfInspect(now) {
  const shots = [];
  for (const vp of VIEWPORTS) {
    const png = path.join(SHOTS, `${stamp(now)}-${vp.name}.png`);
    await abOpen(COCKPIT_URL);
    await ab(["set", "viewport", String(vp.w), String(vp.h)]);
    await ab(["wait", "2500"]); // the cockpit fetches /api/saos/status on hydration
    await ab(["screenshot", png]);
    let domAnchor = false;
    try { domAnchor = (await ab(["get", "text", "body"])).includes(COCKPIT_ANCHOR); } catch { /* text extraction may fail on odd DOM — the VLM still judges */ }
    let vision = null;
    try { vision = await visionJudge(png, VISION_PROMPT); } catch { /* bridge down → unreadable, honest */ }
    shots.push({ name: vp.name, viewport: `${vp.w}x${vp.h}`, file: path.basename(png), domAnchor, vision });
  }
  const ok = shots.length === VIEWPORTS.length && shots.every((s) => s.domAnchor && s.domAnchor === true);
  const visionCount = shots.filter((s) => s.vision).length;
  return {
    task: "self-inspect", ok, at: now, visionCount,
    verdict: ok ? "COCKPIT-RENDERED" : "COCKPIT-UNVERIFIED",
    shots,
    law: "DOM-anchor + VLM judge, fail-closed; screenshots on disk as evidence",
  };
}

/* presence: the public artifact seen through the public's eyes.
 * Measured live 2026-10-03: steemit.com AND ecency.com sit behind Cloudflare
 * bot-walls for headless browsers (steemdb.com does not resolve). The wall
 * is a TYPED verdict — the sensor seeing the wall is itself honest intel;
 * it is never reported as "visible" and never as a crash. */
const BOT_WALL_TOKENS = ["just a moment", "security verification", "attention required", "cloudflare"];

async function taskPresence(now) {
  const days = [dayOf(now), dayOf(new Date(Date.parse(now) - 86400_000).toISOString())];
  const checked = [];
  for (const day of days) {
    const permlink = `saos-transparency-${day}`;
    const url = `https://steemit.com/@${ACCOUNT}/${permlink}`;
    try {
      await abOpen(url);
      await ab(["wait", "8000"]); // steemit renders client-side; the wall sometimes clears
      const text = await ab(["get", "text", "body"]);
      let title = "";
      try { title = await ab(["get", "title"]); } catch { /* title optional */ }
      const blob = `${title}\n${text}`;
      const low = blob.toLowerCase();
      const wall = BOT_WALL_TOKENS.some((w) => low.includes(w)) && !low.includes("saos-catalog");
      const visible = !wall && (low.includes("saos-catalog") || low.includes("transparency"));
      checked.push({ day, permlink, visible, botWall: wall, bytes: text.length });
      if (visible) break;
    } catch (e) {
      checked.push({ day, permlink, visible: false, botWall: false, error: String(e?.message ?? e).slice(0, 140) });
    }
  }
  const first = checked.find((c) => c.visible);
  const wallSeen = checked.some((c) => c.botWall === true);
  const verdict = first
    ? (first.day === days[0] ? "TODAY-VISIBLE" : "YESTERDAY-VISIBLE")
    : wallSeen ? "BOT-WALLED" : "NOT-VISIBLE";
  /* ok = the MEASUREMENT completed with a typed verdict (the sensor did its
   * job); the verdict string carries the truth about what was seen */
  return { task: "presence", ok: true, at: now, verdict, checked, law: "הפוסט הציבורי נבדק כפי שהציבור רואה אותו — דפדפן, לא API; חומת-בוטים פסק-דין-מוקלד, לא קריסה" };
}

/* ─── T-52 · THE ACT LOOP: lawful steps, then the judge ─────────────── */

/** execute ONE lawful step. The law runs FIRST (fail-closed); the browser
 * only ever sees steps actStepLaw admitted. Throws typed on refusal. */
async function actStep(step) {
  const lawful = actStepLaw(step);
  if (!lawful) throw new Error("act-step-unlawful");
  if (lawful.kind === "nav") {
    await abOpen(lawful.url); // the leash lives here too — two layers, one law
    return lawful;
  }
  if (lawful.kind === "click") {
    await ab(["click", lawful.sel]);
    return lawful;
  }
  if (lawful.kind === "wait") {
    await ab(["wait", String(lawful.ms)]);
    return lawful;
  }
  const text = await ab(["get", "text", lawful.sel]);
  return { ...lawful, bytes: text.length };
}

/** the active-tab signal: aria-selected on the section pill — the free DOM
 * truth that the click actually moved the tab state machine. Empty/missing
 * → null (fail-closed; a tab that answers nothing did not answer). */
async function tabSelected(id) {
  try {
    const out = (await ab(["get", "attr", `[data-section="${id}"]`, "aria-selected"])).trim();
    return out === "true" ? true : out === "false" ? false : null;
  } catch {
    return null;
  }
}

const TOUR_VISION_PROMPT = (label) => [
  "You are the independent visual judge of ONE section of a web dashboard (the Bench law: verify what is DISPLAYED, not what the code claims).",
  'Answer STRICT JSON only, no markdown: {"rendered":boolean,"blank":boolean,"errorVisible":boolean,"summary":"<=40 words"}',
  `The expected section is "${label}" of a dark operations dashboard titled 'SAOS SOVEREIGN COCKPIT' (Hebrew and English cards).`,
  "rendered=true ONLY if this section's content cards visibly occupy the viewport — a page showing only the top nav, a blank page, a browser error page, or a server error is rendered=false.",
  "errorVisible=true ONLY for real failures: framework error overlays (Next.js/React error boundary), stack traces, 'Application error' screens, or browser/HTTP error pages.",
  "NOT errors (must stay false): amber/yellow INFORMATIONAL notes about system state; the words 'rails', 'dormant', 'blocked', 'paused', 'pending', 'no reward ops' inside normal dashboard cards; empty-value placeholders.",
].join("\n");

/** cockpit-tour: the ACT rung's first consumer. Mobile viewport (375x812) is
 * the DISCRIMINATING viewport — at lg+ every section renders regardless, so
 * only here does the tab state machine actually hide/show content. Each
 * section is judged by TWO independent signals: aria-selected (the click
 * worked) AND the VLM on the screenshot (the section DISPLAYS). One stuck
 * section is typed and the tour continues. */
async function taskCockpitTour(now) {
  await abOpen(COCKPIT_URL);
  await ab(["set", "viewport", "375", "812"]);
  await ab(["wait", "2500"]); // the cockpit fetches /api/saos/status on hydration
  const sections = [];
  for (const { id, label } of COCKPIT_SECTIONS) {
    const png = path.join(SHOTS, `${stamp(now)}-tour-${id}.png`);
    const entry = { id, label, clicked: false, ariaSelected: null, shot: null, vision: null, error: null };
    try {
      await actStep({ kind: "click", sel: `[data-section="${id}"]` });
      entry.clicked = true;
      await actStep({ kind: "wait", ms: 700 });
      entry.ariaSelected = await tabSelected(id);
      await ab(["screenshot", png]);
      entry.shot = path.basename(png);
      try { entry.vision = await visionJudge(png, TOUR_VISION_PROMPT(label)); } catch { /* judge down → null, fail-closed */ }
    } catch (e) {
      entry.error = String(e?.message ?? e).slice(0, 140);
    }
    sections.push(entry);
  }
  const ok = sections.length === COCKPIT_SECTIONS.length && sections.every(
    (s) => s.clicked && s.ariaSelected === true && s.vision && s.vision.rendered === true && s.vision.blank === false && s.vision.errorVisible === false,
  );
  const judged = sections.filter((s) => s.vision).length;
  return {
    task: "cockpit-tour", ok, at: now, visionCount: judged,
    verdict: ok ? "COCKPIT-TOUR-RENDERED" : "COCKPIT-TOUR-DEGRADED",
    sections,
    law: "ACT=click-class only (actStepLaw; no type/fill/upload/eval) · aria-selected + VLM judge, fail-closed · one stuck section never blinds the rest",
  };
}

/* ─── THE RUNNER ──────────────────────────────────────────────────────── */

const TASK_RUNNERS = {
  "self-inspect": taskSelfInspect,
  "presence": taskPresence,
  "cockpit-tour": taskCockpitTour,
};

export async function runHands({ now = new Date().toISOString(), force = false, only = null } = {}) {
  const last = readJson(FILE, null) ?? {};
  let due = buildTasks(last, now, force);
  if (Array.isArray(only)) due = due.filter((t) => only.includes(t)); // cheap proofs: one task, not the whole rail
  if (!due.length) return { verdict: "NO-DUE", at: now, cadenceMs: HANDS_CADENCE_MS };
  fs.mkdirSync(SHOTS, { recursive: true });
  const tasks = [];
  for (const name of due) {
    try {
      const res = await TASK_RUNNERS[name](now);
      tasks.push(res);
      appendLine(EVENTS_FILE, { type: res.ok ? "hands.task-ok" : "hands.task-fail", at: now, task: name, verdict: res.verdict ?? null });
    } catch (e) {
      const err = String(e?.message ?? e).slice(0, 200);
      tasks.push({ task: name, ok: false, at: now, verdict: "HANDS-ERROR", error: err });
      appendLine(EVENTS_FILE, { type: "hands.task-fail", at: now, task: name, error: err });
    }
  }
  /* no idle Chromium held between runs — the rail opens, sees, closes */
  try { await ab(["close"]); } catch { /* close is best-effort */ }
  /* evidence cap: keep the newest 20 PNGs (self-inspect ×2 + tour ×5 per
   * run — the cap must hold a full cycle of evidence, not thrash it) */
  try {
    const shots = fs.readdirSync(SHOTS).filter((f) => f.endsWith(".png")).sort();
    for (const old of shots.slice(0, Math.max(0, shots.length - 20))) fs.rmSync(path.join(SHOTS, old), { force: true });
  } catch { /* pruning best-effort */ }
  const ok = tasks.every((t) => t.ok !== false);
  const merged = { ...last, tasks: { ...(last.tasks ?? {}) } };
  for (const t of tasks) merged.tasks[t.task] = { at: now, ok: t.ok === true };
  merged.lastRun = now;
  merged.verdict = ok ? "HANDS-OK" : "HANDS-DEGRADED";
  /* the last run's detail for the cockpit (trimmed — paths basename-only,
   * vision verdicts as-parsed; the full PNGs stay on disk as evidence) */
  merged.lastTasks = tasks.map((t) => ({
    task: t.task, ok: t.ok === true, verdict: t.verdict ?? null, at: now,
    visionCount: t.visionCount ?? null,
    shots: (t.shots ?? []).map((s) => ({ name: s.name, file: s.file, domAnchor: s.domAnchor === true, vision: s.vision ?? null })),
    checked: (t.checked ?? []).map((c) => ({ day: c.day, permlink: c.permlink, visible: c.visible === true, botWall: c.botWall === true })),
    sections: (t.sections ?? []).map((s) => ({ id: s.id, clicked: s.clicked === true, ariaSelected: s.ariaSelected, vision: s.vision ?? null, error: s.error ?? null })),
    error: t.error ?? null,
  }));
  merged.law = "allowlist-leashed · ACT=click-class under intent laws (no type/fill/upload/eval) · sense-class (keeps in MINIMUM) · VLM judge fail-closed";
  writeJson(FILE, merged);
  return { verdict: merged.verdict, at: now, tasks };
}

export function handsState() { return readJson(FILE, null); }
