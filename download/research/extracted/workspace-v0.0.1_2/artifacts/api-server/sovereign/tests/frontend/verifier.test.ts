/**
 * tests/frontend/verifier.test.ts — Public verifier module (parse · render · permalink).
 *
 * HAPPY     receipt + passport JSON parse correctly; VALID ribbon rendered with full chain.
 * EDGE      base64 input, whitespace padding, PARTIAL verdict, merkle fields, proof bundle.
 * FAIL-CLOSED  empty / malformed input, unknown version, missing version, array input — all
 *              return ParseErr without throwing; never silently accepted.
 */
import "../_flush.mjs";
import { test, assert, eq } from "../_harness.mjs";
import { parseVerifierInput } from "../../frontend/verifier/parse.ts";
import { renderProofRibbon } from "../../frontend/verifier/render.ts";
import { computePermalinkSlug } from "../../frontend/verifier/permalink.ts";
import type { VerifyResponse } from "../../frontend/verifier/render.ts";

// ─── Test fixtures ─────────────────────────────────────────────────────────────

const RECEIPT_V1 = {
  version: "tfa-receipt-v1",
  intentId: "intent-abc123",
  tenantId: "tenant-1",
  actorId: "agent:xyz",
  toolId: "file.read",
  resourceRef: "res:1",
  riskClass: "read_only",
  approvalClass: "auto",
  decision: "allowed",
  valueMicrounits: "0",
  decisionTrace: { approved: true, approvalClass: "auto" },
  issuedAt: "2026-06-19T00:00:00.000Z",
  serverRiskClass: "read_only",
  clientClaimedRiskClass: "read_only",
  riskSource: "coding_taxonomy",
  signature: "fakesig-abc123",
  kid: "ed25519-key-v1",
};

const STATUS_RECEIPT = {
  version: "tfa-status-receipt-v1",
  intentId: "intent-status-1",
  tenantId: "tenant-2",
  actorId: "agent:status",
  toolId: "status.check",
  resourceRef: "res:2",
  riskClass: "read_only",
  approvalClass: "auto",
  decision: "allowed",
  valueMicrounits: "0",
  decisionTrace: {},
  issuedAt: "2026-06-19T01:00:00.000Z",
  serverRiskClass: "read_only",
  clientClaimedRiskClass: "read_only",
  riskSource: "coding_taxonomy",
  signature: "fakesig-status",
};

const PASSPORT_V1 = {
  version: "1",
  passportId: "pp-deadbeef",
  issuedAt: "2026-06-19T00:00:00.000Z",
  tenantId: "tenant-1",
  audit: {
    id: "audit-001",
    tenantId: "tenant-1",
    actionId: "act-1",
    actionType: "file.read",
    source: "agent:xyz",
    outcome: "allowed",
    occurredAt: "2026-06-19T00:00:00.000Z",
    prevHash: "0000000000000000",
    hash: "abcdef1234567890",
    signature: "auditsig",
  },
  policy: { outcome: "allowed" },
  hash: "ppHash123",
  signature: "ppsig",
};

const PROOF_BUNDLE = {
  version: "1",
  tenantId: "tenant-1",
  id: "bundle-xyz",
  passports: [PASSPORT_V1],
  issuedAt: "2026-06-19T00:00:00.000Z",
};

const RESP_VALID: VerifyResponse = {
  signatureValid: true,
  decisionValid: true,
  reasons: [],
};

const RESP_INVALID: VerifyResponse = {
  signatureValid: false,
  decisionValid: false,
  reasons: ["signature mismatch"],
};

// ─── HAPPY PATH ────────────────────────────────────────────────────────────────

test("parse: tfa-receipt-v1 JSON → ok, type=receipt, fields preserved", () => {
  const r = parseVerifierInput(JSON.stringify(RECEIPT_V1));
  eq(r.ok, true);
  if (!r.ok) return;
  eq(r.type, "receipt");
  eq(r.raw.intentId, "intent-abc123");
  eq(r.raw.tenantId, "tenant-1");
  eq(r.raw.decision, "allowed");
});

test("parse: tfa-status-receipt-v1 JSON → ok, type=receipt", () => {
  const r = parseVerifierInput(JSON.stringify(STATUS_RECEIPT));
  eq(r.ok, true);
  if (!r.ok) return;
  eq(r.type, "receipt");
});

test("parse: ActionPassport JSON → ok, type=passport", () => {
  const r = parseVerifierInput(JSON.stringify(PASSPORT_V1));
  eq(r.ok, true);
  if (!r.ok) return;
  eq(r.type, "passport");
  eq(r.raw.passportId, "pp-deadbeef");
});

test("render: VALID receipt → verdict=VALID, full chain with signature+decision+risk", () => {
  const parsed = parseVerifierInput(JSON.stringify(RECEIPT_V1));
  assert(parsed.ok, "parse must succeed");
  if (!parsed.ok) return;
  const ribbon = renderProofRibbon(parsed, RESP_VALID, "abc12def3456");
  eq(ribbon.verdict, "VALID");
  eq(ribbon.payloadType, "receipt");
  eq(ribbon.id, "intent-abc123");
  eq(ribbon.tenantId, "tenant-1");
  eq(ribbon.actorId, "agent:xyz");
  eq(ribbon.toolId, "file.read");
  eq(ribbon.signatureValid, true);
  eq(ribbon.decisionValid, true);
  eq(ribbon.kid, "ed25519-key-v1");
  eq(ribbon.riskClass, "read_only");
  eq(ribbon.decision, "allowed");
  eq(ribbon.permalinkSlug, "abc12def3456");
  assert(ribbon.chain.length >= 4, "chain must include signature, kid, risk, decision, integrity");
  const labels = ribbon.chain.map(c => c.label);
  assert(labels.includes("Signature"), "chain must have Signature");
  assert(labels.includes("Decision"), "chain must have Decision");
  assert(labels.includes("Decision Integrity"), "chain must have Decision Integrity");
  eq(ribbon.reasons.length, 0);
});

test("render: VALID passport → verdict=VALID, audit hash in chain", () => {
  const parsed = parseVerifierInput(JSON.stringify(PASSPORT_V1));
  assert(parsed.ok);
  if (!parsed.ok) return;
  const ribbon = renderProofRibbon(parsed, { signatureValid: true, reasons: [] }, "slug001");
  eq(ribbon.verdict, "VALID");
  eq(ribbon.payloadType, "passport");
  eq(ribbon.id, "pp-deadbeef");
  const labels = ribbon.chain.map(c => c.label);
  assert(labels.includes("Audit Hash"), "passport ribbon must show audit hash");
});

// ─── EDGE CASES ────────────────────────────────────────────────────────────────

test("parse: base64-encoded receipt → decoded and parsed correctly", () => {
  const encoded = Buffer.from(JSON.stringify(RECEIPT_V1)).toString("base64");
  const r = parseVerifierInput(encoded);
  eq(r.ok, true);
  if (!r.ok) return;
  eq(r.type, "receipt");
  eq(r.raw.intentId, "intent-abc123");
});

test("parse: base64url-encoded receipt (- and _ variants) → decoded and parsed", () => {
  const b64 = Buffer.from(JSON.stringify(RECEIPT_V1)).toString("base64");
  const b64url = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const r = parseVerifierInput(b64url);
  eq(r.ok, true);
  if (!r.ok) return;
  eq(r.type, "receipt");
});

test("parse: whitespace-padded JSON → trimmed and parsed", () => {
  const r = parseVerifierInput("  " + JSON.stringify(RECEIPT_V1) + "\n\t");
  eq(r.ok, true);
});

test("render: INVALID receipt → verdict=INVALID, chain still rendered (forensic)", () => {
  const parsed = parseVerifierInput(JSON.stringify(RECEIPT_V1));
  assert(parsed.ok);
  if (!parsed.ok) return;
  const ribbon = renderProofRibbon(parsed, RESP_INVALID, "slug-inv");
  eq(ribbon.verdict, "INVALID");
  eq(ribbon.signatureValid, false);
  // Forensic: chain still populated even on failure.
  assert(ribbon.chain.length >= 1, "INVALID ribbon must still render chain items");
  const sig = ribbon.chain.find(c => c.label === "Signature")!;
  eq(sig.ok, false);
  assert(ribbon.reasons.includes("signature mismatch"), "reasons propagated");
});

test("render: PARTIAL verdict when signature valid but decision integrity fails", () => {
  const parsed = parseVerifierInput(JSON.stringify(RECEIPT_V1));
  assert(parsed.ok);
  if (!parsed.ok) return;
  const resp: VerifyResponse = { signatureValid: true, decisionValid: false, reasons: ["decision mismatch"] };
  const ribbon = renderProofRibbon(parsed, resp, "slug-par");
  eq(ribbon.verdict, "PARTIAL");
  eq(ribbon.signatureValid, true);
  eq(ribbon.decisionValid, false);
});

test("render: transparency-log fields propagated into chain and ribbon", () => {
  const parsed = parseVerifierInput(JSON.stringify(RECEIPT_V1));
  assert(parsed.ok);
  if (!parsed.ok) return;
  const resp: VerifyResponse = {
    signatureValid: true,
    decisionValid: true,
    reasons: [],
    merkleLeaf: "deadbeef12345678",
    merkleIndex: 42,
  };
  const ribbon = renderProofRibbon(parsed, resp, "slug-merkle");
  eq(ribbon.merkleLeaf, "deadbeef12345678");
  eq(ribbon.merkleIndex, 42);
  const labels = ribbon.chain.map(c => c.label);
  assert(labels.includes("Transparency Log Leaf"), "merkle leaf in chain");
  assert(labels.includes("Log Index"), "log index in chain");
});

test("render: proof-bundle → verdict driven by signatureValid, type=proof-bundle", () => {
  const parsed = parseVerifierInput(JSON.stringify(PROOF_BUNDLE));
  assert(parsed.ok);
  if (!parsed.ok) return;
  eq(parsed.type, "proof-bundle");
  const ribbon = renderProofRibbon(parsed, RESP_VALID, "slug-bundle");
  eq(ribbon.verdict, "VALID");
  eq(ribbon.payloadType, "proof-bundle");
});

test("permalink: same input → same slug (deterministic)", () => {
  const s = JSON.stringify(RECEIPT_V1);
  eq(computePermalinkSlug(s), computePermalinkSlug(s));
});

test("permalink: different inputs → different slugs", () => {
  const s1 = JSON.stringify(RECEIPT_V1);
  const s2 = JSON.stringify({ ...RECEIPT_V1, intentId: "intent-xyz-different" });
  assert(computePermalinkSlug(s1) !== computePermalinkSlug(s2), "different inputs must differ");
});

test("permalink: slug is 12 lowercase hex chars (URL-safe)", () => {
  const slug = computePermalinkSlug(JSON.stringify(RECEIPT_V1));
  assert(/^[0-9a-f]{12}$/.test(slug), `slug must be 12 hex chars; got: ${slug}`);
});

test("permalink: whitespace trimmed before hashing (consistent with parse)", () => {
  const s = JSON.stringify(RECEIPT_V1);
  eq(computePermalinkSlug(s), computePermalinkSlug("  " + s + "\n"));
});

// ─── FAIL-CLOSED ───────────────────────────────────────────────────────────────

test("parse: empty string → error, no throw", () => {
  const r = parseVerifierInput("");
  eq(r.ok, false);
  if (!r.ok) assert(r.error.length > 0, "error message must be non-empty");
});

test("parse: whitespace-only string → error", () => {
  const r = parseVerifierInput("   \n\t  ");
  eq(r.ok, false);
});

test("parse: malformed JSON → error mentioning JSON, no throw", () => {
  const r = parseVerifierInput("{not: valid json!!}");
  eq(r.ok, false);
  if (!r.ok) assert(r.error.toLowerCase().includes("json"), `error must mention JSON; got: ${r.error}`);
});

test("parse: unknown version → error includes version string + forensic data", () => {
  const r = parseVerifierInput(JSON.stringify({ version: "some-unknown-v99", data: "x" }));
  eq(r.ok, false);
  if (!r.ok) {
    assert(r.error.includes("some-unknown-v99"), `error must name the version; got: ${r.error}`);
    assert(r.forensic !== undefined, "forensic data must be returned for unknown version");
    eq((r.forensic as any).version, "some-unknown-v99");
  }
});

test("parse: missing version field → error mentioning version, forensic data returned", () => {
  const r = parseVerifierInput(JSON.stringify({ intentId: "x", tenantId: "t", signature: "s" }));
  eq(r.ok, false);
  if (!r.ok) {
    assert(r.error.includes("version"), `error must mention version; got: ${r.error}`);
    assert(r.forensic !== undefined, "forensic must be present so UI can show what was parsed");
  }
});

test("parse: JSON array (not object) → error, no throw", () => {
  const r = parseVerifierInput("[1, 2, 3]");
  eq(r.ok, false);
  if (!r.ok) assert(r.error.length > 0);
});

test("parse: JSON primitive string → error", () => {
  const r = parseVerifierInput('"just a string"');
  eq(r.ok, false);
});

test("parse: non-string input (number) → error, no throw", () => {
  const r = parseVerifierInput(42 as any);
  eq(r.ok, false);
});

// ─── Witness quorum (TRUST_INTEGRITY_ROADMAP §2.D-11: quorum-in-verifier) ──────

test("render: witness quorum reached → chain item shows confirmed/threshold, ok=true, VALID verdict", () => {
  const parsed = parseVerifierInput(JSON.stringify(RECEIPT_V1));
  assert(parsed.ok);
  if (!parsed.ok) return;
  const resp: VerifyResponse = {
    signatureValid: true,
    decisionValid: true,
    reasons: [],
    witnessQuorum: { reached: true, distinctWitnesses: 3, threshold: 2 },
  };
  const ribbon = renderProofRibbon(parsed, resp, "slug-quorum-ok");
  eq(ribbon.verdict, "VALID");
  eq(ribbon.witnessQuorum?.reached, true);
  const item = ribbon.chain.find(c => c.label === "Witness Quorum");
  assert(item !== undefined, "witness quorum chain item present");
  eq(item!.ok, true);
  eq(item!.value, "3 of 2 witnesses confirmed");
});

test("render: witness quorum NOT reached → surfaced as ok=false, but does not flip an otherwise-VALID signature verdict", () => {
  const parsed = parseVerifierInput(JSON.stringify(RECEIPT_V1));
  assert(parsed.ok);
  if (!parsed.ok) return;
  const resp: VerifyResponse = {
    signatureValid: true,
    decisionValid: true,
    reasons: [],
    witnessQuorum: { reached: false, distinctWitnesses: 1, threshold: 3 },
  };
  const ribbon = renderProofRibbon(parsed, resp, "slug-quorum-short");
  // Quorum is informational alongside signature verification, never a
  // substitute for it — the roadmap calls for *displaying* "K confirmed",
  // not for quorum to silently override the cryptographic verdict.
  eq(ribbon.verdict, "VALID");
  const item = ribbon.chain.find(c => c.label === "Witness Quorum");
  assert(item !== undefined, "witness quorum chain item present even when short of quorum");
  eq(item!.ok, false);
  eq(item!.value, "1 of 3 witnesses confirmed");
});

test("render: witness quorum absent (no witness network for this log) → no fabricated chain item, ribbon unaffected", () => {
  const parsed = parseVerifierInput(JSON.stringify(RECEIPT_V1));
  assert(parsed.ok);
  if (!parsed.ok) return;
  const resp: VerifyResponse = { signatureValid: true, decisionValid: true, reasons: [] };
  const ribbon = renderProofRibbon(parsed, resp, "slug-quorum-absent");
  eq(ribbon.witnessQuorum, undefined);
  const item = ribbon.chain.find(c => c.label === "Witness Quorum");
  eq(item, undefined, "no witness quorum line should appear when the backend supplied none");
});

test("render: witness quorum propagates through passport and proof-bundle renderers too", () => {
  const q = { reached: true, distinctWitnesses: 5, threshold: 5 };
  const passportParsed = parseVerifierInput(JSON.stringify(PASSPORT_V1));
  assert(passportParsed.ok);
  if (passportParsed.ok) {
    const ribbon = renderProofRibbon(passportParsed, { signatureValid: true, witnessQuorum: q }, "slug-pp-q");
    eq(ribbon.witnessQuorum?.distinctWitnesses, 5);
    assert(ribbon.chain.some(c => c.label === "Witness Quorum"), "passport chain has witness quorum item");
  }
  const bundleParsed = parseVerifierInput(JSON.stringify(PROOF_BUNDLE));
  assert(bundleParsed.ok);
  if (bundleParsed.ok) {
    const ribbon = renderProofRibbon(bundleParsed, { signatureValid: true, witnessQuorum: q }, "slug-bundle-q");
    eq(ribbon.witnessQuorum?.threshold, 5);
    assert(ribbon.chain.some(c => c.label === "Witness Quorum"), "bundle chain has witness quorum item");
  }
});
