/**
 * Regression tests for edge-test-offload.ts
 * Focus: Redis keys used by the compute offloader must live under the
 * qodo:v24: namespace (Bug 18-A regression).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { RedisState } from "../src/services/redis-state.js";

function makeFetchStub(responses: Array<{ result: unknown }>) {
  let idx = 0;
  return vi.fn(async (..._args: unknown[]) => ({
    json: async () => responses[Math.min(idx++, responses.length - 1)],
  }));
}

describe("edge-test-offload — Redis namespace (Bug 18-A regression)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pushes requests and results under the qodo:v24 namespace", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://fake-redis.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";

    const responses: { result: unknown }[] = [
      { result: 1 },           // publish
      { result: 1 },           // lpush
      { result: 1 },           // set result key
      { result: null },        // first poll
      { result: JSON.stringify({ requestId: "edge-1", passed: true, logs: "" }) }, // second poll
      { result: 1 },           // delete result key
    ];

    const stub = makeFetchStub(responses);
    vi.stubGlobal("fetch", stub);

    const { tryOffloadToClient } = await import("../src/services/edge-test-offload.js");
    const state = new RedisState();
    const passed = await tryOffloadToClient(["src/a.ts"], "npm test", undefined, state);

    expect(passed).toBe(true);

    const urls = stub.mock.calls.map((call) => call[0] as string);
    const requestUrl = urls.find((u) => u.includes("lpush")) ?? "";
    const resultUrl = urls.find((u) => u.includes("compute%3Aresult")) ?? "";

    expect(requestUrl).toContain("qodo%3Av24%3Acompute%3Arequests%3Apending");
    expect(resultUrl).toContain("qodo%3Av24%3Acompute%3Aresult");
  });
});
