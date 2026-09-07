/**
 * Sandbox engine — an on-device mission simulator so the app is ALIVE the
 * moment it's installed, before any proxy/credentials exist.
 *
 * Design principles:
 * - The event grammar mirrors the real pipeline exactly (same phases and
 *   decision strings the agent's Telemetry emits), so every screen renders
 *   sandbox and live data identically.
 * - Time-based replay, not timers: a mission is a seeded SCHEDULE written
 *   to localStorage; getEvents() returns every scheduled event whose time
 *   has passed. Progress appears on each poll with zero background work,
 *   survives app restarts, and costs no battery.
 * - Interactive, not a movie: dispatch() starts a real simulated run from
 *   the user's objective; decide() resumes/halts the paused mentor gate; a
 *   rejection re-plans once with the feedback.
 * - Always labeled: consumers expose a "Sandbox" pill — simulated data is
 *   never presented as production.
 */
import type { TelemetryEvent } from "../../types/telemetry.js";
import { SEED_MODELS, SEED_PATCHES } from "./diffs.js";

const STORE_KEY = "qodo:sandbox:missions";
const MAX_MISSIONS = 8;
const MENTOR_TIMEOUT_MS = 30 * 60 * 1000; // mirror the real agent's wait window

export interface SandboxMission {
  runId: string;
  objective: string;
  repo: string;
  startAt: number; // epoch ms
  seed: number;
  /** Pause at the mentor gate and wait for the user? */
  mentor: boolean;
  decision?: { status: "approved" | "rejected"; reason?: string; at: number };
  /** Set when this run is the automatic re-plan after a rejection. */
  feedbackOf?: string;
}

// ── Seeded PRNG (mulberry32) — stable variety per run ──────────────────────

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Persistence ────────────────────────────────────────────────────────────

function load(): SandboxMission[] {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const list = raw ? (JSON.parse(raw) as SandboxMission[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function save(missions: SandboxMission[]): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(missions.slice(-MAX_MISSIONS)));
  } catch {
    /* storage unavailable — sandbox degrades to per-session */
  }
}

// ── Schedule construction ──────────────────────────────────────────────────

interface Scheduled {
  at: number;
  event: TelemetryEvent;
}

function buildSchedule(m: SandboxMission): Scheduled[] {
  const rand = rng(m.seed);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
  const jitter = (base: number, spread: number) => base + rand() * spread;

  const patch = SEED_PATCHES[m.seed % SEED_PATCHES.length];
  const planModel = pick(SEED_MODELS);
  const codeModel = pick(SEED_MODELS);
  const prNumber = 100 + (m.seed % 400);
  const [owner, repo] = m.repo.includes("/") ? m.repo.split("/") : ["sandbox", m.repo || "demo-app"];

  const out: Scheduled[] = [];
  let t = 0;
  const ev = (phase: string, decision: string, extra: Record<string, unknown> = {}) => {
    out.push({
      at: m.startAt + t,
      event: {
        runId: m.runId,
        phase,
        decision,
        timestamp: new Date(m.startAt + t).toISOString(),
        ...extra,
      },
    });
  };

  const planTokens = Math.round(jitter(1600, 1400));
  const codeTokens = Math.round(jitter(3800, 3200));
  const reviewTokens = Math.round(jitter(700, 700));

  ev("run", "started", { objective: m.objective, repo: m.repo });
  t += jitter(4000, 5000);
  ev("architect", "plan-generated", {
    steps: patch.planSteps(m.objective),
    totalTokens: planTokens,
    promptTokens: Math.round(planTokens * 0.7),
    completionTokens: Math.round(planTokens * 0.3),
    model: planModel.model,
    provider: planModel.provider,
    tier: planModel.tier,
  });
  t += jitter(2000, 2000);
  ev("ai-call", "tiering_decision", { tier: codeModel.tier, model: codeModel.model, totalTokens: Math.round(jitter(500, 500)) });
  t += jitter(15000, 20000);
  ev("coder", "patch-generated", {
    files: patch.files,
    diff: patch.diff,
    totalTokens: codeTokens,
    promptTokens: Math.round(codeTokens * 0.6),
    completionTokens: Math.round(codeTokens * 0.4),
    model: codeModel.model,
    provider: codeModel.provider,
    tier: codeModel.tier,
  });

  // 5-gate validator (all pass in sandbox — failures come from rejection)
  for (const gate of ["lockfile", "blast-radius", "dom-xray", "shadow-traffic", "chaos-monkey"]) {
    t += jitter(3000, 5000);
    ev("gate", `${gate}-result`, { allowed: true });
  }
  t += jitter(1500, 2000);
  ev("secret-guard", "scan-clean", {});
  t += jitter(1500, 2000);
  ev("warden", "no-violations", {});

  // Mentor gate
  if (m.mentor) {
    t += jitter(1500, 1500);
    const pauseAt = m.startAt + t;
    ev("mentor", "pre-commit-pause", { status: "waiting", owner, repo, prNumber });

    if (!m.decision) {
      // Still waiting — or timed out with no answer (mirror the agent).
      if (Date.now() > pauseAt + MENTOR_TIMEOUT_MS) {
        out.push({
          at: pauseAt + MENTOR_TIMEOUT_MS,
          event: {
            runId: m.runId,
            phase: "mentor",
            decision: "pre-commit-timeout",
            timestamp: new Date(pauseAt + MENTOR_TIMEOUT_MS).toISOString(),
          },
        });
        out.push({
          at: pauseAt + MENTOR_TIMEOUT_MS + 1000,
          event: {
            runId: m.runId,
            phase: "run",
            decision: "fatal-error",
            error: "Mentor approval timed out after 30 minutes",
            timestamp: new Date(pauseAt + MENTOR_TIMEOUT_MS + 1000).toISOString(),
          },
        });
      }
      return out.sort((a, b) => a.at - b.at);
    }

    if (m.decision.status === "rejected") {
      out.push({
        at: m.decision.at,
        event: {
          runId: m.runId,
          phase: "mentor",
          decision: "pre-commit-rejected",
          reason: m.decision.reason,
          timestamp: new Date(m.decision.at).toISOString(),
        },
      });
      out.push({
        at: m.decision.at + 800,
        event: {
          runId: m.runId,
          phase: "run",
          decision: "fatal-error",
          error: `Mentor rejected the Ghost Commit: ${m.decision.reason || "no reason"}`,
          timestamp: new Date(m.decision.at + 800).toISOString(),
        },
      });
      return out.sort((a, b) => a.at - b.at);
    }

    // Approved — the rest of the pipeline resumes from the decision moment.
    out.push({
      at: m.decision.at,
      event: {
        runId: m.runId,
        phase: "mentor",
        decision: "pre-commit-approved",
        timestamp: new Date(m.decision.at).toISOString(),
      },
    });
    t = m.decision.at - m.startAt;
  }

  t += jitter(3000, 3000);
  ev("commit", "ghost-commit-created", { prNumber });
  t += jitter(4000, 4000);
  ev("canary", "canary-deployed", { trafficPercent: 5 });
  t += jitter(12000, 15000);
  ev("canary", "canary-healthy", {});
  t += jitter(3000, 3000);
  ev("merge", "merged", { prNumber });
  t += jitter(5000, 6000);
  ev("postmerge", "validation-passed", {});
  t += jitter(4000, 5000);
  ev("review", "review-posted", { totalTokens: reviewTokens, model: planModel.model });
  t += jitter(1500, 1500);
  ev("run", "done", {});

  // Cost summary mirrors the real costTracker payload shape.
  const entries = [
    { ...planModel, tokens: planTokens + Math.round(jitter(500, 500)) },
    { ...codeModel, tokens: codeTokens },
    { ...planModel, tokens: reviewTokens },
  ];
  const breakdown = entries.map((e) => ({
    provider: e.provider,
    model: e.model,
    tier: e.tier,
    tokens: e.tokens,
    cents: parseFloat(((e.tokens / 1000) * e.centsPer1k).toFixed(4)),
  }));
  const totalTokens = entries.reduce((s, e) => s + e.tokens, 0);
  ev("cost-summary", "", {
    totalTokens,
    promptTokens: Math.round(totalTokens * 0.65),
    completionTokens: Math.round(totalTokens * 0.35),
    estimatedUsdCents: parseFloat(breakdown.reduce((s, b) => s + b.cents, 0).toFixed(4)),
    callCount: 3 + Math.round(jitter(2, 4)),
    breakdown,
  });

  return out.sort((a, b) => a.at - b.at);
}

// ── Seeding ────────────────────────────────────────────────────────────────

function newRunId(seed: number): string {
  return `run-${seed.toString(36).slice(0, 6).padEnd(6, "0")}`;
}

/** First launch: one finished run + one that pauses at the gate shortly. */
export function ensureSeeded(): void {
  if (load().length > 0) return;
  const now = Date.now();
  const s1 = Math.floor(Math.random() * 1e9);
  const s2 = Math.floor(Math.random() * 1e9);
  const missions: SandboxMission[] = [
    {
      runId: newRunId(s1),
      objective: "Harden the webhook client with bounded retries",
      repo: "sandbox/demo-app",
      startAt: now - 3 * 60 * 60 * 1000,
      seed: s1,
      mentor: true,
      decision: { status: "approved", at: now - 3 * 60 * 60 * 1000 + 95_000 },
    },
    {
      runId: newRunId(s2),
      objective: "Add per-IP rate limiting to the public API",
      repo: "sandbox/demo-app",
      startAt: now - 45_000, // architect+coder land within the first minute
      seed: s2,
      mentor: true,
    },
  ];
  save(missions);
}

// ── Public API (consumed via mobile/actions.ts and the telemetry source) ──

export function sandboxGetEvents(): TelemetryEvent[] {
  ensureSeeded();
  const now = Date.now();
  const events: TelemetryEvent[] = [];
  for (const m of load()) {
    for (const s of buildSchedule(m)) {
      if (s.at <= now) events.push(s.event);
    }
  }
  return events.sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp)).slice(0, 400);
}

export function sandboxDispatch(objective: string, repo: string): void {
  const seed = Math.floor(Math.random() * 1e9);
  const missions = load();
  missions.push({
    runId: newRunId(seed),
    objective,
    repo: repo || "sandbox/demo-app",
    startAt: Date.now(),
    seed,
    mentor: rng(seed)() < 0.6, // most runs exercise the approval flow
  });
  save(missions);
}

/** Answer the paused mentor gate of `runId`; rejection re-plans once. */
export function sandboxDecide(runId: string, status: "approved" | "rejected", reason?: string): void {
  const missions = load();
  const m = missions.find((x) => x.runId === runId);
  if (!m || m.decision) return;
  m.decision = { status, reason, at: Date.now() };
  if (status === "rejected" && !m.feedbackOf) {
    // The agent's real behavior: re-dispatch with the feedback folded in.
    const seed = Math.floor(Math.random() * 1e9);
    missions.push({
      runId: newRunId(seed),
      objective: `${m.objective} — revised: ${reason || "address mentor feedback"}`,
      repo: m.repo,
      startAt: Date.now() + 4000,
      seed,
      mentor: false, // the retry sails through so the user sees resolution
      feedbackOf: m.runId,
    });
  }
  save(missions);
}

export function sandboxReset(): void {
  try {
    window.localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}
