# TFA Passport Client SDK

A lightweight, zero-dependency, fail-closed TypeScript/JavaScript SDK for fetching and verifying **TFA Action Passports**. 

Designed for third-party systems, auditors, regulators, or internal components that need to verify cryptographic proofs of system actions without relying on a full database or trusting the core platform's application layer.

---

## Features

- 🌐 **Remote Retrieval**: Safely fetch signed passports via HTTP (`fetchPassport`).
- 🔒 **Zero-Dependency Verification**: Verify passport structures, hashes, and signatures locally with pure, built-in Node.js APIs (`verifyPassport`).
- ⚔️ **Fail-Closed Design**: Any parsing anomaly, key mismatch, or unexpected response throws specific errors or yields clean verification failures.
- ⚙️ **Strict & Lax Verification Modes**: Choose to enforce cryptographic checks strictly (where skipped signature checks because of missing keys fail) or verify whatever keys are provided.
- 📦 **Monorepo Ready**: Fully typed out-of-the-box.

---

## Installation

As an internal package within the TFA monorepo, you can import it directly from your peer packages:

```ts
import { 
  fetchPassport, 
  verifyPassport, 
  PassportClientError 
} from "@tfa/passport-client";
```

For external integration, pack the SDK as a standalone package or bundle the files from `lib/passport-client/`.

---

## Quick Start Example

Here is a complete, real-world example of how a third-party application fetches a passport for a specific audit record and verifies its cryptographic authenticity.

```ts
import { 
  fetchPassport, 
  verifyPassport, 
  PassportVerifyKeys 
} from "./index.ts";

async function verifyAuditRecordProof() {
  const serverUrl = "http://127.0.0.1:7700";
  const auditId = "3fbc6d93-3d07-4e0d-bca7-5349e5d95cf2";
  const tenantId = "tenant-enterprise-prod";
  
  // Symmetric secret shared between the TFA Server and the Auditor
  const keys: PassportVerifyKeys = {
    hmacSecret: "your-shared-passport-hmac-secret-here",
    auditHmacSecret: "your-shared-audit-chain-hmac-secret-here"
  };

  try {
    console.log(`Fetching passport for audit record ${auditId}...`);
    const { passport, status } = await fetchPassport(serverUrl, auditId, tenantId, {
      apiKey: "auditor-api-key-12345", // Optional API Key
      timeoutMs: 5000                   // 5-second timeout
    });

    console.log(`Passport fetched successfully! HTTP Status: ${status}`);
    console.log(`Action Type: ${passport.audit.actionType}`);
    console.log(`Outcome: ${passport.audit.outcome}`);

    console.log("\nRunning local cryptographic verification...");
    const report = verifyPassport(passport, keys, { strict: true });

    if (report.ok) {
      console.log("✅ SUCCESS: Passport is authentic and untampered!");
    } else {
      console.error("❌ FAILURE: Cryptographic verification failed!");
      report.checks.forEach(check => {
        console.error(`  - [${check.status.toUpperCase()}] ${check.name}: ${check.message || "OK"}`);
      });
    }

  } catch (error) {
    if (error instanceof Error) {
      console.error(`❌ Integration Error: ${error.message}`);
    } else {
      console.error("An unknown error occurred during integration.");
    }
  }
}
```

---

## API Reference

### 1. `fetchPassport(baseUrl, auditId, tenantId, options?)`

Requests a signed passport from a TFA server.

- **Parameters**:
  - `baseUrl` (`string`): The remote server's address.
  - `auditId` (`string`): The ID of the audit record.
  - `tenantId` (`string`): Mandatory tenant header identifier to guarantee isolation.
  - `options` (`FetchPassportOptions`, optional):
    - `apiKey` (`string`): Optional key passed in `x-api-key` header.
    - `timeoutMs` (`number`): Connection abort threshold (default: `10_000`ms).
- **Returns**: `Promise<FetchPassportResult>`
  - `passport`: The parsed `ActionPassport` object.
  - `status`: HTTP response status code.
  - `etag`: Optional entity tag for caching.

---

### 2. `verifyPassport(passport, keys, options?)`

Cryptographically validates an Action Passport and its internal audit trail.

- **Parameters**:
  - `passport` (`ActionPassport`): The passport object to verify.
  - `keys` (`PassportVerifyKeys`):
    - `hmacSecret` (`string | Buffer`): HMAC secret for passport signature.
    - `publicKey` (`string`): Ed25519 SPKI PEM public key for passport signature.
    - `auditHmacSecret` (`string | Buffer`): HMAC secret for the underlying audit chain.
    - `auditPublicKey` (`string`): Ed25519 SPKI PEM public key for the audit chain.
  - `options` (`{ strict?: boolean }`, optional):
    - When `strict: true` is provided, any skipped signature checks (due to missing keys) are treated as **failures**. Default is `false` (lax mode).
- **Returns**: `VerifyPassportResult`
  - `ok` (`boolean`): Overall pass/fail result.
  - `checks` (`Array`): Per-check breakdown (e.g. `shape`, `audit.hash`, `passport.hash`, `passport.signature.*`).

---

### 3. `canonicalStringify(value)`

Formats any object into a canonical, sorted-key JSON string. Essential for deterministic hashing of the passport payload.

- **Parameters**: Any JSON-serializable value.
- **Returns**: `string`

---

### 4. `PassportClientError`

The custom exception class thrown during failures.

- **Properties**:
  - `message`: User-friendly explanation.
  - `code`: Machine-readable error identifier (`missing_base_url`, `missing_audit_id`, `missing_tenant_id`, `network_error`, `timeout`, `not_found`, `unauthorized`, `server_error`, `invalid_response`, `verify_failed`).

---

## Cryptographic Guarantees

An Action Passport guarantees absolute integrity across three distinct areas:

1. **Shape Integrity**: Validates the schema version, essential fields presence, and data consistency.
2. **Audit Chaining**: Recomputes the SHA-256 hash of the audit record by joining its fields (`id|tenantId|actionType|outcome|prevHash`). If a secret/public key is provided, verifies that this hash matches the cryptographic signature of the ledger engine.
3. **Passport Body Integrity**: Re-serializes the passport body (excluding `hash` and `signature`) deterministically, hashes it, and checks that it matches the passport's recorded `hash`. Then verifies the signature against the passport-issuer key.
