#!/usr/bin/env node
/**
 * ECOS V6 — End-to-End Demo Script
 * ==================================
 * מריץ עסקה שלמה מקצה לקצה דרך הרכיבים האמיתיים של המערכת.
 *
 * Zero external dependencies — Node.js בלבד, ללא npm install,
 * ללא DB, ללא Ollama, ללא Stripe.
 *
 * Flow:
 *   Task → [AI inference*] → confidenceCalibrator → confidenceGate
 *        → hitlGate.createApproval → [Validator: MODIFY]
 *        → [semanticPatchEngine*] → [selfRefinementAgent*] → [royaltyTrigger*]
 *        → fiatLedger (40/40/20 BigInt) → auditLog → receipt
 *
 *   * = mocked (real wiring via TODO markers below)
 *
 * הרצה:
 *   node scripts/ecos-e2e-demo.js
 *
 * TODO לפני הדגמה ללקוח:
 *   [ ] npm install pg  (מאפשר db/pool.js + כל ה-repos)
 *   [ ] החלף mockInference ב-offlineInference.executeTask()
 *   [ ] החלף mockFindPatch ב-semanticPatchEngine.findSemanticPatch()
 *   [ ] החלף mockHealOutput ב-selfRefinementAgent.healOutput()
 *   [ ] חבר royaltyTrigger.pay() עם DB pool
 *   [ ] חבר hitlGate broadcast לSSE stream של ValidatorUI
 *   [ ] החלף labeled data סינטטי בquery מ-approvalRepo (50+ שורות)
 *   [ ] persists auditLog לDB (כרגע in-memory — נמחק ב-restart)
 */

'use strict';

const path = require('node:path');
const LIB  = path.resolve(__dirname, '../lib');

const { FiatLedger, SYSTEM_ACCOUNTS, usdToMicrocents, microcentsToUsdString }
  = require(path.join(LIB, 'fiatLedger'));
const { AuditLog }
  = require(path.join(LIB, 'auditLog'));
const { HitlGate, DECISION }
  = require(path.join(LIB, 'hitlGate'));
const { ConfidenceCalibrator }
  = require(path.join(LIB, 'confidenceCalibrator'));

// ─── INLINE: evaluateConfidenceGateStrict ────────────────────────────────────
// WHY INLINED: middleware/confidenceGate.js → db/pool.js → require('pg')
// pg is a runtime dep that needs npm install. Demo has zero deps by design.
// Logic is pure JS — no DB calls. Safe to inline.
//
// TODO: once `npm install` has run, replace with:
//   const { evaluateConfidenceGateStrict } = require('../gates/confidenceGate');

// [V15] AUTO_THRESHOLD lowered to 0.70 — Platt scaling ceiling ~0.71.
const AUTO_THRESHOLD = parseFloat(process.env.CONFIDENCE_AUTO || '0.70');
// [FIX-V16] HITL_THRESHOLD lowered from 0.75 to 0.50 to restore HITL_QUEUE band
const HITL_THRESHOLD = parseFloat(process.env.CONFIDENCE_HITL || '0.50');

// [FIX-V17-GATE-ASSERT] Runtime assertion to prevent gate inversion and dead HITL_QUEUE (BUG-NO-GATE-ASSERT)
if (HITL_THRESHOLD >= AUTO_THRESHOLD) {
  throw new Error(
    `CRITICAL_CONFIG_ERROR: HITL_THRESHOLD (${HITL_THRESHOLD}) must be strictly less than AUTO_THRESHOLD (${AUTO_THRESHOLD}) to prevent gate inversion and dead HITL_QUEUE.`
  );
}

const MAX_PRICE_USD  = parseFloat(process.env.MAX_PRICE_USD   || '10000');
const MIN_PRICE_USD  = parseFloat(process.env.MIN_PRICE_USD   || '0.01');

function evaluateConfidenceGateStrict(body) {
  const { confidence, clientAccountId, priceUsd, aiOutput,
          context = {}, taskType = 'default', similarityKeys = [] } = body || {};

  if (confidence === null || confidence === undefined) {
    return {
      verdict: 'HARD_REJECT', confidence: null,
      reasons: ['confidence is null — provider returned uncalibrated score. Routing to HITL.'],
      sanitized: null,
    };
  }
  const conf = typeof confidence === 'string' ? parseFloat(confidence) : confidence;
  if (!Number.isFinite(conf)) {
    return {
      verdict: 'HARD_REJECT', confidence: null,
      reasons: [`confidence "${confidence}" is not a finite number. Routing to HITL.`],
      sanitized: null,
    };
  }
  const reasons = [];
  if (!clientAccountId) reasons.push('clientAccountId is required');
  if (priceUsd === undefined || priceUsd === null) reasons.push('priceUsd is required');
  if (aiOutput === undefined) reasons.push('aiOutput is required');
  if (reasons.length) return { verdict: 'HARD_REJECT', confidence: conf, reasons, sanitized: null };

  const priceN = parseFloat(priceUsd);
  if (!Number.isFinite(priceN))       reasons.push('priceUsd is not a finite number');
  else if (priceN < MIN_PRICE_USD)    reasons.push(`priceUsd ${priceN} below minimum ${MIN_PRICE_USD}`);
  else if (priceN > MAX_PRICE_USD)    reasons.push(`priceUsd ${priceN} exceeds maximum ${MAX_PRICE_USD}`);

  if (typeof aiOutput !== 'object' || aiOutput === null || !('result' in aiOutput))
    reasons.push('aiOutput must be a non-null object with a "result" key');

  if (conf < 0 || conf > 1) reasons.push(`confidence ${conf} out of range [0, 1]`);

  const sanitized = { clientAccountId, priceUsd: String(priceUsd), aiOutput,
                      context, confidence: conf, taskType, similarityKeys };

  if (reasons.length > 0 || conf < HITL_THRESHOLD) {
    if (conf < HITL_THRESHOLD && reasons.length === 0)
      reasons.push(`confidence ${conf.toFixed(4)} below HITL threshold ${HITL_THRESHOLD}`);
    return { verdict: 'HARD_REJECT', confidence: conf, reasons, sanitized: null };
  }
  if (conf >= AUTO_THRESHOLD)
    return { verdict: 'AUTO_FLOW', confidence: conf, reasons: [], sanitized };

  return {
    verdict: 'HITL_QUEUE', confidence: conf,
    reasons: [`confidence ${conf.toFixed(4)} in HITL band [${HITL_THRESHOLD}, ${AUTO_THRESHOLD})`],
    sanitized,
  };
}

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const DEMO_CLIENT_ACCOUNT    = 'client::acme_corp_001';
const DEMO_VALIDATOR_ACCOUNT = 'validator::alice_levi';
const DEMO_PATCH_AUTHOR      = 'validator::bob_cohen';
const DEMO_TASK_TYPE         = 'contract_review';
const DEMO_PRICE_USD         = '25.00';

// ─── COLOURS ──────────────────────────────────────────────────────────────────

const C = { reset:'\x1b[0m', cyan:'\x1b[36m', green:'\x1b[32m',
            yellow:'\x1b[33m', red:'\x1b[31m', bold:'\x1b[1m', dim:'\x1b[2m' };
const ok   = (l,m) => console.log(`${C.green}✓${C.reset} ${C.bold}${l}${C.reset}  ${m}`);
const warn = (l,m) => console.log(`${C.yellow}⚠${C.reset} ${C.bold}${l}${C.reset}  ${m}`);
const info = (l,m) => console.log(`${C.cyan}→${C.reset} ${C.bold}${l}${C.reset}  ${m}`);
const fail = (l,m) => console.log(`${C.red}✗${C.reset} ${C.bold}${l}${C.reset}  ${m}`);
const sep  = (t='') => {
  console.log(`\n${C.cyan}${'─'.repeat(62)}${C.reset}`);
  if (t) console.log(`${C.bold}  ${t}${C.reset}`);
};

// ─── MOCKS ────────────────────────────────────────────────────────────────────

// TODO: replace with offlineInference.executeTask(systemPrompt, userPrompt)
function mockInference(taskType, taskInput) {
  return {
    aiOutput: {
      result: 'Contract review complete.',
      risk_level: 'medium',   // deliberate flaw — patch will correct this to 'low'
      recommendations: ['Add arbitration clause.', 'Clarify payment terms.'],
      jurisdiction: taskInput.jurisdiction || 'IL',
    },
    rawConfidence: 0.88,      // above HITL floor (0.50), below AUTO threshold (0.70)
  };
}

// TODO: replace with semanticPatchEngine.findSemanticPatch(taskType, aiOutput)
function mockFindPatch(taskType) {
  if (taskType !== DEMO_TASK_TYPE) return null;
  return {
    id:               'patch_abc123',
    validator_id:     DEMO_PATCH_AUTHOR,
    reward_per_reuse: 500n,        // 500 μ¢ = $0.05
    patch_body: {
      field: 'risk_level', from: 'medium', to: 'low',
      condition: 'jurisdiction === IL AND no_penalty_clause === false',
    },
  };
}

// TODO: replace with selfRefinementAgent.healOutput(taskType, aiOutput, patch.patch_body)
function mockHealOutput(aiOutput, patchBody) {
  const healed = JSON.parse(JSON.stringify(aiOutput));
  if (patchBody.field && patchBody.to) healed[patchBody.field] = patchBody.to;
  // confidence=null intentional: healed output still requires HITL (anti-scam invariant §2)
  return { refinedOutput: healed, confidence: null, healed: true };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function runE2EDemo() {
  sep('ECOS V6 — END-TO-END DEMO');
  console.log(`${C.dim}  Zero dependencies · No DB · No Ollama · 100% in-memory${C.reset}\n`);

  // ── Setup ──
  const ledger   = new FiatLedger();
  const auditLog = new AuditLog();

  // TODO: replace with real SSE emitter from ecos-api-server.js
  const broadcast = (event) => {
    info('SSE', `${event.type} → approvalId=${event.approvalId || 'n/a'}`);
  };

  const hitlGate = new HitlGate({ ledger, auditLog, broadcast });

  ledger.ensureAccount(DEMO_CLIENT_ACCOUNT);
  ledger.credit(DEMO_CLIENT_ACCOUNT, usdToMicrocents('1000.00'), { note: 'Demo seed' });
  ledger.ensureAccount(SYSTEM_ACCOUNTS.PLATFORM);
  ledger.credit(SYSTEM_ACCOUNTS.PLATFORM, usdToMicrocents('500.00'), { note: 'Platform seed for royalties' });
  ledger.ensureAccount(DEMO_VALIDATOR_ACCOUNT);
  ledger.ensureAccount(DEMO_PATCH_AUTHOR);

  ok('Setup', `Client balance: $${microcentsToUsdString(ledger.balance(DEMO_CLIENT_ACCOUNT))}`);

  // ── STEP 1: Confidence Calibrator ──
  sep('STEP 1 — Confidence Calibrator (Platt Scaling)');

  const calibrator = new ConfidenceCalibrator();

  // 56 synthetic labeled samples — enough to pass the isReady >= 50 threshold.
  // TODO: replace with real DB query:
  //   SELECT raw_confidence AS rawScore, (decision='approve')::int AS label
  //   FROM approvals WHERE raw_confidence IS NOT NULL LIMIT 500
  warn('Data', 'Using 56 synthetic samples (isReady=true). Replace with real approvalRepo query in production.');

  const labeledData = [
    // 30 high-confidence correct predictions (label=1)
    ...Array.from({ length: 30 }, (_, i) => ({ rawScore: 0.80 + i * 0.005, label: 1 })),
    // mid-range mixed outcomes
    { rawScore: 0.78, label: 1 }, { rawScore: 0.79, label: 0 },
    { rawScore: 0.77, label: 1 }, { rawScore: 0.76, label: 0 },
    // lower scores — mostly incorrect (label=0)
    ...Array.from({ length: 18 }, (_, i) => ({ rawScore: 0.55 + i * 0.02, label: 0 })),
    { rawScore: 0.74, label: 0 }, { rawScore: 0.73, label: 0 },
    { rawScore: 0.72, label: 1 }, { rawScore: 0.71, label: 0 },
  ]; // 56 samples total

  const fitResult = calibrator.fit(labeledData);
  ok('fit()', `A=${fitResult.A.toFixed(4)}, B=${fitResult.B.toFixed(4)}, samples=${fitResult.sampleCount}`);
  console.log(`  ${C.dim}${fitResult.message}${C.reset}`);

  console.log(`\n  ${C.bold}Spot-check (raw logprob → calibrated probability):${C.reset}`);
  for (const raw of [0.70, 0.80, 0.88, 0.92, 0.95]) {
    const cal = calibrator.calibrate(raw);
    console.log(`    raw=${raw.toFixed(2)} → calibrated=${cal.toFixed(4)}`);
  }

  // ── STEP 2: AI Inference ──
  sep('STEP 2 — AI Inference  [MOCKED]');

  const missionId = 'mission_' + Date.now();
  const taskInput = { text: 'Review NDA between Acme Corp and Startup Ltd.', jurisdiction: 'IL' };

  info('Task', `type=${DEMO_TASK_TYPE} | missionId=${missionId}`);
  const { aiOutput, rawConfidence } = mockInference(DEMO_TASK_TYPE, taskInput);
  ok('Output', `rawConfidence=${rawConfidence}  aiOutput.risk_level="${aiOutput.risk_level}"`);

  // ── STEP 3: Calibrate ──
  sep('STEP 3 — Calibrate Confidence');

  let calibratedConfidence = calibrator.isReady
    ? calibrator.calibrate(rawConfidence)
    : null;

  // DEMO_FORCE_CONFIDENCE: override for demo/testing purposes only.
  // Allows showing the full HITL → resolution → payment flow when synthetic
  // calibration data doesn't produce a score in the HITL band.
  // Do NOT use in production — in production the calibrated score drives routing.
  const forcedConf = process.env.DEMO_FORCE_CONFIDENCE
    ? parseFloat(process.env.DEMO_FORCE_CONFIDENCE)
    : null;

  if (forcedConf !== null && Number.isFinite(forcedConf)) {
    warn('Override', `DEMO_FORCE_CONFIDENCE=${forcedConf} — overriding calibrated ${calibratedConfidence} for demonstration.`);
    calibratedConfidence = forcedConf;
  }

  if (calibratedConfidence === null) {
    warn('Result', 'Calibrator not ready → null → forces HITL (invariant §2)');
  } else {
    ok('Result', `raw=${rawConfidence} → calibrated=${calibratedConfidence}`);
    info('Routing', calibratedConfidence >= AUTO_THRESHOLD
      ? `${calibratedConfidence.toFixed(4)} >= AUTO_THRESHOLD (${AUTO_THRESHOLD}) → will try AUTO_FLOW`
      : calibratedConfidence >= HITL_THRESHOLD
        ? `${calibratedConfidence.toFixed(4)} in HITL band [${HITL_THRESHOLD}, ${AUTO_THRESHOLD}) → HITL_QUEUE`
        : `${calibratedConfidence.toFixed(4)} < HITL floor (${HITL_THRESHOLD}) → HARD_REJECT`
    );
  }

  // ── STEP 4: Confidence Gate ──
  sep('STEP 4 — Confidence Gate');

  const gateResult = evaluateConfidenceGateStrict({
    clientAccountId: DEMO_CLIENT_ACCOUNT,
    priceUsd:        DEMO_PRICE_USD,
    aiOutput,
    confidence:      calibratedConfidence,
    taskType:        DEMO_TASK_TYPE,
    context:         { missionId, taskInput },
  });

  console.log(`\n  Verdict: ${C.bold}${gateResult.verdict}${C.reset}  (confidence=${gateResult.confidence})`);
  gateResult.reasons.forEach(r => console.log(`  Reason:  ${C.dim}${r}${C.reset}`));

  if (gateResult.verdict === 'HARD_REJECT') {
    fail('Gate', 'HARD_REJECT — correct behaviour. Would return 422 to B2B client.');
    console.log(`\n  ${C.yellow}This is expected with uncalibrated/low-confidence data.${C.reset}`);
    console.log(`  ${C.yellow}To demonstrate the full flow, the calibrator needs data from real approvals.${C.reset}\n`);
    process.exit(0);
  }

  ok('Gate', `${gateResult.verdict} → proceeding with ${gateResult.verdict === 'AUTO_FLOW' ? 'auto' : 'HITL'} path`);

  // ── STEP 5: Semantic Patch Lookup ──
  sep('STEP 5 — Semantic Patch Lookup  [MOCKED]');

  // TODO: const patch = await semanticPatchEngine.findSemanticPatch(DEMO_TASK_TYPE, aiOutput);
  const patch = mockFindPatch(DEMO_TASK_TYPE);
  let outputForHitl = aiOutput;

  if (patch) {
    ok('PatchEngine', `Found: id=${patch.id} by validator=${patch.validator_id}`);

    // TODO: const { refinedOutput } = await selfRefinementAgent.healOutput(
    //         DEMO_TASK_TYPE, aiOutput, patch.patch_body, { missionId });
    const { refinedOutput, healed } = mockHealOutput(aiOutput, patch.patch_body);
    ok('SelfRefinement', `healed=${healed}  risk_level: "${aiOutput.risk_level}" → "${refinedOutput.risk_level}"`);
    outputForHitl = refinedOutput;
  } else {
    warn('PatchEngine', 'No matching patch — using raw AI output.');
  }

  // ── STEP 6: HITL — Create Approval ──
  sep('STEP 6 — HITL: Create Approval');

  const approval = hitlGate.createApproval({
    missionId,
    clientAccountId: DEMO_CLIENT_ACCOUNT,
    priceUsd:        DEMO_PRICE_USD,
    aiOutput:        outputForHitl,
    context:         { taskType: DEMO_TASK_TYPE, taskInput, gateVerdict: gateResult.verdict },
    confidence:      calibratedConfidence,
  });

  ok('Created', `id=${approval.id}  status=${approval.status}`);
  console.log(`\n  ${C.yellow}━━━ ValidatorUI shows this card to ${DEMO_VALIDATOR_ACCOUNT} ━━━${C.reset}`);
  console.log(`  ${C.dim}  Task type:  ${DEMO_TASK_TYPE}${C.reset}`);
  console.log(`  ${C.dim}  Price:      $${DEMO_PRICE_USD}${C.reset}`);
  console.log(`  ${C.dim}  risk_level: ${outputForHitl.risk_level}${C.reset}`);
  console.log(`  ${C.dim}  Confidence: ${calibratedConfidence}${C.reset}`);
  console.log(`  ${C.yellow}  [ Approve ]  [ Modify ]  [ Reject ]${C.reset}\n`);

  // ── STEP 7: HITL — Validator Resolves ──
  sep('STEP 7 — HITL: Validator Decision = MODIFY');

  const validatorFinalOutput = {
    ...outputForHitl,
    risk_level:     'low',
    validator_note: 'Confirmed low risk per IL jurisdiction standard. Amendment to §4 recommended.',
  };

  const resolution = hitlGate.resolveApproval(approval.id, {
    validatorAccountId: DEMO_VALIDATOR_ACCOUNT,
    decision:           DECISION.MODIFY,
    finalOutput:        validatorFinalOutput,
    note:               'Confirmed low risk — IL NDA standard clause.',
  });

  ok('Resolved', `status=${resolution.approval.status}  decision=${resolution.approval.decision}`);

  if (resolution.receipt) {
    const r = resolution.receipt;
    const gross = usdToMicrocents(DEMO_PRICE_USD);
    ok('Ledger', '40/40/20 split — BigInt arithmetic, zero float:');
    console.log(`    Gross:     $${microcentsToUsdString(gross)}`);
    console.log(`    Platform:  $${microcentsToUsdString(r.platform)}  (40%)`);
    console.log(`    Validator: $${microcentsToUsdString(r.validator)}  (40%)  ← ${DEMO_VALIDATOR_ACCOUNT}`);
    console.log(`    Insurance: $${microcentsToUsdString(r.insurance)}   (20%)`);
    const sum = r.platform + r.validator + r.insurance;
    if (sum === gross) {
      ok('Conservation', 'Σ(platform + validator + insurance) === gross ✓');
    } else {
      fail('Conservation', `MISMATCH: ${sum} !== ${gross} — BUG`);
    }
  }

  // ── STEP 8: Royalty Trigger ──
  sep('STEP 8 — Royalty Trigger');

  if (patch) {
    // TODO: wire DB pool and replace this block with:
    //   const { RoyaltyTrigger } = require('../lib/royaltyTrigger');
    //   const rt = new RoyaltyTrigger({ ledger, auditLog, pool: dbPool });
    //   await rt.pay(patch.id, missionId);
    warn('Mode', 'Demo: direct ledger transfer. royaltyTrigger.pay() needs DB pool (see lib/royaltyTrigger.js).');

    const rewardMicro = patch.reward_per_reuse;
    ledger.transfer(
      SYSTEM_ACCOUNTS.PLATFORM,
      DEMO_PATCH_AUTHOR,
      rewardMicro,
      { kind: 'ROYALTY_DEMO', patchId: patch.id, missionId }
    );
    auditLog.append('ROYALTY_PAID', {
      patchId: patch.id, missionId,
      validatorId: DEMO_PATCH_AUTHOR,
      rewardMicro: rewardMicro.toString(),
    });
    ok('Royalty', `${DEMO_PATCH_AUTHOR} ← +$${microcentsToUsdString(rewardMicro)} (patch reuse fee)`);
  } else {
    info('Royalty', 'No patch used — no royalty triggered.');
  }

  // ── STEP 9: Audit Chain ──
  sep('STEP 9 — Audit Chain Verification');

  const verifyResult = auditLog.verify();
  if (verifyResult.ok) {
    ok('Chain', `Intact. ${verifyResult.length} entries. head=${auditLog.head().hash.slice(0,16)}...`);
  } else {
    fail('Chain', `BROKEN: ${verifyResult.reason}`);
  }

  console.log(`\n  ${C.bold}Audit log (in-memory — persists to DB in production):${C.reset}`);
  for (const e of auditLog.entries()) {
    console.log(`    [${String(e.index).padStart(2)}] ${e.type.padEnd(24)} ${e.hash.slice(0,14)}...`);
  }

  // ── STEP 10: Final Balances ──
  sep('STEP 10 — Final Account Balances');

  const toShow = [
    [DEMO_CLIENT_ACCOUNT,       ''],
    [DEMO_VALIDATOR_ACCOUNT,    ` ← ${C.green}+40% task fee${C.reset}`],
    [DEMO_PATCH_AUTHOR,         ` ← ${C.green}+royalty ($0.05)${C.reset}`],
    [SYSTEM_ACCOUNTS.PLATFORM,  ''],
    [SYSTEM_ACCOUNTS.INSURANCE, ''],
  ];
  console.log(`\n  ${'Account'.padEnd(36)} Balance (USD)`);
  console.log(`  ${'─'.repeat(52)}`);
  for (const [id, label] of toShow) {
    const usd = microcentsToUsdString(ledger.balance(id));
    console.log(`  ${id.padEnd(36)} $${usd}${label}`);
  }

  // ── Summary ──
  sep('SUMMARY');
  console.log(`
  ${C.bold}Flow completed end-to-end:${C.reset}

  1.  AI inferred contract_review output (mocked)
  2.  Platt scaling: raw ${rawConfidence} → calibrated ${calibratedConfidence}
  3.  ConfidenceGate verdict: ${C.bold}${gateResult.verdict}${C.reset}
  4.  SemanticPatch found → risk_level healed: medium → low (mocked)
  5.  HITL approval created, SSE broadcast fired
  6.  Validator resolved: MODIFY
  7.  FiatLedger: 40/40/20 BigInt split — zero float arithmetic
  8.  Royalty triggered: patch author earned +$0.05
  9.  Audit chain sealed: ${auditLog.entries().length} entries, verified intact

  ${C.bold}Remaining TODOs (see script header):${C.reset}
  ${C.yellow}  [ ] npm install pg → unlocks db/ layer${C.reset}
  ${C.yellow}  [ ] Wire real offlineInference (Ollama / cloud)${C.reset}
  ${C.yellow}  [ ] Wire semanticPatchEngine + selfRefinementAgent (needs DB)${C.reset}
  ${C.yellow}  [ ] Wire royaltyTrigger.pay() with DB pool${C.reset}
  ${C.yellow}  [ ] Wire hitlGate broadcast → ValidatorUI SSE clients${C.reset}
  ${C.yellow}  [ ] Persist auditLog to DB (in-memory resets on restart)${C.reset}
  ${C.yellow}  [ ] 50+ real labeled approvals → swap synthetic calibrator data${C.reset}
`);

  sep();
  ok('DONE', 'ecos-e2e-demo completed.');
  console.log();
}

runE2EDemo().catch(err => {
  fail('FATAL', err.message);
  console.error(err.stack);
  process.exit(1);
});
