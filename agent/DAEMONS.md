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

## hivePower / he_powerup — Task 27 (RC-deadlock fix + ALL mode + authority gate)

**The deadlock (found live, 2026-09-08)**: the `hivePower` cycle in `agent.cjs` gated the power-up
itself behind `rcCur < 1.2e9 → rc-waiting → return`. Because the anchor loop drains Hive RC ≈ regen
rate forever (one custom_json costs ~124M RC — measured via lsa's rejected withdraw
"has 20,972,581 RC, needs 124,200,044 RC"), `rcCur` can never reach 1.2G — **the cure was gated out
by the disease**. headcorner's 9.682 liquid HIVE sat idle while its Hive anchor starved at
0.003% RC (ops landing ~1 per 25 min instead of every 36s).

**The fix (agent.cjs hivePowerCycle)**: gate replaced with broadcast-FEASIBILITY only (`1.5e8` ≈ one
op). withdraw → landed → power-up now fire as soon as a single op is affordable. The anchor floor is
the anchor loop's concern, not the cure's.

**he_powerup.cjs upgrades**:
1. `--amount ALL` → powers up the WHOLE liquid balance (fetched live, floored to 3 decimals).
2. **Authority pre-verification** (exit 2): derives `wifToPublic(ACTIVE_WIF)` and compares with the
   LIVE on-chain active authority — aborts BEFORE any broadcast on mismatch (pubkey prefixes only,
   never WIFs). This is the Task-26 "Missing Authority" lesson encoded as a gate.
3. **RC feasibility** (exit 3): refuses to broadcast when current mana < 150M (one op), prints the
   regen ETA instead — no more doomed broadcasts.

Runbook (the ONE command that closes the resource corner, on the live runtime):

```bash
node agent/he_powerup.cjs --amount ALL
# expected: authority ✓ → ALL → 9.xxx HIVE → RC feasibility ✓ → broadcast ✓
# effect: max_rc 25.6G → ~40G (+~55% regen/day) → Hive anchor cadence ~25min → ~16min, then hivePower FSM un-sticks
```

Note (Task 27, DEX-side rail): the foundry's external-signer (:3033) v2 now executes the same
pipeline for the 9 fleet accounts whose ACTIVE keys ARE in the sealed envelope (verified against
live HIVE authorities): he_market_sell → he_withdraw → transfer_to_vesting. Proven live on
2026-09-08: lsa sold 2.51025127 WEED → 0.00248765 SWAP.HIVE; macrame sold 0.570715 STEM → +0.000145
SWAP.HIVE; macrame withdraw broadcast accepted. headcorner's own HIVE active key is NOT in the
envelope (runtime-only) — the runbook above stays the headcorner path.
