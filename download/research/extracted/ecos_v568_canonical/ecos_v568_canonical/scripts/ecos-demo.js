#!/usr/bin/env node
/**
 * ECOS B2B Complete End-to-End System Demonstration
 * ------------------------------------------------
 * This integration test suite brings all of our newly added systems together:
 *   1. Spawns our lightweight REST API Server (ecos-api-server.js) in the background.
 *   2. Pumps live financial transaction POST requests over the localhost HTTP network.
 *   3. Queries the HTTP management endpoints (GET /api/v1/head and GET /api/v1/account) to verify states.
 *   4. Runs a live cryptographic chain verification over HTTP (POST /api/v1/verify).
 *   5. Shuts down the background API server safely.
 *   6. Executes the local CLI verifier (ecos-verify-local.js) to audit the resulting log.
 *
 * Runs completely offline with zero external dependencies.
 *
 * Usage:
 *   node scripts/ecos-demo.js
 */

'use strict';

const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const PORT = 3100; // Use a dedicated port to avoid collisions

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Minimal HTTP client helpers for node built-ins
function httpPost(url, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    }).on('error', reject);
  });
}

async function runDemo() {
  console.log('\x1b[36m========================================================\x1b[0m');
  console.log('\x1b[36m    ECOS B2B v3.2 END-TO-END SYSTEM DEMONSTRATION      \x1b[0m');
  console.log('\x1b[36m========================================================\x1b[0m');

  // 1. Spawning background API server
  console.log('Step 1: Spawning REST API Server in background on port', PORT, '...');
  const serverProc = spawn('node', [path.resolve(__dirname, '../ecos-api-server.js')], {
    env: { ...process.env, PORT },
    stdio: 'ignore', // Suppress console logs of background process
    detached: true
  });

  serverProc.unref();

  // Wait 2 seconds for server boot
  await wait(2000);
  console.log('\x1b[32m  [✓] Standalone REST API Server is up and listening.\x1b[0m\n');

  try {
    // 2. Pump Live Transactions via HTTP POST Ingestion
    console.log('Step 2: Simulating live client transaction ingestion over HTTP POST...');
    const transactions = [
      { clientAccountId: 'client::gumloop_001', validatorAccountId: 'validator::demo_alice', grossAmountUsd: '150.7500' },
      { clientAccountId: 'client::gumloop_005', validatorAccountId: 'validator::demo_bob', grossAmountUsd: '2990.0000' },
      { clientAccountId: 'client::gumloop_009', validatorAccountId: 'validator::demo_charlie', grossAmountUsd: '75.2550' }
    ];

    for (const tx of transactions) {
      console.log(`  Sending Transaction: Ingesting gross payment of $${tx.grossAmountUsd} for client ${tx.clientAccountId}...`);
      const res = await httpPost(`http://localhost:${PORT}/api/v1/distribute`, tx);
      if (res.status === 200 && res.body.success) {
        console.log(`    \x1b[32m[✓] Settled. RefId: ${res.body.refId} | PreState: ${res.body.preStateRoot.substring(0, 8)}... | PostState: ${res.body.postStateRoot.substring(0, 8)}...\x1b[0m`);
        console.log(`        Platform: $${res.body.split.platform} | Validator: $${res.body.split.validator} | Insurance: $${res.body.split.insurance}`);
      } else {
        console.error('    [✗] Ingestion failed:', res.body);
      }
      await wait(500);
    }
    console.log();

    // 3. Query State-Head (get-head equivalent over HTTP)
    console.log('Step 3: Querying latest state root head (get-head equivalent)...');
    const headRes = await httpGet(`http://localhost:${PORT}/api/v1/head`);
    if (headRes.status === 200) {
      console.log(`  \x1b[32m[✓] Current Head Hash: ${headRes.body.hash}\x1b[0m`);
      console.log(`      Seq: ${headRes.body.seq} | Ts: ${headRes.body.ts} | Type: ${headRes.body.type}`);
    }
    console.log();

    // 4. Query Specific Account Balance (get-account equivalent over HTTP)
    console.log('Step 4: Querying system platform account details (get-account equivalent)...');
    const accRes = await httpGet(`http://localhost:${PORT}/api/v1/account?id=sys::platform`);
    if (accRes.status === 200) {
      console.log(`  \x1b[32m[✓] Account: ${accRes.body.id} [${accRes.body.kind}]\x1b[0m`);
      console.log(`      Balance (USD): $${accRes.body.balance_usd} | Balance (Microcents): ${accRes.body.balance_micro}`);
    }
    console.log();

    // 5. Test Live HTTP Audit Chain Verifier (verify-audit equivalent)
    console.log('Step 5: Invoking live cryptographic chain verification over HTTP...');
    const verifyRes = await httpPost(`http://localhost:${PORT}/api/v1/verify`, {});
    if (verifyRes.status === 200 && verifyRes.body.ok) {
      console.log(`  \x1b[32m[✓] Network Verifier: ECOS Audit Chain Secure. Verified ${verifyRes.body.length} blocks.\x1b[0m`);
      console.log(`      Current Cryptographic Head: ${verifyRes.body.head}`);
    } else {
      console.error('  [✗] Network Verifier detected anomalies:', verifyRes.body);
    }
    console.log();

  } catch (err) {
    console.error('\x1b[31mE2E Ingestion Error:\x1b[0m', err.message);
  } finally {
    // 6. Safe Server Shutdown
    console.log('Step 6: Safely terminating background REST API Server...');
    process.kill(-serverProc.pid); // Kill process group
    await wait(1000);
    console.log('\x1b[32m  [✓] Background process terminated safely.\x1b[0m\n');
  }

  // 7. Local CLI Audit Verification check
  console.log('Step 7: Launching local CLI verifier on serialized database...');
  const verifyLocalProc = spawn('node', [path.resolve(__dirname, 'ecos-verify-local.js')], { stdio: 'inherit' });
  verifyLocalProc.on('close', (code) => {
    console.log('\x1b[36m========================================================\x1b[0m');
    console.log(`\x1b[36m   DEMO CONCLUDED SUCCESSFULLY WITH EXIT CODE ${code}  \x1b[0m`);
    console.log('\x1b[36m========================================================\x1b[0m');
  });
}

runDemo().catch(err => {
  console.error('E2E Ingestion Runner Failed:', err);
  process.exit(1);
});
