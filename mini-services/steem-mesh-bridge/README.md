# steem-mesh-bridge — local Steem/Hive RPC failover mesh (organ :3050)

W49-d, §3 MASTER DIRECTIVE: **kill the external-RPC single-point-of-failure.**
Internal consumers (saos-engine, realmarket, hivemarket, …) previously hit one
public node directly (api.steemit.com etc.) and suffered rate limits and
detachments. Now they hit **one local gateway**; the gateway fronts a
health-ranked pool of public Steem/Hive nodes with failover, a per-node circuit
breaker, an idempotent-query cache, and honest stale flags.

Zero new dependencies: `Bun.serve` + `fetch` only.

## Honest scope

- **Delivered:** HTTP JSON-RPC passthrough plane (the transport every internal
  consumer uses today via `fetch`). Health-ranked failover pool, circuit
  breaker (closed → open → half-open single probe), per-method-class TTL cache
  with LRU cap, single-flight de-dup, boot reachability census, `stale:true`
  fail-honest degradation, `502 {stale:false, attempts:[…]}` when there is truly
  nothing to serve. This lane owns the Steem/Hive RPC failover plane only.
- **Not in this wave:** a WebSocket *server* upgrade (consumers are HTTP today);
  write/broadcast methods are proxied like any other RPC — caching applies only
  where the gateway sees the same method+params again, and broadcast methods are
  never cached by TTL class defaults… broadcast methods (`broadcast_transaction*`,
  `condenser_api.broadcast*`) hit the default 5000ms TTL — if you need strictly
  never-cached writes, extend `ttlForMethod` (nodes stay untouched).
  Registration in the office-keeper PORTS manifest is intentionally left to a
  follow-up wave (zero-edits-to-existing-files law for this landing).

## Run

```sh
bun run once    # one-shot test suite (bun test, zero network — injected fetch+clock)
bun run dev     # foreground
bun run start   # flock-guarded single instance (boot law)
```

Port: `:3050` (env override `MESH_BRIDGE_PORT`). Tuning: `MESH_BRIDGE_TIMEOUT_MS` (default 2000),
`MESH_BRIDGE_CACHE_MAX` (default 512).

## Endpoints

- `POST /` — JSON-RPC passthrough. Body: `{"method":"condenser_api.get_dynamic_global_properties","params":[]}`
  or a full steem-style envelope `{"jsonrpc":"2.0","id":1,"method":…,"params":…}` (consumer `id` is
  echoed back). Flow: fresh cache → single-flight (identical concurrent requests share ONE upstream
  call) → top-ranked healthy node → fetch with 2000ms timeout → on failure: breaker.recordFail + next
  node (failover loop, max = pool size) → on total failure: last-known value with `{stale:true, servedAt}`
  or honest `502 {ok:false, error, stale:false, attempts:[…]}`.
  Mesh metadata rides headers: `x-mesh-node`, `x-mesh-latency-ms`, `x-mesh-cache` (`hit|miss|stale`),
  `x-mesh-stale`, `x-mesh-attempts`.
- `GET /health` — `{ok, organ, pool:[{name, healthy, breakerState, ewmaMs}], cache:{size, hits, misses}}`.
- `GET /status` — full honest detail: candidates, active, dropped (boot census with drop reasons),
  per-node breaker state / consecFails / EWMA / lastError, cache stats incl. evictions + staleHits,
  single-flight depth, limits.

## Cache TTL classes (idempotent-query law)

| method class                  | TTL    |
| ----------------------------- | ------ |
| `get_dynamic_global_properties` | 1500ms |
| `get_block`                     | 60000ms |
| everything else                 | 5000ms |

Key = `canonicalJSON({method, params})` — object key order never splits entries.
On total upstream failure the last known value is served **stale with honest
flags — fresh data is never fabricated**.

## Node pool (boot census)

Candidates measured at boot with a real probe RPC; only reachable nodes stay
active. Default candidates: `steemit` (api.steemit.com), `hive.blog`,
`hive-api.arcange`, `boylikegirl` (steemapi.boylikegirl.club), `esteem`
(rpc.esteem.app). Ranking: eligible (reachable + breaker-allowed) first, then
EWMA latency ascending (α=0.3), ties by candidate order — deterministic.
Breaker: 3 consecutive fails → open (fast-reject) → 30s cooldown → single
half-open probe → success closes / failure re-opens with a fresh cooldown.

## Tests

`tests/*.test.ts` — 30+ vectors, **zero network** (fetch and clock are injected;
the only real timers are sub-second timeout-race delays): failover determinism,
breaker open/fast-reject/half-open/recovery, cache hit/miss/TTL/LRU, honest
stale, single-flight, pool ranking, timeout→failover, boot census, health/status
shapes, request hygiene.
