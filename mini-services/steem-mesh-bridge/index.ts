// steem-mesh-bridge · index.ts — the local failover mesh gateway (W49-d, §3 MASTER DIRECTIVE).
//
// Owner directive §3: kill the external-RPC single-point-of-failure. Internal
// consumers (engine, realmarket, hivemarket, …) hit ONE local gateway (:3050);
// the gateway fronts a health-ranked pool of public Steem/Hive nodes with
// failover, a circuit breaker, an idempotent-query cache, and honest stale
// flags. Zero new dependencies — Bun.serve + fetch only.
//
// Endpoints:
//   POST /      JSON-RPC passthrough: {method, params} or a full steem-style
//               {jsonrpc, method, params, id} envelope. Cache → single-flight →
//               top-ranked healthy node → failover loop → stale-or-502.
//   GET /health {ok, organ, port, pool:[{name,healthy,breakerState,ewmaMs}], cache}
//   GET /status full honest detail: candidates, active, dropped, per-node
//               breaker/EWMA/lastError, cache stats incl. evictions + staleHits,
//               singleFlight depth, limits.
import { NodePool, UpstreamError } from "./nodes";
import type { NodeCandidate } from "./nodes";
import { QueryCache } from "./cache";

export const ORGAN = "steem-mesh-bridge";

/** Real candidates measured at boot (§3: keep only reachable ones; honest list in /status). */
export const DEFAULT_CANDIDATES: NodeCandidate[] = [
  { name: "steemit", url: "https://api.steemit.com" },
  { name: "hive.blog", url: "https://api.hive.blog" },
  { name: "hive-api.arcange", url: "https://api.hive.blog" },
  { name: "boylikegirl", url: "https://steemapi.boylikegirl.club" },
  { name: "esteem", url: "https://rpc.esteem.app" },
];

interface JobOutcome {
  kind: "upstream" | "stale" | "fail";
  status: number;
  body: Record<string, unknown>;
  node: string | null;
  ms: number | null;
  attempts: { node: string; url: string; ms: number; error: string }[];
  cacheHeader: "miss" | "stale";
}

export interface GatewayDeps {
  pool: NodePool;
  cache: QueryCache;
  clock?: () => number;
}

export function createGateway(deps: GatewayDeps) {
  const clock = deps.clock ?? Date.now;
  const bootAt = new Date(clock()).toISOString();
  const inflight = new Map<string, Promise<JobOutcome>>();

  function runJob(method: string, params: unknown): Promise<JobOutcome> {
    return (async (): Promise<JobOutcome> => {
      try {
        const r = await deps.pool.call(method, params);
        const parsed = r.result;
        const body = parsed !== null && typeof parsed === "object" ? { ...(parsed as Record<string, unknown>) } : { result: parsed };
        deps.cache.set(method, params, parsed);
        return { kind: "upstream", status: 200, body, node: r.node, ms: r.ms, attempts: r.attempts, cacheHeader: "miss" };
      } catch (e) {
        const attempts = e instanceof UpstreamError ? e.attempts : [];
        const error = e instanceof Error ? e.message : String(e);
        const stale = deps.cache.getStale(method, params);
        if (stale.hit) {
          const cached = stale.value;
          const body: Record<string, unknown> =
            cached !== null && typeof cached === "object" ? { ...(cached as Record<string, unknown>) } : { result: cached };
          body.stale = true;
          body.servedAt = new Date(clock()).toISOString();
          return { kind: "stale", status: 200, body, node: null, ms: null, attempts, cacheHeader: "stale" };
        }
        return {
          kind: "fail",
          status: 502,
          body: { ok: false, error: `all-upstreams-failed: ${error}`, stale: false, attempts, method },
          node: null,
          ms: null,
          attempts,
          cacheHeader: "miss",
        };
      }
    })().finally(() => {
      inflight.delete(deps.cache.key(method, params));
    });
  }

  function meshHeaders(extra: Record<string, string>): Record<string, string> {
    return { "x-mesh-organ": ORGAN, ...extra };
  }

  function withId(body: Record<string, unknown>, consumerId: unknown): Record<string, unknown> {
    if (consumerId !== undefined) body.id = consumerId;
    return body;
  }

  async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/health") {
      const pool = deps.pool.health();
      const cs = deps.cache.stats();
      const ok = pool.some((n) => n.reachable && n.breakerState !== "open");
      return Response.json(
        {
          ok,
          organ: ORGAN,
          pool: pool.map((n) => ({ name: n.name, healthy: n.healthy, breakerState: n.breakerState, ewmaMs: n.ewmaMs })),
          cache: { size: cs.size, hits: cs.hits, misses: cs.misses },
        },
        { headers: meshHeaders({}) },
      );
    }

    if (path === "/status") {
      const ps = deps.pool.status();
      return Response.json(
        {
          ok: ps.active.length > 0,
          organ: ORGAN,
          bootAt,
          uptimeMs: Math.max(0, clock() - new Date(bootAt).getTime()),
          candidates: ps.candidates,
          active: ps.active,
          dropped: ps.dropped,
          pool: ps.nodes,
          cache: deps.cache.stats(),
          singleFlight: { inFlight: inflight.size },
          limits: {
            timeoutMs: deps.pool.timeoutMs,
            failThreshold: deps.pool.failThreshold,
            cooldownMs: deps.pool.cooldownMs,
            maxEntries: deps.cache.maxEntries,
          },
        },
        { headers: meshHeaders({}) },
      );
    }

    if (path === "/") {
      if (req.method !== "POST") {
        return Response.json({ ok: false, error: "method-not-allowed", hint: "POST JSON-RPC here; see GET /status" }, { status: 405, headers: meshHeaders({ allow: "POST" }) });
      }
      let raw: any;
      try {
        raw = await req.json();
      } catch {
        return Response.json({ ok: false, error: "invalid-json-body" }, { status: 400, headers: meshHeaders({}) });
      }
      const method = raw?.method;
      if (typeof method !== "string" || method.length === 0) {
        return Response.json({ ok: false, error: "method-required" }, { status: 400, headers: meshHeaders({}) });
      }
      const params = raw?.params ?? [];
      const consumerId = raw?.id;

      // 1) fresh cache?
      const fresh = deps.cache.get(method, params);
      if (fresh.hit) {
        const body = withId(fresh.value !== null && typeof fresh.value === "object" ? { ...(fresh.value as Record<string, unknown>) } : { result: fresh.value }, consumerId);
        return Response.json(body, { headers: meshHeaders({ "x-mesh-cache": "hit", "x-mesh-age-ms": String(fresh.ageMs) }) });
      }

      // 2) single-flight: identical concurrent requests share one upstream job
      const key = deps.cache.key(method, params);
      let job = inflight.get(key);
      if (!job) {
        job = runJob(method, params);
        inflight.set(key, job);
      }
      const outcome = await job;

      if (outcome.status === 502) {
        return Response.json(outcome.body, { status: 502, headers: meshHeaders({ "x-mesh-stale": "false" }) });
      }
      const body = withId({ ...outcome.body }, consumerId);
      const headers = meshHeaders({
        "x-mesh-cache": outcome.cacheHeader,
        "x-mesh-attempts": String(outcome.attempts.length),
        ...(outcome.node ? { "x-mesh-node": outcome.node, "x-mesh-latency-ms": String(outcome.ms) } : {}),
        ...(outcome.cacheHeader === "stale" ? { "x-mesh-stale": "true" } : {}),
      });
      return Response.json(body, { status: outcome.status, headers });
    }

    return Response.json(
      { ok: false, error: "not-found", routes: ["POST /", "GET /health", "GET /status"] },
      { status: 404, headers: meshHeaders({}) },
    );
  }

  return { fetch, pool: deps.pool, cache: deps.cache, inflightCount: () => inflight.size };
}

export async function main(): Promise<void> {
  const port = Number(process.env.MESH_BRIDGE_PORT ?? 3050);
  const timeoutMs = Number(process.env.MESH_BRIDGE_TIMEOUT_MS ?? 2000);
  const maxEntries = Number(process.env.MESH_BRIDGE_CACHE_MAX ?? 512);
  const pool = new NodePool(DEFAULT_CANDIDATES, { timeoutMs });
  const cache = new QueryCache({ maxEntries });
  console.log(`[steem-mesh-bridge] boot: measuring ${DEFAULT_CANDIDATES.length} public candidates (timeout ${timeoutMs}ms each)…`);
  const census = await pool.measure();
  console.log(`[steem-mesh-bridge] boot census: kept=[${census.kept.join(", ") || "NONE"}] dropped=[${census.dropped.map((d) => `${d.name}: ${d.error}`).join(" | ") || "none"}]`);
  if (census.kept.length === 0) {
    console.log("[steem-mesh-bridge] WARNING: zero reachable upstreams — gateway will serve honest 502s until a probe succeeds; /status keeps the drop reasons.");
  }
  const gw = createGateway({ pool, cache });
  Bun.serve({ port, fetch: (req) => gw.fetch(req) });
  console.log(`[steem-mesh-bridge] serving :${port} — health-ranked failover mesh live (§3 claim W49-d)`);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error("[steem-mesh-bridge] fatal boot error:", e);
    process.exit(1);
  });
}
