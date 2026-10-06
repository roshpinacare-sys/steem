/* ── adaptation.mjs — R208/R209 RESTORED LAYER + R210 CAUSAL CLOSURE MACHINERY ──
 * Restored after sandbox regression to the 10-04 snapshot (the R208/R209 code
 * and state were lost with the newer sandbox; rebuilt from documented history
 * and re-verified against chain truth).
 *
 * The learned rule (from REAL historical failures, never invented):
 *   claim_reward_balance executed under ACTIVE authority with op-id 33 →
 *   19 consecutive chain rejections ("Missing Posting Authority",
 *   fingerprint c056922c, last txid 78d23e71…, last at 2026-10-04T20:24Z).
 *   Chain-judged canonical serialization (condenser_api.get_transaction_hex,
 *   OBSERVED 2026-10-05): claim_reward_balance = op-id 39.
 *   Belief: claim runs under POSTING authority with canonical op-id 39.
 *
 * R210 laws encoded here:
 *   - prediction BEFORE action (immutable receipts; post-hoc = flagged)
 *   - chain truth is the judge (local ok ≠ chain inclusion)
 *   - expected vs actual: CONFIRMED/PARTIAL/CONTRADICTED/UNRESOLVED
 *   - belief updates are semantic (BEFORE/EVIDENCE/AFTER/WHY), never counters
 *   - VERIFIED ≠ immortal: contradiction → decay → supersede → fail-closed
 *   - learning never creates authority: role changes stay inside the
 *     already-authorized posting role; owner/active are NEVER adopted
 *   - no natural trigger (pending=0) → ARMED + WAITING, never manufactured */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(__dirname, "state");
const ADAPT_FILE = path.join(STATE, "adaptation.json");
const PRED_LOG = path.join(STATE, "predictions.jsonl");
const OUT_LOG = path.join(STATE, "outcomes.jsonl");
const TRIGGER_LOG = path.join(STATE, "triggers.jsonl");
const WAIT_FILE = path.join(STATE, "waiting.json");

export const ADAPTATION_ID = "ADAPT-claim-role-posting-R209";
const RULE_VERSION = 1;

function readJson(f, dflt) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return dflt; } }
function writeJson(f, o) { try { fs.mkdirSync(STATE, { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2)); } catch { /* best-effort */ } }
function appendLine(f, o) { try { fs.mkdirSync(STATE, { recursive: true }); fs.appendFileSync(f, JSON.stringify(o) + "\n"); } catch { /* best-effort */ } }
const now = () => new Date().toISOString();

function seedAdaptation() {
  return {
    adaptationId: ADAPTATION_ID,
    ruleVersion: RULE_VERSION,
    rule: { op: "claim_reward_balance", roleFrom: "active", roleTo: "posting" },
    bodyFix: { opIdFrom: 33, opIdTo: 39, where: "steemtx.mjs OP_IDS (single source)" },
    status: "VERIFIED", // VERIFIED = supported by CURRENT evidence — never "true forever"
    confidence: 0.9,
    source: {
      kind: "historical-failures",
      count: 19,
      fingerprint: "c056922c",
      lastTxid: "78d23e71a0efbcf184d065cb2ad10cd901a9506d",
      lastAt: "2026-10-04T20:24:51.578Z",
      error: "missing required posting authority:Missing Posting Authority headcorner",
    },
    rootCause: {
      role: "executeOps default role=active reached claim_reward_balance",
      serialization: "op-id 33 hardcoded; chain-judged canonical op-id = 39 (OBSERVED via get_transaction_hex 2026-10-05, control vote=0, delegate=40)",
    },
    falsifier: "valid pending rewards + canonical serialization (chain hex op-id 39) + broadcast rejection citing posting authority",
    belief: {
      before: "claim_reward_balance executes under active authority with op-id 33",
      evidence: "19 consecutive chain rejections (fingerprint c056922c); chain itself serializes claim as op-id 39 (OBSERVED)",
      after: "claim_reward_balance executes under posting authority with canonical op-id 39",
      why: "the chain is the only judge: get_required authority for claim is posting; canonical bytes observed from the chain's own serializer",
    },
    supersededBy: null,
    createdAt: now(),
    updatedAt: now(),
    bootCount: 0,
    lastBootAt: null,
    consumptionCount: 0,
    lastConsumedAt: null,
    evalHistory: [],
  };
}

let bootedPid = null;
export function adaptationBoot() {
  const a = readJson(ADAPT_FILE, null);
  const store = a ?? seedAdaptation();
  if (bootedPid !== process.pid) {
    bootedPid = process.pid;
    store.bootCount = (store.bootCount ?? 0) + 1;
    store.lastBootAt = now();
    store.updatedAt = now();
    writeJson(ADAPT_FILE, store);
    appendLine(PRED_LOG, { at: now(), kind: "boot", pid: process.pid, bootCount: store.bootCount, adaptationId: store.adaptationId, status: store.status });
    reconcileOrphans();
  }
  return store;
}

/* R210 §VI integrity: a prediction that never reached evaluation (crash between
 * writePrediction and the execute step, cap-refusal, no-ops) must be honestly
 * closed as UNRESOLVED — never silently left to imply an implicit success. */
export function reconcileOrphans() {
  try {
    const preds = fs.readFileSync(PRED_LOG, "utf8").trim().split("\n").filter(Boolean).slice(-30).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && r.kind === "prediction");
    let outs = [];
    try { outs = fs.readFileSync(OUT_LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && r.predictionId); } catch { /* no outcomes yet */ }
    const judged = new Set(outs.map((o) => o.predictionId));
    for (const p of preds) {
      if (judged.has(p.predictionId)) continue;
      appendLine(OUT_LOG, { at: now(), kind: "outcome", predictionId: p.predictionId, adaptationId: p.adaptationId ?? null, classification: "UNRESOLVED", orphanReconciled: true, note: "prediction never reached evaluation (crash/refusal/cap) — honestly closed" });
    }
  } catch { /* best-effort */ }
}

export function getAdaptation() {
  return readJson(ADAPT_FILE, null) ?? adaptationBoot();
}

/* THE RESOLVER — the one hot-path consumption point (signer calls this).
 * Fail-closed: a superseded/refuted rule REFUSES claim ops instead of
 * falling back to a role the chain already proved wrong. Learning never
 * grants authority: the rule can only select posting — a role the
 * credential already holds. */
export function resolveClaimRole({ countConsumption = true } = {}) {
  const a = adaptationBoot();
  if (a.status !== "VERIFIED" || a.supersededBy) {
    return { failClosed: true, reason: `adaptation status=${a.status}${a.supersededBy ? ` supersededBy=${a.supersededBy}` : ""} — claim ops REFUSED (fail-closed, R210 §XIII)`, adaptationId: a.adaptationId, status: a.status, roleSource: `${a.adaptationId}:v${a.ruleVersion}:fail-closed`, ruleVersion: a.ruleVersion };
  }
  if (countConsumption) {
    a.consumptionCount = (a.consumptionCount ?? 0) + 1;
    a.lastConsumedAt = now();
    writeJson(ADAPT_FILE, a);
  }
  return {
    failClosed: false,
    role: a.rule.roleTo,
    roleFrom: a.rule.roleFrom,
    roleSource: `${a.adaptationId}:v${a.ruleVersion}:rule:${a.rule.op}.role=${a.rule.roleTo}`,
    adaptationId: a.adaptationId,
    ruleVersion: a.ruleVersion,
    status: a.status,
    confidence: a.confidence,
  };
}

/* R210 §VI · PRE-ACTION PREDICTION — immutable receipt, written BEFORE the
 * broadcast call is even constructed. */
export function writePrediction(p) {
  const row = {
    predictionId: `PRED-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: now(),
    kind: "prediction",
    action: p.action,
    adaptationId: p.adaptationId,
    ruleVersion: p.ruleVersion,
    expectedRole: p.expectedRole,
    roleSource: p.roleSource,
    expectedOutcome: p.expectedOutcome ?? "broadcast accepted + chain inclusion of claim_reward_balance signed by posting authority with canonical op-id 39",
    expectedFailureClass: p.expectedFailureClass ?? ["authority-rejection", "serialization-mismatch"],
    confidence: p.confidence,
    falsifier: p.falsifier ?? "valid pending reward + canonical serialization + broadcast rejection for authority",
    trigger: p.trigger ?? null,
  };
  appendLine(PRED_LOG, row);
  return row;
}

/* action timestamp evidence comes from the signer's own LOG row (execAt).
 * The comparison is verifiable from immutable logs — code order alone is not
 * the proof (R210 §VI). */
export function predictionPrecedesAction(predictionAt, actionAt) {
  return typeof predictionAt === "string" && typeof actionAt === "string" && predictionAt < actionAt; // ISO lexicographic = chronological
}

/* normalize the serialization evidence: signer writes {claimOpId: N} */
function serNum(x) { return typeof x === "object" && x !== null ? x.claimOpId ?? null : (typeof x === "number" ? x : null); }

/* R210 §VIII/§IX · CHAIN TRUTH + EXPECTED VS ACTUAL.
 * chain = { included, txid, block, opFound, actualRole?, delta } measured from
 * the chain (get_transaction / account history), never from local success. */
export function evaluateAndJournal({ prediction, execRow, res, chain }) {
  const actual = {
    broadcastOk: res?.ok === true,
    txid: res?.txid ?? execRow?.txid ?? null,
    chainIncluded: chain?.included === true,
    chainBlock: chain?.block ?? null,
    opFoundOnChain: chain?.opFound === true,
    rewardDeltaObserved: chain?.delta ?? null,
    error: res?.error ?? null,
  };
  const roleUsed = execRow?.role ?? null; // MEASURED — from the signer's own log row
  const ser = serNum(execRow?.serialization);
  const checks = {
    operationType: actual.broadcastOk || actual.chainIncluded ? "claim_reward_balance" : null,
    authority: roleUsed, // measured authority, never copied from the prediction
    roleUsed,
    serialization: ser, // op-id byte actually written (normalized from {claimOpId})
    broadcastResult: actual.broadcastOk ? "BROADCAST" : `BROADCAST-FAIL:${actual.error ?? "?"}`,
    chainInclusion: actual.chainIncluded,
    rewardBalanceDelta: actual.rewardDeltaObserved,
    txid: actual.txid,
    block: actual.chainBlock,
  };
  const postHoc = !predictionPrecedesAction(prediction?.at, execRow?.at ?? null);
  let classification = "UNRESOLVED";
  if (postHoc) classification = "UNRESOLVED"; // §VI: unverifiable ordering can never confirm
  else if (actual.chainIncluded && actual.opFoundOnChain && roleUsed === prediction?.expectedRole && ser === 39) classification = "CONFIRMED";
  else if (actual.chainIncluded && actual.opFoundOnChain) classification = "PARTIAL"; // included but role/serialization evidence incomplete
  else if (actual.broadcastOk && !actual.chainIncluded) classification = "UNRESOLVED"; // §VII/E7: local ok without inclusion is NOT success
  else if (!actual.broadcastOk) {
    // failure → does it hit the falsifier (authority rejection with valid pending + canonical bytes)?
    const authorityRejection = /posting authority/i.test(String(actual.error ?? ""));
    classification = authorityRejection && ser === 39 ? "CONTRADICTED" : "UNRESOLVED";
  }
  const row = {
    at: now(), kind: "outcome", predictionId: prediction?.predictionId ?? null,
    adaptationId: prediction?.adaptationId ?? null, classification,
    predictionBeforeAction: !postHoc, expected: prediction?.expectedOutcome ?? null,
    actual, checks,
  };
  appendLine(OUT_LOG, row);
  return row;
}

/* R210 §XIV/X · belief revision — semantic, evidence-bound, reversible. */
export function updateBelief({ classification, evidence }) {
  const a = getAdaptation();
  const before = { status: a.status, confidence: a.confidence };
  const ev = { at: now(), kind: "belief-update", classification, evidence: evidence ?? null };
  if (classification === "CONFIRMED") {
    a.confidence = Math.min(0.99, Math.round(((a.confidence ?? 0.5) + 0.05) * 1000) / 1000);
    a.status = "VERIFIED";
  } else if (classification === "PARTIAL") {
    a.confidence = Math.max(0.05, Math.round(((a.confidence ?? 0.5) - 0.05) * 1000) / 1000);
  } else if (classification === "CONTRADICTED") {
    a.confidence = Math.max(0.05, Math.round(((a.confidence ?? 0.5) - 0.3) * 1000) / 1000);
  } // UNRESOLVED → no belief change (§VII: never turn ambiguity into certainty)
  // cumulative decay ALSO supersedes — a slow-eroding belief must not stay VERIFIED (finding C-3)
  if (a.confidence < 0.35 && a.status === "VERIFIED") {
    a.status = "SUPERSEDED";
    a.supersededBy = `${a.adaptationId}:fail-closed@${now()}`;
    a.rule.roleTo = "REFUSED-FAIL-CLOSED"; // safe baseline: no claim at all until re-verified
  }
  ev.before = before;
  ev.after = { status: a.status, confidence: a.confidence };
  ev.why = classification === "CONFIRMED" ? "chain included the posting-signed canonical claim — prediction matched reality"
    : classification === "CONTRADICTED" ? "the chain rejected/reality contradicted the predicted outcome under the falsifier — confidence decays, fail-closed below threshold"
    : classification === "PARTIAL" ? "outcome partially matches — small decay, evidence recorded"
    : "unresolved — no belief change (ambiguity must not become certainty)";
  a.updatedAt = now();
  a.evalHistory = [...(a.evalHistory ?? []), ev].slice(-50);
  writeJson(ADAPT_FILE, a);
  return ev;
}

/* R210 §V · NATURAL TRIGGER MONITOR — observe, never manufacture.
 * Both branches deduped (hourly for waiting, 6h-by-fingerprint for triggers). */
export function triggerWatch(pendingAny, pending) {
  if (pendingAny) {
    const fp = JSON.stringify(pending ?? {});
    const recent = readJson(WAIT_FILE, {});
    if (recent.lastTriggerFp === fp && recent.lastTriggerAt && Date.now() - new Date(recent.lastTriggerAt).getTime() < 6 * 3600_000) {
      return { verdict: "TRIGGER-KNOWN" };
    }
    writeJson(WAIT_FILE, { ...recent, lastTriggerAt: now(), lastTriggerFp: fp });
    appendLine(TRIGGER_LOG, {
      at: now(), kind: "trigger-detected", triggerDetectedAt: now(),
      pendingAmount: pending ?? null, source: "chain:pending-rewards", account: "headcorner",
      eligibility: "pending nonzero (chain-measured)", adaptationId: ADAPTATION_ID, ruleVersion: RULE_VERSION,
    });
    return { verdict: "TRIGGER-DETECTED" };
  }
  const w = readJson(WAIT_FILE, { lastWaitingAt: null });
  const t = Date.now();
  if (!w.lastWaitingAt || t - new Date(w.lastWaitingAt).getTime() > 3600_000) {
    writeJson(WAIT_FILE, { lastWaitingAt: new Date(t).toISOString() });
    appendLine(TRIGGER_LOG, { at: now(), kind: "waiting", verdict: "ARMED + WAITING_FOR_REAL_WORLD_TRIGGER (pending=0 — no claim experiment, R210 §IV)" });
  }
  return { verdict: "WAITING" };
}

/* R210 §VIII · CHAIN TRUTH HELPER — read-only, judges by the chain's own
 * transaction store. Local broadcast ok ≠ chain inclusion. */
export async function claimChainTruth(txid) {
  try {
    const r = await fetch("https://api.steemit.com", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_transaction", params: [txid], id: 1 }),
    }).then((x) => x.json());
    if (r.result) {
      const opFound = (r.result.operations ?? []).some(([n]) => n === "claim_reward_balance");
      return { included: true, block: r.result.block_num ?? null, opFound };
    }
    return { included: false, note: String(r.error?.message ?? "not-found").slice(0, 120) };
  } catch (e) {
    return { included: false, note: String(e?.message ?? e).slice(0, 120) };
  }
}

/* fail-closed refusal journaling (typed, honest) */
export function journalClaimRefusal(reason, context = {}) {
  appendLine(OUT_LOG, { at: now(), kind: "claim-refused", reason, ...context });
}

/* cockpit/status projection (no secrets, verdicts only) */
export function publicAdaptation() {
  const a = getAdaptation();
  return {
    adaptationId: a.adaptationId, status: a.status, confidence: a.confidence,
    rule: a.rule, bodyFix: a.bodyFix, supersededBy: a.supersededBy,
    bootCount: a.bootCount, lastBootAt: a.lastBootAt,
    consumptionCount: a.consumptionCount, lastConsumedAt: a.lastConsumedAt,
    belief: a.belief, falsifier: a.falsifier,
    evalHistory: (a.evalHistory ?? []).slice(-5),
  };
}
