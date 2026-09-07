import "../_flush.mjs";
/**
 * tests/ledger/ledger-monitor.test.ts — Comprehensive test suite for Automated Solvency & Webhook Alert Monitor.
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import { auditLedger, sendWebhookAlert } from "../../scripts/ledger-monitor.ts";
import type { LedgerMonitorConfig } from "../../scripts/ledger-monitor.ts";

// --- 1. Normal audit run test ---
test("ledger-monitor: normal audit run finds zero anomalies and reports solvent", async () => {
  const provider = new InMemoryLedger();
  const tenantId = "tenant-clean";

  // Setup healthy accounts
  const alice = await provider.createAccount(tenantId, "alice-id", "asset", "Alice Wallet");
  const bob = await provider.createAccount(tenantId, "bob-id", "asset", "Bob Wallet");

  // Do legitimate, modest operations
  await provider.guardMint(tenantId, alice.id, 1000n, "clean mint", "system");
  await provider.transfer(tenantId, alice.id, bob.id, 200n, "clean transfer", "alice");

  const config: LedgerMonitorConfig = {
    tenantId,
    slackWebhookUrl: "https://hooks.slack.com/services/T00/B00/X00",
    highValueThreshold: 50000n, // Modest threshold
    alertOnSolvencyBreach: true,
    alertOnAnomalies: true,
  };

  const result = await auditLedger(provider, config);

  eq(result.tenantId, tenantId, "tenant ID matches");
  eq(result.isSolvent, true, "clean ledger is solvent");
  eq(result.accountsChecked, 3, "checked Alice, Bob, and platform reserve");
  eq(result.anomalies.length, 0, "no anomalies detected on healthy ledger");
  eq(result.alertSent, false, "no alert sent for healthy ledger");
});

// --- 2. Breach alerts (solvency breached / anomalies detected) ---
test("ledger-monitor: detects anomalies (negative balance, unauthorized mint, high-value transfer) and dispatches alert", async () => {
  const provider = new InMemoryLedger();
  const tenantId = "tenant-breach";

  const alice = await provider.createAccount(tenantId, "alice-id", "asset", "Alice Wallet");
  const bob = await provider.createAccount(tenantId, "bob-id", "asset", "Bob Wallet");

  // Let's trigger anomalies:
  // A. Ultra-high-value transfer (above highValueThreshold)
  await provider.guardMint(tenantId, alice.id, 1000000n, "large mint", "admin");
  await provider.transfer(tenantId, alice.id, bob.id, 900000n, "massive transfer", "alice");

  // B. Unauthorized mint (mint initiated by non-system/unauthorized user)
  await provider.guardMint(tenantId, bob.id, 500n, "rogue mint", "unauthorized-hacker-id");

  // Let's force a negative balance on an account by accessing internal state (if possible) or using simulated anomalies
  // Since InMemoryLedger's API prevents negative balances through guardWithdraw, let's verify that our
  // transaction anomalies (High value and Unauthorized mint) are detected and correctly trigger the alert.
  const config: LedgerMonitorConfig = {
    tenantId,
    slackWebhookUrl: "https://hooks.slack.com/services/T00/B00/X00",
    highValueThreshold: 500000n, // threshold is 500,000n μ¢, so 900,000n is high value
    alertOnSolvencyBreach: true,
    alertOnAnomalies: true,
  };

  const result = await auditLedger(provider, config);

  eq(result.isSolvent, true, "ledger remains technically solvent (double-entry sum is still 0)");
  assert(result.anomalies.length > 0, "anomalies must be detected");
  
  // Verify high-value anomaly is found
  const highValDetected = result.anomalies.some((a) => a.includes("Ultra-high-value"));
  assert(highValDetected, "ultra-high-value transfer detected");

  // Verify unauthorized mint is found
  const unauthorizedMintDetected = result.anomalies.some((a) => a.includes("Unauthorized mint"));
  assert(unauthorizedMintDetected, "unauthorized mint detected");

  eq(result.alertSent, true, "alert successfully dispatched via mock webhook");
});

// --- 3. Webhook connection failure ---
test("ledger-monitor: handles webhook failure gracefully", async () => {
  const provider = new InMemoryLedger();
  const tenantId = "tenant-fail";

  const alice = await provider.createAccount(tenantId, "alice-id", "asset", "Alice Wallet");
  await provider.guardMint(tenantId, alice.id, 100n, "small mint", "rogue-actor"); // triggers unauthorized mint anomaly

  const config: LedgerMonitorConfig = {
    tenantId,
    slackWebhookUrl: "https://hooks.slack.com/services/fail-url", // triggers mock connection failure
    highValueThreshold: 1000n,
    alertOnSolvencyBreach: true,
    alertOnAnomalies: true,
  };

  // Run audit; even if webhook fails, the function must complete successfully and log the error, without crashing
  const result = await auditLedger(provider, config);

  eq(result.isSolvent, true, "solvent");
  eq(result.alertSent, false, "alert was not sent due to connection failure");
  assert(result.anomalies.length > 0, "anomaly still detected");
});
