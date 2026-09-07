import "../_flush.mjs";
/**
 * tests/adapter/ard-verifier.test.ts — ARD verifier core logic.
 *
 * Coverage:
 *   Happy path:
 *     • well-formed urn:ai:... with did:web identity + valid JWS → valid=true
 *   Edge cases:
 *     • https identity with matching hostname → valid=true
 *     • signer not provided → jwsValid=null, still passes if alignment ok
 *   Fail-closed:
 *     • URN authority does not match identity domain → valid=false
 *     • tampered JWS payload → valid=false
 *     • unknown / malformed URN → valid=false
 *     • missing trustManifest.identity → error/invalid
 */

import { test, assert, eq } from "../_harness.mjs";
import { verifyArdAgent, parseUrnAuthority, extractDomainFromIdentity } from "../../lib/adapter/ard-verifier.ts";
import { buildArdCatalog, canonicalizeJson, verifyDetachedJws } from "../../lib/adapter/ard-publisher.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";

function makeSigner() {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  return stack.signer;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function makeSignedTrustManifest(identity: string, signer: any, extra: any = {}) {
  const { createDetachedJws } = await import("../../lib/adapter/ard-publisher.ts");
  const payload = { identity, identityType: "did" as const, ...extra };
  const canonical = canonicalizeJson(payload);
  const signature = createDetachedJws(canonical, signer);
  return { ...payload, signature };
}

// ── parseUrnAuthority ───────────────────────────────────────────────────────

test("parseUrnAuthority extracts FQDN, namespace, agentName", () => {
  const r = parseUrnAuthority("urn:ai:example.com:ns:agent-1") as any;
  assert(r.ok);
  eq(r.fqdn, "example.com");
  eq(r.namespace, "ns");
  eq(r.agentName, "agent-1");
});

test("parseUrnAuthority rejects malformed URN", () => {
  const r = parseUrnAuthority("not-a-urn");
  assert(!r.ok);
});

test("parseUrnAuthority rejects empty string", () => {
  const r = parseUrnAuthority("");
  assert(!r.ok);
});

// ── extractDomainFromIdentity ───────────────────────────────────────────────

test("extractDomainFromIdentity handles did:web", () => {
  const r = extractDomainFromIdentity("did:web:example.com") as any;
  assert(r.ok);
  eq(r.domain, "example.com");
});

test("extractDomainFromIdentity handles https", () => {
  const r = extractDomainFromIdentity("https://api.example.com/v1") as any;
  assert(r.ok);
  eq(r.domain, "api.example.com");
});

test("extractDomainFromIdentity handles spiffe", () => {
  const r = extractDomainFromIdentity("spiffe://example.com/workload") as any;
  assert(r.ok);
  eq(r.domain, "example.com");
});

test("extractDomainFromIdentity falls back to exact match for other DIDs", () => {
  const r = extractDomainFromIdentity("did:ethr:0xabc") as any;
  assert(r.ok);
  eq(r.domain, "did:ethr:0xabc");
});

// ── Happy path ──────────────────────────────────────────────────────────────

test("verifyArdAgent happy path: did:web identity + valid JWS", async () => {
  const signer = makeSigner();
  const tm = await makeSignedTrustManifest("did:web:example.com", signer, {
    attestations: [{ type: "TFA", uri: "https://tfa.dev/verify/1", digest: "abc123" }],
  });
  const result = verifyArdAgent({ urn: "urn:ai:example.com:ns:agent", trustManifest: tm, signer });
  assert(result.valid, `expected valid, got reasons: ${result.reasons.join("; ")}`);
  assert(result.checks.urnWellFormed);
  assert(result.checks.domainAlignment);
  assert(result.checks.jwsValid === true);
  assert(result.checks.attestationsResolvable === true);
});

// ── Edge cases ──────────────────────────────────────────────────────────────

test("verifyArdAgent edge: https identity with matching hostname", async () => {
  const signer = makeSigner();
  const tm = await makeSignedTrustManifest("https://example.com/agent", signer);
  const result = verifyArdAgent({ urn: "urn:ai:example.com:ns:agent", trustManifest: tm, signer });
  assert(result.valid, `expected valid, got reasons: ${result.reasons.join("; ")}`);
  assert(result.checks.domainAlignment);
});

test("verifyArdAgent edge: no signer provided → jwsValid=null but alignment passes", async () => {
  const signer = makeSigner();
  const tm = await makeSignedTrustManifest("did:web:example.com", signer);
  const result = verifyArdAgent({ urn: "urn:ai:example.com:ns:agent", trustManifest: tm });
  assert(result.valid, `expected valid with no signer, got reasons: ${result.reasons.join("; ")}`);
  assert(result.checks.jwsValid === null);
});

test("verifyArdAgent edge: no attestations → attestation check skipped", async () => {
  const signer = makeSigner();
  const tm = await makeSignedTrustManifest("did:web:example.com", signer);
  const result = verifyArdAgent({ urn: "urn:ai:example.com:ns:agent", trustManifest: tm, signer });
  assert(result.valid);
  assert(result.checks.attestationsResolvable === null);
});

// ── Fail-closed ────────────────────────────────────────────────────────────

test("verifyArdAgent fail-closed: domain mismatch", async () => {
  const signer = makeSigner();
  const tm = await makeSignedTrustManifest("did:web:evil.com", signer);
  const result = verifyArdAgent({ urn: "urn:ai:example.com:ns:agent", trustManifest: tm, signer });
  assert(!result.valid);
  assert(!result.checks.domainAlignment);
  assert(result.reasons.some((r) => r.includes("mismatch")));
});

test("verifyArdAgent fail-closed: tampered JWS signature", async () => {
  const signer = makeSigner();
  const tm = await makeSignedTrustManifest("did:web:example.com", signer);
  // Corrupt the signature
  tm.signature = tm.signature.slice(0, -4) + "XXXX";
  const result = verifyArdAgent({ urn: "urn:ai:example.com:ns:agent", trustManifest: tm, signer });
  assert(!result.valid);
  assert(result.checks.jwsValid === false);
  assert(result.reasons.some((r) => r.includes("JWS")));
});

test("verifyArdAgent fail-closed: malformed URN", async () => {
  const signer = makeSigner();
  const tm = await makeSignedTrustManifest("did:web:example.com", signer);
  const result = verifyArdAgent({ urn: "not-a-urn", trustManifest: tm, signer });
  assert(!result.valid);
  assert(!result.checks.urnWellFormed);
});

test("verifyArdAgent fail-closed: missing identity", async () => {
  const signer = makeSigner();
  const tm = await makeSignedTrustManifest("did:web:example.com", signer);
  delete (tm as any).identity;
  const result = verifyArdAgent({ urn: "urn:ai:example.com:ns:agent", trustManifest: tm, signer });
  assert(!result.valid);
  assert(result.reasons.some((r) => r.includes("identity")));
});
