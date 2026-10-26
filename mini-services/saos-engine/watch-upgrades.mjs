/**
 * watch-upgrades.mjs — exec36 · lane 36-b · THE WATCHTOWER UPGRADES.
 *
 * LAW PROVENANCE — exec36 watchtower-upgrade directive: land the 33-b
 * protocol-research harvest (research/exec33/33-b-protocol10.md) as ONE
 * self-healing-watchtower upgrade module. Extends the R342 self-heal
 * mandate ("validate → repair ONCE → revalidate → honest verdict") with
 * a BRAIN before hands, honest stops, and typed audit. Paper/infra layer
 * ONLY: zero keys, zero value movement, zero broadcasts; triage is
 * READ-ONLY ADVISORY by construction — it classifies, it never executes,
 * it never drops a failing surface from the report.
 *
 * THREE PATTERNS (33-b file:line refs; harvested as code, not prose):
 *   · SWE-bench/SWE-bench `harness/infra_failure.py` — post-hoc, READ-ONLY,
 *     ADVISORY classification of "the environment broke" vs "the patch was
 *     wrong" vs "genuinely ambiguous", signature-matched from logs the
 *     harness already writes, and it NEVER DROPS an instance (the scoring
 *     denominator never changes). Harvested here as triageFailure +
 *     triageWatchState — R355-CANDIDATE (triage BEFORE self-heal).
 *   · SWE-agent/SWE-agent `sweagent/agent/reviewer.py` — the retry loop
 *     governed by `cost_limit` + `min_budget_for_new_attempt`, exiting with
 *     TRUTHFUL reasons ("exceeds cost limit…", "not enough budget left…").
 *     Harvested here as createRetryGovernor — R356-CANDIDATE (budget-
 *     governed retries; the min-budget check runs BEFORE spawning a new
 *     attempt, never after; every stop states WHY it stopped).
 *   · elizaOS/eliza `packages/core/src/memory.ts` — typed Memory records:
 *     MemoryType tags, scope private/shared, factory functions + type
 *     guards so storage/retrieval branch on record KIND, not prose.
 *     Harvested here as the Receipt factory + guards + append-only
 *     validated ledger — R357-CANDIDATE (typed receipts over the R303
 *     git-as-memory / R341 atomic-receipt lineage).
 *
 * R-NUMBER HONESTY: R355/R356/R357 are CANDIDATES ("registry pending
 * R355+"). Registration is grep-before-write by the registry lanes
 * (fleet law #21 / R337 CAS); this lane does NOT self-register. 33-b's
 * original R338-R342 candidate block was superseded in-house (R340
 * readback, R341 budget, R342 self-heal are exec34/35 landed laws — see
 * kernel-isolation.mjs header); the PATTERNS kept their identity, only
 * the candidate numbers moved to the next free block.
 *
 * ── A · TRIAGE (R355-CANDIDATE) — the brain, not more hands ──────────────
 * triageFailure({surface, verdict, reason, httpCode}) classifies a DEGRADED
 * surface BEFORE any repair action. STATIC RULES (documented, deterministic,
 * no clock, no network, no execution of the surface — read-only by
 * construction; the input object is never mutated; the result is frozen):
 *   1. reason carries auth/scope signatures (auth, unauthorized, forbidden,
 *      permission, scope, credential, token)            → ENVIRONMENT high
 *      (infrastructure: our code cannot fix someone else's gate)
 *   2. reason carries OUR-ARTIFACT signatures (shape-missing,
 *      shape-missing-timestamp, unparseable, json-parse, parse error,
 *      invalid json, missing-required, type-mismatch, not in enum,
 *      want=)                                           → CODE high
 *      (shape-validation/parse failures are our own artifacts — lawful
 *      repair candidates under the R342 gate)
 *   3. reason carries network/DNS signatures (network, unreachable,
 *      enotfound, econnrefused, econnreset, getaddrinfo, dns, eai_again)
 *                                                      → ENVIRONMENT high
 *   4. httpCode is 4xx (400-499) except 408            → ENVIRONMENT high
 *      (HTTP-4xx-api: the remote gate refused us — not a code bug)
 *   5. timeout signatures (timeout, timed out) OR httpCode 408 OR 5xx
 *      (>=500) OR probe-error / partial-response signatures → AMBIGUOUS
 *      (could be either — SWE-bench's exact tier; ambiguous is never
 *      auto-retried, it is observed then escalated)
 *   6. verdict DEGRADED / STALE without a stronger signature → AMBIGUOUS low
 *   7. ANYTHING ELSE (including empty/garbage input)   → AMBIGUOUS low with
 *      basis "unrecognized-signature:fail-closed" — NEVER a silent OK,
 *      NEVER a DROP: every failing surface keeps its place in the report
 *      (SWE-bench: the denominator never changes).
 * advisedAction mapping (declared, frozen): ENVIRONMENT → "escalate",
 * CODE → "lawful-repair-candidate", AMBIGUOUS → "observe-then-escalate".
 * Rule order is the tie-break law: auth beats code beats network beats
 * httpCode beats ambiguous — the strongest measured cause wins, and the
 * basis names the rule that fired.
 *
 * ── B · RETRY GOVERNOR (R356-CANDIDATE) — honest stops ───────────────────
 * createRetryGovernor({maxAttempts=3, costPerAttemptMs, budgetMs,
 * minBudgetForNewAttemptMs}) — SWE-agent's reviewer loop, exactly:
 *   · every stop is TRUTHFUL: {ok, attempts, spentMs, exitReason} with
 *     exitReason ∈ SUCCEEDED | BUDGET-EXHAUSTED | MAX-ATTEMPTS |
 *     MIN-BUDGET-NOT-MET (the four lifecycle stops) — never a bare false.
 *     One FIFTH reason exists OUTSIDE the lifecycle enum: ACTION-INVALID —
 *     a pre-flight refusal (non-callable action / negative config) that
 *     attempts NOTHING and honestly says so (fail-closed, never a fake
 *     lifecycle stop, never a throw past the boundary).
 *   · the min-budget check runs BEFORE a new attempt is spawned (SWE-agent's
 *     exact rule): remaining = budgetMs − spentMs; remaining ≤ 0 →
 *     BUDGET-EXHAUSTED; 0 < remaining < minBudgetForNewAttemptMs →
 *     MIN-BUDGET-NOT-MET (minBudget defaults to costPerAttemptMs when both
 *     are set). The FIRST attempt is pre-flight checked too: a governor
 *     never starts what it cannot afford.
 *   · between attempts: exponential backoff base*2^(n-1) CAPPED at 30s
 *     (MAX_BACKOFF_MS); the sleep is injectable (sleepImpl) — the selftest
 *     seam (surface-watch fetchImpl convention) so tests stay instant.
 *   · an attempt FAILS when the action throws OR returns exactly false;
 *     any other normal return is a success. Optional isSuccess(result)
 *     predicate for {ok:…}-shaped actions. Thrown errors are recorded
 *     truthfully in errors[] (stringified, capped) — never swallowed.
 *   · spentMs accumulates the DECLARED costPerAttemptMs per spawned attempt
 *     (SWE-agent counts budget in declared attempt-cost units); measuredMs
 *     carries the real wall time alongside it for honesty. Zero-cost
 *     actions with a zero budget make BUDGET-EXHAUSTED reachable at zero
 *     attempts — the governor refuses to run on vapor.
 *
 * ── C · TYPED RECEIPTS (R357-CANDIDATE) — eliza taxonomy over R303 ───────
 * Receipt = { schemaVersion: 1, kind, scope, subject, at, body } — frozen
 * at construction. kind ∈ frozen enum: MEASUREMENT | REPAIR | TRIAGE |
 * ESCALATION | LEASE | SNAPSHOT. scope ∈ private | shared (default
 * PRIVATE — fail-closed: sharing must be explicit, never accidental).
 * makeReceipt CONSTRUCTION IS LOUD (TypeError with the precise reason —
 * a factory that returns junk defeats typing); the PERSISTENCE boundary
 * is honest-refusal: appendReceiptLedger validates every line with
 * isReceipt and REFUSES non-receipts without writing a byte. Ledger =
 * append-only jsonl at mini-services/saos-engine/state/watch-receipts.jsonl
 * (cabinet.mjs path convention, repoRoot + engine state dir), one atomic
 * appendFileSync per receipt (R341 atomic-receipt lineage), R340 readback
 * on every append. readReceipts parses every line, COUNTS corrupt lines
 * honestly (never crashes, never silently drops the count) and filters by
 * kind and since (ISO timestamp).
 *
 * ADDITIVE SEAM: triageWatchState(watchDoc) is a PURE function future
 * beats/CI can call WITHOUT touching surface-watch.mjs — surface-watch.mjs,
 * ci-cycle.mjs and every other module stay byte-untouched by this lane.
 *
 * Zero deps: node:fs, node:path only. Zero keys. Zero network. Zero clocks
 * in the classification path (the ledger readback and `at` defaults are the
 * only wall-clock touchpoints, both injectable by passing explicit values).
 */

import fs from "node:fs";
import path from "node:path";

/* ── 0 · shared constants (frozen — house enum law) ─────────────────────── */

export const TRIAGE_CLASSES = Object.freeze(["ENVIRONMENT", "CODE", "AMBIGUOUS", "NONE"]);
export const TRIAGE_ACTIONS = Object.freeze({
  ENVIRONMENT: "escalate",
  CODE: "lawful-repair-candidate",
  AMBIGUOUS: "observe-then-escalate",
  NONE: "none",
});
export const GOVERNOR_STOP_REASONS = Object.freeze(["SUCCEEDED", "BUDGET-EXHAUSTED", "MAX-ATTEMPTS", "MIN-BUDGET-NOT-MET"]);
export const MAX_BACKOFF_MS = 30000;
export const RECEIPT_KINDS = Object.freeze(["MEASUREMENT", "REPAIR", "TRIAGE", "ESCALATION", "LEASE", "SNAPSHOT"]);
export const RECEIPT_SCOPES = Object.freeze(["private", "shared"]);
export const RECEIPT_SCHEMA_VERSION = 1;
export const WATCH_RECEIPTS_REL = path.join("mini-services", "saos-engine", "state", "watch-receipts.jsonl");

/* ── 1 · triageFailure — READ-ONLY ADVISORY classification (R355) ───────── */

/* substring signatures (SWE-bench style log-signature matching — word
 * boundaries would miss "unauthorized"/"timeouts"/"ENOTFOUND" forms) */
const ENV_AUTH_RE = /auth|unauthorized|forbidden|permission|scope|credential|token/;
const CODE_OWN_RE = /shape-missing|unparseable|json-parse|parse error|invalid json|missing-required|type-mismatch|not in enum|want=/;
const NET_DNS_RE = /network|unreachable|enotfound|econnrefused|econnreset|getaddrinfo|dns|eai_again/;
const TIMEOUT_RE = /timeout|timed out|timed-out/;
const SOFT_RE = /(probe-error|partial|no-clock-anchor|conclusion:cancelled|artery-unmeasured|probe-no-observation)/;
const HTTP_CODE_RE = /\bhttp-(\d{3})\b/;

const freeze = (x) => Object.freeze(x);

export function triageFailure(failure = {}) {
  const reason = typeof failure?.reason === "string" ? failure.reason : "";
  const verdict = typeof failure?.verdict === "string" ? failure.verdict : "";
  const httpParsed = failure?.httpCode != null ? Number(failure.httpCode) : null;
  const httpCode = httpParsed != null && Number.isFinite(httpParsed) ? Math.trunc(httpParsed) : (reason.match(HTTP_CODE_RE) ? Number(reason.match(HTTP_CODE_RE)[1]) : null);
  const low = reason.toLowerCase();

  let out;
  if (low && ENV_AUTH_RE.test(low)) {
    out = { "class": "ENVIRONMENT", confidence: "high", basis: "auth-or-scope signature in reason (rule 1) — infrastructure gate, not our code" };
  } else if (low && CODE_OWN_RE.test(low)) {
    out = { "class": "CODE", confidence: "high", basis: "shape/parse signature in reason (rule 2) — our own artifact, lawful repair candidate" };
  } else if (low && NET_DNS_RE.test(low)) {
    out = { "class": "ENVIRONMENT", confidence: "high", basis: "network/DNS signature in reason (rule 3) — infrastructure" };
  } else if (httpCode != null && httpCode >= 400 && httpCode <= 499 && httpCode !== 408) {
    out = { "class": "ENVIRONMENT", confidence: "high", basis: `http-4xx-api ${httpCode} (rule 4) — remote gate refused, not a code bug` };
  } else if ((low && TIMEOUT_RE.test(low)) || httpCode === 408 || (httpCode != null && httpCode >= 500) || (low && SOFT_RE.test(low))) {
    out = { "class": "AMBIGUOUS", confidence: "high", basis: "timeout/5xx/probe-error signature (rule 5) — could be environment or code; never auto-retried" };
  } else if (verdict === "DEGRADED" || verdict === "STALE") {
    out = { "class": "AMBIGUOUS", confidence: "low", basis: `verdict ${verdict} without a stronger signature (rule 6)` };
  } else {
    out = { "class": "AMBIGUOUS", confidence: "low", basis: "unrecognized-signature:fail-closed (rule 7) — never a silent OK, never a drop" };
  }
  return freeze({ "class": out["class"], confidence: out.confidence, basis: out.basis, advisedAction: TRIAGE_ACTIONS[out["class"]] });
}

/* ── 2 · createRetryGovernor — budget-governed, truthful exits (R356) ───── */

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clampBackoff = (base, n) => Math.min(MAX_BACKOFF_MS, Math.max(0, Math.trunc(base)) * 2 ** Math.max(0, n - 1));

export function createRetryGovernor(opts = {}) {
  const cfg = {
    maxAttempts: Number.isFinite(Number(opts.maxAttempts)) ? Math.trunc(Number(opts.maxAttempts)) : 3,
    costPerAttemptMs: opts.costPerAttemptMs == null ? null : Number(opts.costPerAttemptMs),
    budgetMs: opts.budgetMs == null ? null : Number(opts.budgetMs),
    minBudgetForNewAttemptMs: opts.minBudgetForNewAttemptMs == null ? null : Number(opts.minBudgetForNewAttemptMs),
    backoffBaseMs: Number.isFinite(Number(opts.backoffBaseMs)) ? Number(opts.backoffBaseMs) : 100,
    sleepImpl: typeof opts.sleepImpl === "function" ? opts.sleepImpl : defaultSleep,
  };
  const budgetOn = cfg.costPerAttemptMs != null && cfg.budgetMs != null;
  const minBudget = cfg.minBudgetForNewAttemptMs != null ? cfg.minBudgetForNewAttemptMs : (budgetOn ? cfg.costPerAttemptMs : null);

  const stop = (ok, attempts, spentMs, exitReason, extra) =>
    freeze({ ok, attempts, spentMs, exitReason, ...extra });

  return freeze({
    config: freeze({ ...cfg, budgetOn, minBudgetForNewAttemptMs: minBudget }),
    async run(action, runOpts = {}) {
      const label = typeof runOpts?.label === "string" ? runOpts.label : "governed-action";
      const isSuccess = typeof runOpts?.isSuccess === "function" ? runOpts.isSuccess : null;
      const started = Date.now();
      if (typeof action !== "function") {
        return stop(false, 0, 0, "ACTION-INVALID", { label, errors: ["action-not-callable — pre-flight refusal, nothing attempted"], measuredMs: 0 });
      }
      if ((cfg.costPerAttemptMs != null && !(cfg.costPerAttemptMs >= 0)) || (cfg.budgetMs != null && !(cfg.budgetMs >= 0)) || (cfg.minBudgetForNewAttemptMs != null && !(cfg.minBudgetForNewAttemptMs >= 0))) {
        return stop(false, 0, 0, "ACTION-INVALID", { label, errors: ["negative-budget-config — pre-flight refusal, nothing attempted"], measuredMs: 0 });
      }
      let attempts = 0;
      let spentMs = 0;
      const errors = [];
      /* eslint-disable no-constant-condition */
      while (true) {
        if (attempts >= cfg.maxAttempts) return stop(false, attempts, spentMs, "MAX-ATTEMPTS", { label, errors, measuredMs: Date.now() - started });
        if (budgetOn) {
          const remaining = cfg.budgetMs - spentMs;
          if (remaining <= 0) return stop(false, attempts, spentMs, "BUDGET-EXHAUSTED", { label, errors, measuredMs: Date.now() - started });
          if (minBudget != null && remaining < minBudget) return stop(false, attempts, spentMs, "MIN-BUDGET-NOT-MET", { label, errors, measuredMs: Date.now() - started, remainingMs: remaining });
        }
        if (attempts >= 1) await cfg.sleepImpl(clampBackoff(cfg.backoffBaseMs, attempts));
        const attemptStart = Date.now();
        attempts += 1;
        if (budgetOn) spentMs += cfg.costPerAttemptMs;
        let result;
        try {
          result = await action({ attempt: attempts, label });
          if (isSuccess ? isSuccess(result) === true : result !== false) {
            return stop(true, attempts, spentMs, "SUCCEEDED", { label, result, errors, measuredMs: Date.now() - started, lastAttemptMs: Date.now() - attemptStart });
          }
          errors.push("attempt-returned-false");
        } catch (e) {
          errors.push(String(e && e.message ? e.message : e).slice(0, 200));
        }
      }
    },
  });
}

/* ── 3 · typed receipts — eliza taxonomy, factory + guards (R357) ───────── */

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

export function makeReceipt({ kind, scope, subject, at, body } = {}) {
  if (!RECEIPT_KINDS.includes(kind)) throw new TypeError(`makeReceipt: kind-not-in-enum: ${String(kind)}`);
  const sc = scope == null ? "private" : scope; // fail-closed default: private
  if (!RECEIPT_SCOPES.includes(sc)) throw new TypeError(`makeReceipt: scope-not-in-enum: ${String(sc)}`);
  if (typeof subject !== "string" || !subject.trim()) throw new TypeError("makeReceipt: subject-required-nonempty");
  const stamp = at == null ? new Date().toISOString() : at;
  if (typeof stamp !== "string" || !ISO_RE.test(stamp) || Number.isNaN(Date.parse(stamp))) throw new TypeError("makeReceipt: at-must-be-iso-8601-utc");
  if (body == null) throw new TypeError("makeReceipt: body-required (present, may be empty object)");
  return freeze({ schemaVersion: RECEIPT_SCHEMA_VERSION, kind, scope: sc, subject, at: stamp, body: freeze(body) });
}

export function isReceipt(x) {
  return !!x && typeof x === "object" && !Array.isArray(x) &&
    x.schemaVersion === RECEIPT_SCHEMA_VERSION &&
    RECEIPT_KINDS.includes(x.kind) &&
    RECEIPT_SCOPES.includes(x.scope) &&
    typeof x.subject === "string" && !!x.subject.trim() &&
    typeof x.at === "string" && ISO_RE.test(x.at) && !Number.isNaN(Date.parse(x.at)) &&
    "body" in x && x.body != null;
}

export function isKind(x, kind) {
  return isReceipt(x) && RECEIPT_KINDS.includes(kind) && x.kind === kind;
}

const receiptsPath = (repoRoot) => path.join(String(repoRoot ?? ""), WATCH_RECEIPTS_REL);

export function appendReceiptLedger(repoRoot, receipt) {
  try {
    if (!isReceipt(receipt)) return { ok: false, error: "not-a-receipt (R341 lineage: refused without writing)", path: receiptsPath(repoRoot) };
    const file = receiptsPath(repoRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(receipt) + "\n"); // one atomic line append
    // R340 readback: the appended line parses back equal to what we wrote
    const raw = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
    const last = JSON.parse(raw[raw.length - 1]);
    if (!isReceipt(last) || last.kind !== receipt.kind || last.subject !== receipt.subject || last.at !== receipt.at) {
      return { ok: false, error: "readback-mismatch", path: file };
    }
    return { ok: true, at: receipt.at, kind: receipt.kind, path: file, lines: raw.length };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e).slice(0, 200), path: receiptsPath(repoRoot) };
  }
}

export function readReceipts(repoRoot, filter = {}) {
  try {
    const file = receiptsPath(repoRoot);
    if (!fs.existsSync(file)) return { ok: true, receipts: [], total: 0, corrupt: 0, empty: true, path: file };
    const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
    let corrupt = 0;
    const all = [];
    for (const line of lines) {
      try {
        const r = JSON.parse(line);
        if (isReceipt(r)) all.push(r);
        else corrupt += 1;
      } catch {
        corrupt += 1; // counted honestly, never crashes, never silently dropped
      }
    }
    let out = all;
    if (filter.kind != null) out = out.filter((r) => r.kind === filter.kind);
    if (filter.since != null) {
      const sinceMs = Date.parse(filter.since);
      out = Number.isFinite(sinceMs) ? out.filter((r) => Date.parse(r.at) >= sinceMs) : out;
    }
    return { ok: true, receipts: out, total: all.length, corrupt, empty: all.length === 0, path: file };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e).slice(0, 200), receipts: [], total: 0, corrupt: 0, path: receiptsPath(repoRoot) };
  }
}

/* ── 4 · triageWatchState — ADDITIVE pure seam over the watch doc ───────── */

export function triageWatchState(watchDoc) {
  try {
    if (!watchDoc || typeof watchDoc !== "object" || !Array.isArray(watchDoc.targets)) {
      return freeze({ ok: false, error: "doc-shape-invalid (targets[] missing) — honest refusal, never a fabricated triage", perTarget: [], summary: null });
    }
    const perTarget = watchDoc.targets.map((t) => {
      const target = t && typeof t === "object" ? t : {};
      const id = typeof target.id === "string" ? target.id : "unnamed-target";
      const verdict = typeof target.verdict === "string" ? target.verdict : "";
      let triage = null;
      if (verdict !== "OK") {
        triage = triageFailure({ surface: id, verdict, reason: typeof target.reason === "string" ? target.reason : "", httpCode: null });
      }
      return { id, verdict, triage };
    });
    const summary = {
      total: perTarget.length,
      ok: perTarget.filter((p) => p.verdict === "OK").length,
      triaged: perTarget.reduce((acc, p) => {
        if (p.triage) acc[p.triage.class] = (acc[p.triage.class] ?? 0) + 1;
        return acc;
      }, {}),
      watchVerdict: typeof watchDoc.verdict === "string" ? watchDoc.verdict : null,
    };
    return freeze({ ok: true, perTarget, summary });
  } catch (e) {
    return freeze({ ok: false, error: String(e && e.message ? e.message : e).slice(0, 200), perTarget: [], summary: null });
  }
}
