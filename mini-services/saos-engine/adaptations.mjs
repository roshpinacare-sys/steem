/**
 * adaptations.mjs — T-84 · THE FIRST LEARNING ACTUATOR (experience → behavior)
 *
 * WHY THIS EXISTS (measured, not assumed):
 *   exec-log.jsonl held 19 identical claim_reward_balance failures
 *   ("missing required posting authority", 2026-10-04T20:14 → 2026-10-05T13:05)
 *   while every cycle stayed green and nothing ever changed behavior. The
 *   learning engine (learning.mjs) recorded the lesson but had NO actuator:
 *   157 learn.done events, every one with tunings:[]. This module closes the
 *   loop on ONE rail, with full causality:
 *
 *   experience (measured broadcast rows) → evaluation (classification +
 *   evidence gates) → inference (the chain's own error NAMES the required
 *   authority) → adaptation (persisted behavioral state: signing role for an
 *   op) → future behavioral difference (signer.mjs partitions the trx by the
 *   learned role) → outcome measured on-chain → prediction scored → lesson
 *   VERIFIED or RETIRED (reverse lesson) → knowledge survives restart.
 *
 * AUTHORITY BOUNDARY — UNBREAKABLE BY DESIGN (operator directive: learning
 * must never imply privilege escalation):
 *   - an adaptation can ONLY pick the signing ROLE among key-material the
 *     credential already holds (id.wifs map in signer.mjs still gates this —
 *     ROLE-KEY-ABSENT retires the adaptation immediately);
 *   - it can NEVER touch: policy flags, caps, floors, custody, pause, keys,
 *     the think-gate, or any law. verifyRoles + thinkGate + RC-floor ALL still
 *     run on the FULL op set BEFORE any adaptation is consulted;
 *   - the only supported adaptation kind is "signing-role" — anything else is
 *     rejected at write time;
 *   - bounded: maxAttempts=3, TTL 48h for unverified hypotheses, max 1
 *     adaptation per op, noise gate (2+ identical deterministic failures);
 *   - fail-closed: corrupt/tampered state ⇒ adaptations IGNORED, base
 *     behavior unchanged, corruption journaled to events.jsonl.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const ADAPT_FILE = path.join(STATE, "adaptations.json");
const EVENTS_FILE = path.join(STATE, "events.jsonl");

export const ADAPT_LIMITS = { maxAttempts: 3, ttlMs: 48 * 3600 * 1000, noiseGate: 2, evidenceWindowMs: 36 * 3600 * 1000, allowedTargetRoles: ["posting", "active"] };
const KIND_WHITELIST = ["signing-role"];

/* Code-proven signing-role provenance per broadcast tag (verified 2026-10-05:
 * curator.mjs:304, army.mjs:143, promo.mjs:56 — all pass role:"posting";
 * everything else rides the executeAs default "active"). Used ONLY to
 * interpret legacy ok-rows that predate the T-84 role field. SELF-CORRECTING:
 * if a rail ever changes role, the inference produces an adaptation that
 * fails under the learned role → bounded retire within 3 attempts — the loop
 * itself catches the wrong lesson. New rows carry their own measured role. */
const TAG_ROLE_PROVENANCE = { "curate": "posting", "army-curate": "posting", "promo-daily": "posting" };
const rowRole = (r) => r?.role ?? TAG_ROLE_PROVENANCE[r?.tag] ?? "active";

const appendEvent = (v) => { try { fs.appendFileSync(EVENTS_FILE, JSON.stringify(v) + "\n"); } catch { /* journal best-effort */ } };

/* ── pure failure epistemology (selftest vectors live in selftest.mjs) ──── */

/** Classify a broadcast error the way an engineer would: transient vs
 * persistent vs authority vs configuration. The chain's own error text is the
 * teacher — "missing required posting authority" names BOTH the failure class
 * AND the fix (the authority that must sign). */
export function classifyFailure(errorText) {
  const s = String(errorText ?? "");
  if (!s.trim()) return { type: "none", deterministic: false };
  const m = s.match(/missing required (posting|active|owner)\s+authority/i);
  if (m) return { type: "authority-role", deterministic: true, requiredRole: m[1].toLowerCase() };
  if (/resource credit|rc floor/i.test(s)) return { type: "resource", deterministic: false };
  if (/timeout|abort|fetch failed|econn|socket|network|other side closed/i.test(s)) return { type: "transient", deterministic: false };
  if (/assert|invalid|malformed|parse/i.test(s)) return { type: "config", deterministic: true };
  return { type: "unknown", deterministic: false };
}

const sig = (err) => String(err ?? "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 160);

/** R209 §X: when a lesson retires, a RESOLVED rail contradiction must REOPEN —
 * the self-model may not keep saying "fixed" for a rail that just failed.
 * (closes the R209-d theatre finding: RESOLVED was a write without a reader
 * and a state that could never change back.) */
function reopenContradiction(contradictions, events, a, at, reason) {
  const c = contradictions.find((x) => x.id === `rail:${a.op}` && x.status === "RESOLVED");
  if (!c) return;
  c.status = "OPEN";
  c.reopenedAt = at;
  c.reopenReason = reason;
  events.push({ type: "contradiction.reopened", at, id: c.id, op: a.op, via: a.id, reason });
}

/** Pure integrity check: payload must hash to the recorded integrity. */
export function verifyStateIntegrity(parsed) {
  try {
    if (!parsed || parsed.schema !== "saos.adaptations.v1") return false;
    const h = crypto.createHash("sha256").update(JSON.stringify(parsed.payload)).digest("hex");
    return h === parsed.integrity;
  } catch { return false; }
}

const seal = (payload) => crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");

/* ── the pure planning core: rows + current state → next state ────────────
 * rows: exec-log broadcast rows {at, ok, txid, role?, ops:[names], error?}
 * Everything here is deterministic and clock-explicit (now passed in). */

export function planAdaptations(state, rows, now = new Date().toISOString()) {
  const nowMs = Date.parse(now);
  const prev = state && state.payload ? state.payload : { adaptations: [], contradictions: [], meta: {} };
  const adaptations = (prev.adaptations ?? []).map((a) => ({ ...a, evidence: [...(a.evidence ?? [])] }));
  const contradictions = [...(prev.contradictions ?? [])];
  const events = [];

  const rowsNorm = (rows ?? []).filter((r) => r && Array.isArray(r.ops) && r.ops.length).map((r) => ({ ...r, role: rowRole(r) }));

  /* 1 · score OUTCOMES of adaptations that already fired (prediction vs reality) */
  for (const a of adaptations) {
    /* R209 §X: VERIFIED is revisable too — a verified lesson is a BELIEF, never
     * a permanent authority. Downward revision mirrors the ACTIVE paths. */
    if (a.state !== "ACTIVE" && a.state !== "VERIFIED") continue;
    for (const r of rowsNorm) {
      const atMs = Date.parse(r.at ?? now);
      if (!(atMs >= Date.parse(a.createdAt))) continue;
      const ops = r.ops ?? [];
      if (!ops.includes(a.op)) continue;
      if ((r.role ?? "active") !== a.toRole) continue; // only rows signed UNDER the adaptation
      /* R209-a: only learning-authored rows may score — a caller that chose
       * its own role (roleSource:"caller") can never confirm or contradict a
       * lesson (closes the relabeling path). Legacy rows predate createdAt. */
      if (r.roleSource != null && r.roleSource !== "adapted") continue;
      if (r.ok === true) {
        if (a.state === "VERIFIED") break; // already confirmed — no event churn on re-scan
        const was = a.state;
        a.state = "VERIFIED";
        a.verified = { at: r.at, txid: r.txid ?? null, predictionScore: { expected: a.expected ?? "broadcast ok", actual: "ok", error: "none", class: "CONFIRMED" } };
        events.push({ type: "adaptation.verified", at: r.at, id: a.id, op: a.op, txid: r.txid ?? null, predictionClass: "CONFIRMED",
          belief: {
            before: `${was}(confidence ${a.confidence ?? "?"}): ${a.op} signs under ${a.toRole} → broadcast ok`,
            evidence: `broadcast ok under ${a.toRole}${r.txid ? ` (role-journaled exec row, tx ${String(r.txid).slice(0, 16)}…)` : ""}`,
            after: `VERIFIED: ${a.op} requires ${a.toRole} authority — confirmed by chain outcome`,
            why: "reality matched the standing prediction (sealed store, proposed from measured failures); expected-vs-actual scored by this evaluator from the role-journaled exec row",
          } });
        const c = contradictions.find((x) => x.id === `rail:${a.op}` && x.status === "OPEN");
        if (c) {
          c.status = "RESOLVED"; c.resolvedAt = r.at; c.resolution = `learned signing-role adaptation verified on-chain${r.txid ? ` (tx ${String(r.txid).slice(0, 16)}…)` : ""}`;
          events.push({ type: "contradiction.resolved", at: r.at, id: c.id, op: a.op, via: a.id, txid: r.txid ?? null });
        }
        break;
      }
      if (r.ok === false) {
        a.attempts = (a.attempts ?? 0) + 1;
        a.confidence = Math.max(0.1, (a.confidence ?? 0.5) - 0.2); // §X: confidence moves DOWN on contradiction — in BOTH states
        a.evidence.push({ at: r.at, txid: r.txid ?? null, error: String(r.error ?? "").slice(0, 160) });
        if (a.evidence.length > 5) a.evidence = a.evidence.slice(-5);
        const cls = classifyFailure(r.error);
        const wasRole = a.toRole;
        if (cls.type === "authority-role" && cls.requiredRole && cls.requiredRole !== a.toRole && ADAPT_LIMITS.allowedTargetRoles.includes(cls.requiredRole)) {
          /* reverse lesson, sharper: the chain named a DIFFERENT authority —
           * the hypothesis updates, the loop keeps learning */
          a.hypothesis = `${a.op} requires ${cls.requiredRole} authority (chain-named on retry — was ${wasRole})`;
          a.toRole = cls.requiredRole;
          events.push({ type: "adaptation.superseded", at: r.at, id: a.id, op: a.op, fromRole: wasRole, toRole: a.toRole, predictionClass: "CONTRADICTED",
            contradicted: { expected: `broadcast ok under ${wasRole}`, actual: String(r.error ?? "").slice(0, 120) } });
          break;
        }
        if (cls.type === "config" || cls.deterministic === true) {
          a.state = "RETIRED";
          a.retired = { at: r.at, reason: `new-failure-class:${cls.type}`, revisits: "if the chain contract or credential changes" };
          events.push({ type: "adaptation.retired", at: r.at, id: a.id, op: a.op, reason: a.retired.reason, predictionClass: "CONTRADICTED" });
          reopenContradiction(contradictions, events, a, r.at, `adaptation retired: ${a.retired.reason}`);
          break;
        }
        if (a.attempts >= ADAPT_LIMITS.maxAttempts) {
          a.state = "RETIRED";
          a.retired = { at: r.at, reason: "attempts-exhausted", revisits: "when the failure signature or the held keys change" };
          events.push({ type: "adaptation.retired", at: r.at, id: a.id, op: a.op, reason: a.retired.reason, predictionClass: "CONTRADICTED" });
          reopenContradiction(contradictions, events, a, r.at, `adaptation retired: ${a.retired.reason}`);
          break;
        }
      }
    }
    if (a.state === "ACTIVE" && nowMs > Date.parse(a.createdAt) + ADAPT_LIMITS.ttlMs) {
      a.state = "RETIRED";
      a.retired = { at: now, reason: "ttl-unverified", revisits: "the evaluator may re-propose from fresh evidence" };
      events.push({ type: "adaptation.retired", at: now, id: a.id, op: a.op, reason: a.retired.reason, predictionClass: "UNRESOLVED" });
    }
  }

  /* 2 · PROPOSE: newest failure group meeting every evidence gate */
  const failures = rowsNorm.filter((r) => r.ok === false && r.error);
  const groups = new Map();
  for (const r of failures) {
    const k = `${(r.ops ?? [])[0]}|${sig(r.error)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const successes = rowsNorm.filter((r) => r.ok === true);
  const sorted = [...groups.values()].sort((g1, g2) => Date.parse(g2[g2.length - 1].at ?? 0) - Date.parse(g1[g1.length - 1].at ?? 0));
  for (const g of sorted) {
    const row0 = g[0];
    const op = (row0.ops ?? [])[0];
    if (!op) continue;
    const cls = classifyFailure(row0.error);
    const existing = adaptations.find((a) => a.op === op && (a.state === "ACTIVE" || a.state === "VERIFIED"));
    if (existing) continue;
    const within = g.filter((r) => nowMs - Date.parse(r.at ?? 0) <= ADAPT_LIMITS.evidenceWindowMs);
    const noiseOk = cls.deterministic && within.length >= ADAPT_LIMITS.noiseGate;
    const heldEvidence = successes.some((r) => (r.role ?? "active") === cls.requiredRole);
    if (!noiseOk) continue;
    if (cls.type !== "authority-role" || !cls.requiredRole || cls.requiredRole === (row0.role ?? "active")) continue;
    /* authority boundary: learning may NEVER steer signing toward the owner
     * key (directive: intelligence must not imply privilege escalation) — a
     * chain demand for owner authority is declined with a reason, always. */
    if (!ADAPT_LIMITS.allowedTargetRoles.includes(cls.requiredRole)) {
      const decl = adaptations.find((a) => a.op === op && a.state === "DECLINED");
      if (!decl) {
        adaptations.push({
          id: `adapt-${op}-${cls.requiredRole}`, op, kind: "signing-role", state: "DECLINED",
          declinedReason: `chain requires ${cls.requiredRole} authority — outside the allowed learning target set (${ADAPT_LIMITS.allowedTargetRoles.join("/")}); operator decision required, the machine abstains`,
          fromRole: row0.role ?? "active", toRole: cls.requiredRole, evidence: g.slice(0, 3).map((r) => ({ at: r.at, error: String(r.error).slice(0, 120) })),
          createdAt: now, authorityImpact: "none — declined, nothing changes",
        });
        events.push({ type: "adaptation.declined", at: now, op, requiredRole: cls.requiredRole, reason: "role-outside-allowed-set" });
      }
      continue;
    }
    if (!heldEvidence) {
      const decl = adaptations.find((a) => a.op === op && a.state === "DECLINED");
      if (!decl) {
        adaptations.push({
          id: `adapt-${op}-${cls.requiredRole}`, op, kind: "signing-role", state: "DECLINED",
          declinedReason: `chain requires ${cls.requiredRole} authority for ${op} but no ok broadcast under ${cls.requiredRole} exists yet — bounded abstention, re-checked every evaluation`,
          fromRole: row0.role ?? "active", toRole: cls.requiredRole, evidence: g.slice(0, 3).map((r) => ({ at: r.at, error: String(r.error).slice(0, 120) })),
          createdAt: now, authorityImpact: "none — declined, nothing changes",
        });
        events.push({ type: "adaptation.declined", at: now, op, requiredRole: cls.requiredRole, reason: "required-role-key-not-demonstrably-held" });
      }
      continue;
    }
    adaptations.push({
      id: `adapt-${op}-${cls.requiredRole}`, op, kind: "signing-role", state: "ACTIVE",
      fromRole: row0.role ?? "active", toRole: cls.requiredRole,
      hypothesis: `this chain requires ${cls.requiredRole} authority to ${op}; the credential demonstrably holds it (${successes.filter((r) => r.role === cls.requiredRole).length} ok broadcasts under ${cls.requiredRole}) — re-sign under ${cls.requiredRole}`,
      expected: `broadcast ok for ${op} within ${ADAPT_LIMITS.maxAttempts} attempts`,
      confidence: within.length >= 4 ? 0.8 : 0.5,
      attempts: 0, maxAttempts: ADAPT_LIMITS.maxAttempts,
      createdAt: now, expiresAt: new Date(nowMs + ADAPT_LIMITS.ttlMs).toISOString(),
      evidence: g.slice(0, 3).map((r) => ({ at: r.at, txid: r.txid ?? null, error: String(r.error).slice(0, 120) })),
      authorityImpact: "none — same credential, same policy, same gates (think-gate/verifyRoles/RC-floor all ran before this is consulted)",
    });
    events.push({ type: "adaptation.proposed", at: now, id: `adapt-${op}-${cls.requiredRole}`, op, fromRole: row0.role ?? "active", toRole: cls.requiredRole, failures: within.length });
  }

  /* 3 · contradiction surfacing (self-model honesty — measured, not hidden) */
  for (const g of groups.values()) {
    const op = (g[0].ops ?? [])[0];
    if (g.length < 5) continue;
    const id = `rail:${op}`;
    let c = contradictions.find((x) => x.id === id);
    if (!c) {
      contradictions.push({ id, claim: "cycle health=ok while a rail repeatedly fails", reality: `${op} broadcast failed ×${g.length} with one deterministic signature`, evidence: `${g.length} exec-log rows, last ${g[g.length - 1].at}`, status: "OPEN", detectedAt: now });
      events.push({ type: "contradiction.opened", at: now, id, op, failures: g.length });
    }
  }

  const meta = { ...(prev.meta ?? {}), lastEvalAt: now, evalCount: (prev.meta?.evalCount ?? 0) + 1 };
  return { nextState: { payload: { adaptations, contradictions, meta } }, events, summary: {
    active: adaptations.filter((a) => a.state === "ACTIVE").map((a) => a.id),
    verified: adaptations.filter((a) => a.state === "VERIFIED").map((a) => a.id),
    retired: adaptations.filter((a) => a.state === "RETIRED").map((a) => a.id),
    declined: adaptations.filter((a) => a.state === "DECLINED").map((a) => a.id),
  } };
}

/* ── IO layer ──────────────────────────────────────────────────────────── */

function readAdaptFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ADAPT_FILE, "utf8"));
    return verifyStateIntegrity(parsed) ? parsed : null; // fail-closed on tamper
  } catch { return null; }
}

function writeAdaptFile(payload) {
  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(ADAPT_FILE, JSON.stringify({ schema: "saos.adaptations.v1", updatedAt: new Date().toISOString(), integrity: seal(payload), payload }, null, 2));
}

export function adaptationState() {
  const s = readAdaptFile();
  return s ? { ...s, intact: true } : { intact: false, payload: { adaptations: [], contradictions: [], meta: {} } };
}

/** The executor consults this for EVERY op. Corrupt/absent state ⇒ baseRole. */
export function resolveAdaptedRole(opName, baseRole) {
  return resolveAdaptedRoleFrom(adaptationState().payload, opName, baseRole);
}

export function resolveAdaptedRoleFrom(payload, opName, baseRole, now = new Date().toISOString()) {
  try {
    const a = (payload?.adaptations ?? []).find((x) => x.op === opName && x.kind === "signing-role" && (x.state === "VERIFIED" || (x.state === "ACTIVE" && Date.parse(now) <= Date.parse(x.expiresAt ?? 0))));
    if (!a) return baseRole;
    /* F2 hardening: the seal proves the file was written by THIS machine, but
     * defense-in-depth says even a validly-sealed store can never steer
     * signing outside the allowed role set (owner is NEVER reachable). */
    if (!ADAPT_LIMITS.allowedTargetRoles.includes(a.toRole)) return baseRole;
    return a.toRole;
  } catch { return baseRole; } // fail-closed on any malformed payload
}

/** Immediate outcome path for terminations that never reach the wire
 * (ROLE-KEY-ABSENT): retire the adaptation with a reason — bounded abstention.
 * F1 fix: applies to VERIFIED too — a verified lesson whose key has vanished
 * must retire and JOURNAL, never silently skip ops forever. */
export function noteAdaptationOutcome(opName, { verdict, at = new Date().toISOString() } = {}) {
  if (!opName || verdict !== "ROLE-KEY-ABSENT") return false;
  const s = readAdaptFile();
  if (!s) return false;
  const a = (s.payload.adaptations ?? []).find((x) => x.op === opName && (x.state === "ACTIVE" || x.state === "VERIFIED"));
  if (!a) return false;
  const was = a.state;
  a.state = "RETIRED";
  a.retired = { at, reason: "required-role-key-not-held", revisits: "when the credential gains the key", previously: was };
  writeAdaptFile(s.payload);
  appendEvent({ type: "adaptation.retired", at, id: a.id, op: opName, reason: a.retired.reason, previously: was, predictionClass: "UNRESOLVED" });
  return true;
}

/* R209 · PRE-ACTION PREDICTION (proof-gap closure, mission §III/§VI):
 * before an ADAPTED partition is signed, the machine states — in the
 * append-only journal — exactly what it expects, so prediction_time <
 * action_time is provable from the journal alone and the evaluator can
 * classify CONFIRMED/CONTRADICTED later without ever rewriting the
 * prediction. Best-effort: a journaling failure never kills signing. */
export function recordPrediction(opNames, baseRole, adaptedRole, now = new Date().toISOString()) {
  try {
    const s = readAdaptFile();
    const op = opNames?.[0] ?? null;
    const a = s ? (s.payload.adaptations ?? []).find((x) => x.op === op && x.kind === "signing-role" && (x.state === "VERIFIED" || x.state === "ACTIVE")) : null;
    const rec = {
      type: "prediction.recorded", at: now,
      op, ops: opNames ?? [], baseRole, adaptedRole,
      adaptationId: a?.id ?? null, adaptationState: a?.state ?? null,
      prediction: {
        expectedAuthority: adaptedRole,
        expectedOperation: op,
        expectedExecutionPath: "executeAs→partitionByAdaptedRole(learned)→buildTx→broadcastTx",
        expectedOutcome: a?.expected ?? `broadcast ok for ${op}`,
        failureModeIfWrong: "bounded: ≤3 attempts then RETIRED; deterministic new-failure-class → RETIRED; chain names a different required authority → hypothesis superseded; ROLE-KEY-ABSENT → immediate RETIRED",
        hypothesis: a?.hypothesis ?? null,
        confidence: a?.confidence ?? null,
      },
      provenance: { source: "adaptations.json (integrity-sealed)", journal: "events.jsonl (append-only)" },
    };
    appendEvent(rec);
    return rec;
  } catch { return null; } // instrumentation must never kill signing
}

/** Called from the learning step each cycle. Persists only on change. */
export function evaluateAdaptations({ now = new Date().toISOString(), execLines = null } = {}) {
  let rows = execLines;
  if (!rows) {
    try {
      rows = fs.readFileSync(path.join(STATE, "exec-log.jsonl"), "utf8").trim().split("\n").filter(Boolean).slice(-60)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch { rows = []; }
  }
  const cur = readAdaptFile();
  const { nextState, events, summary } = planAdaptations(cur, rows, now);
  const changed = JSON.stringify(cur?.payload ?? null) !== JSON.stringify(nextState.payload);
  if (changed) writeAdaptFile(nextState.payload);
  for (const e of events) appendEvent(e);
  return { changed, summary, events };
}
