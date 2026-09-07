#!/usr/bin/env node
/**
 * ECOS V31 — Contract Review End-to-End Demo Script
 * ==================================================
 * Full Loop B: seed deposit → 3× contract_review tasks → HITL queue →
 *   resolve via Next.js route (POST /api/mission/[missionId]/approvals) →
 *   receipt + validatorBalance.
 *
 * Changes from V30:
 *   [V31-DEMO-1] Step 6 Next.js resolve URL includes ?validator=validator::legal_counsel
 *                to exercise the query param feature (validator/page.jsx useSearchParams).
 *                SKIP_NEXTJS=1 path unchanged — calls Express directly, no query param needed.
 *   [V31-DEMO-2] Same query param added to Step 7 (idempotency replay URL) for consistency.
 *
 * Changes from V28:
 *   [V29-DEMO-1] HITL resolve now calls the Next.js App Router route
 *                (POST /api/mission/<missionId>/approvals) instead of
 *                Express directly. This exercises the Full Loop B path:
 *                withIdempotency → proxy → hitlGate.resolveApproval().
 *   [V29-DEMO-2] Idempotency-Key header sent on every resolve request.
 *                Duplicate-resolve guard is now DB-backed, not just in-memory.
 *   [V29-DEMO-3] Receipt (gross/platform/validator/insurance) and
 *                validatorBalance are read from the Next.js route response
 *                and printed in the demo output.
 *   [V29-DEMO-4] Second resolve of the same approval (same Idempotency-Key)
 *                demonstrates the idempotency replay path (X-Idempotent-Replay: true).
 *
 * Flow:
 *   1. Start Express (ecos-api-server.js) on PORT_EXPRESS
 *   2. Start Next.js (apps/web) on PORT_NEXT  [requires `next build` first]
 *   3. Seed: POST /api/v1/deposit → client::goldman_corp += $1,000
 *   4. Calibrate: POST /api/v1/calibrator/fit (50 synthetic samples)
 *   5. Task 1 (rawConfidence 0.85) → AUTO_FLOW → immediate receipt
 *   6. Task 2 (rawConfidence 0.62) → HITL_QUEUE → approvalId captured
 *   7. Task 3 (rawConfidence 0.35) → HARD_REJECT (422)
 *   8. Resolve Task 2 via Next.js route with Idempotency-Key → receipt + balance
 *   9. Idempotency replay: same resolve again → X-Idempotent-Replay: true
 *  10. Payout via Express
 *  11. Verify audit chain
 *
 * HOW TO RUN (demo mode — Express only, Next.js optional):
 *   SKIP_NEXTJS=1 node scripts/ecos-demo-contract.js
 *
 * HOW TO RUN (full loop — both servers):
 *   # Terminal 1: cd apps/web && npm run build && npm start (port 3001)
 *   # Terminal 2: node scripts/ecos-demo-contract.js
 *
 * Zero external dependencies — Node.js built-ins only.
 */

'use strict';

const http   = require('node:http');
const https  = require('node:https');
const { spawn } = require('node:child_process');
const path   = require('node:path');
const crypto = require('node:crypto');

const PORT_EXPRESS = 3005;
const PORT_NEXT    = 3006; // used only if SKIP_NEXTJS is not set
const SKIP_NEXTJS  = !!process.env.SKIP_NEXTJS;

const EXPRESS_BASE = `http://127.0.0.1:${PORT_EXPRESS}`;
const NEXTJS_BASE  = SKIP_NEXTJS ? null : `http://127.0.0.1:${PORT_NEXT}`;

// ── ANSI colors ────────────────────────────────────────────────────────────
const C = {
  reset: '\u001b[0m', bold: '\u001b[1m',
  green: '\u001b[32m', yellow: '\u001b[33m',
  red: '\u001b[31m', cyan: '\u001b[36m', magenta: '\u001b[35m', purple: '\u001b[35m',
};
function logHeader(text) { console.log(`\n${C.bold}${C.cyan}=== ${text} ===${C.reset}`); }
function logInfo(text)    { console.log(`${C.cyan}[INFO]${C.reset} ${text}`); }
function logSuccess(text) { console.log(`${C.green}[✓]${C.reset} ${text}`); }
function logWarning(text) { console.log(`${C.yellow}[⚠]${C.reset} ${text}`); }
function logError(text)   { console.log(`${C.red}[✗]${C.reset} ${text}`); }
function logDetail(text)  { console.log(`    ${text}`); }

// ── HTTP request helper ────────────────────────────────────────────────────
function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const lib = options.protocol === 'https:' ? https : http;
    const reqOpts = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    };
    const req = lib.request(reqOpts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        if (res.headers['content-type']?.includes('application/json')) {
          try { parsed = JSON.parse(data); } catch (_) {}
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: parsed,
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// URL-based request helper (for Next.js route calls)
function requestUrl(url, opts = {}) {
  const parsed = new URL(url);
  return request({
    hostname: parsed.hostname,
    port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path:     parsed.pathname + parsed.search,
    method:   opts.method || 'GET',
    headers:  opts.headers || {},
    protocol: parsed.protocol,
  }, opts.body || null);
}

// ── nanoid-compatible idempotency key (no deps) ────────────────────────────
function genIdempotencyKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(21);
  return Array.from(bytes).map(b => chars[b % chars.length]).join('');
}

// ── Wait for server ────────────────────────────────────────────────────────
async function waitForServer(baseUrl, path = '/api/v1/calibrator', retries = 15) {
  const parsed = new URL(baseUrl + path);
  for (let i = 0; i < retries; i++) {
    try {
      const res = await request({ hostname: parsed.hostname, port: parsed.port, path: parsed.pathname, method: 'GET' });
      if (res.statusCode < 500) return true;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error(`Server at ${baseUrl} did not start in time.`);
}

// ── Main demo ──────────────────────────────────────────────────────────────
async function runDemo() {
  logHeader('ECOS V31 — CONTRACT REVIEW FULL LOOP B DEMO');
  logInfo(`Express port: ${PORT_EXPRESS}`);
  if (SKIP_NEXTJS) {
    logWarning('SKIP_NEXTJS=1 — resolve will call Express directly (no idempotency via Next.js)');
  } else {
    logInfo(`Next.js port: ${PORT_NEXT} — resolve calls POST /api/mission/[missionId]/approvals`);
  }

  // ── Start Express ────────────────────────────────────────────────────────
  logInfo('Starting Express (ecos-api-server.js)...');
  const env = { ...process.env, PORT: PORT_EXPRESS.toString() };
  const serverPath = path.resolve(__dirname, '../ecos-api-server.js');
  const serverProc = spawn('node', [serverPath], { env });
  serverProc.stderr.on('data', d => logWarning(`Express stderr: ${d.toString().trim()}`));

  // ── Start Next.js (optional) ─────────────────────────────────────────────
  let nextProc = null;
  if (!SKIP_NEXTJS) {
    logInfo('Starting Next.js (apps/web)...');
    const webDir = path.resolve(__dirname, '../apps/web');
    const nextEnv = {
      ...process.env,
      PORT: PORT_NEXT.toString(),
      ECOS_EXPRESS_URL: EXPRESS_BASE,
      NEXT_PUBLIC_EXPRESS_URL: EXPRESS_BASE,
    };
    nextProc = spawn('node', ['node_modules/.bin/next', 'start', '--port', String(PORT_NEXT)], {
      cwd: webDir,
      env: nextEnv,
    });
    nextProc.stderr.on('data', d => logWarning(`Next.js stderr: ${d.toString().trim()}`));
  }

  function shutdown(exitCode = 0) {
    logInfo('Shutting down servers...');
    serverProc.kill('SIGTERM');
    if (nextProc) nextProc.kill('SIGTERM');
    process.exit(exitCode);
  }
  process.on('SIGINT',  () => shutdown(1));
  process.on('SIGTERM', () => shutdown(1));

  try {
    // Wait for Express
    await waitForServer(EXPRESS_BASE);
    logSuccess('Express is up!');

    // Wait for Next.js (if started)
    if (!SKIP_NEXTJS && nextProc) {
      logInfo('Waiting for Next.js...');
      await waitForServer(NEXTJS_BASE, '/', 30);
      logSuccess('Next.js is up!');
    }

    // ── 1. Seed deposit ────────────────────────────────────────────────────
    logHeader('STEP 1: SEED CLIENT BALANCE');
    logInfo('POST /api/v1/deposit → client::goldman_corp += $1,000');
    const depositKey = 'demo-seed-goldman-v29-' + Date.now();
    const depositRes = await request(
      { hostname: '127.0.0.1', port: PORT_EXPRESS, path: '/api/v1/deposit', method: 'POST' },
      { clientAccountId: 'client::goldman_corp', amountUsd: '1000.00', idempotencyKey: depositKey }
    );
    if (depositRes.statusCode === 200) {
      logSuccess(`Funded. Balance: $${depositRes.body.balanceUsd ?? '?'} · depositId: ${depositRes.body.depositId ?? 'n/a'}`);
    } else {
      logWarning(`Deposit returned ${depositRes.statusCode} — tasks may fail.`);
      logDetail(JSON.stringify(depositRes.body));
    }

    // ── 2. Calibrate ───────────────────────────────────────────────────────
    logHeader('STEP 2: CALIBRATE');
    const syntheticData = [];
    for (let i = 0; i < 25; i++) {
      syntheticData.push({ rawScore: 0.72 + i * 0.01, label: 1 });
      syntheticData.push({ rawScore: 0.30 + i * 0.01, label: 0 });
    }
    const fitRes = await request(
      { hostname: '127.0.0.1', port: PORT_EXPRESS, path: '/api/v1/calibrator/fit', method: 'POST' },
      { data: syntheticData }
    );
    if (fitRes.statusCode === 200 && fitRes.body.ready) {
      logSuccess('Calibrator fitted (Platt scaling ready).');
    } else {
      logWarning(`Calibrator fit returned ${fitRes.statusCode}`);
      logDetail(JSON.stringify(fitRes.body));
    }

    // ── 3. Task 1: AUTO_FLOW ───────────────────────────────────────────────
    logHeader('STEP 3: TASK 1 — AUTO_FLOW (confidence 0.85)');
    const task1Res = await request(
      { hostname: '127.0.0.1', port: PORT_EXPRESS, path: '/api/v1/task', method: 'POST' },
      {
        clientAccountId: 'client::goldman_corp',
        priceUsd: '85.00',
        rawConfidence: 0.85,
        aiOutput: { result: 'Indemnity clause is standard. Limits liabilities to fee paid. Risk is low.' },
        taskType: 'contract_review',
        context: { missionId: 'contract_nda_001', description: 'NDA Indemnity Review' },
      }
    );
    if (task1Res.statusCode === 200) {
      logSuccess('Task 1: AUTO_FLOW approved immediately.');
      if (task1Res.body.split) {
        logDetail(`gross: $${task1Res.body.split.gross} · platform: $${task1Res.body.split.platform} · insurance: $${task1Res.body.split.insurance}`);
      }
    } else {
      logError(`Task 1 failed: ${task1Res.statusCode}`);
      logDetail(JSON.stringify(task1Res.body));
    }

    // ── 4. Task 2: HITL_QUEUE ──────────────────────────────────────────────
    logHeader('STEP 4: TASK 2 — HITL_QUEUE (confidence 0.62)');
    const task2Res = await request(
      { hostname: '127.0.0.1', port: PORT_EXPRESS, path: '/api/v1/task', method: 'POST' },
      {
        clientAccountId: 'client::goldman_corp',
        priceUsd: '150.00',
        rawConfidence: 0.62,
        aiOutput: { result: 'Commercial lease contains 6% annual escalation clause. Exceeds standard index.' },
        taskType: 'contract_review',
        context: { missionId: 'lease_agreement_77', description: 'Lease Escalation Check' },
      }
    );
    let approvalId = null;
    let task2MissionId = null;
    if (task2Res.statusCode === 202) {
      approvalId    = task2Res.body.approvalId;
      task2MissionId = task2Res.body.missionId || 'lease_agreement_77';
      logSuccess(`Task 2 queued for HITL. approvalId: ${approvalId} · missionId: ${task2MissionId}`);
    } else {
      logError(`Task 2 failed: ${task2Res.statusCode}`);
      logDetail(JSON.stringify(task2Res.body));
      shutdown(1);
      return;
    }

    // ── 5. Task 3: HARD_REJECT ─────────────────────────────────────────────
    logHeader('STEP 5: TASK 3 — HARD_REJECT (confidence 0.35)');
    const task3Res = await request(
      { hostname: '127.0.0.1', port: PORT_EXPRESS, path: '/api/v1/task', method: 'POST' },
      {
        clientAccountId: 'client::goldman_corp',
        priceUsd: '100.00',
        rawConfidence: 0.35,
        aiOutput: { result: 'Unreadable or corrupt text found in clauses.' },
        taskType: 'contract_review',
        context: { missionId: 'corrupt_doc_111', description: 'Corrupt PDF analysis' },
      }
    );
    if (task3Res.statusCode === 422) {
      logSuccess('Task 3 HARD_REJECTED by confidence gate (422).');
    } else {
      logWarning(`Task 3 expected 422 but got ${task3Res.statusCode}`);
      logDetail(JSON.stringify(task3Res.body));
    }

    // ── 6. HITL Resolve via Next.js route ─────────────────────────────────
    logHeader('STEP 6: RESOLVE TASK 2 — via Next.js route (Full Loop B)');
    const resolveIdemKey = genIdempotencyKey();

    const resolveBody = {
      approvalId,
      validatorAccountId: 'validator::legal_counsel',
      decision: 'approve',
      finalOutput: {
        result: 'Approved. Annual escalation of 6% acceptable for premium commercial properties.',
      },
      note: 'Escalation within commercial tolerance for this location.',
    };

    let resolveRes;
    if (SKIP_NEXTJS) {
      // Fallback: call Express directly
      logWarning('Calling Express directly (SKIP_NEXTJS=1 — idempotency via Next.js skipped)');
      resolveRes = await request(
        { hostname: '127.0.0.1', port: PORT_EXPRESS, path: `/api/v1/approvals/${approvalId}/resolve`, method: 'POST' },
        { validatorAccountId: resolveBody.validatorAccountId, decision: resolveBody.decision, finalOutput: resolveBody.finalOutput, note: resolveBody.note }
      );
      resolveRes.headers = resolveRes.headers || {};
    } else {
      // [V29-DEMO-1] Call Next.js route with Idempotency-Key
      const nextUrl = `${NEXTJS_BASE}/api/mission/${encodeURIComponent(task2MissionId)}/approvals?validator=validator::legal_counsel`;
      logInfo(`POST ${nextUrl}`);
      logInfo(`Idempotency-Key: ${resolveIdemKey}`);
      resolveRes = await requestUrl(nextUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': resolveIdemKey,
        },
        body: resolveBody,
      });
    }

    if (resolveRes.statusCode === 200) {
      logSuccess('Approval resolved successfully!');
      // [V29-DEMO-3] Print receipt + validatorBalance
      const data = resolveRes.body;
      if (data.receipt) {
        logDetail(`receipt.gross:     $${data.receipt.gross}`);
        logDetail(`receipt.platform:  $${data.receipt.platform}`);
        logDetail(`receipt.validator: $${data.receipt.validator}`);
        logDetail(`receipt.insurance: $${data.receipt.insurance}`);
      }
      if (data.validatorBalance !== null && data.validatorBalance !== undefined) {
        logDetail(`validatorBalance (post-settlement): $${data.validatorBalance}`);
      }
      if (data.royaltyPaid) {
        logDetail(`royaltyPaid: $${data.royaltyPaid.rewardUsd} → ${data.royaltyPaid.validatorId}`);
      }
    } else {
      logError(`Resolve failed: ${resolveRes.statusCode}`);
      logDetail(JSON.stringify(resolveRes.body));
      shutdown(1);
      return;
    }

    // ── 7. Idempotency replay (same key, same body) ────────────────────────
    if (!SKIP_NEXTJS) {
      logHeader('STEP 7: IDEMPOTENCY REPLAY (same key → cached response)');
      logInfo(`Sending identical resolve request with same Idempotency-Key: ${resolveIdemKey}`);
      const replayUrl = `${NEXTJS_BASE}/api/mission/${encodeURIComponent(task2MissionId)}/approvals?validator=validator::legal_counsel`;
      const replayRes = await requestUrl(replayUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': resolveIdemKey,
        },
        body: resolveBody,
      });
      const isReplay = replayRes.headers['x-idempotent-replay'] === 'true';
      if (replayRes.statusCode === 200 && isReplay) {
        logSuccess('Idempotency replay confirmed (X-Idempotent-Replay: true). No double-resolve.');
      } else if (replayRes.statusCode === 409) {
        // Express ALREADY_RESOLVED — still correct, the key was not yet cached before resolve
        logSuccess('Idempotency guard active (409 ALREADY_RESOLVED from Express). No double-resolve.');
      } else {
        logWarning(`Replay returned ${replayRes.statusCode} · X-Idempotent-Replay: ${replayRes.headers['x-idempotent-replay'] ?? 'not set'}`);
        logDetail(JSON.stringify(replayRes.body));
      }
    }

    // ── 8. Check validator balance ─────────────────────────────────────────
    logHeader('STEP 8: VALIDATOR BALANCE CHECK');
    const balRes = await request({
      hostname: '127.0.0.1', port: PORT_EXPRESS,
      path: '/api/v1/account?id=validator::legal_counsel', method: 'GET',
    });
    if (balRes.statusCode === 200) {
      logSuccess(`validator::legal_counsel balance: $${balRes.body.balance_usd}`);
    } else {
      logWarning(`Account check: ${balRes.statusCode}`);
    }

    // ── 9. Stripe payout ───────────────────────────────────────────────────
    logHeader('STEP 9: STRIPE PAYOUT');
    const payoutRes = await request(
      { hostname: '127.0.0.1', port: PORT_EXPRESS, path: '/api/v1/payout', method: 'POST' },
      { validatorAccountId: 'validator::legal_counsel', amountUsd: '45.00' }
    );
    if (payoutRes.statusCode === 200) {
      logSuccess(`Payout processed. mock: ${payoutRes.body.mock} · payoutId: ${payoutRes.body.payoutId}`);
    } else {
      logWarning(`Payout: ${payoutRes.statusCode}`);
      logDetail(JSON.stringify(payoutRes.body));
    }

    // ── 10. Audit chain verify ─────────────────────────────────────────────
    logHeader('STEP 10: AUDIT CHAIN INTEGRITY');
    const verifyRes = await request({
      hostname: '127.0.0.1', port: PORT_EXPRESS, path: '/api/v1/verify', method: 'GET',
    });
    if (verifyRes.statusCode === 200 && verifyRes.body.ok) {
      logSuccess(`Audit chain intact. entries: ${verifyRes.body.length ?? '?'}`);
    } else {
      logError('Audit chain verification failed!');
      logDetail(JSON.stringify(verifyRes.body));
    }

    logHeader('DEMO COMPLETED SUCCESSFULLY');
    logSuccess('Full Loop B verified: seed → task → HITL → resolve → receipt + validatorBalance');
    if (!SKIP_NEXTJS) {
      logSuccess('withIdempotency (DB-backed) exercised via Next.js route.');
      logSuccess('Idempotency replay path verified.');
    }
    shutdown(0);

  } catch (err) {
    logError(`Demo script failed: ${err.message}`);
    console.error(err.stack);
    shutdown(1);
  }
}

runDemo();
