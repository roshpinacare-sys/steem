# steem-mesh-bridge (G71-2c)

Local RPC **failover plane** for Hive/Steem/SBD public-node access: a health-ranked
node pool with a deterministic circuit breaker, an idempotent-query cache with
honest-stale semantics, and a sha256 hash-linked receipt chain for every upstream
decision. Loopback-only JSON-RPC gateway (Bun).

> **Lane boundary (honest)** — public nodes (`api.steemit.com`, `api.hive.blog`,
> `anyx.io`, `api.openhive.network`, …) remain the upstream for chain data. This
> bridge is the resilience layer only: no chain data is invented, ever. The
> internal WS mesh transport for fleet-economy is the sibling sovereign-gateway
> `:3140` lane — zero overlap with this surface.

## Why :3053 (PORT deviation, measured)

The wave-19.84 claim hardcoded `:3050`, but `:3050` is **measured occupied** by a
resident fleet host at execution time (`ss -tlnp` → bun pid on `*:3050`). The
bridge therefore **defaults to `PORT=3053`** and refuses to bind any measured-
occupied port (3000, 3016, 3020–3025, 3040, 3042–3047, 3050, 3140) — fail-closed
at boot, not a silent collision. Override with `PORT=<n>`; reserved ports are
refused even when explicitly requested.

## Endpoints (bind 127.0.0.1 only)

| Route | Behavior |
| --- | --- |
| `GET /health` | Aggregated pool truth: per-node state/score, breaker counts, cache stats, receipt-chain head + verify, honest `ok` flag (false when no node is eligible). |
| `POST /` | JSON-RPC 2.0 passthrough (single or batch). Cache path → breaker path → failover across the health-ranked pool. Response headers: `x-mesh-node`, `x-mesh-cache: hit\|miss\|stale`, `x-mesh-stale: 1` when serving expired-but-held truth. |
| `GET /status` | Pool snapshot (scores, breaker states, counters), cache stats, receipt-chain head + last 20 receipts + verify verdict, effective config. |

JSON-RPC error codes: `-32700` parse error · `-32600` invalid request · `-32001`
broadcast refused (fail-closed default) · `-32002` all upstream nodes failed (with
per-node honest reasons, and a stale serve first if one is held) · `-32603`
gateway internal error (never crashes on a poisoned payload).

## Laws

- **Fail-closed broadcasts**: methods classified `volatile` (the broadcast family —
  `broadcast_block`, `broadcast_transaction`, `network_broadcast_api.*`,
  `condenser_api.broadcast_*`, anything matching `/broadcast/i`) are **refused**
  unless `BROADCAST_ENABLED=1` is explicit. Even when opted in, volatile methods
  are **never cached**.
- **Honest stale**: when every eligible node fails and an expired-but-held value
  exists, it is served **flagged** (`x-mesh-stale: 1`, receipt `stale_serve`) —
  old truth labeled as old truth, never invented data.
- **Deterministic breaker**: CLOSED → OPEN after N consecutive failures
  (default 3) → HALF_OPEN after cooldown (default 30s) → single probe →
  CLOSED or REOPEN. Failover order = health-ranked (success-rate 60% + latency
  factor 40%), url ascending as the final tie-break. All thresholds are config,
  all state transitions land on the receipt chain.
- **Receipts**: every upstream decision (node chosen, node failed, failover,
  cache hit, stale serve, breaker transition, broadcast refuse/forward) is a
  sha256 hash-linked receipt (`prevHash→hash`, genesis `0×64`), tamper-evident by
  `verify()`; persisted as JSONL to `state/receipts.jsonl`.
- **Injected dependencies**: fetch and clock are injected in `buildApp` — the
  module logic contains zero network calls and zero `Date.now` (the single
  composition-root lambda lives in `main()`). Tests are fully offline.

## Config (env)

| Var | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3053` | Loopback bind port (reserved ports refused). |
| `NODES` | the four defaults above | Comma-separated `https://` node URLs (deduped, non-https filtered). |
| `BROADCAST_ENABLED` | unset | `1` = forward volatile methods (still never cached). |
| `UPSTREAM_TIMEOUT_MS` | `6000` | Per-attempt upstream timeout. |
| `BREAKER_THRESHOLD` | `3` | Consecutive failures that trip the breaker. |
| `BREAKER_COOLDOWN_MS` | `30000` | OPEN → HALF_OPEN cooldown. |

## Run & test

```sh
bun test .                    # 64 tests, 193 expects, zero network
./node_modules/.bin/tsc -p . --noEmit
bun index.ts                  # boots on 127.0.0.1:3053 (default)
curl -s 127.0.0.1:3053/health
curl -s -X POST 127.0.0.1:3053/ -d '{"jsonrpc":"2.0","method":"condenser_api.get_chain_properties","params":{},"id":1}'
```

`eslint` note: the repo's own `eslint.config.mjs` global-ignores `mini-services/**`,
so this surface's configured gates are `bun test` + strict `tsc`
(`noUncheckedIndexedAccess` on) — both green; the eslint ignore is the repo's
pre-existing law, not a skip by this lane.

Attribution: executes the wave-19.84 claim `steem-mesh-bridge` (§3) with full
honor credit to wave 19.84, which claimed the lane but landed zero code (measured
census, SWARM_STATE de7b108).
