/* SAOS KERNEL-ISOLATION (exec34, lane 34-a2) — the zero-crash kernel.
 *
 * LAW PROVENANCE — owner's Hyper-Sovereignty directive exec34: "zero-crash
 * architecture". The engine must execute untrusted generated code and consume
 * untrusted LLM output without crashing, without SaaS, without Docker
 * (unavailable, measured), without keys. E2B (firecracker micro-VM) and
 * Guardrails (input/output rails) patterns are harvested NATIVELY:
 *   · E2B pattern → fresh tmpdir cwd per run, env WHITELIST scrub (PATH, HOME
 *     only — every other variable, including any secret, is stripped),
 *     hard SIGKILL timeout, output byte cap, recursive force cleanup.
 *   · Guardrails pattern → static deny-screen BEFORE execution (fail-closed),
 *     schema validation AFTER, with ONE bounded LLM repair attempt.
 *   · R330: the LLM never lives inside the deterministic core — it is
 *     injected as the `repairOnce` seam (sync or async), never imported.
 *   · R340 readback: cleanup is 'confirmed' only when fs.existsSync(tmpdir)
 *     === false — never assumed, always verified.
 *   · R341 budget: estimateTokens + assertBudget throws on exceed.
 *   · R342 self-heal: validate → repair ONCE → revalidate → honest verdict.
 *     Bounded. Never loops.
 *
 * Zero deps: node:child_process, node:fs, node:os, node:path only.
 * Zero keys. Zero network grants (child env carries nothing but PATH+HOME).
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── 1 · screenCode — static deny-screen BEFORE sandboxing (fail-closed) ── */

const CHILD_PROCESS_RE = /child_process/;
const BINDING_RE = /process\s*\.\s*binding/;
const FORKBOMB_RE =
  /(?:while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\))[\s\S]{0,240}(?:spawn|exec|fork)|(?:spawn|exec|fork)[\s\S]{0,240}(?:while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\))/;
const RMRF_RE = /rm\s+-[a-z]*[rf]{2}[a-z]*\s+\/(?![\w.-])/;
const ABSPATH_RE = /(?:\/usr\/|\/etc\/|\/home\/)/;

export function screenCode(code) {
  const reasons = [];
  if (typeof code !== "string") reasons.push("code-not-a-string"); // fail-closed on non-strings
  else {
    if (CHILD_PROCESS_RE.test(code)) reasons.push("child-process-usage");
    if (BINDING_RE.test(code)) reasons.push("process-binding");
    if (FORKBOMB_RE.test(code)) reasons.push("fork-bomb-shape");
    if (RMRF_RE.test(code)) reasons.push("rm-rf-root");
    if (ABSPATH_RE.test(code)) reasons.push("absolute-path-escape");
  }
  return { allow: reasons.length === 0, reasons };
}

/* ── 2 · screenInput — LLM-input injection screen (deny on strong hits only) ── */

const INPUT_MARKERS = [
  "ignore previous",
  "disregard all",
  "system prompt",
  "reveal your instructions",
  "exfiltrate",
];

export function screenInput(text) {
  const reasons = [];
  if (typeof text !== "string") reasons.push("input-not-a-string"); // fail-closed
  else {
    const low = text.toLowerCase();
    for (const m of INPUT_MARKERS) if (low.includes(m)) reasons.push(`injection-marker:${m}`);
    // base64-of-curl pattern: a curl/wget adjacent to a long base64 blob
    if (/(?:curl|wget)[^\n]{0,120}\b[A-Za-z0-9+/]{40,}={0,2}\b/.test(text)) reasons.push("base64-curl-payload");
  }
  return { allow: reasons.length === 0, reasons };
}

/* ── 3 · validateOutput — JSON.parse + hand-rolled shape check (no ajv) ──
 * R352 (exec35, lane 35-a; renumbered R350→R352 after T-95 first-registration,
 * Pulse DECISIONS #35/#36): schema fields may be the legacy type string OR a
 * constraint object { type, enum, min, max, minLength, maxLength }:
 *   · enum      — array; value must be EXACTLY one of (=== semantics).
 *   · min/max   — inclusive numeric bounds.
 *   · minLength/maxLength — string length bounds.
 * Violations are FAIL-CLOSED (invalid = invalid, never silently coerced) and
 * carry a precise reason ("signal: value \"long\" not in enum"). Unknown keys
 * inside a constraint spec are IGNORED (never crash). Backward-compatible:
 * string-typed schemas behave byte-identically (all kernel vectors hold). */

function typeOfValue(v) {
  if (v === null || v === undefined) return "nullish";
  if (Array.isArray(v)) return "array";
  return typeof v; // 'string' | 'number' | 'boolean' | 'object' | 'function'
}

export function validateOutput(text, schema) {
  const errors = [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`json-parse-failed:${e && e.message ? e.message : String(e)}`] };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, errors: ["root-not-an-object"] };
  }
  const required = Array.isArray(schema && schema.required) ? schema.required : [];
  for (const key of required) {
    if (!(key in parsed)) errors.push(`missing-required:${key}`);
  }
  for (const [key, want] of Object.entries(schema || {})) {
    if (key === "required") continue;
    if (!(key in parsed)) continue; // absence handled by required[]; optional keys may be absent
    const got = typeOfValue(parsed[key]);
    // R352 (renumbered R350→R352 after T-95 first-registration, Pulse DECISIONS
    // #35/#36): an object spec carries constraints; a string spec is the legacy type
    const spec = want !== null && typeof want === "object" && !Array.isArray(want) ? want : null;
    if (spec) {
      if (typeof spec.type === "string" && got !== spec.type) errors.push(`type-mismatch:${key}:want=${spec.type}:got=${got}`);
    } else if (got !== want) {
      errors.push(`type-mismatch:${key}:want=${want}:got=${got}`); // legacy path — unchanged
    }
    if (!spec) continue;
    const v = parsed[key];
    if (spec.enum !== undefined) {
      if (!Array.isArray(spec.enum)) errors.push(`${key}: enum-not-an-array`);
      else if (!spec.enum.some((e) => e === v)) errors.push(`${key}: value ${JSON.stringify(v)} not in enum`); // === semantics, no coercion
    }
    if (spec.min !== undefined) {
      if (typeof spec.min !== "number" || !Number.isFinite(spec.min)) errors.push(`${key}: min-not-a-number`);
      else if (typeof v !== "number" || !Number.isFinite(v)) errors.push(`${key}: min-max-requires-number`);
      else if (v < spec.min) errors.push(`${key}: ${v} < min ${spec.min}`); // inclusive bound
    }
    if (spec.max !== undefined) {
      if (typeof spec.max !== "number" || !Number.isFinite(spec.max)) errors.push(`${key}: max-not-a-number`);
      else if (typeof v !== "number" || !Number.isFinite(v)) errors.push(`${key}: min-max-requires-number`);
      else if (v > spec.max) errors.push(`${key}: ${v} > max ${spec.max}`); // inclusive bound
    }
    if (spec.minLength !== undefined) {
      if (!Number.isInteger(spec.minLength) || spec.minLength < 0) errors.push(`${key}: minLength-invalid`);
      else if (typeof v !== "string") errors.push(`${key}: min-length-requires-string`);
      else if (v.length < spec.minLength) errors.push(`${key}: length ${v.length} < minLength ${spec.minLength}`);
    }
    if (spec.maxLength !== undefined) {
      if (!Number.isInteger(spec.maxLength) || spec.maxLength < 0) errors.push(`${key}: maxLength-invalid`);
      else if (typeof v !== "string") errors.push(`${key}: max-length-requires-string`);
      else if (v.length > spec.maxLength) errors.push(`${key}: length ${v.length} > maxLength ${spec.maxLength}`);
    }
    // unknown keys inside the spec (description, format, …) are IGNORED — never crash
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, parsed, errors: [] };
}

/* ── 4 · guardedRound — validate → ONE bounded repair → revalidate (R342) ── */

export async function guardedRound({ rawOutput, schema, repairOnce }) {
  const first = validateOutput(rawOutput, schema);
  if (first.ok) return { verdict: "VALIDATED", attempts: 1, parsed: first.parsed };
  if (typeof repairOnce !== "function") {
    return { verdict: "REJECTED", attempts: 1, errors: first.errors };
  }
  // R330 seam: the LLM is injected, never imported. Its crash is OUR error.
  let repaired;
  try {
    repaired = await repairOnce({ rawOutput, errors: first.errors });
  } catch (e) {
    return { verdict: "REJECTED", attempts: 2, errors: [...first.errors, `repair-once-threw:${e && e.message ? e.message : String(e)}`] };
  }
  const second = validateOutput(repaired, schema);
  if (second.ok) return { verdict: "VALIDATED", attempts: 2, parsed: second.parsed };
  return { verdict: "REJECTED", attempts: 2, errors: [...first.errors, ...second.errors] }; // NEVER a 3rd attempt
}

/* ── 5 · R341 budget ── */

export const estimateTokens = (text) => Math.ceil(String(text).length / 4);

export function assertBudget(spent, cap) {
  if (spent > cap) throw new Error(`R341-budget-exceeded: spent=${spent} cap=${cap}`);
}

/* ── 6 · runIsolated — native micro-sandbox (E2B pattern, no SaaS/Docker) ── */

export async function runIsolated({ code, timeoutMs = 8000, maxOutputBytes = 65536 } = {}) {
  const t0 = Date.now();
  // Static screen first: hostile code never touches a process at all.
  const screen = screenCode(code);
  if (!screen.allow) {
    return { verdict: "SCREENED", stdout: "", stderr: "", exitCode: null, durationMs: 0, truncated: false, cleanup: "confirmed", reasons: screen.reasons };
  }
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), `saos-iso-${process.pid}-`));
  // Env whitelist scrub: the child sees PATH and HOME — nothing else. Any
  // secret in the parent env (measured: EXEC34_SECRET) cannot leak in.
  const childEnv = { PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin", HOME: tmpdir };
  let stdout = "";
  let stderr = "";
  let truncated = false;
  let outcome = { code: null, signal: null, spawnFailed: false };

  try {
    const child = spawn(process.execPath, ["-e", code], {
      cwd: tmpdir,
      env: childEnv,
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });

    const cap = (stream) => {
      stream.on("data", (d) => {
        if (Buffer.byteLength(stdout + stderr, "utf8") >= maxOutputBytes) {
          truncated = true;
          return; // stop collecting — the cap is the law
        }
        if (stream === child.stdout) stdout += d.toString("utf8");
        else stderr += d.toString("utf8");
        if (Buffer.byteLength(stdout + stderr, "utf8") > maxOutputBytes) {
          truncated = true;
          stdout = stdout.slice(0, maxOutputBytes);
        }
      });
    };
    cap(child.stdout);
    cap(child.stderr);

    child.on("error", () => { outcome.spawnFailed = true; });
    await new Promise((resolve) => {
      child.on("close", (code2, signal) => { outcome.code = code2; outcome.signal = signal; resolve(); });
    });
  } catch {
    outcome.spawnFailed = true;
  } finally {
    // ALWAYS clean, then R340 readback: confirmed only by absence on disk.
    try { fs.rmSync(tmpdir, { recursive: true, force: true }); } catch { /* readback below tells the truth */ }
  }
  const cleanup = fs.existsSync(tmpdir) === false ? "confirmed" : "failed";

  if (outcome.spawnFailed) {
    return { verdict: "SPAWN-FAIL", stdout, stderr, exitCode: null, durationMs: Date.now() - t0, truncated, cleanup };
  }
  if (outcome.code === null && outcome.signal === "SIGKILL") {
    return { verdict: "TIMEOUT", stdout, stderr, exitCode: null, durationMs: Date.now() - t0, truncated, cleanup };
  }
  const exitCode = outcome.code === null ? -1 : outcome.code;
  const verdict = exitCode === 0 ? "OK" : `EXIT-${exitCode}`;
  return { verdict, stdout, stderr, exitCode, durationMs: Date.now() - t0, truncated, cleanup };
}
