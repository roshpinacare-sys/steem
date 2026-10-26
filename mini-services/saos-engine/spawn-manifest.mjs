/**
 * spawn-manifest.mjs — R331 · THE SPAWN-MANIFEST LAW + R332 · THE IDEMPOTENCY
 * LIFECYCLE (exec32, lane 32-a; law provenance exec31 dossier
 * state/research/exec31-frontier-super-agent-asi-zerotrust-2026-10-14.md,
 * Autonomy commit f8cd2ad).
 *
 * LAWS IMPLEMENTED (verbatim provenance):
 *  - R331 — spawn-manifest law (from legion_agi's one good idea, hardened):
 *    dynamic agent spawning is lawful ONLY as: goal → sovereign-decider
 *    law-validation → typed spawn manifest COMMITTED TO GIT pre-spawn
 *    (auditable before any lane exists) → orchestrator instantiates lanes
 *    with hard fan-out caps + token budgets + a truthful fixed-roster
 *    fallback. No random personas (honesty laws — no fabricated
 *    credentials), no unbounded spawning (anti-storm laws), no self-scored
 *    acceptance gates (verdicts are measured, never self-reported).
 *  - R332 — idempotency lifecycle law (from Mercury, harvest of lanes
 *    31-a/31-b/31-c alongside the moltspay/Zen7 research): retries on
 *    stateful actions follow reserve-before-act → release only on
 *    pre-action failure → freeze after the committed action (replays
 *    return the same recorded outcome, never a re-execution). Ported to
 *    git-as-memory: reservation, release and terminal outcome are ledger
 *    entries — surviving restarts, unlike Mercury's in-memory store.
 *
 * WHAT THIS MODULE IS (and is NOT): the heartbeat step runSpawnManifest is
 * OBSERVE-ONLY. Each beat derives its OWN typed self-manifest from the REAL
 * step roster (FIXED_ROSTER — the actual stepWrap names of ci-cycle.mjs; the
 * honesty law forbids invented personas like legion_agi's random
 * "MIT/Stanford" fallback experts), validates it fail-closed, walks the R332
 * lifecycle pending→reserved→frozen (frozen = the audit receipt; a replay
 * returns frozen, never re-executes), scans state/spawn/manifests/*.json and
 * records per-file verdicts. It spawns nothing, moves no value, touches no
 * key, broadcasts nothing, gates no other step. A discovered invalid
 * manifest is EVIDENCE (invalidCount + per-file reasons in the sealed doc),
 * not a beat failure — enforcement belongs to the sovereign decider, never
 * to an observe rail.
 *
 * LAWS (measured, not aspirational):
 *  - FAIL-CLOSED validation: every violation recorded (all of them, not
 *    first-fail); an unlawful manifest can never pass by accident.
 *  - TRUTHFUL FALLBACK: a lane's fallback is the lane's own real roster
 *    entry (re-run the same real role); a different or invented persona is
 *    a validation violation.
 *  - Exit-0 by design: every failure degrades to an honest verdict
 *    (SPAWN-MANIFEST-OK/INVALID/ERROR receipt), never a crash.
 *  - Zero npm deps (node builtins only). Pure where testable:
 *    deriveManifest/validateManifest/nextLifecycle/signSpawnDoc take no
 *    clock (beyond the passed `now`), no randomness, no network.
 *  - State rides the git-as-memory commits: state/spawn-manifest-latest.json
 *    + state/spawn/manifests/<id>.json — sandbox deaths lose nothing.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const DIR = path.dirname(new URL(import.meta.url).pathname);

/* ── hard laws (fail-closed constants; not knobs) ────────────────────────── */
export const SCHEMA_V = 1;                    // manifest schema version
export const MAX_FANOUT_PER_MANIFEST = 8;     // hard fan-out cap (anti-storm)
export const MIN_LANE_BUDGET_TOKENS = 1000;   // explicit token budget floor
export const MAX_LANE_BUDGET_TOKENS = 200000; // explicit token budget ceiling
export const MAX_LANES = 8;                   // lanes per manifest ceiling

/* FIXED_ROSTER — the engine's REAL step names: the exact stepWrap("name")
 * calls of ci-cycle.mjs, in heartbeat execution order (verified at exec32
 * against ci-cycle.mjs including this module's own "spawn-manifest" step;
 * "content-swarm" landed concurrently via T-91 and is included as the real
 * tail step it is; "surface-watch" landed via exec33 lane 33-a and is
 * included the same way — the roster is re-measured by selftest §40.34
 * against ci-cycle.mjs's actual stepWrap set every run). The honesty law
 * (R331: no random personas) makes this the ONLY universe of lawful
 * agentTypes — a spawn lane that is not a real engine step does not exist
 * and must never be fabricated. */
export const FIXED_ROSTER = [
  "custody", "dex-takeover", "social", "content", "digest", "post",
  "blurt-custody", "delegation", "shell-watch", "visibility",
  "content-memory", "content-concepts", "content-sourcing",
  "content-engagement", "spawn-manifest", "content-drift", "format-lint",
  "content-swarm", "surface-watch",
];

export const LANE_KINDS = ["observe", "act"];
export const LIFECYCLE_STATES = ["pending", "reserved", "frozen", "released"];
export const LIFECYCLE_EVENTS = ["reserve", "execute", "release", "replay"];

const MANIFEST_FIELDS = ["v", "id", "at", "goal", "lawsChecked", "deciderRef", "lanes", "signature"];
const LANE_FIELDS = ["id", "agentType", "kind", "budgetTokens", "fanoutCap", "fallback", "worklogRequired"];

/* the self-audit's observation targets — 8 REAL roster entries (MAX_LANES
 * cap), all observe-kind. The FULL roster always rides the sealed doc, so
 * nothing about the beat is hidden; the lanes are the bounded audit sample. */
const SELF_LANE_TYPES = [
  "custody", "social", "content", "content-sourcing",
  "content-engagement", "content-drift", "shell-watch", "visibility",
];
const SELF_LANE_BUDGET_TOKENS = 2000;

/* ── pure: canonical form + the seal (sig:8hex over sha256, same fleet style) ── */
export function stableStringify(v) {
  if (v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x)).join(",")}]`;
  if (v && typeof v === "object") {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}
export function signSpawnDoc(doc) {
  const { signature, ...rest } = doc ?? {};
  return "sig:" + createHash("sha256").update(stableStringify(rest ?? {})).digest("hex").slice(0, 8);
}

/* ── pure: R331 typed manifest derivation. Throws on structurally impossible
 * input — an unlawful lane can never be dressed up as a manifest. ────────── */
export function deriveManifest({ goal, lanes, now, laws } = {}) {
  if (typeof goal !== "string" || !goal.trim()) throw new Error("R331-goal-required (non-empty string)");
  if (!Array.isArray(lanes) || lanes.length === 0) throw new Error("R331-lanes-required (non-empty array)");
  if (lanes.length > MAX_LANES) throw new Error(`R331-lanes-max (${lanes.length} > ${MAX_LANES})`);
  const roster = FIXED_ROSTER;
  const normLanes = lanes.map((lane, i) => {
    if (!lane || typeof lane !== "object" || Array.isArray(lane)) throw new Error(`R331-lane-object (lane ${i})`);
    if (!roster.includes(lane.agentType)) throw new Error(`R331-agentType-roster (lane ${i}: ${JSON.stringify(lane.agentType)} — no invented personas)`);
    const kind = lane.kind ?? "observe"; // observe is the safe default; act must be explicit
    if (!LANE_KINDS.includes(kind)) throw new Error(`R331-kind (lane ${i}: ${JSON.stringify(kind)})`);
    if (!Number.isInteger(lane.budgetTokens) || lane.budgetTokens < MIN_LANE_BUDGET_TOKENS || lane.budgetTokens > MAX_LANE_BUDGET_TOKENS)
      throw new Error(`R331-budgetTokens (lane ${i}: ${JSON.stringify(lane.budgetTokens)} outside [${MIN_LANE_BUDGET_TOKENS},${MAX_LANE_BUDGET_TOKENS}])`);
    const fanoutCap = lane.fanoutCap ?? 1;
    if (!Number.isInteger(fanoutCap) || fanoutCap < 1 || fanoutCap > MAX_FANOUT_PER_MANIFEST)
      throw new Error(`R331-fanoutCap (lane ${i}: ${JSON.stringify(fanoutCap)} outside [1,${MAX_FANOUT_PER_MANIFEST}])`);
    const fallback = lane.fallback ?? lane.agentType; // truthful fallback = the roster entry itself
    if (fallback !== lane.agentType || !roster.includes(fallback))
      throw new Error(`R331-fallback-truthful (lane ${i}: fallback must be the lane's own real roster entry)`);
    const id = typeof lane.id === "string" && lane.id.trim() ? lane.id : `lane-${i}`;
    return { id, agentType: lane.agentType, kind, budgetTokens: lane.budgetTokens, fanoutCap, fallback, worklogRequired: true };
  });
  const at = now ?? new Date().toISOString();
  const id = "spawn-" + createHash("sha256").update(stableStringify({ goal, lanes: normLanes, now: at })).digest("hex").slice(0, 8);
  return {
    v: SCHEMA_V,
    id,
    at,
    goal,
    lawsChecked: ["R331", "R332"],
    deciderRef: laws?.deciderRef ?? null,
    lanes: normLanes,
  };
}

/* ── pure: R331 fail-closed validation. EVERY violation is recorded (never
 * first-fail) — an unlawful manifest must see all its sins at once. ─────── */
export function validateManifest(manifest, { roster = FIXED_ROSTER } = {}) {
  const reasons = [];
  const add = (r) => reasons.push(r);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { valid: false, reasons: ["manifest-not-object"] };
  }
  for (const k of Object.keys(manifest)) if (!MANIFEST_FIELDS.includes(k)) add(`unknown-field:${k}`);
  if (manifest.v !== SCHEMA_V) add(`v-schema (got ${JSON.stringify(manifest.v)}, want ${SCHEMA_V})`);
  if (typeof manifest.id !== "string" || !manifest.id.trim()) add("id-missing");
  if (typeof manifest.at !== "string" || !manifest.at.trim()) add("at-missing");
  if (typeof manifest.goal !== "string" || !manifest.goal.trim()) add("goal-missing");
  if (!Array.isArray(manifest.lawsChecked) || !manifest.lawsChecked.includes("R331")) add("lawsChecked-missing-R331");
  if (manifest.deciderRef !== undefined && manifest.deciderRef !== null && typeof manifest.deciderRef !== "string") add("deciderRef-type");
  if (!Array.isArray(manifest.lanes)) add("lanes-not-array");
  else {
    if (manifest.lanes.length === 0) add("lanes-empty");
    if (manifest.lanes.length > MAX_LANES) add(`lanes-max (${manifest.lanes.length} > ${MAX_LANES})`);
    manifest.lanes.forEach((lane, i) => {
      const p = `lanes[${i}]`;
      if (!lane || typeof lane !== "object" || Array.isArray(lane)) { add(`${p}.not-object`); return; }
      for (const k of Object.keys(lane)) if (!LANE_FIELDS.includes(k)) add(`${p}.unknown-field:${k}`);
      if (!roster.includes(lane.agentType)) add(`${p}.agentType-roster (${JSON.stringify(lane.agentType)} — no random personas)`);
      if (!LANE_KINDS.includes(lane.kind)) add(`${p}.kind (${JSON.stringify(lane.kind)})`);
      if (!Number.isInteger(lane.budgetTokens) || lane.budgetTokens < MIN_LANE_BUDGET_TOKENS || lane.budgetTokens > MAX_LANE_BUDGET_TOKENS)
        add(`${p}.budgetTokens-range (${JSON.stringify(lane.budgetTokens)})`);
      if (!Number.isInteger(lane.fanoutCap) || lane.fanoutCap < 1 || lane.fanoutCap > MAX_FANOUT_PER_MANIFEST)
        add(`${p}.fanoutCap-range (${JSON.stringify(lane.fanoutCap)})`);
      if (lane.fallback !== lane.agentType || !roster.includes(lane.fallback)) add(`${p}.fallback-truthful (must equal the lane's own real roster entry)`);
      if (lane.worklogRequired !== true) add(`${p}.worklogRequired (must be true)`);
    });
  }
  return { valid: reasons.length === 0, reasons };
}

/* ── pure: R332 idempotency lifecycle state machine.
 *   pending --reserve--> reserved --execute--> frozen
 *   reserved --release (failure BEFORE execution)--> released
 *   released --reserve (lawful retry)--> reserved
 *   frozen --replay--> frozen (the recorded outcome; never re-executes)
 * Illegal transitions throw with the law reason — silence would be a lie. */
export function nextLifecycle(status, event) {
  const illegal = (why) => { throw new Error(`R332-illegal-transition: ${event}@${status} — ${why}`); };
  if (!LIFECYCLE_STATES.includes(status)) illegal("unknown-status");
  if (!LIFECYCLE_EVENTS.includes(event)) illegal("unknown-event");
  switch (`${status}|${event}`) {
    case "pending|reserve": return "reserved";
    case "reserved|execute": return "frozen";
    case "reserved|release": return "released";
    case "released|reserve": return "reserved";
    case "frozen|replay": return "frozen"; // idempotent: the recorded outcome IS the answer
    case "pending|execute": illegal("reserve-before-act");
    case "pending|release": illegal("no-reservation");
    case "pending|replay": illegal("nothing-recorded");
    case "reserved|reserve": illegal("double-reserve");
    case "reserved|replay": illegal("nothing-recorded-yet");
    case "frozen|execute": illegal("already-frozen (replay returns the recorded outcome)");
    case "frozen|reserve": illegal("already-frozen");
    case "frozen|release": illegal("already-frozen (release is only for pre-act failure)");
    case "released|execute": illegal("reserve-before-act");
    case "released|release": illegal("no-reservation");
    case "released|replay": illegal("nothing-recorded");
    default: illegal("no-transition");
  }
}

/* ── HEAD sha (read-only; never fatal — null stays honest) ───────────────── */
function headSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: DIR, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function writeAtomic(file, doc) {
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
  fs.renameSync(tmp, file);
}

/* ── heartbeat step body (ci-cycle "spawn-manifest"): derive the beat's own
 * self-manifest → validate fail-closed → walk the R332 lifecycle → scan
 * state/spawn/manifests/*.json → seal the receipt. NEVER THROWS — every
 * failure degrades to an honest verdict (exit-0 by design). ─────────────── */
export async function runSpawnManifest(opts = {}) {
  const stateDir = opts.stateDir ?? process.env.SAOS_STATE_DIR ?? path.join(DIR, "state");
  const now = opts.now ?? new Date().toISOString();
  try {
    /* (a) the beat's OWN self-manifest — what this beat actually is, no
     * fiction: every lane is a real roster entry, observe-kind, bounded
     * budget, truthful fallback, worklog required. */
    const selfManifest = deriveManifest({
      goal: "saos-engine beat — fixed roster lanes, R331 self-audit",
      lanes: SELF_LANE_TYPES.map((agentType, i) => ({
        id: `beat-${agentType}-${i}`,
        agentType,
        kind: "observe",
        budgetTokens: SELF_LANE_BUDGET_TOKENS,
        fanoutCap: 1,
      })),
      now,
      laws: { deciderRef: opts.deciderRef ?? null },
    });

    /* (b) validate fail-closed — the decider law-validation, mechanical */
    const selfVerdict = validateManifest(selfManifest);

    /* (c) R332 lifecycle: pending → reserved → frozen (the audit receipt);
     * the replay must return frozen — idempotency measured, not assumed. */
    const transitions = [];
    let status = "pending";
    const step = (ev) => { status = nextLifecycle(status, ev); transitions.push(`${ev}→${status}`); };
    step("reserve");
    step("execute");
    const replayStatus = nextLifecycle(status, "replay");
    transitions.push(`replay→${replayStatus}`);
    if (replayStatus !== "frozen" || status !== "frozen") {
      /* unreachable by construction; if the machine ever drifts, say so */
      selfVerdict.reasons.push(`lifecycle-drift (${status}/${replayStatus})`);
    }

    /* (d) scan the spawn-manifest ledger (git-as-memory). Absent dir = an
     * honest zero. Invalid/unparseable files are EVIDENCE, counted. */
    const manifestsDir = path.join(stateDir, "spawn", "manifests");
    const scan = [];
    let scanned = 0;
    let invalidCount = 0;
    try {
      const files = fs.readdirSync(manifestsDir).filter((f) => f.endsWith(".json")).sort();
      for (const f of files) {
        const rec = { file: f, id: null, valid: false, reasons: [] };
        try {
          const m = JSON.parse(fs.readFileSync(path.join(manifestsDir, f), "utf8"));
          rec.id = m?.id ?? null;
          rec.reasons = validateManifest(m, { roster: FIXED_ROSTER }).reasons;
        } catch (e) {
          rec.reasons = [`unparseable:${String(e?.message ?? e).slice(0, 60)}`];
        }
        rec.valid = rec.reasons.length === 0;
        scanned++;
        if (!rec.valid) invalidCount++;
        scan.push(rec);
      }
    } catch { /* no manifests dir yet → scanned 0, honest */ }

    /* (f) commit the self-manifest into the spawn ledger — git-as-memory:
     * rides the state-churn commits, auditable pre-spawn forever. */
    let selfFileWritten = false;
    try {
      fs.mkdirSync(manifestsDir, { recursive: true });
      writeAtomic(path.join(manifestsDir, `${selfManifest.id}.json`), { ...selfManifest, signature: signSpawnDoc(selfManifest) });
      selfFileWritten = true;
    } catch { /* read-only worktree → the receipt still carries the audit */ }

    /* (e) seal the heartbeat receipt */
    const verdict = selfVerdict.valid && status === "frozen" ? "SPAWN-MANIFEST-OK" : "SPAWN-MANIFEST-INVALID";
    const doc = {
      at: now,
      head: headSha(),
      verdict,
      observe: true, /* R331: this rail spawns nothing and gates nothing */
      goal: selfManifest.goal,
      roster: FIXED_ROSTER,
      rosterSource: "ci-cycle.mjs stepWrap names",
      selfManifest: { id: selfManifest.id, valid: selfVerdict.valid, status },
      lifecycle: transitions,
      scanned,
      invalidCount,
      summary: {
        lanes: selfManifest.lanes.length,
        rosterSize: FIXED_ROSTER.length,
        budgetTokensPerLane: SELF_LANE_BUDGET_TOKENS,
        scan,
      },
    };
    const docSigned = { ...doc, signature: signSpawnDoc(doc) };
    let fileWritten = false;
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      writeAtomic(path.join(stateDir, "spawn-manifest-latest.json"), docSigned);
      fileWritten = true;
    } catch { /* read-only worktree → honest fileWritten:false */ }

    /* (h) heartbeat receipt */
    return {
      verdict,
      at: now,
      selfManifestId: selfManifest.id,
      selfManifestValid: selfVerdict.valid,
      lifecycleStatus: status,
      scanned,
      invalidCount,
      fileWritten,
      selfFileWritten,
      signature: docSigned.signature,
      ...(selfVerdict.valid ? {} : { reasons: selfVerdict.reasons }),
    };
  } catch (e) {
    /* (g) never throws — an error is a verdict, not a wedge */
    return {
      verdict: "SPAWN-MANIFEST-ERROR",
      at: now,
      selfManifestId: null,
      selfManifestValid: false,
      lifecycleStatus: null,
      scanned: 0,
      invalidCount: 0,
      fileWritten: false,
      signature: null,
      error: String(e?.message ?? e).slice(0, 160),
    };
  }
}
