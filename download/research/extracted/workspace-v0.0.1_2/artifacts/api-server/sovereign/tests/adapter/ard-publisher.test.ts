import "../_flush.mjs";
/**
 * tests/adapter/ard-publisher.test.ts — ARD publisher adapter (v0.9 draft).
 *
 * Coverage:
 *   Happy path:
 *     • buildArdCatalog returns spec-conformant catalog with trustManifest
 *     • detached JWS is present and verifiable by the same signer
 *     • catalog structure includes schemaVersion, publisher, agents
 *   Edge cases:
 *     • different tenantId → different identity URI
 *     • domain override is respected
 *     • cached catalog is returned on repeated calls
 *   Fail-closed:
 *     • missing tenantId → error
 *     • missing signer → error
 *     • tampered payload fails JWS verification
 *     • verifyDetachedJws rejects unknown algorithm
 */

import { test, assert, eq } from "../_harness.mjs";
import {
  buildArdCatalog,
  createDetachedJws,
  verifyDetachedJws,
  getCachedArdCatalog,
  _clearArdCatalogCache,
  canonicalizeJson,
} from "../../lib/adapter/ard-publisher.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeSigner() {
  return new HmacSigner("test-secret-ard-publisher-32-bytes-long!!");
}

// ── Happy path ──────────────────────────────────────────────────────────────

test("buildArdCatalog returns spec-conformant catalog", () => {
  const signer = makeSigner();
  const catalog = buildArdCatalog({ tenantId: "tenant-a", signer });
  eq(catalog.schemaVersion, "v0.9-draft");
  assert(typeof catalog.publisher.name === "string", "publisher.name should be string");
  assert(typeof catalog.publisher.uri === "string", "publisher.uri should be string");
  eq(catalog.agents.length, 1);
  const agent = catalog.agents[0];
  assert(typeof agent.id === "string" && agent.id.length > 0, "agent.id should be non-empty");
  eq(agent.name, "TFA Trust Gate");
  assert(agent.trustManifest, "trustManifest should be present");
  const tm = agent.trustManifest!;
  assert(tm.identity.startsWith("did:web:"), "identity should be did:web");
  eq(tm.identityType, "did");
  assert(Array.isArray(tm.attestations) && tm.attestations.length > 0, "attestations should be non-empty array");
  assert(Array.isArray(tm.provenance) && tm.provenance.length > 0, "provenance should be non-empty array");
  assert(typeof tm.signature === "string" && tm.signature.includes(".."), "signature should be detached JWS");
});

test("detached JWS is verifiable by the same signer", () => {
  const signer = makeSigner();
  const catalog = buildArdCatalog({ tenantId: "tenant-b", signer });
  const tm = catalog.agents[0].trustManifest!;
  const signature = tm.signature!;

  // Re-canonicalize the trustManifest payload (without signature field)
  const { signature: _sig, ...payload } = tm;
  const canonical = canonicalizeJson(payload);

  assert(verifyDetachedJws(signature, canonical, signer), "detached JWS should verify");
});

// ── Edge cases ──────────────────────────────────────────────────────────────

test("different tenantId produces different identity", () => {
  const signer = makeSigner();
  const c1 = buildArdCatalog({ tenantId: "tenant-x", signer });
  const c2 = buildArdCatalog({ tenantId: "tenant-y", signer });
  assert(
    c1.agents[0].trustManifest!.identity !== c2.agents[0].trustManifest!.identity,
    "identities should differ per tenant",
  );
});

test("domain override is respected", () => {
  const signer = makeSigner();
  const catalog = buildArdCatalog({ tenantId: "tenant-z", signer, domain: "example.com" });
  eq(catalog.agents[0].trustManifest!.identity, "did:web:example.com");
});

test("cached catalog is returned on repeated calls", () => {
  const signer = makeSigner();
  _clearArdCatalogCache();
  const c1 = getCachedArdCatalog({ tenantId: "tenant-cache", signer });
  const c2 = getCachedArdCatalog({ tenantId: "tenant-cache", signer });
  eq(c1.agents[0].trustManifest!.signature, c2.agents[0].trustManifest!.signature);
});

// ── Fail-closed ─────────────────────────────────────────────────────────────

test("missing tenantId throws", () => {
  const signer = makeSigner();
  try {
    buildArdCatalog({ tenantId: "", signer });
    throw new Error("should have thrown");
  } catch (e: any) {
    assert(e.message.includes("tenantId"), "error should mention tenantId");
  }
});

test("missing signer throws", () => {
  try {
    buildArdCatalog({ tenantId: "tenant-c", signer: undefined as any });
    throw new Error("should have thrown");
  } catch (e: any) {
    assert(e.message.includes("signer"), "error should mention signer");
  }
});

test("tampered payload fails JWS verification", () => {
  const signer = makeSigner();
  const catalog = buildArdCatalog({ tenantId: "tenant-d", signer });
  const tm = catalog.agents[0].trustManifest!;
  const signature = tm.signature!;
  const { signature: _sig, ...payload } = tm;
  const canonical = canonicalizeJson(payload);

  // tamper
  const tampered = canonical.replace("tenant-d", "evil-tenant");
  assert(!verifyDetachedJws(signature, tampered, signer), "tampered payload should fail verification");
});

test("verifyDetachedJws rejects unknown algorithm", () => {
  const signer = makeSigner();
  const payload = '{"identity":"did:web:test"}';
  const jws = createDetachedJws(payload, signer);

  // Replace the alg in the header with something unsupported
  const parts = jws.split("..");
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  header.alg = "RS256";
  const tamperedJws = `${Buffer.from(JSON.stringify(header), "utf8").toString("base64url")}..${parts[1]}`;

  assert(!verifyDetachedJws(tamperedJws, payload, signer), "RS256 should be rejected");
});

test("verifyDetachedJws rejects malformed token", () => {
  const signer = makeSigner();
  assert(!verifyDetachedJws("not-a-jws", "{}", signer), "malformed token should be rejected");
  assert(!verifyDetachedJws("a.b", "{}", signer), "two-part token should be rejected");
});
