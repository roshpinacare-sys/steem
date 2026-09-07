#!/usr/bin/env node
/**
 * ECOS B2B High-Throughput Ingestion Simulation (1,000 runs)
 * --------------------------------------------------------
 * Simulates continuous B2B transactions using the pure offline ECOS core engines
 * (fiatLedger and auditLog) with cryptographically accurate CSR calculations.
 *
 * It generates:
 *  - 1,000 unique transaction iterations
 *  - Real-time 40/40/20 balance distribution
 *  - Deterministic CSR (Canonical State Root) for every state transition
 *  - Ongoing Audit Log chaining and verifications
 *  - Historical metrics database exported to CSV
 *  - Serialized cryptographic chain exported to ecos_audit_log.json
 *  - Detailed dashboard state exported to JSON
 *
 * Run with: node scripts/ecos-simulation.js
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { FiatLedger, SYSTEM_ACCOUNTS, usdToMicrocents, microcentsToUsdString } = require('../src/lib/fiatLedger');
const { AuditLog, NULL_HASH, sha256Hex } = require('../src/lib/auditLog');

// Deterministic state root calculator following stateRoot.js spec exactly
function calculateCSR(ledger) {
  const sortedAccounts = Array.from(ledger._accounts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]));
  const stateBuffer = sortedAccounts.map(([id, bal]) => `${id}:${bal}`).join('\n');
  return sha256Hex(stateBuffer);
}

async function runSimulation() {
  console.log('Starting ECOS B2B High-Throughput Ingestion Simulation (1,000 iterations)...');

  const ledger = new FiatLedger();
  const auditLog = new AuditLog();

  // Initialize metrics trackers
  const csvRows = [];
  const stateHistory = [];
  const alerts = [];
  
  // Track system performance metrics
  const startTime = Date.now();
  let successfulConservationChecks = 0;
  let lastAuditCheckResult = { ok: true, length: 0 };
  let currentHeadHash = NULL_HASH;

  // Let's seed the system with some initial clients to simulate real-world activity
  console.log('Bootstrapping client accounts and seed balances...');
  for (let i = 1; i <= 10; i++) {
    const client_id = `client::gumloop_${String(i).padStart(3, '0')}`;
    ledger.ensureAccount(client_id);
    // Give them a large seed balance
    ledger.credit(client_id, usdToMicrocents('100000.00'), { note: 'Seed balance' });
  }

  // Generate 1,000 transactions
  for (let step = 1; step <= 1000; step++) {
    const uniqueId = crypto.randomBytes(4).toString('hex');
    const clientIdx = Math.floor(Math.random() * 10) + 1;
    const client_id = `client::gumloop_${String(clientIdx).padStart(3, '0')}`;
    const validator_id = `validator::gumloop_${uniqueId}`;

    // Random BigInt amount between 10.00 and 5,000.00 USD (in microcents)
    const randomUsd = (Math.random() * 4990 + 10).toFixed(4);
    const grossMicro = usdToMicrocents(randomUsd);

    const refType = 'approval';
    const refId = `apv_gumloop_${uniqueId}`;

    // Capture pre-state CSR (Phase 1 pre-snapshot)
    const preCSR = calculateCSR(ledger);

    // Credit client dynamically with gross amount to prevent overdraft if they run low
    ledger.credit(client_id, grossMicro, { note: `Inflow for transaction ${refId}` });

    // Execute 40/40/20 transaction payment split
    const splitResult = ledger.distributeTaskPayment({
      clientAccountId: client_id,
      validatorAccountId: validator_id,
      grossAmountUsd: grossMicro,
      meta: { refType, refId, step }
    });

    // Capture post-state CSR (Phase 2 post-snapshot)
    const postCSR = calculateCSR(ledger);

    // Basic Conservation Check
    const platformMicro = splitResult.platform;
    const validatorMicro = splitResult.validator;
    const insuranceMicro = splitResult.insurance;
    const escrowMicro = ledger.balance(SYSTEM_ACCOUNTS.ESCROW); // should be 0 after distribution
    
    const sumDistributed = platformMicro + validatorMicro + insuranceMicro + escrowMicro;
    const conservationPassed = (grossMicro === sumDistributed);

    if (conservationPassed) {
      successfulConservationChecks++;
    } else {
      const errMsg = `Conservation failure at step ${step}: Gross ${grossMicro} != Sum ${sumDistributed}`;
      console.error(errMsg);
      alerts.push({
        type: 'CONSERVATION_FAILURE',
        step,
        timestamp: new Date().toISOString(),
        message: errMsg
      });
    }

    // Record DELTA_COMMIT in Audit Log
    const payload = {
      step,
      refType,
      refId,
      clientAccountId: client_id,
      validatorAccountId: validator_id,
      grossMicro: grossMicro.toString(),
      platformMicro: platformMicro.toString(),
      validatorMicro: validatorMicro.toString(),
      insuranceMicro: insuranceMicro.toString(),
      escrowMicro: escrowMicro.toString(),
      preStateRoot: preCSR,
      postStateRoot: postCSR,
      timestamp: new Date().toISOString()
    };

    const auditEntry = auditLog.append('DELTA_COMMIT', payload);
    currentHeadHash = auditEntry.hash;

    // Run continuous verification check every 100 steps
    if (step % 100 === 0) {
      const verifyRes = auditLog.verify();
      if (!verifyRes.ok) {
        const errMsg = `Audit chain tampered or broken at step ${step}! Reason: ${verifyRes.reason}`;
        console.error(errMsg);
        alerts.push({
          type: 'AUDIT_INTEGRITY_BREACH',
          step,
          timestamp: new Date().toISOString(),
          message: errMsg
        });
      }
      lastAuditCheckResult = verifyRes;
    }

    // Keep history sample for visualization
    if (step === 1 || step % 50 === 0) {
      stateHistory.push({
        step,
        timestamp: new Date().toISOString(),
        csr: postCSR,
        platformBalance: ledger.balanceUsd(SYSTEM_ACCOUNTS.PLATFORM),
        insuranceBalance: ledger.balanceUsd(SYSTEM_ACCOUNTS.INSURANCE),
        escrowBalance: ledger.balanceUsd(SYSTEM_ACCOUNTS.ESCROW),
        activeValidators: ledger.listAccounts().filter(a => a.id.startsWith('validator')).length
      });
    }

    // Add row to metrics database (CSV format)
    csvRows.push([
      new Date().toISOString(),
      step,
      refId,
      client_id,
      validator_id,
      grossMicro.toString(),
      randomUsd,
      platformMicro.toString(),
      validatorMicro.toString(),
      insuranceMicro.toString(),
      escrowMicro.toString(),
      conservationPassed ? 'TRUE' : 'FALSE',
      preCSR,
      postCSR
    ]);
  }

  const durationMs = Date.now() - startTime;
  const throughput = (1000 / (durationMs / 1000)).toFixed(2);
  console.log(`Simulation complete! Processed 1,000 steps in ${durationMs}ms (${throughput} trans/sec).`);

  // Verify full final audit log
  const finalVerify = auditLog.verify();
  console.log(`Final audit log integrity: ${finalVerify.ok ? 'OK (Clean)' : 'FAILED'}`);
  console.log(`Total active validator accounts created: ${ledger.listAccounts().filter(a => a.id.startsWith('validator')).length}`);

  // Save the full audit log entries to ecos_audit_log.json
  const auditLogPath = path.resolve(__dirname, '../ecos_audit_log.json');
  fs.writeFileSync(auditLogPath, JSON.stringify(auditLog.entries(), null, 2), 'utf8');
  console.log(`Saved serialized cryptographic chain of ${auditLog.size()} entries to ${auditLogPath}`);

  // Create historical CSV output complying with spreadsheet-output guidelines
  const csvHeaders = [
    'Timestamp', 'Sequence', 'Transaction ID', 'Client Account', 'Validator Account',
    'Gross (Microcents)', 'Gross (USD)', 'Platform (Microcents)', 'Validator (Microcents)',
    'Insurance (Microcents)', 'Escrow (Microcents)', 'Conservation Passed', 'Pre-State Root', 'Post-State Root'
  ];
  
  const csvContent = [
    csvHeaders.join(','),
    ...csvRows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n') + '\n';

  const csvPath = path.resolve(__dirname, '../ecos_simulation_metrics.csv');
  fs.writeFileSync(csvPath, csvContent, 'utf8');
  console.log(`Saved metrics to ${csvPath}`);

  // Save structured JSON state for dashboard ingestion
  const dashboardState = {
    summary: {
      totalTransactions: 1000,
      totalVolumeProcessedUsd: microcentsToUsdString(
        csvRows.reduce((sum, r) => sum + BigInt(r[5]), 0n)
      ),
      throughputTps: throughput,
      durationMs,
      systemStatus: alerts.length === 0 ? 'HEALTHY' : 'DEGRADED',
      lastVerificationStatus: finalVerify.ok ? 'PASSED' : 'FAILED',
      lastSuccessfulCheck: new Date().toISOString(),
      currentCSR: calculateCSR(ledger),
      platformRevenueUsd: ledger.balanceUsd(SYSTEM_ACCOUNTS.PLATFORM),
      insurancePoolUsd: ledger.balanceUsd(SYSTEM_ACCOUNTS.INSURANCE),
      escrowBalanceUsd: ledger.balanceUsd(SYSTEM_ACCOUNTS.ESCROW)
    },
    history: stateHistory,
    alerts,
    recentTransactions: csvRows.slice(-15).reverse().map(r => ({
      timestamp: r[0],
      sequence: r[1],
      txId: r[2],
      client: r[3],
      validator: r[4],
      grossUsd: r[6],
      platformUsd: microcentsToUsdString(r[7]),
      validatorUsd: microcentsToUsdString(r[8]),
      insuranceUsd: microcentsToUsdString(r[9])
    })),
    accounts: ledger.listAccounts().map(a => ({
      id: a.id,
      balanceUsd: a.usd,
      balanceMicrocents: a.microcents
    }))
  };

  const jsonPath = path.resolve(__dirname, '../simulation_state.json');
  fs.writeFileSync(jsonPath, JSON.stringify(dashboardState, null, 2), 'utf8');
  console.log(`Saved dashboard database to ${jsonPath}`);
}

runSimulation().catch(err => {
  console.error('Fatal simulation error:', err);
  process.exit(1);
});
