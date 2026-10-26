/* SAOS CABINET (exec35, lane 35-a) — the deterministic multi-persona paper
 * decision machinery, mapped onto OUR kernel (R343) + OUR own paper ledger.
 *
 * LAW PROVENANCE — exec35 cabinet law directive; registry number R351
 * (registered, Pulse DECISIONS #36; the R352 validateOutput enum/range
 * extension — renumbered R350→R352 after T-95 first-registration (Pulse
 * DECISIONS #35/#36) — is the registered kernel upgrade this module parses
 * through). Pattern source:
 * the ai-hedge-fund v2.5 blueprint (34-c dossier, MIT, harvest table H1-H10)
 * re-built sovereignty-native:
 *   · persona = declared approach metadata ONLY (R331 roster-truthfulness:
 *     personas exist in code, never invented at runtime); machinery is
 *     deterministic code below.
 *   · R330: the LLM never lives inside the deterministic graph and is NEVER
 *     imported — it enters ONLY as the injected `respond({personaId, prompt})`
 *     async seam (a real LLM, a fixture, or anything; the cabinet never
 *     knows). With no injected respond the cabinet does not run — honest
 *     {ok:false}, never a fabricated opinion.
 *   · LOCKED FAILURE CONTRACT: data errors propagate, LLM errors ABSTAIN
 *     (never fabricate), every persisted decision is hash-chained.
 *   · enum+range parse BEFORE use through kernel validateOutput (R352;
 *     renumbered R350→R352 after T-95 first-registration, Pulse DECISIONS #35/#36):
 *     signal ∈ {bullish,neutral,bearish}, confidence ∈ [0,100]; invalid ⇒
 *     ONE bounded repair round (max 2 total attempts, never 3), still
 *     invalid ⇒ abstain record.
 *   · deterministic blend: abstentions excluded and counted; value =
 *     sign × confidence/100; netConviction ∈ [-1,1].
 *   · "conviction requests, risk disposes": hard non-negotiable risk clamps,
 *     every application emits a ClampEvent; killSwitch ⇒ FORCED HOLD.
 *   · append-only hash-chained PAPER decision ledger (own state dir only),
 *     verified by fold; replay is a VERIFICATION, never a re-execution, and
 *     re-reads the kill-switch INSIDE the replay.
 *
 * PAPER-ONLY LAW: verdicts are paper strings on our own state. This module
 * NEVER reads broker APIs, NEVER produces real orders, NEVER touches keys,
 * NEVER moves value, NEVER broadcasts, ZERO network calls anywhere. The
 * ledger lives at mini-services/saos-engine/state/cabinet-decisions.jsonl —
 * our own git-as-memory state, nothing else.
 *
 * Zero deps: node:fs, node:path, node:crypto only + the local kernel.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { validateOutput } from "./kernel-isolation.mjs";

export const CABINET_IDENTITY = "exec35-engine-lane@agents.roshpinacare-sys";
export const CABINET_LAW_SOURCE =
  "exec35 cabinet law directive (R351 registered, Pulse DECISIONS #36): ai-hedge-fund blueprint on the LOCAL kernel — " +
  "injected-respond-only LLM seam (R330), declared-persona roster (R331), deterministic blend, risk clamps " +
  "'conviction requests, risk disposes', hash-chained append-only PAPER ledger, kill-switch read at decision " +
  "time AND inside replay; paper-only, own-ledger, zero keys, zero brokers, zero value, zero broadcasts";

export const CABINET_LEDGER_REL = path.join("mini-services", "saos-engine", "state", "cabinet-decisions.jsonl");
export const KILLSWITCH_REL = path.join("mini-services", "saos-engine", "state", "cabinet-killswitch.json");
export const GENESIS_HASH = "GENESIS";

/* ── 1 · PERSONAS — the frozen roster (R331: declared in code, never runtime) */
const SIGNAL_ENUM = Object.freeze(["bullish", "neutral", "bearish"]);
const CONFIDENCE_RANGE = Object.freeze([0, 100]);

export const PERSONAS = Object.freeze([
  Object.freeze({
    id: "technical",
    approach: "momentum/trend-reading: price structure, trend persistence, volume confirmation — paper chart-reading of OUR OWN state only",
    signalEnum: SIGNAL_ENUM,
    confidenceRange: CONFIDENCE_RANGE,
  }),
  Object.freeze({
    id: "fundamental",
    approach: "value/earnings-reading: book quality, paper-economy flows, valuation posture — no external data feeds",
    signalEnum: SIGNAL_ENUM,
    confidenceRange: CONFIDENCE_RANGE,
  }),
  Object.freeze({
    id: "risk",
    approach: "drawdown/vol-reading: drawdown depth, volatility regime, position stress — protective bias by design",
    signalEnum: SIGNAL_ENUM,
    confidenceRange: CONFIDENCE_RANGE,
  }),
  Object.freeze({
    id: "macro",
    approach: "rates/fx-reading: paper rates, currency drift, liquidity posture — top-down bias",
    signalEnum: SIGNAL_ENUM,
    confidenceRange: CONFIDENCE_RANGE,
  }),
]);

export const PERSONA_IDS = Object.freeze(PERSONAS.map((p) => p.id));

/* persona schema — parsed through the kernel R352 enum/range validator
 * (renumbered R350→R352 after T-95 first-registration, Pulse DECISIONS #35/#36) */
export function personaSchema(persona) {
  const p = persona && typeof persona === "object" ? persona : {};
  const range = Array.isArray(p.confidenceRange) && p.confidenceRange.length === 2 ? p.confidenceRange : CONFIDENCE_RANGE;
  return {
    signal: { type: "string", enum: Array.isArray(p.signalEnum) ? p.signalEnum : SIGNAL_ENUM },
    confidence: { type: "number", min: range[0], max: range[1] },
    rationale: { type: "string", minLength: 1, maxLength: 1024 },
  };
}

/* ── 2 · runPersona — ONE persona round through the kernel guardrail ────────
 * respond({personaId, prompt}) is INJECTED (R330) — sync or async, returning
 * a raw string. Invalid output ⇒ ONE bounded repair round (re-invoke with a
 * repair instruction; max 2 total attempts, NEVER 3). Still invalid (or the
 * seam threw) ⇒ honest abstain record. LLM errors abstain, never fabricate. */
export async function runPersona({ persona, prompt, respond } = {}) {
  const personaId = persona && typeof persona.id === "string" ? persona.id : null;
  const registered = personaId ? PERSONAS.find((p) => p.id === personaId) : null;
  if (!registered) {
    return { personaId, abstain: true, reason: "persona-not-in-roster", attempts: 0, errors: ["persona-not-in-roster"] };
  }
  if (typeof respond !== "function") {
    return { personaId, abstain: true, reason: "respond-not-injected", attempts: 0, errors: ["respond-not-injected"] };
  }
  const schema = personaSchema(registered);
  const basePrompt = typeof prompt === "string" && prompt ? prompt : `Paper persona round for ${personaId}.`;
  const errors = [];
  let question = basePrompt;
  let attempts = 0;
  for (let i = 0; i < 2; i++) { // max 2 total attempts — never a 3rd
    attempts++;
    let raw;
    try {
      raw = await respond({ personaId, prompt: question, attempt: attempts });
    } catch (e) {
      errors.push(`attempt-${attempts}:respond-threw:${String(e && e.message ? e.message : e).slice(0, 160)}`);
      if (attempts < 2) { question = repairPrompt(basePrompt, errors); continue; }
      break;
    }
    const v = validateOutput(typeof raw === "string" ? raw : JSON.stringify(raw ?? null), schema);
    if (v.ok) {
      return { personaId, abstain: false, attempts, approach: registered.approach, signal: v.parsed.signal, confidence: v.parsed.confidence, rationale: v.parsed.rationale };
    }
    for (const er of v.errors) errors.push(`attempt-${attempts}:${er}`);
    if (attempts < 2) { question = repairPrompt(basePrompt, errors); continue; }
  }
  return { personaId, abstain: true, reason: "abstain-after-bounded-repair", attempts, errors: errors.slice(0, 8) };
}

function repairPrompt(base, errors) {
  return (
    base +
    "\n\nREPAIR REQUIRED (kernel validator rejected the previous answer): " + errors.join("; ") +
    '. Respond AGAIN with STRICT JSON only: {"signal": "bullish"|"neutral"|"bearish", "confidence": <number 0-100>, "rationale": <non-empty string, max 1024 chars>}. No prose outside the JSON.'
  );
}

/* ── 3 · blend — deterministic aggregation (no clock, no randomness) ────────
 * Abstentions excluded AND counted; direction vote bullish=+1/bearish=−1/
 * neutral=0; netConviction = Σ(sign×confidence/100)/max(1, nonAbstainCount)
 * ∈ [-1,1]; verdict from the declared thresholds; sizing = |netConviction|
 * capped by clamp.maxSizing when a clamp is provided (the REQUESTED paper
 * magnitude — only the risk stage may zero it). Rounds that are present but
 * unusable (bad signal/confidence — cannot happen post-validation) are
 * excluded and counted honestly as invalidCount. */
export const BLEND_BUY_THRESHOLD = 0.25;
export const BLEND_SELL_THRESHOLD = -0.25;

const r6 = (x) => { const v = Math.round(x * 1e6) / 1e6; return Object.is(v, -0) ? 0 : v; };

export function blend({ rounds, clamp } = {}) {
  const list = Array.isArray(rounds) ? rounds : [];
  let abstainCount = 0, invalidCount = 0, used = 0, sum = 0;
  const votes = { bullish: 0, neutral: 0, bearish: 0 };
  for (const r of list) {
    if (!r || r.abstain === true) { abstainCount++; continue; }
    const sign = r.signal === "bullish" ? 1 : r.signal === "bearish" ? -1 : r.signal === "neutral" ? 0 : null;
    if (sign === null || typeof r.confidence !== "number" || !Number.isFinite(r.confidence) || r.confidence < 0 || r.confidence > 100) {
      invalidCount++; continue;
    }
    votes[r.signal]++;
    sum += sign * (r.confidence / 100);
    used++;
  }
  const netConviction = r6(sum / Math.max(1, used)); // ∈ [-1, 1]
  const verdict = netConviction >= BLEND_BUY_THRESHOLD ? "BUY" : netConviction <= BLEND_SELL_THRESHOLD ? "SELL" : "HOLD";
  const capRaw = clamp && typeof clamp === "object" && !Array.isArray(clamp) ? clamp.maxSizing : clamp; // bare number also accepted
  const cap = typeof capRaw === "number" && Number.isFinite(capRaw) ? capRaw : null;
  let sizing = Math.abs(netConviction);
  let sizingCapped = false;
  if (cap !== null && sizing > cap) { sizing = cap; sizingCapped = true; }
  return {
    ok: true, netConviction, verdict, sizing, votes,
    nonAbstainCount: used, abstainCount, invalidCount, total: list.length,
    thresholds: { buy: BLEND_BUY_THRESHOLD, sell: BLEND_SELL_THRESHOLD },
    sizingCapped,
  };
}

/* ── 4 · applyRiskClamps — "conviction requests, risk disposes" ─────────────
 * Hard, non-negotiable clamps from the risk config; every applied clamp
 * emits a {clamp, from, to, at} ClampEvent. Order: killSwitch →
 * minConfidence → maxSizing. killSwitch=true ⇒ verdict FORCED to HOLD +
 * sizing 0 + ClampEvent (the flag is read at decision time AND again inside
 * replay — belt and braces, the caller cannot forget to look).
 * minConfidence = a floor on |netConviction|: below it nothing moves. */
export function applyRiskClamps({ blend: b, risk, now } = {}) {
  try {
    if (!b || typeof b !== "object" || Array.isArray(b)) return { ok: false, error: "blend-required" };
    const at = typeof now === "string" && now ? now : new Date().toISOString();
    const rk = risk && typeof risk === "object" && !Array.isArray(risk) ? risk : {};
    const clampEvents = [];
    let verdict = typeof b.verdict === "string" ? b.verdict : "HOLD";
    let sizing = typeof b.sizing === "number" && Number.isFinite(b.sizing) ? b.sizing : 0;
    const nc = typeof b.netConviction === "number" && Number.isFinite(b.netConviction) ? b.netConviction : 0;
    if (rk.killSwitch === true) {
      const preV = verdict, preS = sizing;
      verdict = "HOLD"; sizing = 0;
      if (preV !== "HOLD" || preS !== 0) clampEvents.push({ clamp: "killSwitch", from: preV, to: "HOLD", at }); // sizing → 0 rides the same event
    }
    const minC = typeof rk.minConfidence === "number" && Number.isFinite(rk.minConfidence) ? rk.minConfidence : null;
    if (minC !== null && Math.abs(nc) < minC && (verdict !== "HOLD" || sizing > 0)) {
      const from = sizing;
      verdict = "HOLD"; sizing = 0;
      clampEvents.push({ clamp: "minConfidence", from, to: 0, at });
    }
    const maxS = typeof rk.maxSizing === "number" && Number.isFinite(rk.maxSizing) ? rk.maxSizing : null;
    if (maxS !== null && sizing > maxS) {
      clampEvents.push({ clamp: "maxSizing", from: sizing, to: maxS, at });
      sizing = maxS;
    }
    return {
      ok: true, verdict, sizing, netConviction: nc,
      votes: b.votes ?? null, nonAbstainCount: b.nonAbstainCount ?? 0,
      abstainCount: b.abstainCount ?? 0, invalidCount: b.invalidCount ?? 0,
      thresholds: b.thresholds ?? null, clampEvents, killSwitch: rk.killSwitch === true,
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e).slice(0, 200) }; // never throw past the boundary
  }
}

/* ── 5 · the PAPER decision ledger — append-only hash chain ──────────────── */
function stableStringify(v) {
  if (v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x)).join(",")}]`;
  if (v && typeof v === "object") {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

const chainHash = (prevHash, body) =>
  createHash("sha256").update(prevHash + stableStringify(body)).digest("hex"); // full 64-hex

const ledgerPath = (repoRoot) => path.join(String(repoRoot ?? ""), CABINET_LEDGER_REL);

/* foldLedger — state is never stored, it is REBUILT by folding over the
 * chain (R337 cousin): seq continuity 1..n, prev-hash linkage, and every
 * hash recomputed over the canonical record sans hash. Any mismatch ⇒
 * {ok:false, at:seq}. An absent ledger is an honestly EMPTY chain. */
export function foldLedger(repoRoot) {
  const file = ledgerPath(repoRoot);
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (/ENOENT|ENOTDIR|EISDIR/.test(String(e && e.code))) {
      return { ok: true, empty: true, length: 0, lastSeq: 0, lastHash: GENESIS_HASH, records: [], path: file };
    }
    return { ok: false, at: 0, error: `ledger-unreadable:${String(e && e.message ? e.message : e).slice(0, 120)}`, path: file };
  }
  const lines = raw.split("\n").filter((l) => l.length > 0);
  const records = [];
  let expectedSeq = 1, prevHash = GENESIS_HASH;
  for (const line of lines) {
    let rec;
    try { rec = JSON.parse(line); } catch { return { ok: false, at: expectedSeq, error: "line-unparseable", path: file }; }
    if (!rec || typeof rec !== "object" || Array.isArray(rec)) return { ok: false, at: expectedSeq, error: "record-not-an-object", path: file };
    if (rec.seq !== expectedSeq) return { ok: false, at: expectedSeq, error: "seq-gap-or-reorder", path: file };
    if (rec.prevHash !== prevHash) return { ok: false, at: expectedSeq, error: "prev-hash-link-broken", path: file };
    const { hash, ...body } = rec;
    if (typeof hash !== "string" || chainHash(prevHash, body) !== hash) {
      return { ok: false, at: expectedSeq, error: "hash-mismatch", path: file };
    }
    prevHash = hash;
    records.push(rec);
    expectedSeq++;
  }
  return { ok: true, empty: records.length === 0, length: records.length, lastSeq: records.length, lastHash: prevHash, records, path: file };
}

/* appendDecisionLedger — ONE hash-chained line, R340-style readback; refuses
 * to build on a broken chain (folds first, fail-closed). */
export function appendDecisionLedger(repoRoot, record) {
  try {
    if (!record || typeof record !== "object" || Array.isArray(record)) return { ok: false, error: "record-required" };
    const file = ledgerPath(repoRoot);
    const fold = foldLedger(repoRoot);
    if (!fold.ok) return { ok: false, error: "ledger-chain-broken", at: fold.at, detail: fold.error ?? null, path: file };
    const seq = fold.lastSeq + 1;
    const prevHash = fold.lastHash;
    const at = typeof record.at === "string" && record.at ? record.at : new Date().toISOString();
    const body = { ...record, seq, at, prevHash };
    const hash = chainHash(prevHash, body);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ ...body, hash }) + "\n");
    // R340 readback: the last line parses back and its hash recomputes
    const back = foldLedger(repoRoot);
    if (!back.ok) return { ok: false, error: "readback-failed", at: back.at, detail: back.error ?? null, path: file };
    const last = back.records[back.records.length - 1];
    if (!last || last.seq !== seq || last.hash !== hash) return { ok: false, error: "readback-mismatch", path: file };
    return { ok: true, seq, hash, prevHash, path: file, length: back.length };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e).slice(0, 200) };
  }
}

/* ── 6 · replayDecision — replay is a VERIFICATION, not a re-execution ─────
 * Fold the chain (broken ⇒ refuse loudly), read the record, re-read the
 * kill-switch NOW (injected killSwitchFn; default reads
 * state/cabinet-killswitch.json — absent ⇒ false, corrupt/error ⇒ TRUE
 * fail-closed: an unreadable control signal never enables action).
 * kill-switch true ⇒ {replayVerdict:'SUPERSEDED-KILLSWITCH'}; else
 * {replayVerdict:'CONFIRMED'} with the chain verification attached. */
async function readKillSwitch(killSwitchFn, repoRoot) {
  if (typeof killSwitchFn === "function") {
    try {
      return { killSwitch: !!(await killSwitchFn(repoRoot)), source: "injected-killSwitchFn" };
    } catch (e) {
      return { killSwitch: true, source: "injected-error-fail-closed", detail: String(e && e.message ? e.message : e).slice(0, 120) };
    }
  }
  const file = path.join(String(repoRoot ?? ""), KILLSWITCH_REL);
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch (e) {
    if (/ENOENT|ENOTDIR|EISDIR/.test(String(e && e.code))) return { killSwitch: false, source: "no-killswitch-file" };
    return { killSwitch: true, source: "killswitch-file-unreadable-fail-closed" };
  }
  try {
    const j = JSON.parse(raw);
    return { killSwitch: j && j.killSwitch === true, source: "cabinet-killswitch.json" };
  } catch {
    return { killSwitch: true, source: "killswitch-file-corrupt-fail-closed" };
  }
}

export async function replayDecision(repoRoot, seq, killSwitchFn = null) {
  try {
    const fold = foldLedger(repoRoot);
    if (!fold.ok) return { ok: false, error: "ledger-chain-broken", at: fold.at, detail: fold.error ?? null };
    const record = (fold.records || []).find((r) => r && r.seq === seq);
    if (!record) return { ok: false, error: "record-not-found", seq, chainOk: true, length: fold.length };
    const ks = await readKillSwitch(killSwitchFn, repoRoot);
    return {
      ok: true, seq, at: record.at, record,
      replayVerdict: ks.killSwitch ? "SUPERSEDED-KILLSWITCH" : "CONFIRMED",
      killSwitch: ks.killSwitch, killSwitchSource: ks.source,
      chainOk: true, chainLength: fold.length,
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e).slice(0, 200) };
  }
}

/* ── 7 · runCabinet — orchestrate the whole paper round with receipts ──────
 * ALL PERSONAS → blend → risk clamps → (persist? appendDecisionLedger) →
 * full record. Never throws past the boundary (honest {ok:false,error}).
 * The kill-switch is consulted at decision time (risk.killSwitch, or the
 * injected killSwitchFn when the flag is absent) AND again inside any later
 * replayDecision — reading it twice is the design, not redundancy. */
function compactRound(r) {
  if (!r || typeof r !== "object") return { personaId: null, abstain: true, reason: "malformed-round" };
  // rationales stay in the returned run record (full receipts); the ledger
  // line carries the blended summary only — honest compact truth.
  return r.abstain === true
    ? { personaId: r.personaId, abstain: true, reason: String(r.reason ?? "").slice(0, 200), attempts: r.attempts ?? 0 }
    : { personaId: r.personaId, abstain: false, signal: r.signal, confidence: r.confidence, attempts: r.attempts ?? 0 };
}

export async function runCabinet({ respond, risk, killSwitchFn = null, repoRoot = null, persist = false, now = null, prompt = null } = {}) {
  try {
    if (typeof respond !== "function") {
      // honest refusal — with no injected LLM the cabinet does not run
      return { ok: false, error: "respond-required", note: "cabinet never fabricates: inject respond (R330 seam) or nothing runs" };
    }
    const at = typeof now === "string" && now ? now : new Date().toISOString();
    const basePrompt = typeof prompt === "string" && prompt
      ? prompt
      : `exec35 paper cabinet round (at ${at}). Personas read OUR OWN saos-dex paper state only — no external data, no brokers, no keys. Respond with STRICT JSON: {"signal": "bullish"|"neutral"|"bearish", "confidence": <number 0-100>, "rationale": <1-1024 chars>}.`;
    const personaRounds = [];
    for (const persona of PERSONAS) {
      personaRounds.push(await runPersona({ persona, prompt: basePrompt, respond }));
    }
    // decision-time kill-switch read (risk flag first; injected fn as fallback)
    const riskEff = risk && typeof risk === "object" && !Array.isArray(risk) ? { ...risk } : {};
    let killSwitchSource = null;
    if (riskEff.killSwitch !== true && typeof killSwitchFn === "function") {
      const ks = await readKillSwitch(killSwitchFn, repoRoot);
      if (ks.killSwitch) { riskEff.killSwitch = true; killSwitchSource = ks.source; }
    }
    // blend requests the RAW conviction magnitude — the risk stage alone
    // clamps (each clamp application must emit its own ClampEvent; pre-capping
    // here would silently swallow the audit trail)
    const b = blend({ rounds: personaRounds });
    const decision = applyRiskClamps({ blend: b, risk: riskEff, now: at });
    if (!decision.ok) return { ok: false, stage: "risk-clamps", error: decision.error ?? "clamps-failed", personaRounds, blend: b };
    const record = {
      schemaVersion: 1,
      at,
      identity: CABINET_IDENTITY,
      personaRounds: personaRounds.map(compactRound),
      verdict: decision.verdict,
      sizing: decision.sizing,
      netConviction: decision.netConviction,
      votes: decision.votes,
      nonAbstainCount: decision.nonAbstainCount,
      abstainCount: decision.abstainCount,
      clampEvents: decision.clampEvents,
      lawSource: CABINET_LAW_SOURCE,
    };
    let ledger = null;
    if (persist) {
      if (typeof repoRoot !== "string" || !repoRoot) {
        return { ok: false, stage: "persist", error: "repoRoot-required-for-persist", personaRounds, blend: b, decision };
      }
      ledger = appendDecisionLedger(repoRoot, record);
      if (!ledger.ok) return { ok: false, stage: "persist", error: ledger.error ?? "ledger-append-failed", personaRounds, blend: b, decision };
    }
    return {
      ok: true, at, personaRounds, blend: b, decision, record, ledger,
      receipts: {
        respondInjected: true,
        personasRun: personaRounds.length,
        abstains: personaRounds.filter((r) => r && r.abstain === true).length,
        clampEvents: decision.clampEvents.length,
        persisted: !!(ledger && ledger.ok),
        killSwitchSource,
        paperOnly: true,
      },
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e).slice(0, 200) }; // never throw past the boundary
  }
}

/* ── the DETERMINISTIC STUB respond — fixed fixture answers, NOT an LLM ────
 * Single source of truth for the ci-cycle self-probe AND the selftest
 * integration vector. Confidences chosen so the stub blend is exact in
 * binary floating point: (0.75 + 0.5 + 0 − 0.25) / 4 = 0.25 exactly →
 * BUY at the ≥0.25 threshold, sizing 0.25. The stub NEVER persists and
 * never runs in production beats (SAOS_CABINET_SELFPROBE gate, default OFF)
 * — a stub must never write decision-ledger lines: fabricated decisions in
 * state are a dishonesty hazard. */
export const DETERMINISTIC_STUB = Object.freeze({
  technical: JSON.stringify({ signal: "bullish", confidence: 75, rationale: "Stub fixture: paper momentum higher-lows pattern on OUR OWN paper ledger (deterministic stub, not an LLM)." }),
  fundamental: JSON.stringify({ signal: "bullish", confidence: 50, rationale: "Stub fixture: paper credit supply steady, book fundamentals unchanged (deterministic stub)." }),
  risk: JSON.stringify({ signal: "neutral", confidence: 50, rationale: "Stub fixture: paper drawdown flat, no volatility regime signal (deterministic stub)." }),
  macro: JSON.stringify({ signal: "bearish", confidence: 25, rationale: "Stub fixture: paper rates drifting up, mild bearish tilt (deterministic stub)." }),
});

export async function stubRespond({ personaId } = {}) {
  const raw = DETERMINISTIC_STUB[personaId];
  if (raw === undefined) throw new Error(`stub-has-no-answer-for:${personaId}`); // honest — never invent
  return raw;
}
