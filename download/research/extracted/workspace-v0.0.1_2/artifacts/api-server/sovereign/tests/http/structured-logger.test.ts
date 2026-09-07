import "../_flush.mjs";
/**
 * tests/http/structured-logger.test.ts — unit tests for structured logger.
 */

import { test, assert, eq, deepEq } from "../_harness.mjs";
import { StructuredLogger, beginLog, endLog } from "../../src/http/structured-logger.ts";

// ─── Logger sink ───────────────────────────────────────────────────────────────

test("StructuredLogger calls the provided sink", () => {
  const captured: any[] = [];
  const logger = new StructuredLogger((e) => captured.push(e));
  logger.log({ ts: "2024-01-01T00:00:00Z", level: "info", method: "GET", path: "/", status: 200, durationMs: 5 });
  eq(captured.length, 1);
  eq(captured[0].level, "info");
});

// ─── beginLog / endLog happy path ─────────────────────────────────────────────

test("beginLog captures method, path, and timestamps", () => {
  const req: any = { method: "POST", url: "/api/ledger/mint", _requestId: "abc", _tenantId: "t1" };
  const ctx = beginLog(req);
  eq(ctx.method, "POST");
  eq(ctx.path, "/api/ledger/mint");
  eq(ctx.reqId, "abc");
  eq(ctx.tenantId, "t1");
  assert(ctx.start > 0, "start should be a positive timestamp");
});

test("endLog produces a complete LogEntry for a success", () => {
  const captured: any[] = [];
  const logger = new StructuredLogger((e) => captured.push(e));
  const ctx = { start: Date.now() - 10, method: "GET", path: "/", reqId: "r1", tenantId: "t1" };
  const entry = endLog(ctx, 200, { logger });
  eq(entry.level, "info");
  eq(entry.status, 200);
  eq(entry.reqId, "r1");
  eq(entry.tenantId, "t1");
  assert(entry.durationMs >= 0, "durationMs should be non-negative");
  assert(!entry.error, "no error on success");
  eq(captured.length, 1);
  deepEq(captured[0], entry);
});

test("endLog produces an error-level entry when error is present", () => {
  const captured: any[] = [];
  const logger = new StructuredLogger((e) => captured.push(e));
  const ctx = { start: Date.now() - 5, method: "POST", path: "/api/escrow" };
  const entry = endLog(ctx, 500, { error: "db timeout", logger });
  eq(entry.level, "error");
  eq(entry.error, "db timeout");
  eq(captured.length, 1);
});

// ─── Edge cases ────────────────────────────────────────────────────────────────

test("beginLog falls back to defaults when req is sparse", () => {
  const ctx = beginLog({});
  eq(ctx.method, "GET");
  eq(ctx.path, "/");
  assert(ctx.reqId === undefined, "reqId should be undefined");
  assert(ctx.tenantId === undefined, "tenantId should be undefined");
});

test("endLog works without a logger (returns entry, no crash)", () => {
  const ctx = { start: Date.now(), method: "GET", path: "/health" };
  const entry = endLog(ctx, 200);
  eq(entry.status, 200);
  eq(entry.level, "info");
});

test("endLog works without reqId or tenantId", () => {
  const captured: any[] = [];
  const logger = new StructuredLogger((e) => captured.push(e));
  const ctx = { start: Date.now(), method: "GET", path: "/" };
  const entry = endLog(ctx, 404, { logger });
  assert(!("reqId" in entry), "reqId should not be present");
  assert(!("tenantId" in entry), "tenantId should not be present");
});
