import "../_flush.mjs";
/**
 * tests/mcp-server/mcp-server-settlement-tools.test.ts — Settlement tools for TFA MCP Server.
 *
 * FEATURE    tfa_settlement_status, tfa_dispute_settlement wired through stack.settlement.
 * EDGE       stateful flow: create → fund → partialRelease → dispute via MCP tool.
 * FAIL-CLOSED missing settlementService → error; wrong tenant → not found; missing params → error.
 */
import { test, assert, eq } from "../_harness.mjs";
import { TfaMcpServer, type JsonRpcRequest } from "../../lib/mcp-server/index.ts";
import { InMemoryNonceRegistry } from "../../lib/mcp-server/nonce-registry.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { SettlementService, InMemorySettlementStore } from "../../lib/escrow/settlement.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";

const signer = new HmacSigner("mcp-settlement-test-secret");
const FIXED_NOW = () => "2099-01-01T00:00:00.000Z";

function req(method: string, params?: unknown, id = 1): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, params };
}

function makeServerWithSettlement() {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const server = new TfaMcpServer({
    signer,
    executionStore: new InMemoryExecutionStore(),
    serverVersion: "1.0.0",
    nonceRegistry: new InMemoryNonceRegistry(),
    settlementService: stack.settlement,
  });
  return { server, stack };
}

function makeServerWithoutSettlement() {
  const server = new TfaMcpServer({
    signer,
    executionStore: new InMemoryExecutionStore(),
    serverVersion: "1.0.0",
    nonceRegistry: new InMemoryNonceRegistry(),
  });
  return { server };
}

// ── tfa_settlement_status ──

test("tfa_settlement_status returns agreement state for existing settlement", async () => {
  const { server, stack } = makeServerWithSettlement();
  const t = "tenant-s1";
  const ledger = stack.ledger;
  const payer = await ledger.createAccount(t, "owner", "asset", "Payer");
  const worker = await ledger.createAccount(t, "worker", "asset", "Worker");
  await ledger.mint(t, payer.id, 500_000n, "seed", "test", false);

  const agreement = await stack.settlement.create({
    tenantId: t, opportunityId: "opp-s1",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 200_000n, settledBy: "owner",
  });

  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_settlement_status",
    arguments: { tenantId: t, settlementId: agreement.id },
  }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, true);
  eq(text.settlement.id, agreement.id);
  eq(text.settlement.state, "created");
  eq(text.settlement.totalAmount, "200000");
  eq(text.settlement.releasedAmount, "0");
});

test("tfa_settlement_status fail-closed: wrong tenant → not found", async () => {
  const { server, stack } = makeServerWithSettlement();
  const t = "tenant-s2";
  const ledger = stack.ledger;
  const payer = await ledger.createAccount(t, "owner", "asset", "Payer");
  const worker = await ledger.createAccount(t, "worker", "asset", "Worker");
  await ledger.mint(t, payer.id, 500_000n, "seed", "test", false);

  const agreement = await stack.settlement.create({
    tenantId: t, opportunityId: "opp-s2",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 100_000n, settledBy: "owner",
  });

  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_settlement_status",
    arguments: { tenantId: "wrong-tenant", settlementId: agreement.id },
  }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, false);
  eq(text.error, "settlement not found");
});

test("tfa_settlement_status fail-closed: missing settlementService → error", async () => {
  const { server } = makeServerWithoutSettlement();
  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_settlement_status",
    arguments: { tenantId: "t1", settlementId: "s1" },
  }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, false);
  eq(text.error, "settlement service not configured");
});

// ── tfa_dispute_settlement ──

test("tfa_dispute_settlement stateful flow: create → fund → dispute via MCP", async () => {
  const { server, stack } = makeServerWithSettlement();
  const t = "tenant-s3";
  const ledger = stack.ledger;
  const payer = await ledger.createAccount(t, "owner", "asset", "Payer");
  const worker = await ledger.createAccount(t, "worker", "asset", "Worker");
  await ledger.mint(t, payer.id, 500_000n, "seed", "test", false);

  const agreement = await stack.settlement.create({
    tenantId: t, opportunityId: "opp-s3",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 300_000n, settledBy: "owner",
  });
  await stack.settlement.fund(t, agreement.id, "owner");
  await stack.settlement.partialRelease(t, agreement.id, 100_000n, "owner");

  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_dispute_settlement",
    arguments: {
      tenantId: t,
      settlementId: agreement.id,
      disputedBy: "worker",
      disputeReason: "deliverable incomplete",
    },
  }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, true);
  eq(text.settlement.state, "disputed");
  eq(text.settlement.disputedBy, "worker");
  eq(text.settlement.disputeReason, "deliverable incomplete");
  eq(text.settlement.releasedAmount, "100000");
});

test("tfa_dispute_settlement fail-closed: wrong tenant → not found", async () => {
  const { server, stack } = makeServerWithSettlement();
  const t = "tenant-s4";
  const ledger = stack.ledger;
  const payer = await ledger.createAccount(t, "owner", "asset", "Payer");
  const worker = await ledger.createAccount(t, "worker", "asset", "Worker");
  await ledger.mint(t, payer.id, 500_000n, "seed", "test", false);

  const agreement = await stack.settlement.create({
    tenantId: t, opportunityId: "opp-s4",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 100_000n, settledBy: "owner",
  });
  await stack.settlement.fund(t, agreement.id, "owner");

  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_dispute_settlement",
    arguments: {
      tenantId: "wrong-tenant",
      settlementId: agreement.id,
      disputedBy: "worker",
    },
  }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, false);
  eq(text.code, "not_found");
});

test("tfa_dispute_settlement fail-closed: missing settlementService → error", async () => {
  const { server } = makeServerWithoutSettlement();
  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_dispute_settlement",
    arguments: { tenantId: "t1", settlementId: "s1", disputedBy: "worker" },
  }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, false);
  eq(text.error, "settlement service not configured");
});

test("tfa_dispute_settlement fail-closed: missing disputedBy → JSON-RPC error", async () => {
  const { server, stack } = makeServerWithSettlement();
  const t = "tenant-s5";
  const ledger = stack.ledger;
  const payer = await ledger.createAccount(t, "owner", "asset", "Payer");
  const worker = await ledger.createAccount(t, "worker", "asset", "Worker");
  await ledger.mint(t, payer.id, 500_000n, "seed", "test", false);

  const agreement = await stack.settlement.create({
    tenantId: t, opportunityId: "opp-s5",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 100_000n, settledBy: "owner",
  });
  await stack.settlement.fund(t, agreement.id, "owner");

  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_dispute_settlement",
    arguments: { tenantId: t, settlementId: agreement.id },
  }));
  eq(r!.error!.code, -32603);
  assert(r!.error!.message.includes("disputedBy"), "error mentions disputedBy");
});

test("tfa_dispute_settlement fail-closed: dispute released settlement → wrong_state", async () => {
  const { server, stack } = makeServerWithSettlement();
  const t = "tenant-s6";
  const ledger = stack.ledger;
  const payer = await ledger.createAccount(t, "owner", "asset", "Payer");
  const worker = await ledger.createAccount(t, "worker", "asset", "Worker");
  await ledger.mint(t, payer.id, 500_000n, "seed", "test", false);

  const agreement = await stack.settlement.create({
    tenantId: t, opportunityId: "opp-s6",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 100_000n, settledBy: "owner",
  });
  await stack.settlement.fund(t, agreement.id, "owner");
  await stack.settlement.release(t, agreement.id, "owner");

  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_dispute_settlement",
    arguments: {
      tenantId: t,
      settlementId: agreement.id,
      disputedBy: "worker",
    },
  }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, false);
  eq(text.code, "wrong_state");
});

// ── tfa_create_settlement ──

test("tfa_create_settlement returns created agreement", async () => {
  const { server, stack } = makeServerWithSettlement();
  const t = "tenant-s7";
  const ledger = stack.ledger;
  const payer = await ledger.createAccount(t, "owner", "asset", "Payer");
  const worker = await ledger.createAccount(t, "worker", "asset", "Worker");

  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_create_settlement",
    arguments: {
      tenantId: t,
      opportunityId: "opp-s7",
      payerAccountId: payer.id,
      workerAccountId: worker.id,
      totalAmount: "150000",
      settledBy: "owner",
    },
  }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, true);
  eq(text.settlement.tenantId, t);
  eq(text.settlement.opportunityId, "opp-s7");
  eq(text.settlement.payerAccountId, payer.id);
  eq(text.settlement.workerAccountId, worker.id);
  eq(text.settlement.totalAmount, "150000");
  eq(text.settlement.state, "created");
  eq(text.settlement.settledBy, "owner");
  assert(typeof text.settlement.id === "string" && text.settlement.id.length > 0, "id assigned");
});

test("tfa_create_settlement fail-closed: missing settlementService → error", async () => {
  const { server } = makeServerWithoutSettlement();
  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_create_settlement",
    arguments: {
      tenantId: "t1", opportunityId: "o1",
      payerAccountId: "p1", workerAccountId: "w1",
      totalAmount: "100000", settledBy: "owner",
    },
  }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, false);
  eq(text.error, "settlement service not configured");
});

test("tfa_create_settlement fail-closed: non-positive totalAmount → error", async () => {
  const { server, stack } = makeServerWithSettlement();
  const t = "tenant-s7b";
  const ledger = stack.ledger;
  const payer = await ledger.createAccount(t, "owner", "asset", "Payer");
  const worker = await ledger.createAccount(t, "worker", "asset", "Worker");

  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_create_settlement",
    arguments: {
      tenantId: t,
      opportunityId: "opp-s7b",
      payerAccountId: payer.id,
      workerAccountId: worker.id,
      totalAmount: "0",
      settledBy: "owner",
    },
  }));
  eq(r!.error!.code, -32603);
  assert(r!.error!.message.includes("totalAmount"), "error mentions totalAmount");
});

// ── tfa_fund_settlement ──

test("tfa_fund_settlement transitions created → held", async () => {
  const { server, stack } = makeServerWithSettlement();
  const t = "tenant-s8";
  const ledger = stack.ledger;
  const payer = await ledger.createAccount(t, "owner", "asset", "Payer");
  const worker = await ledger.createAccount(t, "worker", "asset", "Worker");
  await ledger.mint(t, payer.id, 500_000n, "seed", "test", false);

  const agreement = await stack.settlement.create({
    tenantId: t, opportunityId: "opp-s8",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 200_000n, settledBy: "owner",
  });

  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_fund_settlement",
    arguments: { tenantId: t, settlementId: agreement.id, initiatedBy: "owner" },
  }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, true);
  eq(text.settlement.state, "held");
  eq(text.settlement.totalAmount, "200000");
  assert(text.settlement.fundAuditId && text.settlement.fundAuditId.length > 0, "fundAuditId recorded");
});

test("tfa_fund_settlement fail-closed: wrong tenant → not_found", async () => {
  const { server, stack } = makeServerWithSettlement();
  const t = "tenant-s9";
  const ledger = stack.ledger;
  const payer = await ledger.createAccount(t, "owner", "asset", "Payer");
  const worker = await ledger.createAccount(t, "worker", "asset", "Worker");
  await ledger.mint(t, payer.id, 500_000n, "seed", "test", false);

  const agreement = await stack.settlement.create({
    tenantId: t, opportunityId: "opp-s9",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 100_000n, settledBy: "owner",
  });

  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_fund_settlement",
    arguments: { tenantId: "wrong-tenant", settlementId: agreement.id, initiatedBy: "owner" },
  }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, false);
  eq(text.code, "not_found");
});

test("tfa_fund_settlement fail-closed: missing settlementService → error", async () => {
  const { server } = makeServerWithoutSettlement();
  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_fund_settlement",
    arguments: { tenantId: "t1", settlementId: "s1", initiatedBy: "owner" },
  }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, false);
  eq(text.error, "settlement service not configured");
});

// ── tfa_release_settlement ──

test("tfa_release_settlement transitions held → released", async () => {
  const { server, stack } = makeServerWithSettlement();
  const t = "tenant-s10";
  const ledger = stack.ledger;
  const payer = await ledger.createAccount(t, "owner", "asset", "Payer");
  const worker = await ledger.createAccount(t, "worker", "asset", "Worker");
  await ledger.mint(t, payer.id, 500_000n, "seed", "test", false);

  const agreement = await stack.settlement.create({
    tenantId: t, opportunityId: "opp-s10",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 200_000n, settledBy: "owner",
  });
  await stack.settlement.fund(t, agreement.id, "owner");

  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_release_settlement",
    arguments: { tenantId: t, settlementId: agreement.id, initiatedBy: "owner" },
  }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, true);
  eq(text.settlement.state, "released");
  eq(text.settlement.releasedAmount, "200000");
});

test("tfa_release_settlement fail-closed: wrong tenant → not_found", async () => {
  const { server, stack } = makeServerWithSettlement();
  const t = "tenant-s11";
  const ledger = stack.ledger;
  const payer = await ledger.createAccount(t, "owner", "asset", "Payer");
  const worker = await ledger.createAccount(t, "worker", "asset", "Worker");
  await ledger.mint(t, payer.id, 500_000n, "seed", "test", false);

  const agreement = await stack.settlement.create({
    tenantId: t, opportunityId: "opp-s11",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 100_000n, settledBy: "owner",
  });
  await stack.settlement.fund(t, agreement.id, "owner");

  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_release_settlement",
    arguments: { tenantId: "wrong-tenant", settlementId: agreement.id, initiatedBy: "owner" },
  }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, false);
  eq(text.code, "not_found");
});

test("tfa_release_settlement fail-closed: missing settlementService → error", async () => {
  const { server } = makeServerWithoutSettlement();
  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_release_settlement",
    arguments: { tenantId: "t1", settlementId: "s1", initiatedBy: "owner" },
  }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, false);
  eq(text.error, "settlement service not configured");
});

// ── tfa_partial_release_settlement ──

test("tfa_partial_release_settlement transitions held → partially_released", async () => {
  const { server, stack } = makeServerWithSettlement();
  const t = "tenant-p1";
  const ledger = stack.ledger;
  const payer = await ledger.createAccount(t, "owner", "asset", "Payer");
  const worker = await ledger.createAccount(t, "worker", "asset", "Worker");
  await ledger.mint(t, payer.id, 500_000n, "seed", "test", false);

  const agreement = await stack.settlement.create({
    tenantId: t, opportunityId: "opp-p1",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 300_000n, settledBy: "owner",
  });
  await stack.settlement.fund(t, agreement.id, "owner");

  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_partial_release_settlement",
    arguments: { tenantId: t, settlementId: agreement.id, amount: "100000", initiatedBy: "owner" },
  }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, true);
  eq(text.settlement.state, "partially_released");
  eq(text.settlement.releasedAmount, "100000");
  assert(text.settlement.releaseAuditIds.length > 0, "releaseAuditIds recorded");
});

test("tfa_partial_release_settlement fail-closed: wrong tenant → not_found", async () => {
  const { server, stack } = makeServerWithSettlement();
  const t = "tenant-p2";
  const ledger = stack.ledger;
  const payer = await ledger.createAccount(t, "owner", "asset", "Payer");
  const worker = await ledger.createAccount(t, "worker", "asset", "Worker");
  await ledger.mint(t, payer.id, 500_000n, "seed", "test", false);

  const agreement = await stack.settlement.create({
    tenantId: t, opportunityId: "opp-p2",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 100_000n, settledBy: "owner",
  });
  await stack.settlement.fund(t, agreement.id, "owner");

  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_partial_release_settlement",
    arguments: { tenantId: "wrong-tenant", settlementId: agreement.id, amount: "50000", initiatedBy: "owner" },
  }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, false);
  eq(text.code, "not_found");
});

test("tfa_partial_release_settlement fail-closed: missing settlementService → error", async () => {
  const { server } = makeServerWithoutSettlement();
  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_partial_release_settlement",
    arguments: { tenantId: "t1", settlementId: "s1", amount: "10000", initiatedBy: "owner" },
  }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, false);
  eq(text.error, "settlement service not configured");
});

test("tfa_partial_release_settlement fail-closed: non-positive amount → error", async () => {
  const { server, stack } = makeServerWithSettlement();
  const t = "tenant-p3";
  const ledger = stack.ledger;
  const payer = await ledger.createAccount(t, "owner", "asset", "Payer");
  const worker = await ledger.createAccount(t, "worker", "asset", "Worker");
  await ledger.mint(t, payer.id, 500_000n, "seed", "test", false);

  const agreement = await stack.settlement.create({
    tenantId: t, opportunityId: "opp-p3",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 100_000n, settledBy: "owner",
  });
  await stack.settlement.fund(t, agreement.id, "owner");

  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_partial_release_settlement",
    arguments: { tenantId: t, settlementId: agreement.id, amount: "0", initiatedBy: "owner" },
  }));
  eq(r!.error!.code, -32603);
  assert(r!.error!.message.includes("amount"), "error mentions amount");
});

// ── tfa_reverse_settlement ──

test("tfa_reverse_settlement transitions disputed → reversed", async () => {
  const { server, stack } = makeServerWithSettlement();
  const t = "tenant-r1";
  const ledger = stack.ledger;
  const payer = await ledger.createAccount(t, "owner", "asset", "Payer");
  const worker = await ledger.createAccount(t, "worker", "asset", "Worker");
  await ledger.mint(t, payer.id, 500_000n, "seed", "test", false);

  const agreement = await stack.settlement.create({
    tenantId: t, opportunityId: "opp-r1",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 200_000n, settledBy: "owner",
  });
  await stack.settlement.fund(t, agreement.id, "owner");
  await stack.settlement.partialRelease(t, agreement.id, 50_000n, "owner");
  await stack.settlement.dispute(t, agreement.id, "worker", "incomplete");

  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_reverse_settlement",
    arguments: { tenantId: t, settlementId: agreement.id, initiatedBy: "owner" },
  }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, true);
  eq(text.settlement.state, "reversed");
  eq(text.settlement.releasedAmount, "50000");
  assert(text.settlement.reversalAuditId && text.settlement.reversalAuditId.length > 0, "reversalAuditId recorded");
});

test("tfa_reverse_settlement fail-closed: wrong tenant → not_found", async () => {
  const { server, stack } = makeServerWithSettlement();
  const t = "tenant-r2";
  const ledger = stack.ledger;
  const payer = await ledger.createAccount(t, "owner", "asset", "Payer");
  const worker = await ledger.createAccount(t, "worker", "asset", "Worker");
  await ledger.mint(t, payer.id, 500_000n, "seed", "test", false);

  const agreement = await stack.settlement.create({
    tenantId: t, opportunityId: "opp-r2",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 100_000n, settledBy: "owner",
  });
  await stack.settlement.fund(t, agreement.id, "owner");
  await stack.settlement.dispute(t, agreement.id, "worker");

  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_reverse_settlement",
    arguments: { tenantId: "wrong-tenant", settlementId: agreement.id, initiatedBy: "owner" },
  }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, false);
  eq(text.code, "not_found");
});

test("tfa_reverse_settlement fail-closed: missing settlementService → error", async () => {
  const { server } = makeServerWithoutSettlement();
  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_reverse_settlement",
    arguments: { tenantId: "t1", settlementId: "s1", initiatedBy: "owner" },
  }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, false);
  eq(text.error, "settlement service not configured");
});

test("tfa_reverse_settlement fail-closed: reverse non-disputed → wrong_state", async () => {
  const { server, stack } = makeServerWithSettlement();
  const t = "tenant-r3";
  const ledger = stack.ledger;
  const payer = await ledger.createAccount(t, "owner", "asset", "Payer");
  const worker = await ledger.createAccount(t, "worker", "asset", "Worker");
  await ledger.mint(t, payer.id, 500_000n, "seed", "test", false);

  const agreement = await stack.settlement.create({
    tenantId: t, opportunityId: "opp-r3",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 100_000n, settledBy: "owner",
  });
  await stack.settlement.fund(t, agreement.id, "owner");

  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_reverse_settlement",
    arguments: { tenantId: t, settlementId: agreement.id, initiatedBy: "owner" },
  }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, false);
  eq(text.code, "wrong_state");
});

// ── tfa_threshold_approval ──

test("tfa_threshold_approval returns signed token for existing settlement", async () => {
  const { server, stack } = makeServerWithSettlement();
  const t = "tenant-t1";
  const ledger = stack.ledger;
  const payer = await ledger.createAccount(t, "owner", "asset", "Payer");
  const worker = await ledger.createAccount(t, "worker", "asset", "Worker");

  const agreement = await stack.settlement.create({
    tenantId: t, opportunityId: "opp-t1",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 500_000n, settledBy: "owner",
  });

  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_threshold_approval",
    arguments: { tenantId: t, settlementId: agreement.id, maxAmount: "200000", approvedBy: "owner" },
  }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, true);
  eq(text.approval.agreementId, agreement.id);
  eq(text.approval.maxAmount, "200000");
  eq(text.approval.approvedBy, "owner");
  assert(typeof text.approval.token === "string" && text.approval.token.length > 0, "token present");
  assert(typeof text.approval.expiresAt === "string" && text.approval.expiresAt.length > 0, "expiresAt present");
});

test("tfa_threshold_approval fail-closed: wrong tenant → not_found", async () => {
  const { server, stack } = makeServerWithSettlement();
  const t = "tenant-t2";
  const ledger = stack.ledger;
  const payer = await ledger.createAccount(t, "owner", "asset", "Payer");
  const worker = await ledger.createAccount(t, "worker", "asset", "Worker");

  const agreement = await stack.settlement.create({
    tenantId: t, opportunityId: "opp-t2",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 100_000n, settledBy: "owner",
  });

  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_threshold_approval",
    arguments: { tenantId: "wrong-tenant", settlementId: agreement.id, maxAmount: "50000", approvedBy: "owner" },
  }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, false);
  eq(text.code, "not_found");
});

test("tfa_threshold_approval fail-closed: missing settlementService → error", async () => {
  const { server } = makeServerWithoutSettlement();
  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_threshold_approval",
    arguments: { tenantId: "t1", settlementId: "s1", maxAmount: "10000", approvedBy: "owner" },
  }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, false);
  eq(text.error, "settlement service not configured");
});

test("tfa_threshold_approval fail-closed: approvedBy mismatch → unauthorized", async () => {
  const { server, stack } = makeServerWithSettlement();
  const t = "tenant-t3";
  const ledger = stack.ledger;
  const payer = await ledger.createAccount(t, "owner", "asset", "Payer");
  const worker = await ledger.createAccount(t, "worker", "asset", "Worker");

  const agreement = await stack.settlement.create({
    tenantId: t, opportunityId: "opp-t3",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 100_000n, settledBy: "owner",
  });

  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_threshold_approval",
    arguments: { tenantId: t, settlementId: agreement.id, maxAmount: "50000", approvedBy: "attacker" },
  }));
  eq(r!.error, undefined);
  const text = JSON.parse(r!.result!.content[0].text);
  eq(text.ok, false);
  eq(text.code, "unauthorized");
});

test("tfa_threshold_approval fail-closed: non-positive maxAmount → error", async () => {
  const { server, stack } = makeServerWithSettlement();
  const t = "tenant-t4";
  const ledger = stack.ledger;
  const payer = await ledger.createAccount(t, "owner", "asset", "Payer");
  const worker = await ledger.createAccount(t, "worker", "asset", "Worker");

  const agreement = await stack.settlement.create({
    tenantId: t, opportunityId: "opp-t4",
    payerAccountId: payer.id, workerAccountId: worker.id,
    totalAmount: 100_000n, settledBy: "owner",
  });

  const r = await server.handleRequest(req("tools/call", {
    name: "tfa_threshold_approval",
    arguments: { tenantId: t, settlementId: agreement.id, maxAmount: "0", approvedBy: "owner" },
  }));
  eq(r!.error!.code, -32603);
  assert(r!.error!.message.includes("maxAmount"), "error mentions maxAmount");
});

// ── stateful flow via MCP tools ──

test("stateful flow: create → fund → release via MCP tools", async () => {
  const { server, stack } = makeServerWithSettlement();
  const t = "tenant-s12";
  const ledger = stack.ledger;
  const payer = await ledger.createAccount(t, "owner", "asset", "Payer");
  const worker = await ledger.createAccount(t, "worker", "asset", "Worker");
  await ledger.mint(t, payer.id, 500_000n, "seed", "test", false);

  // create
  const createRes = await server.handleRequest(req("tools/call", {
    name: "tfa_create_settlement",
    arguments: {
      tenantId: t,
      opportunityId: "opp-s12",
      payerAccountId: payer.id,
      workerAccountId: worker.id,
      totalAmount: "300000",
      settledBy: "owner",
    },
  }));
  eq(createRes!.error, undefined);
  const createText = JSON.parse(createRes!.result!.content[0].text);
  eq(createText.ok, true);
  eq(createText.settlement.state, "created");
  const settlementId = createText.settlement.id as string;

  // fund
  const fundRes = await server.handleRequest(req("tools/call", {
    name: "tfa_fund_settlement",
    arguments: { tenantId: t, settlementId, initiatedBy: "owner" },
  }));
  eq(fundRes!.error, undefined);
  const fundText = JSON.parse(fundRes!.result!.content[0].text);
  eq(fundText.ok, true);
  eq(fundText.settlement.state, "held");
  eq(fundText.settlement.fundAuditId.length > 0, true);

  // release
  const releaseRes = await server.handleRequest(req("tools/call", {
    name: "tfa_release_settlement",
    arguments: { tenantId: t, settlementId, initiatedBy: "owner" },
  }));
  eq(releaseRes!.error, undefined);
  const releaseText = JSON.parse(releaseRes!.result!.content[0].text);
  eq(releaseText.ok, true);
  eq(releaseText.settlement.state, "released");
  eq(releaseText.settlement.releasedAmount, "300000");
  assert(releaseText.settlement.releaseAuditIds.length > 0, "releaseAuditIds recorded");
});

test("stateful flow: create → fund → partialRelease → dispute → reverse via MCP tools", async () => {
  const { server, stack } = makeServerWithSettlement();
  const t = "tenant-s13";
  const ledger = stack.ledger;
  const payer = await ledger.createAccount(t, "owner", "asset", "Payer");
  const worker = await ledger.createAccount(t, "worker", "asset", "Worker");
  await ledger.mint(t, payer.id, 500_000n, "seed", "test", false);

  // create
  const createRes = await server.handleRequest(req("tools/call", {
    name: "tfa_create_settlement",
    arguments: {
      tenantId: t,
      opportunityId: "opp-s13",
      payerAccountId: payer.id,
      workerAccountId: worker.id,
      totalAmount: "400000",
      settledBy: "owner",
    },
  }));
  eq(createRes!.error, undefined);
  const createText = JSON.parse(createRes!.result!.content[0].text);
  eq(createText.ok, true);
  eq(createText.settlement.state, "created");
  const settlementId = createText.settlement.id as string;

  // fund
  const fundRes = await server.handleRequest(req("tools/call", {
    name: "tfa_fund_settlement",
    arguments: { tenantId: t, settlementId, initiatedBy: "owner" },
  }));
  eq(fundRes!.error, undefined);
  const fundText = JSON.parse(fundRes!.result!.content[0].text);
  eq(fundText.ok, true);
  eq(fundText.settlement.state, "held");

  // partial release
  const partialRes = await server.handleRequest(req("tools/call", {
    name: "tfa_partial_release_settlement",
    arguments: { tenantId: t, settlementId, amount: "100000", initiatedBy: "owner" },
  }));
  eq(partialRes!.error, undefined);
  const partialText = JSON.parse(partialRes!.result!.content[0].text);
  eq(partialText.ok, true);
  eq(partialText.settlement.state, "partially_released");
  eq(partialText.settlement.releasedAmount, "100000");

  // dispute
  const disputeRes = await server.handleRequest(req("tools/call", {
    name: "tfa_dispute_settlement",
    arguments: { tenantId: t, settlementId, disputedBy: "worker", disputeReason: "incomplete" },
  }));
  eq(disputeRes!.error, undefined);
  const disputeText = JSON.parse(disputeRes!.result!.content[0].text);
  eq(disputeText.ok, true);
  eq(disputeText.settlement.state, "disputed");

  // reverse
  const reverseRes = await server.handleRequest(req("tools/call", {
    name: "tfa_reverse_settlement",
    arguments: { tenantId: t, settlementId, initiatedBy: "owner" },
  }));
  eq(reverseRes!.error, undefined);
  const reverseText = JSON.parse(reverseRes!.result!.content[0].text);
  eq(reverseText.ok, true);
  eq(reverseText.settlement.state, "reversed");
  eq(reverseText.settlement.releasedAmount, "100000");
  assert(reverseText.settlement.reversalAuditId && reverseText.settlement.reversalAuditId.length > 0, "reversalAuditId recorded");
});
