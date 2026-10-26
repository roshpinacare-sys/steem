/**
 * bridge-guard.mjs — R263 · THE BRIDGE CIRCUIT BREAKER (429-storm law).
 *
 * THE MEASURED ROOT CAUSE (live, 2026-10-08): the LLM provider rate-limits
 * in SUSTAINED storms (first 429 at 01:09Z, still storming at 03:27Z —
 * 2h+). During a storm, every blind bridge call burns quota, adds up to
 * ~3min of timeout per lane call, and deepens the throttle. Retrying
 * through a storm is not engineering; it is self-inflicted damage.
 *
 * THE PATTERN (classic circuit breaker, one file, zero deps):
 *  · CLOSED: calls pass through; failures increment the streak.
 *  · OPEN (streak ≥ FAIL_THRESHOLD): callers SKIP the bridge entirely and
 *    use the lawful persona floor at once — zero waste, zero quota burn.
 *  · HALF-OPEN (cooldown elapsed): ONE call is allowed through; success
 *    closes the circuit, failure re-opens for another cooldown.
 * The state is a tiny JSON file (state/bridge-guard.json) — readable by
 * every rail in every process, atomic-write, verdict-only (no content).
 *
 * LAWS: the persona floor is ALWAYS lawful — the breaker never blocks the
 * conversation, it only stops the waste. Offline mode never touches this
 * (SAOS_OFFLINE callers already skip the bridge by their own law).
 */

import * as fs from "node:fs";
import * as path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const FILE = path.join(DIR, "state", "bridge-guard.json");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };

export const FAIL_THRESHOLD = Number(process.env.SAOS_BRIDGE_FAIL_THRESHOLD) || 3;
export const COOLDOWN_MS = Number(process.env.SAOS_BRIDGE_COOLDOWN_MS) || 10 * 60_000;

/** pure (selftest-locked): the breaker state machine —
 * verdict "pass" (CLOSED or HALF-OPEN: the caller may try the bridge)
 * or "open" (skip the bridge, use the floor). */
export function breakerVerdict(state, nowMs) {
  const s = state ?? {};
  const streak = Number.isFinite(s.failStreak) ? s.failStreak : 0;
  const open = s.open === true;
  const since = Number.isFinite(s.openSince) ? s.openSince : 0;
  if (!open) return streak >= FAIL_THRESHOLD ? "open" : "pass";
  const elapsed = Math.max(0, (Number(nowMs) || 0) - since);
  return elapsed >= COOLDOWN_MS ? "pass" : "open"; // half-open: one call may try
}

/** pure: the state after a failure — a fresh threshold crossing OR a failed
 * half-open probe both (re)arm the FULL cooldown from NOW (a probe that
 * failed does not inherit the old clock; otherwise the breaker would flap
 * open/half-open on every call). */
export function breakerAfterFailure(state, nowMs) {
  const s = state ?? {};
  const streak = (Number.isFinite(s.failStreak) ? s.failStreak : 0) + 1;
  const open = s.open === true || streak >= FAIL_THRESHOLD;
  return { failStreak: streak, open, openSince: open ? (Number(nowMs) || 0) : null, lastKind: String(s.lastKind ?? "") };
}

/** pure: the state after a success (circuit closes, streak resets) */
export function breakerAfterSuccess() {
  return { failStreak: 0, open: false, openSince: null, lastKind: null };
}

function load() { return readJson(FILE, null); }
function save(v) { try { writeJson(FILE, v); } catch { /* read-only fs in CI: the in-memory law still stands */ } }

/** may this process call the bridge right now? */
export function bridgeOpen(nowMs = Date.now()) {
  return breakerVerdict(load(), nowMs) === "pass";
}

export function noteBridgeFailure(kind = "unknown", nowMs = Date.now()) {
  const next = breakerAfterFailure(load(), nowMs);
  next.lastKind = String(kind).slice(0, 60);
  save(next);
  return next;
}

export function noteBridgeSuccess(nowMs = Date.now()) {
  const next = breakerAfterSuccess();
  save(next);
  return next;
}

/** light shape for /status (verdicts only) */
export function bridgeGuardState() {
  return load();
}
