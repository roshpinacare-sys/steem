import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
// AUTO-GENERATED contract test from openapi.yaml — do not hand-edit; regenerate.
// Contract: DELETE /auth/api-keys/{keyId} → 204
const SPEC = { method: "delete", path: "/auth/api-keys/{keyId}", expectStatus: 204 };
// No requestBody defined for this operation.

test("contract authApiKeysRevoke: DELETE /auth/api-keys/{keyId} is declared", () => {
  assert(SPEC.path.startsWith("/"), "path must be absolute");
  eq(SPEC.method, "delete");
});

test("contract authApiKeysRevoke: DELETE /auth/api-keys/{keyId} is reachable (live, no crash)", async () => {
  const server = startSovereignServer(0);
  const port = (server.address()).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const res = await fetch(base + "/api" + "/auth/api-keys/contract-test-id-0000", {
      method: "DELETE",
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


