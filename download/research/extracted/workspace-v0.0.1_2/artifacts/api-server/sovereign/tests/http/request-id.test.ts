import "../_flush.mjs";
/**
 * tests/http/request-id.test.ts — unit tests for request-id generation and attachment.
 */

import { test, assert, eq } from "../_harness.mjs";
import { generateRequestId, attachRequestId } from "../../src/http/request-id.ts";

// ─── Generation ────────────────────────────────────────────────────────────────

test("generateRequestId returns a 16-character hex string", () => {
  const id = generateRequestId();
  eq(id.length, 16);
  assert(/^[0-9a-f]{16}$/.test(id), "id should be 16 hex chars");
});

test("generateRequestId returns unique values", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 20; i++) ids.add(generateRequestId());
  eq(ids.size, 20, "all generated ids should be unique");
});

// ─── Attachment ────────────────────────────────────────────────────────────────

test("attachRequestId generates a new id when header is absent", () => {
  const req: any = { headers: {} };
  const res: any = { setHeader: (k: string, v: string) => { res._headers = res._headers || {}; res._headers[k] = v; } };
  const result = attachRequestId(req, res);
  assert(result.id.length > 0, "id should be generated");
  assert(result.attached, "header should be attached");
  eq(res._headers["x-request-id"], result.id);
});

test("attachRequestId propagates existing x-request-id header", () => {
  const req: any = { headers: { "x-request-id": "existing-123" } };
  const res: any = { setHeader: (k: string, v: string) => { res._headers = res._headers || {}; res._headers[k] = v; } };
  const result = attachRequestId(req, res);
  eq(result.id, "existing-123");
  assert(result.attached, "header should be attached");
  eq(res._headers["x-request-id"], "existing-123");
});

test("attachRequestId works with Express-style res.set", () => {
  const req: any = { headers: {} };
  const res: any = { set: (k: string, v: string) => { res._headers = res._headers || {}; res._headers[k] = v; } };
  const result = attachRequestId(req, res);
  assert(result.attached, "should attach via res.set");
  eq(res._headers["x-request-id"], result.id);
});

test("attachRequestId survives missing res methods", () => {
  const req: any = { headers: {} };
  const res: any = {};
  const result = attachRequestId(req, res);
  assert(result.id.length > 0, "id should still be generated");
  assert(!result.attached, "should report not attached when res lacks methods");
});

test("attachRequestId handles null headers gracefully", () => {
  const req: any = { headers: null };
  const res: any = {};
  const result = attachRequestId(req, res);
  assert(/^[0-9a-f]{16}$/.test(result.id), "should still generate a valid id");
});
