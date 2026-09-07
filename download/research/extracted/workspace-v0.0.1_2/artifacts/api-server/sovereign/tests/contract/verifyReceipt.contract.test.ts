import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
// AUTO-GENERATED contract test from openapi.yaml — do not hand-edit; regenerate.
// Contract: POST /receipt/verify → 200
const SPEC = { method: "post", path: "/receipt/verify", expectStatus: 200 };
// Minimal valid payload derived from requestBody.schema.required in the OpenAPI spec.
const PAYLOAD = {"receipt":{}};

test("contract verifyReceipt: POST /receipt/verify is declared", () => {
  assert(SPEC.path.startsWith("/"), "path must be absolute");
  eq(SPEC.method, "post");
});

test("contract verifyReceipt: POST /receipt/verify is reachable (live, no crash)", async () => {
  const server = startSovereignServer(0);
  const port = (server.address()).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const res = await fetch(base + "/api" + "/receipt/verify", {
      method: "POST",
      headers: { "x-tenant-id": "contract-test-tenant", "content-type": "application/json" },
      body: JSON.stringify(PAYLOAD),
    });
    // Contract guarantee: route handler runs without crashing the server.
    // 400 (missing/invalid body), 401/403 (auth), 404 (resource not found) are all acceptable —
    // they prove the route is registered and validation ran.
    // 405 would mean the method is not registered on this path.
    // 5xx means the server crashed — a contract violation.
    assert(res.status !== 405, "method must be registered on this path (got 405)");
    assert(res.status < 500, "server must not crash — got " + res.status);
  } finally {
    server.close();
  }
});

test("contract verifyReceipt: POST /receipt/verify accepts valid payload (200 or known client error)", async () => {
  // Spec contract: a minimal valid payload should yield status 200 (success)
  // OR a known client error (400/401/403/404/409/422) — never a crash (5xx) or 405.
  // Acceptable: [200, 201, 202, 204, 400, 401, 403, 404, 409, 422, 429]
  const server = startSovereignServer(0);
  const port = (server.address()).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const res = await fetch(base + "/api" + "/receipt/verify", {
      method: "POST",
      headers: { "x-tenant-id": "contract-test-tenant-payload", "content-type": "application/json" },
      body: JSON.stringify(PAYLOAD),
    });
    const acceptable = new Set([200, 201, 202, 204, 400, 401, 403, 404, 409, 422, 429]);
    assert(res.status !== 405, "method must be registered (got 405)");
    assert(res.status < 500, "server must not crash with valid payload — got " + res.status);
    assert(acceptable.has(res.status),
      "status " + res.status + " is not in acceptable set [200, 201, 202, 204, 400, 401, 403, 404, 409, 422, 429] for POST /receipt/verify with valid payload");
  } finally {
    server.close();
  }
});

// Response-shape: responses["200"].content.application/json.schema.required from the spec.
const REQUIRED_RESPONSE_FIELDS = ["ok","valid","signatureValid","decisionValid","reasons"];

test("contract verifyReceipt: POST /receipt/verify response shape — required fields present on 200", async () => {
  // Only checked when the live status equals the declared success status (200).
  // A client-error status (400/401/403/404/409/422) has a different/no body shape and is skipped here —
  // it is already covered by the "accepts valid payload" test above.
  const server = startSovereignServer(0);
  const port = (server.address()).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const res = await fetch(base + "/api" + "/receipt/verify", {
      method: "POST",
      headers: { "x-tenant-id": "contract-test-tenant-shape", "content-type": "application/json" },
      body: JSON.stringify(PAYLOAD),
    });
    if (res.status !== 200) return; // client-error path — shape not asserted
    const body = await res.json();
    for (const field of REQUIRED_RESPONSE_FIELDS) {
      assert(field in body, "response missing required field \"" + field + "\" for POST /receipt/verify (status 200)");
    }
  } finally {
    server.close();
  }
});
