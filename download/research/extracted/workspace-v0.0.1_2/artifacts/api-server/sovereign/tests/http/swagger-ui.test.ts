import "../_flush.mjs";
/**
 * tests/http/swagger-ui.test.ts
 *
 * Swagger UI endpoint tests.
 * Verifies that GET /api/docs serves the Swagger UI HTML and that
 * GET /api/openapi.yaml serves the raw OpenAPI 3.1 spec.
 */

import { test, assert } from "../_harness.mjs";
import http from "node:http";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

let server: ReturnType<typeof startSovereignServer>;
let port: number;

function get(path: string): Promise<{ status: number; body: string; headers: Record<string, string | string[]> }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, method: "GET", path }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, body, headers: res.headers });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

test("Swagger UI: /api/docs returns HTML with Swagger UI CDN", async () => {
  server = startSovereignServer(0);
  const addr = server.address();
  port = typeof addr === "object" && addr ? addr.port : 0;

  const res = await get("/api/docs");
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert((res.headers["content-type"] as string).includes("text/html"), `expected text/html, got ${res.headers["content-type"]}`);
  assert(res.body.includes("swagger-ui"), "body should contain swagger-ui div");
  assert(res.body.includes("swagger-ui-dist@5"), "body should reference swagger-ui-dist CDN");
  assert(res.body.includes("/api/openapi.yaml"), "body should reference /api/openapi.yaml spec URL");

  await server.shutdown(1000);
});

test("Swagger UI: /api/openapi.yaml returns the spec as YAML", async () => {
  server = startSovereignServer(0);
  const addr = server.address();
  port = typeof addr === "object" && addr ? addr.port : 0;

  const res = await get("/api/openapi.yaml");
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert((res.headers["content-type"] as string).includes("yaml"), `expected yaml content-type, got ${res.headers["content-type"]}`);
  assert(res.body.includes("openapi: \"3.1.0\""), "body should contain openapi version declaration");
  assert(res.body.includes("/healthz"), "body should contain /healthz path");
  assert(res.body.includes("/execution"), "body should contain /execution path");

  await server.shutdown(1000);
});

test("Swagger UI: unknown path under docs returns 404", async () => {
  server = startSovereignServer(0);
  const addr = server.address();
  port = typeof addr === "object" && addr ? addr.port : 0;

  const res = await get("/api/docs/unknown");
  assert(res.status === 404, `expected 404, got ${res.status}`);

  await server.shutdown(1000);
});
