# DAEMONS.md — live/dry contract for agent/ broadcast daemons

**Status**: LIVE-GATE contract in force since Task 25-d (2026-09-08), per owner decision
"דגל --live מפורש + לוג רועש" (docs/owner-decisions.md, Task 24 — live-default demoted to explicit opt-in).

## The gate contract (implemented)

Trading daemons are **DRY by default**. Real broadcast happens only when the gate is satisfied by BOTH:

1. **Explicit enable** — one of:
   - CLI flag `--live` in argv, OR
   - env `HE_LIVE=1`
2. **Confirmation** — env `HE_LIVE_CONFIRM=<agent-account-name>` must exactly match the
   account the daemon will act as (`AGENT_ACCOUNT`, default `headcorner`, case-insensitive).

A bare `HE_LIVE=1` without the matching `HE_LIVE_CONFIRM` is NOT enough — the confirmation
exists so an ambient env var can never accidentally enable live broadcasting.

If the gate is not satisfied → the daemon runs DRY and prints an unmistakable one-liner to stdout:

```
[LIVE-GATE] dry-run default — broadcast requires --live flag (or HE_LIVE=1) AND HE_LIVE_CONFIRM=<account>
```

When live IS enabled → an equally loud line is printed **before any broadcast call**:

```
[LIVE-GATE] LIVE MODE ENABLED — real broadcast to Hive mainnet (Hive-Engine sidechain ops) as @<account>
```

Legacy `--dry` is still accepted and always forces DRY (wins over `--live`/`HE_LIVE=1`).

## Gated daemons (Task 25-d)

| Daemon | Gate (file:line) | Broadcast call (file:line) | Network |
|---|---|---|---|
| `agent/he_sell.cjs` | he_sell.cjs:46-57 | he_sell.cjs:150 (`condenser_api.broadcast_transaction`, active auth) | Hive mainnet / Hive-Engine sidechain |
| `agent/he_unstake.cjs` | he_unstake.cjs:44-55 | he_unstake.cjs:119 (inside `heOp()`, active auth) | Hive mainnet / Hive-Engine sidechain |

Safe examples:

```bash
# DRY (default — even with no flags at all)
node agent/he_sell.cjs

# LIVE — both conditions required
node agent/he_sell.cjs --live --qty 9000 --price 0.0001   # + env HE_LIVE_CONFIRM=headcorner
HE_LIVE=1 HE_LIVE_CONFIRM=headcorner node agent/he_unstake.cjs
```

## Blast radius note (Task 25-d evidence)

A repo sweep (`rg "broadcast_transaction|broadcast\(" agent/ -g '*.cjs' -g '*.js'`) found **40
broadcast-capable files** under `agent/` (he_sell, he_unstake, agent.cjs, mint_borrow.cjs, reflex.cjs,
factory_v2.cjs, paymaster.cjs, he_genesis.cjs, limits_probe*.cjs, …). The Task 24/25-d gate was applied
**only to he_sell.cjs + he_unstake.cjs** (bounded scope). Several of the others still use the
live-default pattern `const DRY = process.argv.includes('--dry')` (e.g. value_lock.cjs:43,
sovereign_ops.cjs:47, mint_borrow.cjs:51, he_genesis.cjs:54, grid79.cjs:32, cascade.cjs:46,
fleet_voice.cjs:30, post_announce.cjs:50) or `DRY_RUN` env defaults-to-live (net_site/net_kv/
net_registry/limits_probe/harden_topology). Rolling this same gate out to the remaining 38 files is a
queued follow-up — do NOT run any of them live until they carry the gate.
