/**
 * examples/third-party-verify.mjs — zero-trust HTTP flow demo.
 *
 * Simulates an EXTERNAL PARTY (partner / auditor / regulator) verifying a TFA
 * ActionPassport without any kernel access or shared secrets.
 *
 * The only information the external party uses:
 *   • The server's base URL (well-known endpoint)
 *   • The public key from GET /api/passport/public-key
 *   • auditIds received from the API
 *   • The published SDK: sdk/passport-client (zero-dependency, node:crypto only)
 *
 * Run: node examples/third-party-verify.mjs
 *   or: TFA_BASE_URL=http://prod:7700 AUDIT_ID=<uuid> TENANT_ID=acme node examples/third-party-verify.mjs
 *
 * When TFA_BASE_URL is set, the script uses that server and skips setup.
 * When AUDIT_ID is also set, it goes directly to fetch+verify.
 */

// ── SDK: the only import an external party needs ──────────────────────────────
// In your own project: import { verifyPassport } from "@tfa/passport-client";
import { verifyPassport, canonicalStringify } from "../sdk/passport-client/index.mjs";
import { fetchPassport, fetchPublicKey, PassportClientError } from "../lib/passport-client/index.ts";

const ok  = (m) => console.log("  ✓", m);
const bad = (m) => console.error("  ✗", m);

async function post(base, path, tenant, body) {
  const r = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tenant-id": tenant },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

async function run() {
  console.log("\n=== TFA — Third-Party Zero-Trust Verification ===\n");

  // ── 1. Server setup (skip if external) ──────────────────────────────────
  let server = null;
  let base   = process.env.TFA_BASE_URL ?? null;
  let tenant = process.env.TENANT_ID    ?? "demo-tenant";
  let auditId = process.env.AUDIT_ID   ?? null;

  if (!base) {
    console.log("[ local ] Starting in-process server with Ed25519 signer...");
    const { startSovereignServer } = await import("../src/http/sovereign-server.ts");
    const { buildSovereignStack }  = await import("../src/composition.ts");
    const { InMemoryLedger }       = await import("../lib/ledger/in-memory-ledger.ts");
    const { generateAuditKeyPair } = await import("../lib/orchestrator/signer.ts");
    const kp    = generateAuditKeyPair();
    const stack = buildSovereignStack(undefined, { signerKind: "ed25519", ed25519KeyPair: kp, provider: new InMemoryLedger() });
    server = startSovereignServer(0, stack, { requireIdempotencyKey: false });
    base   = `http://127.0.0.1:${server.address().port}`;
    ok(`server at ${base}`);
  }

  try {
    // ── 2. External party: fetch public key (zero-trust anchor) ─────────
    console.log("\n[ step 1 ] Fetch public key from server...");
    const { algorithm, publicKey } = await fetchPublicKey(base, tenant);
    ok(`algorithm=${algorithm}, publicKey=${publicKey ? "Ed25519 PEM (" + publicKey.length + " chars)" : "null (HMAC)"}`);

    if (!publicKey) {
      console.log("  ↳ HMAC server — can only verify hash integrity (no public key to verify signature).");
    }

    // ── 3. Perform an action (or use provided AUDIT_ID) ──────────────────
    if (!auditId) {
      console.log("\n[ step 2 ] Create account + mint to get an auditId...");
      const acct = await post(base, "/api/ledger/accounts", tenant, {
        ownerId: "external-party-demo", type: "asset", name: "Demo Account",
      });
      if (acct.status !== 201) throw new Error(`create account failed: ${acct.status}`);
      ok(`account created: ${acct.body.account.id}`);

      const mint = await post(base, "/api/ledger/mint", tenant, {
        toAccountId: acct.body.account.id, amount: "500000", memo: "zero-trust demo",
      });
      if (mint.status !== 200) throw new Error(`mint failed: ${mint.status}`);
      auditId = mint.body.auditId;
      ok(`action succeeded — auditId: ${auditId}`);
    } else {
      ok(`using provided auditId: ${auditId}`);
    }

    // ── 4. Fetch passport via SDK ────────────────────────────────────────
    console.log("\n[ step 3 ] Fetch signed ActionPassport via SDK...");
    const result = await fetchPassport(base, auditId, tenant);
    const passport = result.passport;
    ok(`HTTP ${result.status} — passportId: ${passport.passportId}`);
    ok(`actionType: ${passport.audit.actionType} | outcome: ${passport.policyDecision.outcome}`);
    ok(`issuedAt: ${passport.issuedAt} | algorithm: ${passport.algorithm}`);

    // ── 5. Verify — ONLY the public key, no shared secret ───────────────
    console.log("\n[ step 4 ] Verify passport (public key only — zero trust)...");
    const keys = publicKey ? { publicKey, auditPublicKey: publicKey } : {};
    const report = verifyPassport(passport, keys);

    for (const c of report.checks) {
      const icon = c.status === "pass" ? "✓" : c.status === "skipped" ? "~" : "✗";
      console.log(`  ${icon} [${c.status.padEnd(7)}] ${c.name}${c.message ? ": " + c.message : ""}`);
    }

    if (!report.ok) {
      bad("Passport INVALID — verification failed.");
      process.exitCode = 1;
      return;
    }
    ok("Passport VALID ✓ — proven accountable, zero trust in issuer.");

    // ── 6. Demonstrate fail-closed ───────────────────────────────────────
    console.log("\n[ step 5 ] Demonstrate fail-closed error handling...");

    try {
      await fetchPassport(base, auditId, "wrong-tenant");
      bad("should have thrown on cross-tenant lookup");
    } catch (e) {
      if (e instanceof PassportClientError && e.code === "not_found")
        ok(`cross-tenant lookup → ${e.code} (no data leaked)`);
    }

    const tampered = JSON.parse(JSON.stringify(passport));
    tampered.tenantId = "evil-override";
    const tamperedReport = verifyPassport(tampered, keys);
    if (!tamperedReport.ok) ok("tampered passport detected → hash fail ✓");

    console.log("\n✅ Zero-trust verification demo complete.\n");

  } finally {
    if (server) server.close();
  }
}

run().catch((e) => { console.error("\n✗ Demo failed:", e.message); process.exitCode = 1; });
