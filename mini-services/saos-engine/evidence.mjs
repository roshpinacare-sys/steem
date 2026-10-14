/* SAOS EVIDENCE (exec36, lane 36-a) — the execution-evidence module.
 *
 * LAW PROVENANCE — exec36 execution-evidence directive; registry number
 * PENDING R354+ (R354-candidate; grep-before-write registration belongs to
 * the registry lanes — Pulse DECISIONS #36 is the last registration row).
 * Pattern source: SWE-bench/SWE-bench harness/grading.py SUITE_RAN
 * positive-evidence gate (33-b dossier §2.10/§5.2): "Evidence that a test
 * runner actually executed, used to tell 'ran with no failures' apart from
 * 'never ran'… an empty status map scores every F2P test as passing, so a
 * zero count read as evidence turns a suite that never ran into a resolved
 * instance." Rebuilt sovereignty-native:
 *   · RUN MARKER — written ATOMICALLY (tmp + rename) by selftest.mjs BEFORE
 *     the first vector executes: {runId, startedAt, startedMs, pid, host}.
 *     A process that dies mid-run leaves a marker WITHOUT a matching
 *     verdict = "ran but never finished".
 *   · VERDICT — the final selftest write embeds the legacy keys (pass, fail,
 *     at, vectors — byte-compatible for existing consumers) PLUS the
 *     evidence shape {runId === marker.runId, startedAt, finishedAt,
 *     durationMs, total, suiteRan:true}.
 *   · CLASSIFICATION (fail-closed precedence, in order):
 *       verdict missing/unparseable/malformed      → NOT-RAN
 *       marker missing/unparseable                 → NO-MARKER
 *       verdict.runId missing or ≠ marker.runId    → RUNID-MISMATCH
 *       verdict.suiteRan !== true                  → NOT-RAN
 *       verdict.fail > 0 (marker matched)          → FAIL-RECORDED
 *       otherwise                                  → SUITE-RAN
 *     honest === (evidence === "SUITE-RAN"). EVERY non-SUITE-RAN state is
 *     NO-EVIDENCE: consumers must treat it as STALE/UNKNOWN — never green.
 *     A crashed/partial selftest can therefore never read green, and a
 *     legacy pre-evidence verdict (no runId) can never read green either.
 *   · FAIL-RECORDED is an honest RED (the state file itself admits the
 *     failure) — kept distinct from NOT-RAN precisely because "ran and
 *     failed" ≠ "never ran" is the distinction SUITE_RAN exists to draw.
 *     It is still honest:false (green is never justified by it).
 *
 * CONSUMERS: selftest.mjs self-verifies before exit (defense in depth);
 * the ci-cycle heartbeat carries an observe-only selftest-evidence probe;
 * future probes (surface-watch) import the same one-shape validator.
 *
 * PAPER/INFRA LAYER ONLY: zero npm deps (node:fs, node:os, node:path,
 * node:crypto), zero keys, zero network, zero broadcasts, zero value.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const ENGINE_STATE_DEFAULT = path.join(path.dirname(new URL(import.meta.url).pathname), "state");
export const VERDICT_FILE = "selftest-last-run.json";
export const MARKER_FILE = "selftest-run-marker.json";
export const EVIDENCE_VALUES = Object.freeze(["SUITE-RAN", "NO-MARKER", "RUNID-MISMATCH", "NOT-RAN", "FAIL-RECORDED"]);

/* ── 1 · writeJsonAtomic — the shared atomic write (tmp + rename) ── */
export function writeJsonAtomic(file, obj) {
  const tmp = `${file}.tmp.${process.pid}`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, file);
    return { written: true, path: file };
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort */ }
    return { written: false, error: String(e?.message ?? e).slice(0, 200), path: file };
  }
}

/* ── 2 · writeRunMarker — minted BEFORE the first vector executes ── */
export function writeRunMarker(stateDir = ENGINE_STATE_DEFAULT) {
  const startedMs = Date.now();
  const marker = {
    runId: randomBytes(16).toString("hex"),
    startedAt: new Date(startedMs).toISOString(),
    startedMs,
    pid: process.pid,
    host: os.hostname(),
  };
  const r = writeJsonAtomic(path.join(stateDir, MARKER_FILE), marker);
  if (!r.written) throw new Error(`run-marker-write-failed:${r.error}`);
  return marker;
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

/* ── 3 · verifySelftestEvidence — the one-shape fail-closed validator ──
 * Defaults verify the REAL engine state files; explicit paths serve tests
 * and future probes. Returns {evidence, honest} (header classification). */
export function verifySelftestEvidence({ verdictPath = path.join(ENGINE_STATE_DEFAULT, VERDICT_FILE), markerPath = path.join(ENGINE_STATE_DEFAULT, MARKER_FILE) } = {}) {
  const v = readJsonSafe(verdictPath);
  if (!v || typeof v !== "object" || typeof v.pass !== "number" || typeof v.fail !== "number") return { evidence: "NOT-RAN", honest: false };
  const m = readJsonSafe(markerPath);
  if (!m || typeof m !== "object" || typeof m.runId !== "string") return { evidence: "NO-MARKER", honest: false };
  if (typeof v.runId !== "string" || v.runId !== m.runId) return { evidence: "RUNID-MISMATCH", honest: false };
  if (v.suiteRan !== true) return { evidence: "NOT-RAN", honest: false };
  if (v.fail > 0) return { evidence: "FAIL-RECORDED", honest: false };
  return { evidence: "SUITE-RAN", honest: true };
}
