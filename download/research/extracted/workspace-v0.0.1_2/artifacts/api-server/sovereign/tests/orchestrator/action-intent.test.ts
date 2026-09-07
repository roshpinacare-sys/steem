import "../_flush.mjs";
/**
 * tests/orchestrator/action-intent.test.ts — ActionIntent canonical object + validator.
 *
 * Coverage:
 *   VALID        a fully populated valid intent passes validation.
 *   CANONICAL    canonicalActionIntent produces sorted-key JSON with BigInt as string.
 *   TYPE         null / non-object input rejected.
 *   FIELDS       each required string field rejects empty / missing / wrong type.
 *   RISKCLASS    unknown / invalid risk class rejected; all 7 valid classes accepted.
 *   VALUE        non-bigint rejected; negative bigint rejected; zero allowed.
 *   PRIVACY      unknown / invalid privacy level rejected; all 4 valid levels accepted.
 *   EXPIRY       invalid ISO format rejected; past timestamp rejected; future accepted.
 */
import { test, assert, eq } from "../_harness.mjs";
import {
  PRIVACY_LEVELS,
  validateActionIntent,
  canonicalActionIntent,
} from "../../lib/orchestrator/action-intent.ts";
import type { ActionIntent, ActionRiskClass, PrivacyLevel } from "../../lib/orchestrator/types.ts";

const ALL_RISK_CLASSES: ActionRiskClass[] = [
  "read_only",
  "write_safe",
  "write_destructive",
  "value_moving",
  "irreversible",
  "privacy_sensitive",
  "regulated",
];

function makeIntent(overrides: Partial<ActionIntent> = {}): ActionIntent {
  const base: ActionIntent = {
    tenantId: "tenant-a",
    actorId: "actor-1",
    toolId: "tool-mint",
    resourceRef: "resource-ledger-1",
    riskClass: "value_moving",
    valueMicrounits: 500_000n,
    privacyLevel: "internal",
    approvalPolicyRef: "policy-default",
    nonce: "nonce-abc-123",
    expiry: "2099-01-01T00:00:00.000Z",
    provenance: "api",
    evidencePolicy: "evidence-minimal",
  };
  return { ...base, ...overrides };
}

// ── VALID: a fully populated intent passes validation ──
test("valid ActionIntent passes validation and returns identical data", () => {
  const intent = makeIntent();
  const validated = validateActionIntent(intent);
  eq(validated.tenantId, "tenant-a");
  eq(validated.actorId, "actor-1");
  eq(validated.toolId, "tool-mint");
  eq(validated.resourceRef, "resource-ledger-1");
  eq(validated.riskClass, "value_moving");
  eq(validated.valueMicrounits, 500_000n);
  eq(validated.privacyLevel, "internal");
  eq(validated.approvalPolicyRef, "policy-default");
  eq(validated.nonce, "nonce-abc-123");
  eq(validated.expiry, "2099-01-01T00:00:00.000Z");
  eq(validated.provenance, "api");
  eq(validated.evidencePolicy, "evidence-minimal");
});

// ── CANONICAL: sorted keys, BigInt as string, deterministic ──
test("canonicalActionIntent produces sorted deterministic JSON with BigInt as string", () => {
  const intent = makeIntent({ valueMicrounits: 1_000_000n });
  const canon = canonicalActionIntent(intent);
  const parsed = JSON.parse(canon);
  eq(parsed.actorId, "actor-1");
  eq(parsed.tenantId, "tenant-a");
  eq(parsed.valueMicrounits, "1000000");
  eq(parsed.privacyLevel, "internal");
  // Keys must be sorted.
  const keys = Object.keys(parsed);
  const sorted = [...keys].sort();
  eq(JSON.stringify(keys), JSON.stringify(sorted), "canonical JSON keys are sorted");
});

// ── TYPE: non-object input rejected ──
test("null input rejected", () => {
  try { validateActionIntent(null); throw new Error("should have thrown"); }
  catch (e: any) { assert(e.message.includes("must be an object"), "null throws"); }
});

test("string input rejected", () => {
  try { validateActionIntent("intent"); throw new Error("should have thrown"); }
  catch (e: any) { assert(e.message.includes("must be an object"), "string throws"); }
});

test("array input rejected", () => {
  try { validateActionIntent([]); throw new Error("should have thrown"); }
  catch (e: any) { assert(e.message.includes("must be an object"), "array throws"); }
});

// ── FIELDS: each required string field rejects empty / missing / wrong type ──
const stringFields = [
  "tenantId",
  "actorId",
  "toolId",
  "resourceRef",
  "approvalPolicyRef",
  "nonce",
  "provenance",
  "evidencePolicy",
] as const;

for (const field of stringFields) {
  test(`missing ${field} rejected`, () => {
    const intent = makeIntent();
    (intent as any)[field] = undefined;
    try { validateActionIntent(intent); throw new Error("should have thrown"); }
    catch (e: any) { assert(e.message.includes(`${field} must be a non-empty string`), `missing ${field} throws`); }
  });

  test(`empty ${field} rejected`, () => {
    const intent = makeIntent();
    (intent as any)[field] = "";
    try { validateActionIntent(intent); throw new Error("should have thrown"); }
    catch (e: any) { assert(e.message.includes(`${field} must be a non-empty string`), `empty ${field} throws`); }
  });

  test(`non-string ${field} rejected`, () => {
    const intent = makeIntent();
    (intent as any)[field] = 123;
    try { validateActionIntent(intent); throw new Error("should have thrown"); }
    catch (e: any) { assert(e.message.includes(`${field} must be a non-empty string`), `non-string ${field} throws`); }
  });
}

// ── RISKCLASS: invalid rejected, all valid accepted ──
test("unknown risk class rejected", () => {
  const intent = makeIntent({ riskClass: "totally_unknown" as ActionRiskClass });
  try { validateActionIntent(intent); throw new Error("should have thrown"); }
  catch (e: any) { assert(e.message.includes("riskClass must be a valid ActionRiskClass"), "unknown riskClass throws"); }
});

test("all 7 canonical risk classes accepted", () => {
  for (const rc of ALL_RISK_CLASSES) {
    const intent = makeIntent({ riskClass: rc });
    const validated = validateActionIntent(intent);
    eq(validated.riskClass, rc, `riskClass ${rc} accepted`);
  }
});

// ── VALUE: non-bigint and negative rejected, zero allowed ──
test("non-bigint valueMicrounits rejected", () => {
  const intent = makeIntent({ valueMicrounits: 100 as any });
  try { validateActionIntent(intent); throw new Error("should have thrown"); }
  catch (e: any) { assert(e.message.includes("valueMicrounits must be BigInt"), "number valueMicrounits throws"); }
});

test("string valueMicrounits rejected", () => {
  const intent = makeIntent({ valueMicrounits: "100" as any });
  try { validateActionIntent(intent); throw new Error("should have thrown"); }
  catch (e: any) { assert(e.message.includes("valueMicrounits must be BigInt"), "string valueMicrounits throws"); }
});

test("negative valueMicrounits rejected", () => {
  const intent = makeIntent({ valueMicrounits: -1n });
  try { validateActionIntent(intent); throw new Error("should have thrown"); }
  catch (e: any) { assert(e.message.includes("valueMicrounits must be non-negative"), "negative valueMicrounits throws"); }
});

test("zero valueMicrounits allowed", () => {
  const intent = makeIntent({ valueMicrounits: 0n });
  const validated = validateActionIntent(intent);
  eq(validated.valueMicrounits, 0n);
});

// ── PRIVACY: invalid rejected, all valid accepted ──
test("unknown privacy level rejected", () => {
  const intent = makeIntent({ privacyLevel: "top_secret" as PrivacyLevel });
  try { validateActionIntent(intent); throw new Error("should have thrown"); }
  catch (e: any) { assert(e.message.includes("privacyLevel must be a valid PrivacyLevel"), "unknown privacyLevel throws"); }
});

test("all 4 canonical privacy levels accepted", () => {
  for (const pl of PRIVACY_LEVELS) {
    const intent = makeIntent({ privacyLevel: pl });
    const validated = validateActionIntent(intent);
    eq(validated.privacyLevel, pl, `privacyLevel ${pl} accepted`);
  }
});

// ── EXPIRY: invalid format / past timestamp rejected, future accepted ──
test("invalid ISO expiry rejected", () => {
  const intent = makeIntent({ expiry: "not-a-date" });
  try { validateActionIntent(intent); throw new Error("should have thrown"); }
  catch (e: any) { assert(e.message.includes("expiry must be a valid ISO-8601 timestamp"), "invalid expiry throws"); }
});

test("past expiry rejected", () => {
  const intent = makeIntent({ expiry: "2000-01-01T00:00:00.000Z" });
  try { validateActionIntent(intent); throw new Error("should have thrown"); }
  catch (e: any) { assert(e.message.includes("expiry must be in the future"), "past expiry throws"); }
});

test("expiry exactly at now rejected", () => {
  const nowIso = new Date().toISOString();
  const intent = makeIntent({ expiry: nowIso });
  try { validateActionIntent(intent); throw new Error("should have thrown"); }
  catch (e: any) { assert(e.message.includes("expiry must be in the future"), "now expiry throws"); }
});

test("future expiry accepted", () => {
  const intent = makeIntent({ expiry: "2099-12-31T23:59:59.999Z" });
  const validated = validateActionIntent(intent);
  eq(validated.expiry, "2099-12-31T23:59:59.999Z");
});

// ── efficiency/pre-sorted-keys — v335 ────────────────────────────────────────
// These three tests guard the pre-sorted inline canonicalisation refactor:
// 1. Output matches a reference runtime-sorted baseline (regression guard).
// 2. All 12 keys appear in lexicographic order (structural guard).
// 3. Two intents constructed with different field insertion order yield identical
//    canonical strings (determinism/idempotency guard).

test("canonicalActionIntent output matches runtime-sorted reference baseline", () => {
  const intent = makeIntent({ valueMicrounits: 42_000n });
  const canon = canonicalActionIntent(intent);
  // Build reference via the old algorithm so this test catches any divergence.
  const obj: Record<string, unknown> = {
    tenantId: intent.tenantId,
    actorId: intent.actorId,
    toolId: intent.toolId,
    resourceRef: intent.resourceRef,
    riskClass: intent.riskClass,
    valueMicrounits: intent.valueMicrounits.toString(),
    privacyLevel: intent.privacyLevel,
    approvalPolicyRef: intent.approvalPolicyRef,
    nonce: intent.nonce,
    expiry: intent.expiry,
    provenance: intent.provenance,
    evidencePolicy: intent.evidencePolicy,
  };
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) ordered[key] = obj[key];
  const reference = JSON.stringify(ordered);
  eq(canon, reference, "pre-sorted output equals runtime-sorted reference");
});

test("canonicalActionIntent keys are in strict lexicographic order", () => {
  const intent = makeIntent({ valueMicrounits: 0n });
  const canon = canonicalActionIntent(intent);
  const parsed = JSON.parse(canon);
  const keys = Object.keys(parsed);
  const sorted = [...keys].sort();
  eq(JSON.stringify(keys), JSON.stringify(sorted), "keys emitted in sorted order");
  eq(keys.length, 12, "all 12 fields present");
});

test("canonicalActionIntent is deterministic regardless of object construction order", () => {
  // First intent built with makeIntent (standard order).
  const a = canonicalActionIntent(makeIntent({ valueMicrounits: 7n }));
  // Second intent built manually in a different field order.
  const b = canonicalActionIntent({
    evidencePolicy: "evidence-minimal",
    expiry: "2099-01-01T00:00:00.000Z",
    valueMicrounits: 7n,
    privacyLevel: "internal",
    nonce: "nonce-abc-123",
    toolId: "tool-mint",
    actorId: "actor-1",
    tenantId: "tenant-a",
    riskClass: "value_moving",
    resourceRef: "resource-ledger-1",
    approvalPolicyRef: "policy-default",
    provenance: "api",
  });
  eq(a, b, "canonical output is identical regardless of field construction order");
});
