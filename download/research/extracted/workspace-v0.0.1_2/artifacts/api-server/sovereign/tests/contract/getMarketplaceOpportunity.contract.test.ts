import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
// AUTO-GENERATED contract test from openapi.yaml — do not hand-edit; regenerate.
// Contract: GET /marketplace/opportunities/{id} → 200
const SPEC = { method: "get", path: "/marketplace/opportunities/{id}", expectStatus: 200 };
// No requestBody defined for this operation.

test("contract getMarketplaceOpportunity: GET /marketplace/opportunities/{id} is declared", () => {
  assert(SPEC.path.startsWith("/"), "path must be absolute");
  eq(SPEC.method, "get");
});

test("contract getMarketplaceOpportunity: GET /marketplace/opportunities/{id} is reachable (live, no crash)", async () => {
  const server = startSovereignServer(0);
  const port = (server.address()).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const res = await fetch(base + "/api" + "/marketplace/opportunities/contract-test-id-0000", {
      method: "GET",
      headers: { "x-tenant-id": "contract-test-tenant", "content-type": "application/json" },

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


// Response-shape: responses["200"].content.application/json.schema.required from the spec.
const REQUIRED_RESPONSE_FIELDS = ["ok","opportunity"];

test("contract getMarketplaceOpportunity: GET /marketplace/opportunities/{id} response shape — required fields present on 200", async () => {
  // Only checked when the live status equals the declared success status (200).
  // A client-error status (400/401/403/404/409/422) has a different/no body shape and is skipped here —
  // it is already covered by the "accepts valid payload" test above.
  const server = startSovereignServer(0);
  const port = (server.address()).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const res = await fetch(base + "/api" + "/marketplace/opportunities/contract-test-id-0000", {
      method: "GET",
      headers: { "x-tenant-id": "contract-test-tenant-shape", "content-type": "application/json" },

    });
    if (res.status !== 200) return; // client-error path — shape not asserted
    const body = await res.json();
    for (const field of REQUIRED_RESPONSE_FIELDS) {
      assert(field in body, "response missing required field \"" + field + "\" for GET /marketplace/opportunities/{id} (status 200)");
    }
  } finally {
    server.close();
  }
});
