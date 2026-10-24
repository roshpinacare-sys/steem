// G71-2c — steem-mesh-bridge · index.ts
// HTTP JSON-RPC failover gateway over the Hive/Steem public-node mesh.
//
// Lane law (owner's MASTER DIRECTIVE §3): replace direct dependency on public
// HTTP RPC endpoints with a resilient local failover plane. This bridge is the
// RPC FAILOVER PLANE ONLY — public nodes remain the upstream for chain data;
// the internal WS mesh transport lives in the sibling sovereign-gateway :3140.
//
// Fail-closed laws:
//  · loopback bind only (127.0.0.1)
//  · default port 3053 — the wave-19.84 claim hardcoded :3050, but :3050 is
//    measured occupied by a resident host → honest deviation, recorded in README
//  · measured-occupied ports are refused at boot
//  · broadcasts are refused by default; explicit BROADCAST_ENABLED=1 opts in
//  · honest stale flags instead of invented data
//  · every upstream decision lands on the sha256 receipt chain
//
// Zero-slop law holds: clean production surface. Zero Date.now in logic — clock
// is injected (the single Date.now lambda lives in main() as the composition root).
import { NodePool, type FetchLike, type NodeSnapshot } from "./nodes";
import { RpcCache, canonicalKey, methodClass, type TtlTable } from "./cache";
import { ReceiptChain, type Clock, type Receipt } from "./receipts";
import { appendFileSync, mkdirSync } from "node:fs";

export const SERVICE = "steem-mesh-bridge";
export const VERSION = "1.0.0";
/** Default port: 3053. The 19.84 claim hardcoded 3050 — measured occupied by a resident host. */
export const DEFAULT_PORT = 3053;
/** Ports measured occupied by resident fleet hosts — the bridge refuses to bind them. */
export const RESERVED_PORTS: readonly number[] = Object.freeze([
  3000, 3016, 3020, 3021, 3022, 3023, 3024, 3025, 3040, 3042, 3043, 3044, 3045, 3046, 3047, 3050,
  3140,
]);
export const DEFAULT_NODES: readonly string[] = Object.freeze([
  "https://api.steemit.com",
  "https://api.hive.blog",
  "https://anyx.io",
  "https://api.openhive.network",
]);

const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_INVALID_REQUEST = -32600;
const ERR_BROADCAST_DISABLED = -32001;
const ERR_ALL_NODES_FAILED = -32002;

export interface UpstreamEnvelope {
  jsonrpc?: string;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
  id?: unknown;
}

export interface GatewayConfig {
  nodes: string[];
  fetch: FetchLike;
  clock: Clock;
  port?: number; // reported by /health & /status; binding happens in main()
  broadcastEnabled?: boolean;
  upstreamTimeoutMs?: number;
  breaker?: { failureThreshold?: number; cooldownMs?: number };
  ttls?: Partial<TtlTable>;
  maxEntries?: number;
  maxBodyBytes?: number;
  receiptsSink?: (line: string) => void;
}

export function parseNodes(envValue: string | undefined): string[] {
  if (!envValue) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of envValue.split(",")) {
    const url = raw.trim();
    if (!url.startsWith("https://")) continue; // honest filter: https-only upstreams
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

interface RpcRequest {
  jsonrpc?: unknown;
  method?: unknown;
  params?: unknown;
  id?: unknown;
}

function jsonError(code: number, message: string, id: unknown = null, data?: unknown): UpstreamEnvelope {
  const error: { code: number; message: string; data?: unknown } = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", error, id };
}

const jsonHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
  "content-type": "application/json",
  ...extra,
});

export interface BuiltApp {
  fetch: (req: Request) => Promise<Response>;
  pool: NodePool;
  cache: RpcCache;
  receipts: ReceiptChain;
  config: {
    port: number;
    nodes: string[];
    broadcastEnabled: boolean;
    upstreamTimeoutMs: number;
    ttls: TtlTable;
    maxBodyBytes: number;
  };
}

export function buildApp(cfg: GatewayConfig): BuiltApp {
  if (!Array.isArray(cfg.nodes) || cfg.nodes.length === 0) {
    throw new Error("buildApp: at least one upstream node is required (fail-closed)");
  }
  const clock = cfg.clock;
  const broadcastEnabled = cfg.broadcastEnabled === true;
  const port = cfg.port ?? DEFAULT_PORT;
  const maxBodyBytes = Math.max(1, cfg.maxBodyBytes ?? 1_000_000);
  const ttls: TtlTable = {
    dynamicMs: cfg.ttls?.dynamicMs ?? 3_000,
    stableMs: cfg.ttls?.stableMs ?? 30_000,
    defaultMs: cfg.ttls?.defaultMs ?? 5_000,
  };
  const upstreamTimeoutMs = Math.max(1, cfg.upstreamTimeoutMs ?? 6_000);

  const pool = new NodePool({
    nodes: cfg.nodes,
    fetch: cfg.fetch,
    clock,
    breaker: cfg.breaker,
    timeoutMs: upstreamTimeoutMs,
  });
  const cache = new RpcCache({ clock, ttls, maxEntries: cfg.maxEntries });
  const receipts = new ReceiptChain({ clock, sink: cfg.receiptsSink });
  const bootAt = clock();

  // breaker transitions become receipts (same receipt language as the fleet)
  pool.drainTransitions().forEach((t) =>
    receipts.append("breaker", { url: t.url, from: t.from, to: t.to, kind: t.kind }),
  );

  async function handleSingle(reqObj: RpcRequest): Promise<{ body: UpstreamEnvelope; headers: Record<string, string> }> {
    try {
      return await handleSingleInner(reqObj);
    } catch (err) {
      // honest fail-closed: never crash the gateway on a poisoned payload
      const msg = err instanceof Error ? err.message : String(err);
      receipts.append("request", { outcome: "internal_error", error: msg });
      return {
        body: jsonError(-32603, "gateway internal error", (reqObj as RpcRequest).id ?? null, { error: msg }),
        headers: { "x-mesh-cache": "error" },
      };
    }
  }

  async function handleSingleInner(reqObj: RpcRequest): Promise<{ body: UpstreamEnvelope; headers: Record<string, string> }> {
    const method = typeof reqObj.method === "string" ? reqObj.method : null;
    if (!method) {
      return { body: jsonError(JSONRPC_INVALID_REQUEST, "invalid request: method must be a string", reqObj.id ?? null), headers: { "x-mesh-cache": "error" } };
    }
    const params = reqObj.params === undefined ? [] : reqObj.params;
    const id = reqObj.id ?? null;
    const cls = methodClass(method);

    if (cls === "volatile" && !broadcastEnabled) {
      receipts.append("broadcast_refused", { method, reason: "fail-closed default; set BROADCAST_ENABLED=1" });
      return {
        body: jsonError(
          ERR_BROADCAST_DISABLED,
          "broadcast refused: fail-closed default (set BROADCAST_ENABLED=1 to opt in)",
          id,
        ),
        headers: { "x-mesh-cache": "error" },
      };
    }

    const key = canonicalKey(method, params);
    const cached = cache.get(method, params);
    if (cached.hit && !cached.stale) {
      receipts.append("cache_hit", { method, key });
      return {
        body: { jsonrpc: "2.0", result: cached.value, id },
        headers: { "x-mesh-cache": "hit" },
      };
    }

    const envelope = { jsonrpc: "2.0", method, params, id };
    const ranked = pool.rank();
    const errors: Array<{ url: string; error: string }> = [];
    let previousUrl: string | null = null;

    for (const candidate of ranked) {
      if (previousUrl !== null) {
        receipts.append("failover", { from: previousUrl, to: candidate.url, method });
      }
      receipts.append("node_chosen", { url: candidate.url, method, attempt: errors.length });
      if (candidate.state === "HALF_OPEN") pool.beginProbe(candidate.url);
      const res = await pool.callRaw(candidate.url, envelope);
      pool.drainTransitions().forEach((t) =>
        receipts.append("breaker", { url: t.url, from: t.from, to: t.to, kind: t.kind }),
      );
      if (!res.ok) {
        receipts.append("node_failed", { url: candidate.url, error: res.error, method });
        errors.push({ url: candidate.url, error: res.error });
        previousUrl = candidate.url;
        continue;
      }
      const json = res.json as UpstreamEnvelope;
      if (json && typeof json === "object" && "error" in json && json.error) {
        // upstream answered a valid JSON-RPC error — the node is healthy; pass through
        receipts.append("upstream_error", { url: candidate.url, method, code: json.error.code ?? null });
        return {
          body: json,
          headers: { "x-mesh-node": candidate.url, "x-mesh-cache": "miss" },
        };
      }
      if (cls !== "volatile" && json && typeof json === "object" && "result" in json) {
        cache.set(method, params, json.result);
      }
      receipts.append(
        cls === "volatile" ? "broadcast_forward" : "upstream_ok",
        { url: candidate.url, method },
      );
      return {
        body: json,
        headers: { "x-mesh-node": candidate.url, "x-mesh-cache": "miss" },
      };
    }

    // every eligible node failed — honest stale before honest failure
    if (cached.hit && cached.stale) {
      receipts.append("stale_serve", { method, key, cachedAt: cached.cachedAt });
      return {
        body: { jsonrpc: "2.0", result: cached.value, id },
        headers: { "x-mesh-cache": "stale", "x-mesh-stale": "1" },
      };
    }
    receipts.append("all_nodes_failed", { method, errors });
    return {
      body: jsonError(ERR_ALL_NODES_FAILED, "all upstream nodes failed; no stale value held", id, { errors }),
      headers: { "x-mesh-cache": "error" },
    };
  }

  async function handlePost(req: Request): Promise<Response> {
    const declaredLength = Number(req.headers.get("content-length") ?? "0");
    if (declaredLength > maxBodyBytes) {
      return new Response(JSON.stringify(jsonError(-32600, `body exceeds ${maxBodyBytes} bytes`)), {
        status: 413,
        headers: jsonHeaders(),
      });
    }
    let text: string;
    try {
      text = await req.text();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify(jsonError(JSONRPC_PARSE_ERROR, `unreadable body: ${msg}`)), {
        status: 400,
        headers: jsonHeaders(),
      });
    }
    if (text.length > maxBodyBytes) {
      return new Response(JSON.stringify(jsonError(-32600, `body exceeds ${maxBodyBytes} bytes`)), {
        status: 413,
        headers: jsonHeaders(),
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      receipts.append("request", { outcome: "parse_error", error: msg });
      return new Response(JSON.stringify(jsonError(JSONRPC_PARSE_ERROR, "parse error")), {
        status: 200,
        headers: jsonHeaders(),
      });
    }
    if (Array.isArray(parsed)) {
      const parts: UpstreamEnvelope[] = [];
      const cacheFlags = new Set<string>();
      for (const item of parsed) {
        const out = await handleSingle((item ?? {}) as RpcRequest);
        parts.push(out.body);
        cacheFlags.add(out.headers["x-mesh-cache"] ?? "error");
      }
      const flag = cacheFlags.size === 1 ? ([...cacheFlags][0] ?? "error") : "batch";
      return new Response(JSON.stringify(parts), { status: 200, headers: jsonHeaders({ "x-mesh-cache": flag }) });
    }
    const out = await handleSingle((parsed ?? {}) as RpcRequest);
    return new Response(JSON.stringify(out.body), { status: 200, headers: jsonHeaders(out.headers) });
  }

  async function handleGet(pathname: string): Promise<Response> {
    if (pathname === "/health") {
      const counts = pool.counts();
      const ranked = pool.rank();
      const ok = counts.eligible > 0;
      return new Response(
        JSON.stringify({
          ok,
          service: SERVICE,
          version: VERSION,
          port,
          broadcastEnabled,
          pool: {
            ...counts,
            best: ranked.length > 0 ? (ranked[0] as NonNullable<typeof ranked[number]>).url : null,
            nodes: pool.snapshot(),
          },
          cache: cache.stats(),
          receipts: {
            ...receipts.stats(),
            verify: receipts.verify(),
          },
        }),
        { status: 200, headers: jsonHeaders() },
      );
    }
    if (pathname === "/status") {
      const recent: Receipt[] = receipts.recent(20);
      return new Response(
        JSON.stringify({
          service: SERVICE,
          version: VERSION,
          port,
          uptimeMs: clock() - bootAt,
          pool: { counts: pool.counts(), nodes: pool.snapshot() },
          cache: cache.stats(),
          receipts: {
            ...receipts.stats(),
            verify: receipts.verify(),
            recent,
          },
          config: {
            port,
            nodes: cfg.nodes,
            broadcastEnabled,
            upstreamTimeoutMs,
            ttls,
          },
        }),
        { status: 200, headers: jsonHeaders() },
      );
    }
    return new Response(JSON.stringify(jsonError(-32600, `no route: GET ${pathname}`)), {
      status: 404,
      headers: jsonHeaders(),
    });
  }

  async function fetch(req: Request): Promise<Response> {
    let pathname = "/";
    try {
      pathname = new URL(req.url).pathname;
    } catch {
      pathname = "/";
    }
    if (req.method === "POST" && (pathname === "/" || pathname === "/rpc")) {
      return handlePost(req);
    }
    if (req.method === "GET") return handleGet(pathname);
    return new Response(JSON.stringify(jsonError(-32600, `method ${req.method} not allowed`)), {
      status: 405,
      headers: jsonHeaders(),
    });
  }

  return {
    fetch,
    pool,
    cache,
    receipts,
    config: {
      port,
      nodes: cfg.nodes,
      broadcastEnabled,
      upstreamTimeoutMs,
      ttls,
      maxBodyBytes,
    },
  };
}

/** Refuses measured-occupied ports — fail-closed binding law. */
export function assertPortAllowed(port: number): void {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`refusing to bind: invalid port ${port}`);
  }
  if (RESERVED_PORTS.includes(port)) {
    throw new Error(
      `refusing to bind :${port} — measured occupied by a resident fleet host ` +
      `(reserved: ${RESERVED_PORTS.join(",")}). The wave-19.84 claim hardcoded :3050; ` +
      `the bridge defaults to :3053 instead.`,
    );
  }
}

function main(): void {
  const clock: Clock = () => Date.now(); // composition root — the only Date.now on this surface
  const envNodes = parseNodes(process.env.NODES);
  const nodes = envNodes.length > 0 ? envNodes : [...DEFAULT_NODES];
  const port = process.env.PORT ? Number(process.env.PORT) : DEFAULT_PORT;
  assertPortAllowed(port);
  const broadcastEnabled = process.env.BROADCAST_ENABLED === "1";
  const here = import.meta.dir;
  const stateDir = `${here}/state`;
  const receiptsSink = (line: string): void => {
    try {
      mkdirSync(stateDir, { recursive: true });
      appendFileSync(`${stateDir}/receipts.jsonl`, line + "\n");
    } catch (err) {
      throw new Error(`receipt sink write failed for ${stateDir}/receipts.jsonl: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const app = buildApp({
    nodes,
    fetch: globalThis.fetch as unknown as FetchLike,
    clock,
    port,
    broadcastEnabled,
    upstreamTimeoutMs: process.env.UPSTREAM_TIMEOUT_MS ? Number(process.env.UPSTREAM_TIMEOUT_MS) : 6_000,
    breaker: {
      failureThreshold: process.env.BREAKER_THRESHOLD ? Number(process.env.BREAKER_THRESHOLD) : 3,
      cooldownMs: process.env.BREAKER_COOLDOWN_MS ? Number(process.env.BREAKER_COOLDOWN_MS) : 30_000,
    },
    receiptsSink,
  });

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: app.fetch,
  });

  console.log(
    JSON.stringify({
      at: new Date(clock()).toISOString(),
      msg: `${SERVICE} up`,
      bind: `127.0.0.1:${port}`,
      nodes: nodes.length,
      broadcastEnabled,
      honest: "public nodes remain upstream for chain data; this bridge is the failover plane",
    }),
  );

  const shutdown = (signal: string): void => {
    console.log(JSON.stringify({ at: new Date(clock()).toISOString(), msg: `${SERVICE} stopping`, signal, receiptHead: app.receipts.stats().seq }));
    server.stop(true);
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

if (import.meta.main) main();
