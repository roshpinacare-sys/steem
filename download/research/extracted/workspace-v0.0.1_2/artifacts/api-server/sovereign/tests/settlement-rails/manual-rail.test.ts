import "../_flush.mjs";
/**
 * tests/settlement-rails/manual-rail.test.ts — v181.
 *
 * Tests for ManualSettlementRail and InMemoryRailRegistry.
 * Zero external dependencies. Run with:
 *   node tests/settlement-rails/manual-rail.test.ts
 *
 * Coverage:
 *   HAPPY PATH  disburse → succeeded · externalRef format · idempotency ·
 *               zero-amount → skipped · metadata passthrough · healthCheck ok
 *   FAIL MODE   failMode=true → failed · healthCheck returns ok=false
 *   FAIL-CLOSED invalid_amount (non-BigInt) · negative amount · empty payeeId ·
 *               empty currency → SettlementRailError
 *   getStatus   found → result · unknown → null
 *   getDisbursements newest-first · reset()
 *   REGISTRY    register + getRail (exact match · default "*" · fallback · null)
 *               listTenants · empty tenantId → SettlementRailError
 *   COMPOSITION buildSovereignStack returns railRegistry with ManualRail default
 */

import { ManualSettlementRail, InMemoryRailRegistry } from "../../lib/settlement-rails/manual-rail.ts";
import { SettlementRailError } from "../../lib/settlement-rails/types.ts";
import type { DisbursementRequest } from "../../lib/settlement-rails/types.ts";

// ─── Harness ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log("  ✓ " + name);
    passed++;
  } catch (e: any) {
    console.error("  ✗ " + name);
    console.error("    " + (e?.message ?? String(e)));
    failed++;
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error("Assert: " + msg);
}
function eq(a: unknown, b: unknown, label?: string): void {
  if (a !== b) throw new Error(`${label ?? "eq"}: expected ${String(b)}, got ${String(a)}`);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeReq(overrides: Partial<DisbursementRequest> = {}): DisbursementRequest {
  return {
    idempotencyKey: "idem-" + Math.random().toString(36).slice(2),
    tenantId: "t1",
    settlementId: "sa-1",
    payeeId: "payee-abc",
    amountMicrounits: 5000n,
    currency: "USD",
    description: "Test disbursement",
    ...overrides,
  };
}

// ─── ManualSettlementRail — happy path ────────────────────────────────────────

await test("disburse: happy path → status=succeeded", async () => {
  const rail = new ManualSettlementRail();
  const result = await rail.disburse(makeReq());
  eq(result.status, "succeeded");
  assert(result.externalRef !== null, "externalRef set");
  assert(result.externalRef!.startsWith("manual:"), "externalRef format");
  assert(result.processedAt.includes("T"), "ISO timestamp");
  assert(result.message.includes("5000"), "amount in message");
});

await test("disburse: externalRef = manual:<idempotencyKey>", async () => {
  const rail = new ManualSettlementRail();
  const req = makeReq({ idempotencyKey: "test-key-123" });
  const result = await rail.disburse(req);
  eq(result.externalRef, "manual:test-key-123");
});

await test("disburse: idempotency — same key returns same result", async () => {
  const rail = new ManualSettlementRail();
  const req = makeReq({ idempotencyKey: "idm-stable" });
  const r1 = await rail.disburse(req);
  const r2 = await rail.disburse(req);
  eq(r1.externalRef, r2.externalRef);
  eq(r1.processedAt, r2.processedAt);
  eq(rail.size, 1);
});

await test("disburse: zero-amount → status=skipped, externalRef=null", async () => {
  const rail = new ManualSettlementRail();
  const result = await rail.disburse(makeReq({ amountMicrounits: 0n }));
  eq(result.status, "skipped");
  eq(result.externalRef, null);
  assert(result.message.includes("zero-amount"), "skip reason in message");
});

await test("disburse: large BigInt amount handled (no overflow)", async () => {
  const rail = new ManualSettlementRail();
  const result = await rail.disburse(makeReq({ amountMicrounits: 999_999_999_999_999n }));
  eq(result.status, "succeeded");
  assert(result.message.includes("999999999999999"), "big amount in message");
});

await test("disburse: label suffix included in message when set", async () => {
  const rail = new ManualSettlementRail({ label: "tenant-A" });
  const result = await rail.disburse(makeReq());
  assert(result.message.includes("[tenant-A]"), "label in message");
});

await test("disburse: providerResponse contains settlementId + tenantId", async () => {
  const rail = new ManualSettlementRail();
  const result = await rail.disburse(makeReq({ settlementId: "sa-42", tenantId: "t-special" }));
  eq((result.providerResponse as any)?.settlementId, "sa-42");
  eq((result.providerResponse as any)?.tenantId, "t-special");
  eq((result.providerResponse as any)?.amountMicrounits, "5000"); // stringified BigInt
});

// ─── failMode ────────────────────────────────────────────────────────────────

await test("failMode: disburse → status=failed", async () => {
  const rail = new ManualSettlementRail({ failMode: true });
  const result = await rail.disburse(makeReq());
  eq(result.status, "failed");
  eq(result.externalRef, null);
  assert(result.message.includes("failMode"), "failMode in message");
});

await test("failMode: idempotency preserved even in failMode", async () => {
  const rail = new ManualSettlementRail({ failMode: true });
  const req = makeReq({ idempotencyKey: "fail-idem" });
  const r1 = await rail.disburse(req);
  const r2 = await rail.disburse(req);
  eq(r1.processedAt, r2.processedAt);
});

await test("failMode: healthCheck → ok=false", async () => {
  const rail = new ManualSettlementRail({ failMode: true });
  const health = await rail.healthCheck!();
  eq(health.ok, false);
  assert(typeof health.reason === "string", "reason present");
});

// ─── healthCheck ─────────────────────────────────────────────────────────────

await test("healthCheck: normal → ok=true", async () => {
  const rail = new ManualSettlementRail();
  const health = await rail.healthCheck!();
  eq(health.ok, true);
});

// ─── getStatus ────────────────────────────────────────────────────────────────

await test("getStatus: after disburse → returns result", async () => {
  const rail = new ManualSettlementRail();
  const req = makeReq({ idempotencyKey: "gs-key" });
  await rail.disburse(req);
  const found = await rail.getStatus("gs-key");
  assert(found !== null, "found");
  eq(found!.status, "succeeded");
});

await test("getStatus: unknown key → null", async () => {
  const rail = new ManualSettlementRail();
  const result = await rail.getStatus("no-such-key");
  eq(result, null);
});

// ─── getDisbursements + reset ─────────────────────────────────────────────────

await test("getDisbursements: returns newest first", async () => {
  const rail = new ManualSettlementRail();
  await rail.disburse(makeReq({ idempotencyKey: "a" }));
  await rail.disburse(makeReq({ idempotencyKey: "b" }));
  const recs = rail.getDisbursements();
  eq(recs.length, 2);
  eq(recs[0].request.idempotencyKey, "b"); // newest first
  eq(recs[1].request.idempotencyKey, "a");
});

await test("reset: clears all records", async () => {
  const rail = new ManualSettlementRail();
  await rail.disburse(makeReq());
  await rail.disburse(makeReq());
  eq(rail.size, 2);
  rail.reset();
  eq(rail.size, 0);
  eq(rail.getDisbursements().length, 0);
});

// ─── Fail-closed input validation ────────────────────────────────────────────

await test("fail-closed: amountMicrounits not BigInt → SettlementRailError(invalid_amount)", async () => {
  const rail = new ManualSettlementRail();
  let caught: SettlementRailError | null = null;
  try {
    await rail.disburse(makeReq({ amountMicrounits: 5000 as any }));
  } catch (e: unknown) {
    if (e instanceof SettlementRailError) caught = e;
  }
  assert(caught !== null, "should throw");
  eq(caught!.code, "invalid_amount");
});

await test("fail-closed: negative amount → SettlementRailError(invalid_amount)", async () => {
  const rail = new ManualSettlementRail();
  let caught: SettlementRailError | null = null;
  try {
    await rail.disburse(makeReq({ amountMicrounits: -1n }));
  } catch (e: unknown) {
    if (e instanceof SettlementRailError) caught = e;
  }
  assert(caught !== null, "should throw");
  eq(caught!.code, "invalid_amount");
});

await test("fail-closed: empty payeeId → SettlementRailError(invalid_payee)", async () => {
  const rail = new ManualSettlementRail();
  let caught: SettlementRailError | null = null;
  try {
    await rail.disburse(makeReq({ payeeId: "" }));
  } catch (e: unknown) {
    if (e instanceof SettlementRailError) caught = e;
  }
  assert(caught !== null, "should throw");
  eq(caught!.code, "invalid_payee");
});

await test("fail-closed: empty currency → SettlementRailError(invalid_currency)", async () => {
  const rail = new ManualSettlementRail();
  let caught: SettlementRailError | null = null;
  try {
    await rail.disburse(makeReq({ currency: "" }));
  } catch (e: unknown) {
    if (e instanceof SettlementRailError) caught = e;
  }
  assert(caught !== null, "should throw");
  eq(caught!.code, "invalid_currency");
});

// ─── InMemoryRailRegistry ─────────────────────────────────────────────────────

await test("registry: register + getRail (exact tenant match)", async () => {
  const reg = new InMemoryRailRegistry();
  const rail = new ManualSettlementRail({}, "rail-t1");
  reg.register("t1", rail);
  const found = reg.getRail("t1");
  assert(found !== null, "found");
  eq(found!.railId, "rail-t1");
});

await test("registry: default '*' used when no exact match", async () => {
  const reg = new InMemoryRailRegistry();
  const defaultRail = new ManualSettlementRail({}, "rail-default");
  reg.register("*", defaultRail);
  const found = reg.getRail("unknown-tenant");
  assert(found !== null, "found via default");
  eq(found!.railId, "rail-default");
});

await test("registry: exact match takes priority over default", async () => {
  const reg = new InMemoryRailRegistry();
  reg.register("*", new ManualSettlementRail({}, "default"));
  reg.register("t1", new ManualSettlementRail({}, "tenant-specific"));
  eq(reg.getRail("t1")!.railId, "tenant-specific");
  eq(reg.getRail("other")!.railId, "default");
});

await test("registry: no registration → null", async () => {
  const reg = new InMemoryRailRegistry();
  const found = reg.getRail("t-unknown");
  eq(found, null);
});

await test("registry: listTenants returns registered keys", async () => {
  const reg = new InMemoryRailRegistry();
  reg.register("t1", new ManualSettlementRail());
  reg.register("*", new ManualSettlementRail());
  const tenants = reg.listTenants();
  assert(tenants.includes("t1"), "t1 in list");
  assert(tenants.includes("*"), "* in list");
  eq(tenants.length, 2);
});

await test("registry: empty tenantId → SettlementRailError", async () => {
  const reg = new InMemoryRailRegistry();
  let caught: SettlementRailError | null = null;
  try {
    reg.register("", new ManualSettlementRail());
  } catch (e: unknown) {
    if (e instanceof SettlementRailError) caught = e;
  }
  assert(caught !== null, "should throw");
});

// ─── Composition integration ──────────────────────────────────────────────────

await test("composition: buildSovereignStack returns railRegistry", async () => {
  const { buildSovereignStack } = await import("../../src/composition.ts");
  const { InMemoryRailRegistry } = await import("../../lib/settlement-rails/manual-rail.ts");
  process.env.TFA_ENV_CHECK_SKIP = "1";
  const stack = buildSovereignStack([]);
  assert(stack.railRegistry instanceof InMemoryRailRegistry, "InMemoryRailRegistry");
  // Default rail registered under "*"
  const defaultRail = stack.railRegistry.getRail("any-tenant");
  assert(defaultRail !== null, "default rail present");
  eq(defaultRail!.railId, "manual-default");
});

await test("composition: railRegistry default rail disburses successfully", async () => {
  const { buildSovereignStack } = await import("../../src/composition.ts");
  process.env.TFA_ENV_CHECK_SKIP = "1";
  const stack = buildSovereignStack([]);
  const rail = stack.railRegistry.getRail("any-tenant")!;
  const result = await rail.disburse({
    idempotencyKey: "comp-test-" + Date.now(),
    tenantId: "any-tenant",
    settlementId: "sa-comp",
    payeeId: "payee-1",
    amountMicrounits: 1000n,
    currency: "USD",
    description: "composition test",
  });
  eq(result.status, "succeeded");
});

// ─── Result ───────────────────────────────────────────────────────────────────

console.log(`\nResult: ${passed} pass, ${failed} fail`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exit(1);
