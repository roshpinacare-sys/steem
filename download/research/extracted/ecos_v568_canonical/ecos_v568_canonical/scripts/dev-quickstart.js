#!/usr/bin/env node
/**
 * ECOS Dev Quickstart — Full Demo Flywheel  (V95)
 * ─────────────────────────────────────────────────────────────────────────────
 * Demonstrates the complete ECOS economic loop:
 *   deposit → submit tasks → seed calibrator → list pending → approve → stats
 *
 * Usage:
 *   node engine/scripts/dev-quickstart.js
 *   PORT=3099 node engine/scripts/dev-quickstart.js
 *
 * The script starts the ECOS API server internally on the configured port,
 * runs the full demo, then exits cleanly via server.close().
 *
 * Port resolution order: PORT env var → QUICKSTART_PORT env var → 3099
 *
 * No external dependencies — uses only Node.js built-ins + the project itself.
 */

'use strict';

const http   = require('node:http');
const path   = require('node:path');

// ── Config ────────────────────────────────────────────────────────────────────
// Honour PORT (set by integration test), then QUICKSTART_PORT, then 3099.
const PORT   = process.env.PORT
  ? parseInt(process.env.PORT, 10)
  : process.env.QUICKSTART_PORT
    ? parseInt(process.env.QUICKSTART_PORT, 10)
    : 3099;
const BASE   = `http://localhost:${PORT}`;

// ANSI helpers
const G  = (s) => `\x1b[32m${s}\x1b[0m`;
const Y  = (s) => `\x1b[33m${s}\x1b[0m`;
const C  = (s) => `\x1b[36m${s}\x1b[0m`;
const B  = (s) => `\x1b[1m${s}\x1b[0m`;
const R  = (s) => `\x1b[31m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

// ── HTTP helper ───────────────────────────────────────────────────────────────
function apiCall(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const req = http.request(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Start server ──────────────────────────────────────────────────────────────
// [P5-V94] Returns the http.Server listener so main() can call server.close() cleanly.
async function startServer() {
  // Set port override BEFORE requiring the server module
  process.env.PORT = String(PORT);

  const serverModulePath = path.resolve(__dirname, '../ecos-api-server.js');
  const serverModule = require(serverModulePath);
  // Use startServer(PORT) API so we get back the http.Server listener
  const listener = serverModule.startServer(PORT);
  await new Promise(resolve => listener.once('listening', resolve));

  // Confirm API is ready
  for (let i = 0; i < 30; i++) {
    try {
      const r = await apiCall('GET', '/api/v1/health');
      if (r.status === 200) return listener;
    } catch {}
    await sleep(200);
  }
  throw new Error('Server did not start within 6s');
}

// ── Synthetic Platt samples ───────────────────────────────────────────────────
function makeSamples(n = 60) {
  return Array.from({ length: n }, (_, i) => ({
    rawScore: 0.30 + (i / n) * 0.65,
    label: (i / n) > 0.4 ? 1 : 0,
  }));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + B('═══════════════════════════════════════════════════════'));
  console.log(B('  ECOS Dev Quickstart — Full Demo Flywheel              '));
  console.log(B('═══════════════════════════════════════════════════════') + '\n');

  // ── Step 1: Start server
  process.stdout.write(DIM('Starting ECOS API server on port ') + C(String(PORT)) + ' … ');
  const serverListener = await startServer();
  console.log(G('✓ ready'));

  // ── Step 2: Health check
  const health = await apiCall('GET', '/api/v1/health');
  console.log(G('✓ Health:') + ` V=${health.body.version}  DB=${health.body.db}  LLM=${health.body.llmProvider}`);

  // ── Step 3: Deposit funds for demo client
  console.log('\n' + B('── Step 1: Fund client::demo ─────────────────────────────'));
  const depositRes = await apiCall('POST', '/api/v1/deposit', {
    clientAccountId: 'client::demo',
    amountUsd: '100.00',
    idempotencyKey: 'quickstart-demo-001',
  });
  if (depositRes.status === 200 || depositRes.status === 201) {
    console.log(G('✓ Deposited') + ` $100.00 for client::demo | Balance: $${depositRes.body.newBalanceUsd || depositRes.body.balance_usd || '?'}`);
  } else {
    console.log(Y('⚠ Deposit returned') + ` ${depositRes.status}: ${JSON.stringify(depositRes.body)}`);
  }

  // ── Step 4: Submit 3 tasks
  console.log('\n' + B('── Step 2: Submit 3 tasks ────────────────────────────────'));
  const tasks = [
    { text: 'Review this software licensing contract for risks', price: '2.00' },
    { text: 'Analyze GDPR compliance requirements for EU users', price: '3.50' },
    { text: 'Check this arbitration clause for enforceability', price: '1.50' },
  ];

  const approvalIds = [];
  for (const [i, task] of tasks.entries()) {
    const r = await apiCall('POST', '/api/v1/chat', {
      text: task.text,
      priceUsd: task.price,
      clientAccountId: 'client::demo',
    });
    const verdict  = r.body.verdict  || r.body.gateVerdict || '?';
    const apvId    = r.body.approvalId || '?';
    approvalIds.push(apvId);
    const statusColor = verdict === 'AUTO_FLOW' ? G : Y;
    console.log(`  ${i + 1}. ${statusColor(verdict.padEnd(12))} | ${C(apvId)} | $${task.price}`);
  }

  // ── Step 5: Seed calibrator
  console.log('\n' + B('── Step 3: Seed calibrator (60 synthetic samples) ────────'));
  const calRes = await apiCall('POST', '/api/v1/calibrator/fit', {
    data: makeSamples(60),
  });
  if (calRes.status === 200) {
    const { A, B: Bval, sampleCount } = calRes.body;
    console.log(G('✓ Calibrated') + `  A=${A?.toFixed(4)}  B=${Bval?.toFixed(4)}  sampleCount=${sampleCount}`);
  } else {
    console.log(Y('⚠ Calibrator returned') + ` ${calRes.status}: ${JSON.stringify(calRes.body)}`);
  }

  // ── Step 6: List pending approvals
  console.log('\n' + B('── Step 4: List pending approvals ────────────────────────'));
  const listRes = await apiCall('GET', '/api/v1/approvals?status=pending');
  const pending = listRes.body.approvals || [];
  if (pending.length === 0) {
    console.log(DIM('  (no pending approvals — all AUTO_FLOW)'));
  } else {
    for (const a of pending.slice(0, 5)) {
      console.log(`  ${C(a.id)}  status=${Y(a.status)}  price=$${a.priceUsd}  conf=${a.confidence ?? 'null'}`);
    }
    if (pending.length > 5) console.log(DIM(`  … and ${pending.length - 5} more`));
  }

  // ── Step 7: Approve the first pending approval
  const firstPending = pending[0];
  if (firstPending) {
    console.log('\n' + B('── Step 5: Approve first pending approval ─────────────────'));
    const approveRes = await apiCall('POST', `/api/v1/approvals/${firstPending.id}/resolve`, {
      validatorAccountId: 'validator::demo_001',
      decision: 'approve',
      note: 'Quickstart demo approval',
    });
    if (approveRes.status === 200) {
      const { approvalId, status, receipt } = approveRes.body;
      console.log(G('✓ Approved') + ` ${C(approvalId)}  status=${G(status)}`);
      if (receipt) {
        console.log(`  Platform: $${receipt.platformUsd}  Validator: $${receipt.validatorUsd}  Insurance: $${receipt.insuranceUsd}`);
      }
    } else {
      console.log(Y('⚠ Approve returned') + ` ${approveRes.status}: ${JSON.stringify(approveRes.body)}`);
    }
  }

  // ── Step 8: Final state summary
  console.log('\n' + B('── Step 6: Final state summary ───────────────────────────'));
  const statsRes = await apiCall('GET', '/api/v1/stats');
  const s = statsRes.body;
  if (statsRes.status === 200) {
    console.log(`  Platform balance: $${s.ledger?.platformBalance || '?'}`);
    console.log(`  Chain length:     ${s.chain?.length ?? '?'}`);
    console.log(`  Pending queue:    ${s.approvals?.pending ?? '?'}`);
    console.log(`  Calibrator:       ${s.calibrator?.ready ? 'ready' : 'not ready'}  (${s.calibrator?.sampleCount ?? 0} samples)`);
    console.log(`  Version:          ${C(s.version)}`);
    console.log(`  Uptime:           ${s.uptime}s`);
    console.log(`  Insurance:        $${s.ledger?.insuranceBalance || '?'}`);
    console.log(`  Chain ok:         ${s.chain?.ok ? G('yes') : R('no')}`);
  }

  // ── Verify chain
  const verifyRes = await apiCall('GET', '/api/v1/verify');
  console.log('\n' + (verifyRes.body.ok
    ? G(`✓ Chain intact (${verifyRes.body.length} entries)`)
    : R(`✗ Chain BROKEN: ${verifyRes.body.reason}`)));

  console.log('\n' + B('═══════════════════════════════════════════════════════'));
  console.log(B('  Quickstart complete! ECOS economic loop demonstrated.  '));
  console.log(B('═══════════════════════════════════════════════════════') + '\n');

  console.log(DIM('Approval IDs created:'));
  for (const id of approvalIds) console.log(DIM('  ' + id));
  console.log('');

  // [P5-V94] Exit cleanly via server.close() then process.exit(0)
  await new Promise(resolve => serverListener.close(resolve));
  process.exit(0);
}

main().catch((err) => {
  console.error(R('\n✗ Quickstart failed: ') + err.message);
  console.error(err.stack);
  process.exit(1);
});
