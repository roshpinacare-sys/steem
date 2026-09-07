import "../_flush.mjs";
/**
 * tests/integration/third-party-sdk.test.ts — STAGE D proof: an external party (regulator / insurer /
 * B2B partner) verifies a TFA Action Passport with ZERO trust in us — using only the public key and
 * the published client verifier. This is the world-first capability: portable proof of accountable
 * autonomy. Issuance happens in the kernel; verification happens "outside" with no kernel access.
 */
import { test, assert, eq } from "../_harness.mjs";
import { issuePassport } from "../../lib/passport/index.ts";
import { InMemoryAuditStore } from "../../lib/orchestrator/audit.ts";
import { Ed25519Signer, generateAuditKeyPair } from "../../lib/orchestrator/signer.ts";
import { verifyPassport as clientVerify } from "../../sdk/passport-client/index.mjs";

function issueRealPassport() {
  const kp = generateAuditKeyPair();
  const signer = new Ed25519Signer(kp.privateKey, kp.publicKey);
  const store = new InMemoryAuditStore(signer);
  const rec = store.append({
    id: "audit-d-1", tenantId: "acme", actionId: "act-1", actionType: "ledger.mint",
    source: "agent-7", outcome: "allowed", occurredAt: new Date().toISOString(),
  });
  const passport = issuePassport({ auditId: rec.id, auditStore: store, signer });
  return { passport, publicKey: kp.publicKey };
}

test("STAGE D: external party verifies a real passport with public key only (zero trust)", () => {
  const { passport, publicKey } = issueRealPassport();
  const res = clientVerify(passport, { publicKey, auditPublicKey: publicKey }, { strict: true });
  eq(res.ok, true, "passport must verify with the issuer's public key alone");
});

test("STAGE D: tampering with the passport breaks verification (tamper-evident)", () => {
  const { passport, publicKey } = issueRealPassport();
  const forged = JSON.parse(JSON.stringify(passport));
  // an attacker tries to change the signed action type after issuance
  forged.audit.actionType = "ledger.withdraw";
  const res = clientVerify(forged, { publicKey, auditPublicKey: publicKey }, { strict: true });
  eq(res.ok, false, "tampered passport must fail verification");
});

test("STAGE D: wrong public key fails (no trust shortcut)", () => {
  const { passport } = issueRealPassport();
  const otherKey = generateAuditKeyPair().publicKey;
  const res = clientVerify(passport, { publicKey: otherKey, auditPublicKey: otherKey }, { strict: true });
  eq(res.ok, false, "a different key must not validate the passport");
});
