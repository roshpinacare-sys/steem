/**
 * readiness-gate.mjs — exec29/29-b · THE SOCIAL-STANDBY LAW (hard gate).
 *
 * OWNER DIRECTIVE 2026-10-14 (verbatim intent): stay low-profile — it is OK to
 * be invisible; zero flooding; nobody should see our actions until we are
 * truly ready to operate as a strong engineering body; everything through the
 * Autonomy architecture; do not give them any reason to block us further.
 *
 * This module turns the standby from an accident into a LAW: a hard gate at
 * the execution choke-point of the social rail (runSocial / runProfiles in
 * army-social.mjs). While the gate is CLOSED, nothing downstream ever runs —
 * no custody revival, no key/WIF decryption, no signing, no broadcast.
 *
 * THE LAW (dual-key, fail-closed):
 *  · KEY 1 (local): state/readiness.json — the runtime state file, committed
 *    as the DEFAULT CLOSED law. SAOS_STATE_DIR aware (same pattern as
 *    army-social.mjs). Absent or corrupt file ⇒ {gate:"STANDBY"}.
 *  · KEY 2 (remote): the Autonomy architecture's sovereign directive —
 *    roshpinacare-sys/Autonomy @main
 *    ops/sovereign/DIRECTIVES/SOCIAL-ARMING.json — must parse, must carry the
 *    SAME directiveRef as the local file, and its status must be "ARMED".
 *  · ARMED requires ALL FOUR: local gate === "ARMED", non-empty directiveRef,
 *    valid ISO armedAt, and the remote cross-check above. ANY failure (fetch,
 *    parse, mismatch) ⇒ STANDBY with an honest reason.
 *  · NEVER CACHED, NEVER STICKY: every verdict is evaluated fresh — a fresh
 *    file read + a fresh directive fetch on EVERY call. An owner who closes
 *    either key is obeyed on the very next run.
 *
 * Zero new dependencies: global fetch only (Node ≥18 / bun). 10s timeout.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);

/* KEY 2 · the Autonomy architecture's sovereign directive (fetch-fresh every
 * verdict; a 404/parse-failure/mismatch is a CLOSED gate, never an error). */
export const DIRECTIVE_URL =
  "https://raw.githubusercontent.com/roshpinacare-sys/Autonomy/main/ops/sovereign/DIRECTIVES/SOCIAL-ARMING.json";

const stateDirOf = (stateDir) =>
  stateDir || process.env.SAOS_STATE_DIR || path.join(DIR, "state");

/* KEY 1 · read the local readiness state. Fail-closed by construction:
 * absent file, corrupt JSON, or a gate-less document all read as STANDBY. */
export function readGate(stateDir) {
  const dir = stateDirOf(stateDir);
  let raw = null;
  try {
    raw = fs.readFileSync(path.join(dir, "readiness.json"), "utf8");
  } catch {
    return { gate: "STANDBY", reason: "readiness.json absent — fail-closed default (owner-armed only)" };
  }
  try {
    const doc = JSON.parse(raw);
    if (!doc || typeof doc !== "object" || Array.isArray(doc) || typeof doc.gate !== "string" || !doc.gate.trim()) {
      return { gate: "STANDBY", reason: "readiness.json corrupt (missing gate field) — fail-closed default" };
    }
    return { ...doc, gate: doc.gate };
  } catch (e) {
    return { gate: "STANDBY", reason: `readiness.json corrupt (${String(e?.message ?? e).slice(0, 80)}) — fail-closed default` };
  }
}

/* THE VERDICT — re-evaluated every single call (never cached, never sticky).
 * opts.fetchImpl is an injection seam for the offline selftest ONLY; in
 * production the default global fetch is used and the 10s timeout applies. */
export async function socialGateVerdict(stateDir, opts = {}) {
  const local = readGate(stateDir);

  /* (a) the local key must be turned by hand */
  if (local.gate !== "ARMED") {
    return { mode: "STANDBY", reason: local.reason ?? `local gate=${JSON.stringify(local.gate)} — standby law holds (exec29)` };
  }
  /* (b) an arming without a directive reference is not an arming */
  const ref = typeof local.directiveRef === "string" ? local.directiveRef.trim() : "";
  if (!ref) {
    return { mode: "STANDBY", reason: "local file says ARMED but directiveRef is empty — dual-key law refuses (fail-closed)" };
  }
  /* (c) an arming without a valid timestamp is not an arming */
  if (!local.armedAt || Number.isNaN(Date.parse(local.armedAt))) {
    return { mode: "STANDBY", reason: "local file says ARMED but armedAt is missing/invalid ISO — dual-key law refuses (fail-closed)" };
  }

  /* (d) KEY 2 · the Autonomy architecture must agree — fresh fetch, every run */
  const fetchImpl = opts.fetchImpl ?? fetch;
  let remote = null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    try {
      const res = await fetchImpl(DIRECTIVE_URL, {
        signal: ctl.signal,
        headers: { "user-agent": "saos-readiness-gate/exec29", "cache-control": "no-cache" },
      });
      if (!res.ok) {
        return { mode: "STANDBY", reason: `cross-key fetch HTTP ${res.status} for Autonomy DIRECTIVES/SOCIAL-ARMING.json — fail-closed` };
      }
      remote = await res.json();
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return { mode: "STANDBY", reason: `cross-key fetch/parse failed (${String(e?.name ?? e?.message ?? e).slice(0, 60)}) — fail-closed` };
  }
  if (!remote || typeof remote !== "object" || Array.isArray(remote)) {
    return { mode: "STANDBY", reason: "cross-key directive did not parse to an object — fail-closed" };
  }
  if (String(remote.directiveRef ?? "").trim() !== ref) {
    return { mode: "STANDBY", reason: `cross-key directiveRef mismatch (local=${ref}) — fail-closed` };
  }
  if (String(remote.status ?? "").trim().toUpperCase() !== "ARMED") {
    return { mode: "STANDBY", reason: `cross-key directive status=${JSON.stringify(remote.status ?? null)} (need ARMED) — fail-closed` };
  }

  return { mode: "ARMED", reason: `dual-key ARMED — readiness.json + Autonomy DIRECTIVES/SOCIAL-ARMING.json agree (directiveRef=${ref}, armedAt=${local.armedAt})` };
}

/* THE HONEST RECEIPT — every planned lane reports this while the gate is
 * closed: zero actions, zero footprint, and the reason why. */
export const STANDBY_RECEIPT = (lane) => ({
  lane,
  status: "STANDBY-GATE-CLOSED",
  actions: 0,
  note: "social standby law exec29 — zero social footprint until owner arms via Autonomy DIRECTIVES",
});

/* ═══════════════════════════════════════════════════════════════════════════
 * exec29/29-a2 · MEASURED-LAWS REFRESH (additive, honesty-only).
 *
 * WHY: the sovereign decider (Autonomy D5-social-standby) measures the
 * PUBLISHED gate state and requires the anti-farm laws to be measurable
 * there — cfg = readiness.json.config | antiFarm | laws, and it PASSes its
 * "חוקי-האנטי-חווה חיים-בקונפיג" item only when the cfg carries ALL THREE
 * keys: fleetWeightPct · maxPostsPerDay · antiHerd. Until now readiness.json
 * carried only the gate fields, so the decider honestly printed
 * "הקונפיג-המפורסם (readiness.json) טרם-נמדד".
 *
 * WHAT: enrich the gate state with a `laws` block — EVERY number measured
 * live from socialPolicy() (army-social.mjs), never invented. Zero fleet
 * votes under the stealth doctrine is an honest law, serialized as-is.
 * The block: {fleetWeightPct, maxPostsPerDay, maxFleetVotesPerDay,
 * maxFleetVotesPerPost, jitterPct, antiHerd, stealth:{...the full
 * socialPolicy() return as-is}, measuredAt, source}.
 *   · jitterPct 5 = the R298 weight-jitter code law (fleetWeightPct ±5,
 *     seeded per vote — army-social.mjs doFleetVote, `% 6` amplitude).
 *   · antiHerd true = the T-87 anti-herd pick + R298 ring-cap laws (support
 *     spreads by least-supported tier, ≤2 fleet votes per post, chain-truth).
 *
 * LAWS OF THIS FUNCTION:
 *  · ADDITIVE ONLY: existing fields (gate/at/by/directiveRef/note/armedAt)
 *    are preserved byte-for-byte in meaning — the gate value is NEVER
 *    touched here; a STANDBY gate stays STANDBY (fail-closed untouched).
 *  · LIVENESS: measuredAt is refreshed on EVERY standby run that finds a
 *    readable gate file (the same living-receipt pattern as every other
 *    state file the beat commits; a laws block measured weeks ago proves
 *    nothing about now). Atomic write (tmp + rename), same as the rail.
 *  · FAIL-HONEST: absent/corrupt/gate-less readiness.json → no write (a
 *    laws block is never invented onto a file the gate cannot read);
 *    socialPolicy() unavailable → no write. This function NEVER throws and
 *    NEVER blocks the standby receipt path that calls it.
 *  · The army-social import is DYNAMIC (inside the call): army-social.mjs
 *    statically imports THIS module, so a static back-import would create
 *    an evaluation cycle — the runtime import keeps the graph acyclic and
 *    is resolved from the module cache in production and selftest alike.
 * ═══════════════════════════════════════════════════════════════════════════ */
export async function refreshLaws(stateDir) {
  const dir = stateDirOf(stateDir);
  const file = path.join(dir, "readiness.json");
  let doc = null;
  try {
    doc = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { refreshed: false, reason: "readiness.json absent/corrupt — nothing to enrich (fail-closed untouched)" };
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc) || typeof doc.gate !== "string") {
    return { refreshed: false, reason: "readiness.json gate-less — nothing to enrich (fail-closed untouched)" };
  }
  let policy = null;
  try {
    const { socialPolicy } = await import("./army-social.mjs");
    policy = socialPolicy();
  } catch (e) {
    return { refreshed: false, reason: `socialPolicy() unavailable (${String(e?.message ?? e).slice(0, 60)}) — laws block not written (never invented)` };
  }
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return { refreshed: false, reason: "socialPolicy() returned no object — laws block not written (never invented)" };
  }
  const laws = {
    fleetWeightPct: policy.fleetWeightPct ?? null,
    maxPostsPerDay: policy.maxPostsPerDay ?? null,
    maxFleetVotesPerDay: policy.maxFleetVotesPerDay ?? null,
    maxFleetVotesPerPost: policy.maxFleetVotesPerPost ?? null,
    jitterPct: 5, /* R298 weight-jitter law: fleetWeightPct ±(0..5) per vote, seeded + auditable */
    antiHerd: true, /* T-87 anti-herd pick + R298 ring-cap: support spreads by least-supported tier, ≤2 fleet votes/post, chain-truth */
    stealth: policy, /* the full measured socialPolicy() return, as-is — every number lives there */
    measuredAt: new Date().toISOString(),
    source: "socialPolicy() live",
  };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify({ ...doc, laws }, null, 2) + "\n");
    fs.renameSync(tmp, file);
  } catch (e) {
    return { refreshed: false, reason: `write failed (${String(e?.message ?? e).slice(0, 60)}) — gate state untouched` };
  }
  return { refreshed: true, laws };
}
