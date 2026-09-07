import "../_flush.mjs";
/**
 * tests/http/eval-routes.test.ts — HTTP integration tests for the eval harness routes.
 *
 * Coverage:
 *   • GET /api/eval/run — runs all golden tasks, returns aggregate report
 *   • GET /api/eval/run/:taskId — runs a single task by id
 *   • GET /api/eval/run/:taskId with unknown taskId — 404
 *   • Response shape: ok, overallMean, scorecardMeans, tasks, taskCount
 *   • Each task result has taskId, taskName, evaluatedAt, overallScore, scorecards
 *   • All 6 scorecard dimensions present in scorecardMeans
 *   • Tasks 5 (dispute-reversal) and 6 (partial-release) return correct scores
 *
 * Rate-limit note: each test spins its own server with a large bucket (10_000)
 * and uses a unique tenantId to avoid cross-test bucket exhaustion.
 */

import { test, assert, eq } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import type { Server } from "node:http";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _counter = 0;
function uniqueTenant(): string {
  return `eval-tenant-${++_counter}`;
}

/** High-capacity rate limit so tests never hit 429. */
const UNLIMITED = { windowMs: 60_000, maxRequests: 10_000 };

function makeServer(): { server: Server; port: number } {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const server = startSovereignServer(0, stack, { requireIdempotencyKey: false, rateLimit: UNLIMITED });
  server.unref();
  const addr = server.address();
  if (!addr || typeof addr !== "object") throw new Error("Server did not bind");
  return { server, port: addr.port };
}

async function httpGet(
  port: number,
  path: string,
  tenantId: string,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "GET",
    headers: { "x-tenant-id": tenantId },
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("eval route: GET /api/eval/run returns 200", async () => {
  const { server, port } = makeServer();
  try {
    const { status } = await httpGet(port, "/api/eval/run", uniqueTenant());
    eq(status, 200, "eval/run should return 200");
  } finally { server.close(); }
});

test("eval route: GET /api/eval/run returns ok:true and aggregate shape", async () => {
  const { server, port } = makeServer();
  try {
    const { status, body } = await httpGet(port, "/api/eval/run", uniqueTenant());
    eq(status, 200);
    eq(body.ok, true, "ok must be true");
    assert(typeof body.overallMean === "number", "overallMean must be a number");
    assert(body.overallMean >= 0 && body.overallMean <= 1, "overallMean in [0,1]");
    assert(typeof body.scorecardMeans === "object", "scorecardMeans must be object");
    assert(typeof body.taskCount === "number", "taskCount must be present");
    assert(Array.isArray(body.tasks), "tasks must be an array");
    eq(body.tasks.length, body.taskCount, "tasks.length === taskCount");
    assert(body.taskCount >= 6, "must have at least 6 golden tasks");
  } finally { server.close(); }
});

test("eval route: GET /api/eval/run tasks have required fields", async () => {
  const { server, port } = makeServer();
  try {
    const { body } = await httpGet(port, "/api/eval/run", uniqueTenant());
    for (const task of body.tasks) {
      assert(typeof task.taskId === "string" && task.taskId.length > 0, `taskId missing`);
      assert(typeof task.taskName === "string" && task.taskName.length > 0, `taskName missing on ${task.taskId}`);
      assert(typeof task.evaluatedAt === "string", `evaluatedAt missing on ${task.taskId}`);
      assert(typeof task.overallScore === "number", `overallScore missing on ${task.taskId}`);
      assert(typeof task.scorecards === "object", `scorecards missing on ${task.taskId}`);
      for (const [name, sc] of Object.entries(task.scorecards)) {
        const s = sc as any;
        assert(typeof s.score === "number", `${task.taskId}.${name}.score not a number`);
        assert(typeof s.passed === "boolean", `${task.taskId}.${name}.passed not a boolean`);
        assert(Array.isArray(s.details), `${task.taskId}.${name}.details not an array`);
      }
    }
  } finally { server.close(); }
});

test("eval route: scorecardMeans has all 6 dimensions", async () => {
  const { server, port } = makeServer();
  try {
    const { body } = await httpGet(port, "/api/eval/run", uniqueTenant());
    const expected = [
      "PlanFidelity", "ApprovalPrecision", "EvidenceCompleteness",
      "ReplayDeterminism", "EconomicInvariantScore", "SafetyScore",
    ];
    for (const name of expected) {
      assert(typeof body.scorecardMeans[name] === "number", `scorecardMeans.${name} missing`);
      assert(body.scorecardMeans[name] >= 0 && body.scorecardMeans[name] <= 1,
        `scorecardMeans.${name} out of [0,1]`);
    }
  } finally { server.close(); }
});

test("eval route: GET /api/eval/run/:taskId returns single task (gt-001)", async () => {
  const { server, port } = makeServer();
  try {
    const { status, body } = await httpGet(port, "/api/eval/run/eval-gt-001", uniqueTenant());
    eq(status, 200);
    eq(body.ok, true);
    assert(typeof body.task === "object", "body.task must be object");
    eq(body.task.taskId, "eval-gt-001");
    eq(body.task.taskName, "value-moving-with-escrow");
    assert(body.task.overallScore > 0, "score must be positive");
  } finally { server.close(); }
});

test("eval route: GET /api/eval/run/:taskId unknown id → 404", async () => {
  const { server, port } = makeServer();
  try {
    const { status, body } = await httpGet(port, "/api/eval/run/eval-gt-does-not-exist", uniqueTenant());
    eq(status, 404);
    eq(body.ok, false);
    assert(typeof body.error === "string", "error message must be present");
  } finally { server.close(); }
});

test("eval route: gt-004 (denied-irreversible) economic invariant passes via HTTP", async () => {
  const { server, port } = makeServer();
  try {
    const { status, body } = await httpGet(port, "/api/eval/run/eval-gt-004", uniqueTenant());
    eq(status, 200);
    eq(body.ok, true);
    assert(body.task.scorecards.EconomicInvariantScore.passed, "economic invariant must pass (no money moved)");
    assert(body.task.scorecards.PlanFidelity.passed, "plan fidelity must pass for denied path");
  } finally { server.close(); }
});

test("eval route: gt-005 (dispute-reversal) returns 200 and scores positively", async () => {
  const { server, port } = makeServer();
  try {
    const { status, body } = await httpGet(port, "/api/eval/run/eval-gt-005", uniqueTenant());
    eq(status, 200);
    eq(body.ok, true);
    eq(body.task.taskId, "eval-gt-005");
    assert(body.task.overallScore > 0, "dispute-reversal must score positively");
    assert(body.task.scorecards.PlanFidelity.passed, "reversal plan fidelity must pass");
  } finally { server.close(); }
});

test("eval route: gt-006 (partial-release-then-full) returns 200 and scores positively", async () => {
  const { server, port } = makeServer();
  try {
    const { status, body } = await httpGet(port, "/api/eval/run/eval-gt-006", uniqueTenant());
    eq(status, 200);
    eq(body.ok, true);
    eq(body.task.taskId, "eval-gt-006");
    assert(body.task.overallScore > 0, "partial-release must score positively");
    assert(body.task.scorecards.EconomicInvariantScore.passed, "economic invariant must pass (200k moved)");
  } finally { server.close(); }
});
