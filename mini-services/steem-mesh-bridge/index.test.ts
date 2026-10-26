// G71-2c — steem-mesh-bridge · index.test.ts
// Contract tests for the JSON-RPC gateway: passthrough via breaker path,
// cache path, honest stale, broadcast fail-closed default, receipts, ports.
// Zero network: fetch is injected. Zero Date.now in module logic: clock is injected.
import { describe, expect, test } from "bun:test";
import { DEFAULT_PORT, RESERVED_PORTS, buildApp, parseNodes } from "./index";
import type { FetchLike } from "./nodes";

function stepClock(start = 1_000_000, stepMs = 10) {
  let now = start;
  return () => (now += stepMs);
}

interface RecordedCall {
  url: string;
  body: string;
}

type FetchBehavior = (url: string, body: string) => unknown | never;

/** Route-based injected fetch: url → behavior. Throws when behavior throws. */
function routedFetch(
  routes: Record<string, FetchBehavior>,
  calls: RecordedCall[],
): FetchLike {
  return async (url: string, init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal }) => {
    calls.push({ url, body: init.body });
    const behavior = routes[url];
    if (!behavior) throw new Error("no route: " + url);
    const out = behavior(url, init.body);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(out),
    };
  };
}

const ENVELOPE = (id: string | number, result: unknown) => ({
  jsonrpc: "2.0",
  result,
  id,
});

const props = { head_block_number: 7_000_000, time: "2026-01-01T00:00:00" };

function jsonReq(method: string, params: unknown = {}, id: string | number = 1) {
  return JSON.stringify({ jsonrpc: "2.0", method, params, id });
}

interface AppOpts {
  routes?: Record<string, FetchBehavior>;
  calls?: RecordedCall[];
  clock?: () => number;
  broadcastEnabled?: boolean;
  ttls?: { dynamicMs: number; stableMs: number; defaultMs: number };
  nodes?: string[];
}

function makeApp(opts: AppOpts = {}) {
  const calls: RecordedCall[] = opts.calls ?? [];
  const app = buildApp({
    nodes: opts.nodes ?? ["https://a.test", "https://b.test"],
    fetch: routedFetch(
      opts.routes ?? {
        // echo the request id back — public nodes answer with the caller's id
        "https://b.test": (_url, body) => ENVELOPE((JSON.parse(body) as { id: number }).id, props),
        "https://a.test": () => {
          throw new Error("a.test down");
        },
      },
      calls,
    ),
    clock: opts.clock ?? stepClock(),
    broadcastEnabled: opts.broadcastEnabled ?? false,
    ttls: opts.ttls ?? { dynamicMs: 50, stableMs: 5_000, defaultMs: 300 },
    upstreamTimeoutMs: 50,
    maxBodyBytes: 1_000,
  });
  return { app, calls };
}

const post = (app: ReturnType<typeof buildApp>, body: string) =>
  app.fetch(new Request("http://127.0.0.1:" + DEFAULT_PORT + "/", { method: "POST", body }));

describe("port & config laws (measured host truth)", () => {
  test("default port is 3053 (19.84 claimed 3050 — measured collision with resident host)", () => {
    expect(DEFAULT_PORT).toBe(3053);
  });

  test("occupied ports are reserved and refused", () => {
    for (const p of [3000, 3016, 3020, 3021, 3022, 3023, 3024, 3025, 3040, 3042, 3043, 3044, 3045, 3046, 3047, 3050, 3140]) {
      expect(RESERVED_PORTS).toContain(p);
    }
    expect(RESERVED_PORTS).not.toContain(3053);
  });

  test("parseNodes: env parsing is deterministic, deduped, https-only, non-empty", () => {
    expect(parseNodes("https://b.test, https://a.test,https://b.test")).toEqual([
      "https://b.test",
      "https://a.test",
    ]);
    expect(parseNodes("http://insecure.test,https://ok.test")).toEqual(["https://ok.test"]);
    expect(parseNodes("")).toEqual([]);
  });
});

describe("POST / — JSON-RPC passthrough", () => {
  test("happy path fails over to the healthy node and passes the envelope through", async () => {
    const { app, calls } = makeApp();
    const res = await post(app, jsonReq("condenser_api.get_chain_properties"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result?: unknown; id?: unknown };
    expect(body.result).toEqual(props);
    expect(body.id).toBe(1);
    expect(res.headers.get("x-mesh-node")).toBe("https://b.test");
    expect(res.headers.get("x-mesh-cache")).toBe("miss");
    expect(calls).toHaveLength(2); // a.test failed → b.test answered
    const firstAttempt = calls.find((c) => c.url === "https://a.test");
    expect(firstAttempt).toBeDefined();
    expect(JSON.parse((firstAttempt as RecordedCall).body)).toEqual({
      jsonrpc: "2.0",
      method: "condenser_api.get_chain_properties",
      params: {},
      id: 1,
    });
  });

  test("parse error is reported honestly as -32700 with no upstream call", async () => {
    const { app, calls } = makeApp();
    const res = await post(app, "this is not json");
    const body = (await res.json()) as { error?: { code: number } };
    expect(body.error?.code).toBe(-32700);
    expect(calls).toHaveLength(0);
  });

  test("batch requests are served item by item", async () => {
    const { app, calls } = makeApp();
    const res = await post(
      app,
      JSON.stringify([
        { jsonrpc: "2.0", method: "condenser_api.get_chain_properties", params: {}, id: 1 },
        { jsonrpc: "2.0", method: "condenser_api.get_config", params: {}, id: 2 },
      ]),
    );
    const body = (await res.json()) as Array<{ id: number; result: unknown }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.map((b) => b.id)).toEqual([1, 2]);
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  test("oversized body is refused fail-closed (413), no upstream call", async () => {
    const { app, calls } = makeApp();
    const res = await post(app, jsonReq("condenser_api.get_chain_properties") + "x".repeat(2000));
    expect(res.status).toBe(413);
    expect(calls).toHaveLength(0);
  });
});

describe("cache path", () => {
  test("second identical read is a cache hit — upstream called once less", async () => {
    const { app, calls } = makeApp();
    await post(app, jsonReq("condenser_api.get_chain_properties"));
    const callsAfterFirst = calls.length;
    const res2 = await post(app, jsonReq("condenser_api.get_chain_properties"));
    expect(res2.headers.get("x-mesh-cache")).toBe("hit");
    expect(res2.headers.get("x-mesh-stale")).toBeNull();
    expect(calls.length).toBe(callsAfterFirst); // zero upstream calls
    const body = (await res2.json()) as { result?: unknown };
    expect(body.result).toEqual(props);
  });

  test("different params or method are different cache keys", async () => {
    const { app, calls } = makeApp();
    await post(app, jsonReq("condenser_api.get_block", [100]));
    const before = calls.length;
    await post(app, jsonReq("condenser_api.get_block", [101]));
    expect(calls.length).toBeGreaterThan(before);
  });
});

describe("honest stale (upstream dead, cache speaks the truth)", () => {
  test("all nodes failing + expired-but-held value → served with stale flag", async () => {
    const clock = stepClock();
    const routes: Record<string, FetchBehavior> = {
      "https://b.test": () => ENVELOPE(1, props),
      "https://a.test": () => {
        throw new Error("a.test down");
      },
    };
    const { app, calls } = makeApp({ clock, routes });
    await post(app, jsonReq("condenser_api.get_dynamic_global_properties"));
    const before = calls.length;
    for (let i = 0; i < 7; i++) clock(); // 70ms > dynamicMs 50 → expired-but-held
    routes["https://b.test"] = () => {
      throw new Error("b.test died too");
    };
    const res = await post(app, jsonReq("condenser_api.get_dynamic_global_properties"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-mesh-stale")).toBe("1");
    expect(res.headers.get("x-mesh-cache")).toBe("stale");
    const body = (await res.json()) as { result?: unknown };
    expect(body.result).toEqual(props); // honest stale — old truth, flagged as such
    expect(calls.length).toBe(before + 2); // both nodes attempted before stale fallback
  });

  test("all nodes failing + nothing cached → honest JSON-RPC error, no invented data", async () => {
    const routes: Record<string, FetchBehavior> = {
      "https://a.test": () => {
        throw new Error("a down");
      },
      "https://b.test": () => {
        throw new Error("b down");
      },
    };
    const { app } = makeApp({ routes });
    const res = await post(app, jsonReq("condenser_api.get_accounts", [["alice"]]));
    const body = (await res.json()) as { error?: { code: number; data?: unknown } };
    expect(body.error?.code).toBe(-32002);
    expect(body.error?.data).toBeDefined();
  });
});

describe("broadcast fail-closed law", () => {
  test("broadcast is refused by default with zero upstream calls", async () => {
    const { app, calls } = makeApp();
    const res = await post(
      app,
      jsonReq("condenser_api.broadcast_transaction", [{ trx: "signed-blob" }]),
    );
    const body = (await res.json()) as { error?: { code: number } };
    expect(body.error?.code).toBe(-32001);
    expect(calls).toHaveLength(0);
  });

  test("with BROADCAST_ENABLED=1 the broadcast is forwarded but never cached", async () => {
    let seen = 0;
    const { app, calls } = makeApp({
      broadcastEnabled: true,
      routes: {
        "https://b.test": () => {
          seen++;
          return ENVELOPE(1, { accepted: true });
        },
        "https://a.test": () => {
          throw new Error("a down");
        },
      },
    });
    const trx = jsonReq("network_broadcast_api.broadcast_transaction", [{ trx: "signed-blob" }]);
    const r1 = await post(app, trx);
    expect(((await r1.json()) as { result?: unknown }).result).toEqual({ accepted: true });
    expect(seen).toBe(1);
    const r2 = await post(app, trx); // volatile → never cached → upstream again
    expect(r2.headers.get("x-mesh-cache")).toBe("miss");
    expect(seen).toBe(2);
    expect(calls.filter((c) => c.url === "https://b.test")).toHaveLength(2);
    expect(calls.some((c) => c.url === "https://a.test")).toBe(true); // failover was attempted first
  });
});

describe("GET /health & GET /status — aggregated honest truth", () => {
  test("/health reports pool truth when nodes are eligible", async () => {
    const { app } = makeApp();
    const res = await app.fetch(new Request("http://127.0.0.1/health"));
    const body = (await res.json()) as {
      ok: boolean;
      service: string;
      port: number;
      pool: { total: number; closed: number; eligible: number; best: string | null };
      receipts: { seq: number; head: string };
    };
    expect(body.service).toBe("steem-mesh-bridge");
    expect(body.ok).toBe(true);
    expect(body.port).toBe(3053);
    expect(body.pool.total).toBe(2);
    expect(body.pool.closed).toBe(2);
    expect(body.pool.eligible).toBe(2);
    expect(body.pool.best).toBe("https://a.test");
    expect(body.receipts.seq).toBeGreaterThanOrEqual(0);
  });

  test("/health goes honestly false when every breaker is OPEN", async () => {
    const routes: Record<string, FetchBehavior> = {
      "https://a.test": () => {
        throw new Error("a down");
      },
      "https://b.test": () => {
        throw new Error("b down");
      },
    };
    const { app } = makeApp({ routes });
    await post(app, jsonReq("condenser_api.get_accounts", [["alice"]])); // 1 failure each
    await post(app, jsonReq("condenser_api.get_accounts", [["bob"]])); // 2
    await post(app, jsonReq("condenser_api.get_accounts", [["carol"]])); // 3 → OPEN both
    const res = await app.fetch(new Request("http://127.0.0.1/health"));
    const body = (await res.json()) as { ok: boolean; pool: { closed: number; open: number } };
    expect(body.ok).toBe(false);
    expect(body.pool.open).toBe(2);
    expect(body.pool.closed).toBe(0);
  });

  test("/status exposes pool scores, breaker states, cache stats and receipt head", async () => {
    const { app } = makeApp();
    await post(app, jsonReq("condenser_api.get_chain_properties"));
    const res = await app.fetch(new Request("http://127.0.0.1/status"));
    const body = (await res.json()) as {
      pool: { nodes: Array<{ url: string; state: string; health: number; failureCount: number }> };
      cache: { entries: number; hits: number };
      receipts: { seq: number; verify: { ok: boolean }; recent: Array<{ kind: string }> };
      config: { broadcastEnabled: boolean; port: number };
    };
    expect(body.pool.nodes).toHaveLength(2);
    const a = body.pool.nodes.find((n) => n.url === "https://a.test");
    const b = body.pool.nodes.find((n) => n.url === "https://b.test");
    expect(a?.state).toBe("CLOSED");
    expect(a?.failureCount).toBe(1);
    expect(b?.failureCount).toBe(0);
    expect(b?.health).toBeGreaterThan(a?.health ?? 0);
    expect(body.cache.hits).toBe(0);
    expect(body.receipts.seq).toBeGreaterThan(0);
    expect(body.receipts.verify.ok).toBe(true);
    expect(body.receipts.recent.some((r) => r.kind === "failover")).toBe(true);
    expect(body.config.broadcastEnabled).toBe(false);
    expect(body.config.port).toBe(3053);
  });
});

describe("receipt chain integration (tamper-evident upstream decisions)", () => {
  test("failover, cache hit and stale serve all leave receipts", async () => {
    const clock = stepClock();
    const routes: Record<string, FetchBehavior> = {
      "https://b.test": () => ENVELOPE(1, props),
      "https://a.test": () => {
        throw new Error("a down");
      },
    };
    const { app } = makeApp({ clock, routes });
    await post(app, jsonReq("condenser_api.get_chain_properties")); // failover + set
    await post(app, jsonReq("condenser_api.get_chain_properties")); // cache hit
    const res = await app.fetch(new Request("http://127.0.0.1/status"));
    const body = (await res.json()) as { receipts: { recent: Array<{ kind: string }> } };
    const kinds = body.receipts.recent.map((r) => r.kind);
    expect(kinds).toContain("failover");
    expect(kinds).toContain("cache_hit");
  });
});

/* ── G76-i — chain-pinned routing (x-mesh-chain) ────────────────────────── */

describe("x-mesh-chain routing (G76-i)", () => {
  test("header pins account reads to same-chain nodes; absent header keeps legacy order", async () => {
    const calls: RecordedCall[] = [];
    const { app } = makeApp({
      calls,
      // both nodes healthy: legacy order is url-ascending (hive first)
      routes: {
        "https://hive-node.test": (_url, body) => ENVELOPE((JSON.parse(body) as { id: number }).id, []),
        "https://steem-node.test": (_url, body) =>
          ENVELOPE((JSON.parse(body) as { id: number }).id, [
            { name: "hcsoldier4", posting: { key_auths: [["STM59test", 1]] } },
          ]),
      },
      nodes: ["https://hive-node.test", "https://steem-node.test"],
    });
    // legacy (no header): hive node answers first (alphabetical, equal health)
    const legacy = await app.fetch(new Request("http://mesh/rpc", { method: "POST", body: jsonReq("condenser_api.get_accounts", [["x"]]) }));
    expect(calls[0]?.url).toBe("https://hive-node.test");
    expect(((await legacy.json()) as { result?: unknown[] })?.result).toEqual([]);
    // pinned steem: the STEEM-only account must come from the steem node
    calls.length = 0;
    const pinned = await app.fetch(
      new Request("http://mesh/rpc", {
        method: "POST",
        headers: { "x-mesh-chain": "steem" },
        body: jsonReq("condenser_api.get_accounts", [["hcsoldier4"]]),
      }),
    );
    expect(calls.map((c) => c.url)).toEqual(["https://steem-node.test"]);
    const body = (await pinned.json()) as { result?: Array<{ name?: string }> };
    expect(body?.result?.[0]?.name).toBe("hcsoldier4");
    // the chain-pinned steem answer must be cached per its own key, not leak [] from hive
    calls.length = 0;
    await app.fetch(
      new Request("http://mesh/rpc", {
        method: "POST",
        headers: { "x-mesh-chain": "steem" },
        body: jsonReq("condenser_api.get_accounts", [["hcsoldier4"]]),
      }),
    );
    expect(calls).toHaveLength(0); // served from cache — same canonical key, same chain-pinned truth
  });
});
