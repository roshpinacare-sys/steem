#!/usr/bin/env node
/**
 * ECOS Seed Calibrator — V58
 * ──────────────────────────
 * שולח 60 משימות סינטטיות לשרת, מאשר/דוחה כ-labeled data,
 * אחר כך קורא POST /api/v1/calibrator/fit.
 *
 * תוצאה מצופה: calibrator.isReady=true, sampleCount≥50
 *
 * Usage:
 *   cd engine
 *   node scripts/seed-calibrator.js
 *
 * דרישות:
 *   - שרת כבר רץ על PORT (default: 3000)
 *   - או: SERVER_RUNNING=0 להפעיל שרת זמני אוטומטית
 *
 * משמעות ה-labeled data:
 *   - label=1 (approve): rawScore גבוה → המשימה הייתה נכונה
 *   - label=0 (reject):  rawScore נמוך → המשימה הייתה שגויה
 *   Platt scaling לומד לכייל את rawScore לפי ה-labels האלה.
 */

'use strict';

const http   = require('http');
const { spawn } = require('child_process');
const path   = require('path');

const PORT    = parseInt(process.env.PORT || '3000', 10);
const BASE    = `http://127.0.0.1:${PORT}`;
const CLIENT  = 'client::calibrator_seed';
const VALIDTR = 'validator::calibrator_seed_v1';

// Colour helpers
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  green: '\x1b[32m', yellow: '\x1b[33m',
  red: '\x1b[31m',   cyan: '\x1b[36m',   blue: '\x1b[34m',
};
const ok   = msg => console.log(`${C.green}  ✓ ${msg}${C.reset}`);
const warn = msg => console.log(`${C.yellow}  ⚠ ${msg}${C.reset}`);
const info = msg => console.log(`${C.cyan}  → ${msg}${C.reset}`);
const hdr  = msg => console.log(`\n${C.bold}${C.blue}══ ${msg} ══${C.reset}`);
const fail = msg => console.log(`${C.red}  ✗ ${msg}${C.reset}`);

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function request(method, path_, body) {
  return new Promise((res, rej) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1', port: PORT,
      path: path_, method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, r => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try { res({ status: r.statusCode, body: JSON.parse(data) }); }
        catch { res({ status: r.statusCode, body: data }); }
      });
    });
    req.on('error', rej);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForServer(retries = 20) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await request('GET', '/api/v1/verify');
      if (r.status === 200) return true;
    } catch { /* not ready */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

// ── Synthetic task templates ───────────────────────────────────────────────────
// 30 tasks that should APPROVE (clear, well-formed requests)
// 30 tasks that should REJECT/MODIFY (vague, contradictory, or low quality)
const APPROVE_TASKS = [
  { text: 'Review this NDA: Acme Corp grants 5-year exclusivity in EMEA. Check for liability gaps.', type: 'contract_review' },
  { text: 'Extract all party names and effective dates from this SLA agreement.', type: 'data_extraction' },
  { text: 'Summarize the key financial obligations in this vendor contract.', type: 'summarization' },
  { text: 'Identify jurisdiction clauses in this cross-border agreement.', type: 'contract_review' },
  { text: 'List all defined terms in section 3 of this licensing agreement.', type: 'data_extraction' },
  { text: 'Summarize indemnification clauses for executive review.', type: 'summarization' },
  { text: 'Check whether this employment contract complies with EU GDPR for data handling.', type: 'contract_review' },
  { text: 'Extract all payment milestones and amounts from this SOW.', type: 'data_extraction' },
  { text: 'Summarize termination conditions in plain English for non-legal stakeholders.', type: 'summarization' },
  { text: 'Review IP assignment clause — does it cover work made for hire in California?', type: 'contract_review' },
  { text: 'Extract all SLAs and penalty structures from this MSA.', type: 'data_extraction' },
  { text: 'Summarize arbitration procedure in this dispute resolution clause.', type: 'summarization' },
  { text: 'Verify that this SAFE note includes standard MFN provision.', type: 'contract_review' },
  { text: 'List all representations and warranties made by each party.', type: 'data_extraction' },
  { text: 'Summarize the scope of work section for the project manager.', type: 'summarization' },
  { text: 'Review confidentiality clause — does it survive termination?', type: 'contract_review' },
  { text: 'Extract all pricing tiers and volume discounts from this reseller agreement.', type: 'data_extraction' },
  { text: 'Summarize liability caps in this software license agreement.', type: 'summarization' },
  { text: 'Check whether this term sheet includes anti-dilution protection for Series A.', type: 'contract_review' },
  { text: 'Extract all governing law and venue clauses from this suite of contracts.', type: 'data_extraction' },
  { text: 'Summarize data processing addendum obligations for the privacy team.', type: 'summarization' },
  { text: 'Review force majeure clause — does it include pandemic provisions?', type: 'contract_review' },
  { text: 'Extract all assignment restrictions and consent requirements.', type: 'data_extraction' },
  { text: 'Summarize notice requirements and escalation procedures.', type: 'summarization' },
  { text: 'Review non-compete clause — is it enforceable in New York?', type: 'contract_review' },
  { text: 'Extract all audit rights granted to each party in this enterprise agreement.', type: 'data_extraction' },
  { text: 'Summarize all conditions precedent to closing this transaction.', type: 'summarization' },
  { text: 'Verify that this escrow agreement includes standard release conditions.', type: 'contract_review' },
  { text: 'Extract all change-of-control provisions and their triggers.', type: 'data_extraction' },
  { text: 'Summarize the warranty and support obligations in this hardware agreement.', type: 'summarization' },
];

const REJECT_TASKS = [
  { text: 'review contract', type: 'contract_review' },                // too vague
  { text: 'check the document', type: 'contract_review' },             // no document
  { text: 'fix this', type: 'data_extraction' },                       // no context
  { text: 'tell me everything important', type: 'summarization' },     // undefined scope
  { text: 'contract good or bad?', type: 'contract_review' },         // ambiguous
  { text: 'data', type: 'data_extraction' },                           // single word
  { text: 'summarize it', type: 'summarization' },                     // no referent
  { text: 'is this legal?', type: 'contract_review' },                 // no doc, no jurisdiction
  { text: 'extract all the stuff', type: 'data_extraction' },          // undefined "stuff"
  { text: 'write a summary but make it comprehensive and brief', type: 'summarization' }, // contradiction
  { text: 'review contract make it better also add things', type: 'contract_review' },
  { text: 'give me the data from the thing I sent you', type: 'data_extraction' },
  { text: 'short summary but include everything', type: 'summarization' },
  { text: 'is the contract ok for us', type: 'contract_review' },
  { text: 'extract', type: 'data_extraction' },
  { text: 'summarize this document into a summary', type: 'summarization' },
  { text: 'review the legal stuff in that thing', type: 'contract_review' },
  { text: 'get all info from document', type: 'data_extraction' },
  { text: 'make a summary that covers all key points comprehensively in 2 sentences', type: 'summarization' },
  { text: 'check contract for any issues and fix them all', type: 'contract_review' },
  { text: 'extract data', type: 'data_extraction' },
  { text: 'quick summary', type: 'summarization' },
  { text: 'look at this', type: 'contract_review' },
  { text: 'info please', type: 'data_extraction' },
  { text: 'what does this say', type: 'summarization' },
  { text: 'analyze everything holistically from a high level in detail', type: 'contract_review' },
  { text: 'get the numbers out', type: 'data_extraction' },
  { text: 'tldr', type: 'summarization' },
  { text: 'is the contract risky?', type: 'contract_review' },
  { text: 'pull all the data and give me only what matters', type: 'data_extraction' },
];

// ── generateSyntheticCalibrationData — exported for tests ──────────────────
/**
 * Generates n synthetic calibration samples.
 * Distribution:
 *   60% label=1 (approved)  rawScore in [0.6, 1.0]
 *   40% label=0 (rejected)  rawScore in [0.0, 0.5]
 */
function generateSyntheticCalibrationData(n) {
  const samples = [];
  const nApproved = Math.round(n * 0.6);
  const nRejected = n - nApproved;

  for (let i = 0; i < nApproved; i++) {
    // rawScore in [0.6, 1.0]
    const rawScore = 0.6 + (i / Math.max(nApproved - 1, 1)) * 0.4;
    samples.push({ rawScore: Math.min(1.0, rawScore), label: 1 });
  }
  for (let i = 0; i < nRejected; i++) {
    // rawScore in [0.0, 0.5]
    const rawScore = 0.0 + (i / Math.max(nRejected - 1, 1)) * 0.5;
    samples.push({ rawScore: Math.min(0.5, rawScore), label: 0 });
  }
  return samples;
}

module.exports = { generateSyntheticCalibrationData };

// ── Dry-run mode: standalone calibration (no server) ───────────────────────
if (process.argv.includes('--dry-run')) {
  (function dryRun() {
    const fs = require('fs');

    console.log(`\n${C.bold}${C.blue}╔══════════════════════════════════════════╗`);
    console.log(`║   ECOS Seed Calibrator — Dry Run         ║`);
    console.log(`╚══════════════════════════════════════════╝${C.reset}\n`);

    // Generate 60 deterministic synthetic samples
    function linSpace(start, end, count) {
      const vals = [];
      const step = count > 1 ? (end - start) / (count - 1) : 0;
      for (let i = 0; i < count; i++) vals.push(start + step * i);
      return vals;
    }

    const samples = [];
    // 25 rawScore[0.70-0.98] label=1
    linSpace(0.70, 0.98, 25).forEach(v => samples.push({ rawScore: v, label: 1 }));
    // 15 rawScore[0.52-0.69] label=1
    linSpace(0.52, 0.69, 15).forEach(v => samples.push({ rawScore: v, label: 1 }));
    // 12 rawScore[0.30-0.51] label=0
    linSpace(0.30, 0.51, 12).forEach(v => samples.push({ rawScore: v, label: 0 }));
    // 8 rawScore[0.65-0.80] label=0
    linSpace(0.65, 0.80, 8).forEach(v => samples.push({ rawScore: v, label: 0 }));

    info(`Generated ${samples.length} deterministic synthetic samples`);

    // Platt scaling gradient descent (pure JS, no deps)
    const sigmoid = x => 1 / (1 + Math.exp(-x));
    let A = 0;
    let B = 0;
    const lr = 0.1;
    const epochs = 2000;

    for (let e = 0; e < epochs; e++) {
      let dA = 0;
      let dB = 0;
      for (const { rawScore: x, label: y } of samples) {
        const p = sigmoid(A * x + B);
        const err = p - y;
        dA += err * x;
        dB += err;
      }
      A -= (lr / samples.length) * dA;
      B -= (lr / samples.length) * dB;
    }

    const checkRaw = 0.85;
    const checkCal = sigmoid(A * checkRaw + B);

    const result = {
      A,
      B,
      sampleCount: samples.length,
      fittedAt: new Date().toISOString(),
    };

    const outPath = path.join(__dirname, '..', 'calibration_params.json');
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');

    ok(`Fitted A=${A.toFixed(10)} B=${B.toFixed(10)} sampleCount=${samples.length}`);
    ok(`Calibration check: rawScore=${checkRaw} -> calibratedScore=${checkCal.toFixed(6)}`);
    process.exit(0);
  })();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}${C.blue}╔══════════════════════════════════════════╗`);
  console.log(`║   ECOS Seed Calibrator — V58            ║`);
  console.log(`╚══════════════════════════════════════════╝${C.reset}\n`);

  // 1. Check server
  hdr('Step 1: Connecting to server');
  info(`Waiting for server on port ${PORT}...`);
  const alive = await waitForServer();
  if (!alive) {
    fail(`Server not reachable on port ${PORT}. Start it first: node ecos-api-server.js`);
    process.exit(1);
  }
  ok('Server is up');

  // 2. Fund seed client
  hdr('Step 2: Fund seed client ($500)');
  const depositRes = await request('POST', '/api/v1/deposit', {
    clientAccountId: CLIENT,
    amountUsd: '500.00',
    idempotencyKey: `seed-calibrator-fund-${Date.now()}`,
  });
  if (depositRes.status === 200) {
    ok(`Funded ${CLIENT} — idempotent: ${depositRes.body.idempotent || false}`);
  } else {
    warn(`Deposit returned ${depositRes.status} — continuing (account may already have funds)`);
  }

  // 3. Submit tasks and collect approvalIds
  hdr('Step 3: Submitting 60 seed tasks');

  const labeled = []; // { approvalId, label }

  async function submitTask(taskText, taskType, label) {
    try {
      const r = await request('POST', '/api/v1/task', {
        missionId:        `seed_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        clientAccountId:  CLIENT,
        taskType,
        taskInput:        { instruction: taskText },
        priceUsd:         '1.00',
        context:          { source: 'seed-calibrator' },
      });
      if (r.status === 200 && r.body.approvalId) {
        labeled.push({ approvalId: r.body.approvalId, label });
        return true;
      }
      return false;
    } catch { return false; }
  }

  let submitted = 0;
  process.stdout.write('  Submitting');
  for (const t of APPROVE_TASKS) {
    const ok_ = await submitTask(t.text, t.type, 1);
    if (ok_) { submitted++; process.stdout.write('.'); }
    await new Promise(r => setTimeout(r, 50)); // avoid hammering
  }
  for (const t of REJECT_TASKS) {
    const ok_ = await submitTask(t.text, t.type, 0);
    if (ok_) { submitted++; process.stdout.write('.'); }
    await new Promise(r => setTimeout(r, 50));
  }
  console.log('');
  ok(`Submitted ${submitted}/60 tasks, collected ${labeled.length} approvalIds`);

  if (labeled.length < 10) {
    fail(`Only ${labeled.length} approvals collected — need at least 10 to fit. Aborting.`);
    process.exit(1);
  }

  // 4. Resolve each approval (approve label=1, reject label=0)
  hdr('Step 4: Resolving approvals as labeled data');
  let resolved = 0;
  process.stdout.write('  Resolving');
  for (const { approvalId, label } of labeled) {
    try {
      // [FIX-V58-P2] was: POST /api/v1/resolve (endpoint does not exist → 404 silent failure)
      // Correct endpoint: POST /api/v1/approvals/:id/resolve
      const r = await request('POST', `/api/v1/approvals/${approvalId}/resolve`, {
        validatorAccountId: VALIDTR,
        decision: label === 1 ? 'approve' : 'reject',
        ...(label === 0 ? { note: 'seed: low quality task' } : {}),
      });
      if (r.status === 200) { resolved++; process.stdout.write(label === 1 ? '+' : '-'); }
      else { process.stdout.write('?'); }
    } catch { process.stdout.write('!'); }
    await new Promise(r => setTimeout(r, 30));
  }
  console.log('');
  ok(`Resolved ${resolved}/${labeled.length} approvals (+ = approve, - = reject)`);

  // 5. Build labeled data for calibrator/fit from the resolutions
  // We have to fetch training data from the server (which reads from DB/in-memory)
  hdr('Step 5: Fetching training data');
  const tdRes = await request('GET', '/api/v1/calibrator/training-data');
  const samples = tdRes.body?.samples || [];
  info(`Server reports ${samples.length} samples available`);

  // Fallback: if DB not available, build samples from our labeled array
  // using synthetic rawScore distribution matching the approve/reject split
  let fitData = samples;
  if (fitData.length < 10) {
    warn(`DB training data insufficient (${fitData.length}) — using synthetic distribution`);
    fitData = labeled.map(({ label }) => ({
      rawScore: label === 1
        ? 0.82 + (Math.random() * 0.12)   // approve: 0.82–0.94
        : 0.45 + (Math.random() * 0.25),  // reject:  0.45–0.70
      label,
    }));
    ok(`Built ${fitData.length} synthetic samples from labeled resolves`);
  }

  // 6. Fit calibrator
  hdr('Step 6: Fitting calibrator');
  info(`Sending ${fitData.length} samples to POST /api/v1/calibrator/fit`);
  const fitRes = await request('POST', '/api/v1/calibrator/fit', { data: fitData });

  if (fitRes.status !== 200) {
    fail(`Fit failed: ${fitRes.status} — ${JSON.stringify(fitRes.body)}`);
    process.exit(1);
  }

  const fit = fitRes.body;
  ok(`Fit complete — A=${fit.A?.toFixed(4)}, B=${fit.B?.toFixed(4)}, samples=${fit.sampleCount}`);
  ok(`isReady: ${fit.ready} | persisted: ${fit.persisted}`);

  if (!fit.ready) {
    warn(`isReady=false — need ${Math.max(0, 50 - (fit.sampleCount || 0))} more samples.`);
    warn(`Re-run after accumulating more real approvals.`);
  }

  // 7. Verify calibrator status
  hdr('Step 7: Calibrator status');
  const statusRes = await request('GET', '/api/v1/calibrator');
  const st = statusRes.body;
  console.log(`  isReady:      ${st.isReady}`);
  console.log(`  sampleCount:  ${st.sampleCount}`);
  console.log(`  autoThreshold: ${st.autoThreshold}`);
  console.log(`  hitlThreshold: ${st.hitlThreshold}`);
  console.log(`  note:         ${st.note}`);

  console.log(`\n${C.bold}${C.green}══ Done ══${C.reset}`);
  console.log(`  Tasks submitted: ${submitted}`);
  console.log(`  Approvals resolved: ${resolved}`);
  console.log(`  Samples for fit: ${fitData.length}`);
  console.log(`  Calibrator ready: ${fit.ready}\n`);

  if (fit.ready) {
    ok('Calibrator is now fitted and active.');
    ok('AUTO_FLOW will fire when calibrated confidence ≥ ' + st.autoThreshold);
  } else {
    warn('Calibrator not yet ready. Run again after more real approvals accumulate.');
  }
}

// Only run main() when executed directly, not when require()'d from tests
if (require.main === module) {
  main().catch(e => {
    console.error(`\n${C.red}Fatal error: ${e.message}${C.reset}`);
    process.exit(1);
  });
}
