/**
 * lib/passport-client/integration-example.ts
 *
 * This file contains a complete integration example showcasing how a third-party application,
 * auditor, or regulatory system imports the `passport-client` SDK to fetch and verify
 * an ActionPassport cryptographically.
 *
 * To run this file:
 *   ts-node integration-example.ts
 */

import {
  fetchPassport,
  verifyPassport,
  PassportClientError,
  type PassportVerifyKeys,
  type FetchPassportResult,
  type VerifyPassportResult,
} from "./index.ts";

import type { ActionPassport } from "../passport/types.ts";

// ============================================================================
// 1. Mock Data Generator
// ============================================================================
// In a real application, you would receive the Passport JSON from fetchPassport
// or an external source. We construct a realistic mock ActionPassport here
// so that the verification code executes beautifully in isolation.
function generateMockPassport(): ActionPassport {
  return {
    version: "1",
    passportId: "pass-abc-123456",
    issuedAt: new Date().toISOString(),
    tenantId: "tenant-enterprise-prod",
    audit: {
      id: "audit-def-789012",
      tenantId: "tenant-enterprise-prod",
      actionId: "act-ghi-345678",
      actionType: "ledger.transfer",
      source: "workflow-engine",
      outcome: "allowed",
      occurredAt: new Date().toISOString(),
      prevHash: "0000000000000000000000000000000000000000000000000000000000000000",
      // A realistic sha256 hash
      hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      signature: "MOCK_AUDIT_SIGNATURE_BASE64_STUB==",
    },
    delegationChain: null,
    policyDecision: {
      outcome: "allowed",
    },
    ledgerEffect: {
      transactionId: "tx-xyz-987654",
      tenantId: "tenant-enterprise-prod",
      kind: "asset.transfer",
      debitAccountId: "acc-source-111",
      creditAccountId: "acc-dest-222",
      amount: "10000000", // Decimal representation of micro-cents (100.00 USD)
      memo: "Invoice payment for Q2 consultation services",
      initiatedBy: "agent-id-99",
      createdAt: new Date().toISOString(),
    },
    attestation: null,
  algorithm: "hmac-sha256",
    // Deterministic hash of the canonical body
    hash: "f4a7c29e1f5cd9a7761005a911bb02242131ef7ba1b22e1189acfa093c85a210",
    signature: "MOCK_PASSPORT_SIGNATURE_BASE64_STUB==",
  };
}

// ============================================================================
// 2. Integration Scenarios
// ============================================================================

/**
 * Scenario A: Local Crytographic Verification
 * Demonstrates how to locally verify a passport with shared secrets.
 */
export function executeLocalVerificationDemo() {
  console.log("\n=======================================================");
  console.log("SCENARIO A: Local Cryptographic Verification Demo");
  console.log("=======================================================");

  const passport = generateMockPassport();
  
  // Define cryptographic keys. In practice, these are loaded securely from 
  // environment variables, vault management systems, or secure config files.
  const keys: PassportVerifyKeys = {
    // Shared HMAC secret used to verify passport-level authenticity
    hmacSecret: "passport-client-test-secret-42!",
    // Shared HMAC secret used to verify underlying audit record chain
    auditHmacSecret: "audit-chain-test-secret-99!",
  };

  console.log(`Verifying Passport: ${passport.passportId}`);
  console.log(`Action Logged: ${passport.audit.actionType} (${passport.audit.outcome})`);

  // Run the zero-dependency canonical verification
  // lax mode: skipped signature checks are logged as 'skipped' but do not fail the overall check
  const laxResult: VerifyPassportResult = verifyPassport(passport, keys, { strict: false });
  console.log(`\nLax Verification result: ${laxResult.ok ? "✅ VALID" : "❌ INVALID"}`);
  console.log("Checks detailed log:");
  laxResult.checks.forEach((c) => {
    console.log(`  [${c.status.toUpperCase()}] ${c.name}: ${c.message || "OK"}`);
  });

  // strict mode: any skipped signature checks automatically fail the entire passport validation
  const strictResult: VerifyPassportResult = verifyPassport(passport, keys, { strict: true });
  console.log(`\nStrict Verification result: ${strictResult.ok ? "✅ VALID" : "❌ INVALID"}`);
  console.log("Checks detailed log:");
  strictResult.checks.forEach((c) => {
    console.log(`  [${c.status.toUpperCase()}] ${c.name}: ${c.message || "OK"}`);
  });
}

/**
 * Scenario B: Live Remote Fetching & Verification
 * Demonstrates how to fetch a passport from a remote TFA endpoint and verify it.
 */
export async function executeRemoteFetchingDemo() {
  console.log("\n=======================================================");
  console.log("SCENARIO B: Live Remote Fetching and Verification Demo");
  console.log("=======================================================");

  const baseUrl = "http://127.0.0.1:7700";
  const auditId = "some-audit-record-uuid-123456";
  const tenantId = "tenant-enterprise-prod";

  console.log(`Attempting remote fetch to ${baseUrl} for audit record ${auditId}...`);
  try {
    const result: FetchPassportResult = await fetchPassport(baseUrl, auditId, tenantId, {
      apiKey: "auditor-secret-token",
      timeoutMs: 3000, // abort request after 3 seconds
    });

    console.log(`\nFetch Succeeded! HTTP Status: ${result.status}`);
    console.log(`Fetched Passport: ${result.passport.passportId}`);
    
    // Validate locally after fetching
    const keys: PassportVerifyKeys = {
      hmacSecret: "your-shared-hmac-secret",
    };
    const report = verifyPassport(result.passport, keys);
    console.log(`Verification result: ${report.ok ? "✅ PASSED" : "❌ FAILED"}`);

  } catch (error) {
    if (error instanceof PassportClientError) {
      console.log(`\n❌ Fetch aborted / failed with predictable code: ${error.code}`);
      console.log(`Message: ${error.message}`);
      console.log("SDK handled this fail-closed gracefully without leaking raw networking errors.");
    } else {
      console.log(`\n❌ Unexpected system error: ${(error as any).message}`);
    }
  }
}

// Execute the demo function if this script is run directly (ESM-safe).
const _isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1]);
if (_isMain) {
  executeLocalVerificationDemo();
  executeRemoteFetchingDemo().then(() => {
    console.log("\nDemo completed successfully.");
  });
}
