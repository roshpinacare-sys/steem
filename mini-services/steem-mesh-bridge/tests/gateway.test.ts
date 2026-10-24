// W49-d · steem-mesh-bridge · gateway (index.ts createGateway) vectors — JSON-RPC
// passthrough, cache hits, single-flight, honest stale / 502. ZERO NETWORK:
// the pool's fetch is injected and the clock is injected; no sockets are bound.
import { describe, expect, test } from "bun:test";
import { NodePool } from "../nodes";
import type { NodeCandidate } from "../nodes";
import { QueryCache } from "../cache";
import { createGateway } from "../index";

const rpcReply = (result: unknown, id: number = 1) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const GLOBALS = { head_block_number: 777_777, time: "2026-01-01T00:00:00" };

function harness(handler: (url: string, body: any) => Promise<Response> | Response, maxEntries = 512) {
  const clock = { value: 1_000_000 };
  const calls: { url: string; body: any }[] = [];
  const pool = new NodePool(
    [{ name: "a", url: "https://a.test" }, { name: "b", url: "https://b.test" }] as NodeCandidate[],
    { fetchImpl: async (url: string, init?: any) => { const b = JSON.parse(init?.body ?? "{}"); calls.push({ url, body: b }); return handler(url, b); }, clock: () => clock.value, probeMethod: "mesh.probe" },
  );
  const cache = new QueryCache({ clock: () => clock.value, maxEntries });
  const gw = createGateway({ pool, cache, clock: () => clock.value });
  const post = (payload: unknown) =>
    gw.fetch(new Request("http://mesh:3050/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
  return { gw, pool, cache, clock, calls, post };
}

describe("gateway POST / — JSON-RPC passthrough", () => {
  test("proxies to the top-ranked node and passes the upstream body through", async () => {
    const h = harness(async (url) => {
      if (url.includes("a")) return rpcReply(GLOBALS);
      throw new Error("unreachable-in-test");
    });
    const res = await h.post({ method: "condenser_api.get_dynamic_global_properties", params: [] });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.result).toEqual(GLOBALS);
    expect(res.headers.get("x-mesh-node")).toBe("a");
    expect(res.headers.get("x-mesh-cache")).toBe("miss");
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].body).toMatchObject({ jsonrpc: "2.0", method: "condenser_api.get_dynamic_global_properties", params: [] });
  });

  test("full steem-style envelope accepted; consumer id echoed back", async () => {
    const h = harness(async () => rpcReply(GLOBALS));
    const res = await h.post({ jsonrpc: "2.0", id: 77, method: "condenser_api.get_dynamic_global_properties", params: [] });
    const body: any = await res.json();
    expect(body.id).toBe(77);
    expect(body.result).toEqual(GLOBALS);
  });

  test("failover inside the gateway: first node fails, second serves", async () => {
    const h = harness(async (url) => {
      if (url.includes("a")) throw new Error("boom");
      return rpcReply({ from: "b" });
    });
    const res = await h.post({ method: "m", params: [] });
    const body: any = await res.json();
    expect(body.result).toEqual({ from: "b" });
    expect(res.headers.get("x-mesh-node")).toBe("b");
  });
});

describe("gateway cache — idempotent-query caching", () => {
  test("second identical POST is a cache hit and never reaches upstream", async () => {
    const h = harness(async () => rpcReply(GLOBALS));
    const r1 = await h.post({ method: "condenser_api.get_block", params: [42] });
    const r2 = await h.post({ method: "condenser_api.get_block", params: [42] });
    expect((await r2.json()).result).toEqual(GLOBALS);
    expect(r2.headers.get("x-mesh-cache")).toBe("hit");
    expect(h.calls).toHaveLength(1);
    expect((await r1.json()).result).toEqual(GLOBALS);
  });

  test("different params never share a cache entry", async () => {
    const h = harness(async () => rpcReply(GLOBALS));
    await h.post({ method: "condenser_api.get_block", params: [1] });
    await h.post({ method: "condenser_api.get_block", params: [2] });
    expect(h.calls).toHaveLength(2);
  });

  test("TTL expiry on the injected clock turns a hit back into a miss", async () => {
    const h = harness(async () => rpcReply(GLOBALS));
    await h.post({ method: "condenser_api.get_dynamic_global_properties", params: [] }); // call 1, cached
    h.clock.value += 1400; // inside 1500ms class
    await h.post({ method: "condenser_api.get_dynamic_global_properties", params: [] }); // hit
    h.clock.value += 200; // 1600ms > TTL
    await h.post({ method: "condenser_api.get_dynamic_global_properties", params: [] }); // miss → call 2
    expect(h.calls).toHaveLength(2);
  });
});

describe("gateway single-flight", () => {
  test("N concurrent identical POSTs share ONE upstream call", async () => {
    let upstream = 0;
    const h = harness(async () => {
      upstream++;
      await new Promise((r) => setTimeout(r, 30));
      return rpcReply({ shared: true });
    });
    const payload = { method: "condenser_api.get_block", params: [7] };
    const responses = await Promise.all([h.post(payload), h.post(payload), h.post(payload), h.post(payload), h.post(payload)]);
    expect(upstream).toBe(1);
    const bodies = await Promise.all(responses.map((r) => r.json()));
    for (const b of bodies) expect(b.result).toEqual({ shared: true });
    expect(responses.every((r) => r.status === 200)).toBe(true);
  });

  test("different payloads do not join each other's flight", async () => {
    let upstream = 0;
    const h = harness(async () => {
      upstream++;
      await new Promise((r) => setTimeout(r, 20));
      return rpcReply({ n: upstream });
    });
    await Promise.all([h.post({ method: "m", params: [1] }), h.post({ method: "m", params: [2] })]);
    expect(upstream).toBe(2);
  });
});

describe("gateway honest degradation", () => {
  test("total upstream failure with a warm cache serves STALE with honest flags", async () => {
    let dead = false;
    const h = harness(async () => {
      if (dead) throw new Error("all down");
      return rpcReply(GLOBALS);
    });
    const warm = await h.post({ method: "condenser_api.get_block", params: [9] });
    expect((await warm.json()).result).toEqual(GLOBALS);
    h.clock.value += 999_999; // entry long expired
    dead = true;
    const res = await h.post({ method: "condenser_api.get_block", params: [9] });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-mesh-stale")).toBe("true");
    const body: any = await res.json();
    expect(body.stale).toBe(true);
    expect(typeof body.servedAt).toBe("string");
    expect(body.result).toEqual(GLOBALS); // real cached chain data, never fabricated
  });

  test("total failure with no cache → honest 502 with attempts and stale:false", async () => {
    const h = harness(async () => { throw new Error("dead"); });
    const res = await h.post({ method: "condenser_api.get_block", params: [9] });
    expect(res.status).toBe(502);
    const body: any = await res.json();
    expect(body.ok).toBe(false);
    expect(body.stale).toBe(false);
    expect(Array.isArray(body.attempts)).toBe(true);
    expect(body.attempts.map((a: any) => a.node)).toEqual(["a", "b"]);
    expect(body.attempts[0].error).toContain("dead");
  });
});

describe("gateway observability + hygiene", () => {
  test("GET /health: ok, pool with breaker states, cache stats", async () => {
    const h = harness(async () => rpcReply(GLOBALS));
    await h.post({ method: "m", params: [] });
    const res = await h.gw.fetch(new Request("http://mesh:3050/health"));
    const body: any = await res.json();
    expect(body.ok).toBe(true);
    expect(body.organ).toBe("steem-mesh-bridge");
    expect(body.pool).toEqual([
      { name: "a", healthy: true, breakerState: "closed", ewmaMs: expect.any(Number) },
      { name: "b", healthy: true, breakerState: "closed", ewmaMs: null },
    ]);
    expect(body.cache).toMatchObject({ size: 1, hits: 0, misses: 1 });
  });

  test("GET /status: full honest detail incl. singleFlight + limits", async () => {
    const h = harness(async () => rpcReply(GLOBALS));
    await h.post({ method: "m", params: [] });
    const res = await h.gw.fetch(new Request("http://mesh:3050/status"));
    const body: any = await res.json();
    expect(body.singleFlight).toMatchObject({ inFlight: 0 });
    expect(body.limits).toMatchObject({ timeoutMs: 2000, failThreshold: 3, cooldownMs: 30000, maxEntries: 512 });
    expect(body.cache).toMatchObject({ size: 1, hits: 0, misses: 1, evictions: 0 });
    expect(body.pool.length).toBe(2);
  });

  test("hygiene: bad JSON → 400, missing method → 400, unknown path → 404, GET / → 405", async () => {
    const h = harness(async () => rpcReply(GLOBALS));
    const bad = await h.gw.fetch(new Request("http://mesh:3050/", { method: "POST", body: "{not-json" }));
    expect(bad.status).toBe(400);
    const noMethod = await h.post({ params: [] });
    expect(noMethod.status).toBe(400);
    const nf = await h.gw.fetch(new Request("http://mesh:3050/nope"));
    expect(nf.status).toBe(404);
    const wrongMethod = await h.gw.fetch(new Request("http://mesh:3050/"));
    expect(wrongMethod.status).toBe(405);
  });
});
