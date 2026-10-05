# DAEMONS.md — live/dry contract for agent/ broadcast daemons

**Status**: LIVE-GATE contract in force since Task 25-d (2026-09-08), **rolled out to the FULL
broadcast surface in Task 28-b (2026-09-09)**, per owner decision "דגל --live מפורש + לוג רועש"
(docs/owner-decisions.md, Task 24 — live-default demoted to explicit opt-in).

> Task 25-d per-file gates (he_sell/he_unstake) were WIPED by a runtime auto-save snapshot
> (reverted to live-default). Task 28-b re-established them — and the rest of the surface —
> through the durable shared module `agent/lib/live_gate.cjs` (durable channel = origin/main).

## The gate contract (implemented — single source of truth: `agent/lib/live_gate.cjs`)

Trading daemons are **DRY by default**. Real broadcast happens only when the gate is satisfied by BOTH:

1. **Explicit enable** — one of:
   - CLI flag `--live` in argv, OR
   - env `HE_LIVE=1`
2. **Confirmation** — env `HE_LIVE_CONFIRM=<agent-account-name>` must exactly match the
   account the daemon will act as (`AGENT_ACCOUNT`, **required — no default since the 8-b sweep**, case-insensitive;
   missing → the script exits 1 before loading anything, mirroring keyrotate.cjs/7-c).

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

Five daemons keep their own historical explicit-enable flag, which the shared module treats as
the `--live` equivalent (still ANDed with `HE_LIVE_CONFIRM`): `chaintalk.cjs`, `chaintalk95.cjs`,
`econ96.cjs`, `wrap96.cjs` and `blurt99.cjs` use `--run`. In DRY mode those daemons spawn their
`saosnet`/`microdex` children WITHOUT `--live` (children stay DRY too).

## Gated daemons — full rollout (Task 28-b)

All rows below are **DRY by default** via `agent/lib/live_gate.cjs` (`resolveLiveGate` + `announceGate`;
the acting account is passed from each daemon's own `AGENT_ACCOUNT`/fixed constant).

| Daemon | Default | Gate mechanism | Network |
|---|---|---|---|
| `agent/he_sell.cjs` | DRY | live_gate (`{account: ACCOUNT}`) | Hive mainnet / Hive-Engine sidechain |
| `agent/he_unstake.cjs` | DRY | live_gate (`{account: ACCOUNT}`) | Hive mainnet / Hive-Engine sidechain |
| `agent/anchor.cjs` | DRY | live_gate (CLI) | Steem + Hive + Blurt (weave anchors) |
| `agent/blurt_revive.cjs` | DRY | live_gate (CLI) | Blurt |
| `agent/blurt99.cjs` | DRY | live_gate (`--run` = enable) | Blurt |
| `agent/bridge_test.cjs` | DRY | live_gate (`{account: ACCOUNT}`) | Steem ↔ Hive bridge |
| `agent/cascade.cjs` | DRY | live_gate (`{account: ACCOUNT}`) | Steem (custom_json) |
| `agent/chain_attest.cjs` | DRY | live_gate (CLI; `--read` mode announces nothing) | Steem + Hive |
| `agent/chaintalk.cjs` | DRY | live_gate (`--run` = enable; children demoted to DRY) | Steem (custom_json) + SAOS-NET |
| `agent/chaintalk95.cjs` | DRY | live_gate (`--run` = enable; children demoted to DRY) | Steem (custom_json) + SAOS-NET |
| `agent/fixpw102.cjs` | DRY | live_gate (`{account: ACCOUNT}`; saosnet beat demoted to DRY) | SAOS-NET (via saosnet child) |
| `agent/oracle106.cjs` | DRY | live_gate (`{account: ACCOUNT}`; saosnet beat demoted to DRY) | SAOS-NET (via saosnet child) |
| `agent/rean106.cjs` | DRY | live_gate (`{account: ACCOUNT}`; saosnet beats demoted to DRY) | SAOS-NET (via saosnet child) |
| `agent/reanchor103.cjs` | DRY | live_gate (`{account: ACCOUNT}`; saosnet beats demoted to DRY) | SAOS-NET (via saosnet child) |
| `agent/cross_shard.cjs` | DRY | live_gate (CLI) | Steem + Hive (shard custom_json) |
| `agent/econ96.cjs` | DRY | live_gate (`--run` = enable; children demoted to DRY) | Steem (custom_json) + SAOS-NET |
| `agent/energy_ops.cjs` | DRY | live_gate (`{account: OPERATOR}`; broadcast modes refused in DRY) | Steem (RC/HP ops) |
| `agent/escrow_rail.cjs` | DRY | live_gate (`{account: ACCOUNT}`; DRY aborts before escrow ops) | Steem (escrow) |
| `agent/factory_create.cjs` | DRY | live_gate (`{account: ACCOUNT}`) | Steem (account factory) |
| `agent/factory_v2.cjs` | DRY | live_gate (`{account: OPERATOR}`) | Steem (account factory) |
| `agent/fleet_voice.cjs` | DRY | live_gate (`{account: HEAD}`) | Steem (custom_json) |
| `agent/fuel_line.cjs` | DRY | live_gate (CLI) | Steem (transfers) |
| `agent/grid79.cjs` | DRY | live_gate (`{account: HEAD}`) | Hive-Engine + Steem |
| `agent/harden58.cjs` | DRY | live_gate (`{account: OPERATOR}`; DRY refuses all steps) | Steem + Hive (authority anchors) |
| `agent/harden_topology.cjs` | DRY | live_gate + `DRY_RUN=true` still honored as extra DRY force | Steem (account_update) |
| `agent/he_conforms.cjs` | DRY | live_gate (`{account: ACCOUNT}`; DRY exits before probes) | Hive-Engine |
| `agent/he_fleet_sell.cjs` | DRY | live_gate (`{account: HEAD}`) | Hive-Engine |
| `agent/he_genesis.cjs` | DRY | live_gate (`{account: ACCOUNT}`) | Hive (converts) + Hive-Engine |
| `agent/he_ladder.cjs` | DRY | live_gate (`{account: ACCOUNT}`) | Hive-Engine |
| `agent/he_powerup.cjs` | DRY | live_gate (`{account: ACCOUNT}`; DRY stops before `transfer_to_vesting`) | Hive mainnet |
| `agent/hive_publish_watch.cjs` | DRY | live_gate (`{account: ACCOUNT}` from `AGENT_ACCOUNT`; DRY skips publication) | Hive (comment op) |
| `agent/hive_rc_heal.cjs` | DRY | live_gate (`{account: HEAD}`, resolved in `main()`) | Hive (delegate_vesting_shares) |
| `agent/keyrotate.cjs` | DRY | live_gate (`{account: ACCOUNT}`) | Steem + Hive (authority update) |
| `agent/limits_probe.cjs` | DRY | live_gate + `DRY_RUN=true` still honored as extra DRY force | Steem (custom_json probes) |
| `agent/limits_probe2.cjs` | DRY | live_gate (`{account: ACCOUNT}`; DRY skips probes) | Steem (custom_json probes) |
| `agent/linkage.cjs` | DRY | live_gate (CLI; only `--fix` announces, and fixes are skipped in DRY) | Steem + Hive (account_update) |
| `agent/liq_seed.cjs` | DRY | live_gate (CLI) | Steem (transfers) |
| `agent/merchant.cjs` | DRY | live_gate (`{account: ACCOUNT}` from `AGENT_ACCOUNT`) | Steem (transfers) |
| `agent/microdex.cjs` | DRY | live_gate (CLI) | Steem (custom_json) |
| `agent/mint_borrow.cjs` | DRY | live_gate (`{account: OPERATOR}`) | Steem (account create + transfer) |
| `agent/muster.cjs` | DRY | live_gate (CLI) | Steem (escrow transfers) |
| `agent/net_kv.cjs` | DRY | live_gate + `DRY_RUN=true` still honored as extra DRY force | Steem (kv custom_json) |
| `agent/net_registry.cjs` | DRY | live_gate + `DRY_RUN=true` still honored as extra DRY force | Steem (custom_json) |
| `agent/net_site.cjs` | DRY | live_gate + `DRY_RUN=true` still honored as extra DRY force | Steem (custom_json) |
| `agent/paymaster.cjs` | DRY | live_gate (CLI; `--fuel` gets gated dry flag, other modes abort in DRY) | Steem (meta-tx relay/fuel) |
| `agent/perf_bench.cjs` | DRY | live_gate (CLI; inclusion probes + anchor skipped in DRY) | Steem + Hive |
| `agent/post_announce.cjs` | DRY | live_gate (`{account: ACCOUNT}`) | Steem (post/comment) |
| `agent/probe_agent.cjs` | DRY | live_gate (`{account: NAME}`; vote skipped in DRY) | Steem (vote) |
| `agent/publish_spec58.cjs` | DRY | live_gate (`{account: ACCOUNT}`; DRY skips publication) | Steem + Hive (posts) |
| `agent/rc_sovereign.cjs` | DRY | live_gate (`{account: ACCOUNT}`) | Steem (delegate_rc) + Hive |
| `agent/reflex.cjs` | DRY | live_gate (`{account: ACCOUNT}`; `LIVE=GATE.live`) | Steem (custom_json) |
| `agent/retc_test.cjs` | DRY | live_gate (`{account: ACCOUNT}` from `AGENT_ACCOUNT`; DRY before delegate test) | Hive (delegate_rc) |
| `agent/roundtrip.cjs` | DRY | live_gate (`{account: ACCOUNT}` from `AGENT_ACCOUNT`) | Steem (transfers) |
| `agent/sovereign_60_live.cjs` | DRY | live_gate (`{account: OPERATOR}`; DRY refuses execution) | Steem + Hive + Hive-Engine |
| `agent/sovereign_fix59.cjs` | DRY | live_gate (`{account: OPERATOR}`; DRY refuses execution) | Steem + Hive + Hive-Engine |
| `agent/sovereign_ops.cjs` | DRY | live_gate (`{account: OPERATOR}`) | Steem + Hive |
| `agent/sovereign_runner.cjs` | DRY | live_gate (CLI) | Steem (custom_json workload) |
| `agent/test-factory.cjs` | DRY | live_gate (CLI; negative-key test exits in DRY) | Steem |
| `agent/test-pipeline.cjs` | DRY | live_gate (CLI; negative-key test exits in DRY) | Steem |
| `agent/value_lock.cjs` | DRY | live_gate (`{account: ACCOUNT}`) | Steem (custom_json) |
| `agent/weave95_finish.cjs` | DRY | live_gate (CLI; anchor skipped with honest error in DRY) | Steem (custom_json) + SAOS-NET |
| `agent/weave_batch.cjs` | DRY | live_gate (CLI, passed into `runWeaveBatch({dry})`) | Steem + Hive + Blurt |
| `agent/wrap96.cjs` | DRY | live_gate (`--run` = enable; children demoted to DRY) | Steem (custom_json) + SAOS-NET |
| `agent/wrapped.cjs` | DRY | live_gate (missing WIFs still force DRY, as before) | Steem + Hive |
| `agent/yield.cjs` | DRY | live_gate (`{account: ACCOUNT}` from `AGENT_ACCOUNT`) | Steem (transfers) |
| `agent/ynet_rescue_ping.cjs` | DRY | live_gate (CLI; DRY before broadcast) | Steem + Hive (rescue ping) |
| `agent/restore_tov.cjs` | DRY | live_gate (`{account: 'tov'}`, fixed subject) — gate BEFORE vault/paste-WIF load; owner-authority mutation; Task 11-c: hive aspects additionally REFUSE `--live` fail-closed unless `fleet_control_audit.json` shows a resolved controlling source — `chains.hive.tov.vault.owner=true` OR (Task 13-a) `chains.hive.tov.master.owner=true` (factory-derived, WIF derived at run-time, never stored) | Steem + Hive (recover_account / account_update2) — Hive side **BLOCKED-NO-KEY** (owner 2026-10-01: no more keys exist — NO economic use; Task 13-a proven negative: master restored + every git-folder candidate derive tov steem+blurt 4/4 yet hive 0/4) until a resolved source appears in the audit |
| `agent/head-delegate.cjs` | DRY | live_gate (`{account: HEAD}`) — gate BEFORE vault recovery | Steem (delegate_vesting_shares) |
| `agent/head-revive.cjs` | DRY | live_gate (`{account: HEAD}`) — no dry mode: dry gate exits before key load | Steem (claim/vote/delegate) |
| `agent/soldiers-blog.cjs` | DRY | live_gate (`{account: 'headcorner'}` fleet head confirms) — dry gate exits before key load | Steem (comment/comment_options) |
| `agent/self-audience.cjs` | DRY | live_gate (`{account: 'headcorner'}` fleet head confirms) — dry gate exits before key load | Steem (vote) |
| `agent/sp_reclaim.cjs` | DRY | live_gate (`{account: HEAD}` from `AGENT_ACCOUNT`; `--live` without confirm runs DRY) | Steem (delegate_vesting_shares reclaim) |
| `agent/fleet-claim.cjs` | DRY | live_gate (`{account: 'headcorner'}` fleet head confirms; `DRY=1` still forces dry) | Steem (claim_reward_balance) |
| `agent/fleet_mint_v3.cjs` | DRY | live_gate (`{account: HEAD}` from `AGENT_ACCOUNT`); `--verify` stays gateless/read-only | Steem (claim_account/create_claimed_account/delegate) |
| `agent/fleetv3_autopilot.cjs` | DRY | live_gate (`{account: HEAD}` from `AGENT_ACCOUNT`); live auto-mint passes `--live` to the gated `fleet_mint_v3` child | Steem (claim/power-up/mint) |
| `agent/net_probe.cjs` | read-only + gated claim | live_gate resolves ONLY on `--claim` (`{account: HEAD}`); census/probe stays runnable gateless | Steem + Hive (claim_reward_balance on --claim) |
| `sovereign/node/wallets.cjs` | DRY | live_gate on the `manifest()` broadcast path (`{account: ACCOUNT}`); status/derive/verify/inject/budget stay gateless | Steem (custom_json saos:wallets/v1 anchor) |

Safe examples:

```bash
# DRY (default — even with no flags at all)
node agent/he_sell.cjs

# LIVE — both conditions required
node agent/he_sell.cjs --live --qty 9000 --price 0.0001   # + env AGENT_ACCOUNT=… HE_LIVE_CONFIRM=<same account>
HE_LIVE=1 HE_LIVE_CONFIRM=$AGENT_ACCOUNT node agent/he_unstake.cjs
```

### Task 10 sweep (2026-09-30): the 11 remaining ungated broadcast paths are now gated — FULL surface claim is now true

The roast audit found ~10 broadcast-capable scripts outside this table while this doc claimed a
"FULL broadcast surface". Closed by Task 10-d-3: `restore_tov.cjs` (owner-authority mutation —
the highest-priority gap), `head-delegate.cjs`, `head-revive.cjs`, `soldiers-blog.cjs`,
`self-audience.cjs`, `sp_reclaim.cjs`, `fleet-claim.cjs`, `fleet_mint_v3.cjs`,
`fleetv3_autopilot.cjs`, `net_probe.cjs` (`--claim` path only — census stays gateless/read-only),
and `sovereign/node/wallets.cjs` (`manifest()` anchor path only). All 11 now route every broadcast
through `agent/lib/live_gate.cjs` (`resolveLiveGate` + `announceGate`) with the acting account from
each script's own `AGENT_ACCOUNT`/env/fixed constant, resolved BEFORE any key material is loaded.
Read-only paths (--probe/census/verify) remain runnable without the gate. The only remaining
out-of-scope live process is the documented saosnet runtime node below (owner-level decision,
unchanged). Fleet-wide tools (soldiers-blog / self-audience / fleet-claim) confirm as the fleet
head `headcorner` — the operator identity that owns the vault those keys come from.

### Already-safe by construction (no gate wired — verified read-only / DRY-default)

| Daemon | Default | Mechanism + evidence | Network |
|---|---|---|---|
| `agent/agent.cjs` | DRY | `dryRun: parseBool(process.env.DRY_RUN, true)` (agent.cjs:102) — DRY unless operator flips env; children it spawns (`mint_borrow.cjs --live`, `reflex.cjs --live`) re-resolve the shared gate themselves, so a bare `--live` from the parent still lands DRY | orchestrator |
| `agent/he_report.cjs` | read-only | report generator; `blurtBroadcast` appears only inside a report string literal (he_report.cjs:361), zero call sites | — |
| `agent/probe106.cjs` | read-only | probe; `blurtBroadcast` only in a status string (probe106.cjs:108), zero call sites | — |
| `agent/empire_60.cjs` | read-only | self-documented: "READ-ONLY: zero broadcasts, zero secrets in output" (empire_60.cjs:22) | — |
| `agent/energy_census.cjs` | read-only | self-documented: "READ-ONLY: no broadcasts, no secrets printed" (energy_census.cjs:6) | — |
| `agent/forkscan.cjs` | read-only | self-documented: "Nothing is signed, nothing is broadcast" (forkscan.cjs:16) | — |
| `agent/voice_probe.cjs` | read-only | self-documented: "No keys, no broadcasts — pure measurement" (voice_probe.cjs:12) | — |
| `agent/verify_pendings.cjs` | read-only | backfill verifier; the word "broadcast" only in output strings about historical txs | — |
| `agent/verify_selfhost.cjs` | read-only | verifies the latest chain_attest broadcast (read-back only) | — |
| `agent/verify_system.cjs` | read-only | system verifier: broadcasts only referenced in evidence strings/proof-map, zero broadcast API calls | — |
| `agent/audit65.cjs`, `agent/batch_reverify.cjs`, `agent/bee_wall.cjs`, `agent/blurt_probe.cjs`, `agent/fuel_map.cjs`, `agent/hive_rc.cjs`, `agent/hive_withdraw_diag.cjs`, `agent/hive_withdraw_trace.cjs`, `agent/keyscan.cjs`, `agent/probe64.cjs`, `agent/rc_map_measure.cjs`, `agent/rebuild.cjs`, `agent/salvo_reverify.cjs`, `agent/verify15.cjs`, `agent/verify_worldlog.cjs`, `agent/wblurt_recon.cjs` | read-only | matched the `condenser_api` sweep but contain ZERO broadcast indicators (steem.broadcast / broadcast_transaction / grapheneBroadcast / blurtBroadcast / client.broadcast) — pure RPC reads | — |
| `agent/cloud_heartbeat.cjs` | orchestrator | spawns gated children (`agent/agent.cjs` DRY-default, `agent/chain_attest.cjs` gated — env `HE_LIVE*` propagates); its direct `saosnet.cjs --beat --live` line is part of the documented saosnet out-of-scope below | — |

### Known out-of-scope broadcast surface (documented, not gated in 28-b)

- `sovereign/node/saosnet.cjs` — the live node: `const LIVE = process.argv.includes('--live')`
  (saosnet.cjs:29), broadcasts via `steem.broadcast.sendAsync` + `condenser_api.broadcast_transaction`.
  It is the RUNTIME's own loop process (started by the runtime with explicit `--live`, not by an
  agent operator), and agent/ parents now only hand it `--live` when their own gate is satisfied.
  Gating it would silently flip the live fleet loop to DRY — an owner-level decision, queued as follow-up.

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
HE_LIVE_CONFIRM=headcorner node agent/he_powerup.cjs --amount ALL --live
# expected: [LIVE-GATE] LIVE MODE ENABLED … → authority ✓ → ALL → 9.xxx HIVE → RC feasibility ✓ → broadcast ✓
# effect: max_rc 25.6G → ~40G (+~55% regen/day) → Hive anchor cadence ~25min → ~16min, then hivePower FSM un-sticks
```

Note (Task 27, DEX-side rail): the foundry's external-signer (:3033) v2 now executes the same
pipeline for the 9 fleet accounts whose ACTIVE keys ARE in the sealed envelope (verified against
live HIVE authorities): he_market_sell → he_withdraw → transfer_to_vesting. Proven live on
2026-09-08: lsa sold 2.51025127 WEED → 0.00248765 SWAP.HIVE; macrame sold 0.570715 STEM → +0.000145
SWAP.HIVE; macrame withdraw broadcast accepted. headcorner's own HIVE active key is NOT in the
envelope (runtime-only) — the runbook above stays the headcorner path.

## CAPITAL-GATE era (owner directive 2026-10-04, IM trace 1a108e28015b0451)

**New law above every gate**: every capital-lane signer in this home answers THREE gates
before signing — `agent/lib/capital_gate.cjs`:

1. **STASIS** — `agent/STASIS.json` active=true (engaged 2026-10-04T22:18Z on the owner's
   "עצור ולבחון" directive after measured delegation chaos) → healthy no-op, exit 0.
2. **ROSTER** — every target must be in `agent/lib/fleet-roster.cjs` activeFleet with
   `economicUse=true` for the target chain; `hcsoldier1/2/3` + `ynet` are BANNED by name
   with custody evidence (LOST-NO-CUSTODY receipts).
3. **JOURNAL** — every capital decision lands in `agent/receipts/capital-decisions.jsonl`.

Wired: `head-delegate.cjs` (STASIS + roster + journal). New tool:
`agent/reclaim-lost-soldiers.cjs` — returns the fresh SP delegated to the keyless lost
generation back to the treasury (DRY default; live requires `--live` + `HE_LIVE_CONFIRM`
+ `OWNER_DIRECTIVE=RECLAIM-LOST-SOLDIERS-2026-10-04` — the recorded owner word that also
serves as this specific op's STASIS-resume note). Mirror brakes: `Domain/agents/STASIS.json`
(all Domain signers via capital-gate.cjs) + `saos-dex grids/state/STASIS.json` (mover/convert).

## 2026-10-05 (R24-b): STASIS capital-gate rolled out to ALL broadcast daemons — per-site gates, fail-closed

Measured live on chain: after STASIS engaged (2026-10-04T22:06Z) a **stale process kept signing
ladder limit orders at 22:33Z / 23:04Z / 2026-10-05T04:01Z**. Lesson codified: **the gate must be
checked AT THE OP SITE (sign time), not at process entry** — long-lived daemons (agent.cjs and
friends, re-spawned by guardian-loop.cjs on every `bun run dev`) can hold stale code in memory.

What changed (37 files, zero behavior under DRY, all fail-closed):

- **Per-site `stasisStop('<tool>')` brakes** (try/catch wrapper over `capGate.stasisHalt` — on gate
  module error the lane HALTS with a loud `[CAPITAL-GATE]` line) inserted immediately before every
  chain-capital broadcast: claims, transfers/sweeps/escrow, delegations, power-ups, converts,
  limit orders, mints (claim_account/create_claimed_account/account_create), HE sells/unstake/
  withdraw, soldier repair (authority), delegate_rc, meta-tx fuel.
- `agent.cjs` — 10 per-site brakes (claim, army-claim, army-sweep, netTask command transfer,
  factory claim_account, dexBroadcast escrow/transfer leg, liq escrow, payroll, hiveBroadcastActive
  [HE withdraw + HIVE power-up], paymaster fuel delegation). Posting-key custom_json bus lanes
  (saos/wlog/net/ping/anchor) are NOT capital ops and stay open — measurement continues.
- Daemon-spawned tools each gate their own sign site (they are separate processes even when the
  parent holds stale code): mint_borrow, he_genesis, he_fleet_sell, wrapped (7 sites + hive lane),
  fleetv3_autopilot (guardian-spawned). One-shot CLIs gate at/before their broadcast choke point:
  ladder_refresh (entry receipt `stasis-halt` + sign-time throw in broadcastOp), energy_ops
  (broadcastSigned + hiveBroadcastRaw), sovereign_ops (broadcastSteem), he_ladder/he_sell/
  he_unstake/he_powerup, fuel_line (tx1+tx2), paymaster (fuel + memo-biz), rc_sovereign
  (hive-powerup ×2), sp_reclaim, hive_rc_heal, factory_create/factory_v2, fleet_mint_v3,
  soldier_mint_paid, soldier_repair, head-delegate-era siblings head-revive/fleet-claim,
  escrow_rail, merchant self-demand, yield payouts, muster escrow, sovereign_fix59, roundtrip
  hive lane, rc_bridge, limits_probe2.
- Read-only lanes stay ungated with an explicit marker: `verify_system.cjs`, `empire_60.cjs`,
  `roast_audit.cjs` — "measurement-only lane — capital gate N/A (STASIS scope)".
- Verified: `node --check` green on all 37 modified files; live smoke `stasisHalt('r24b-smoke') →
  true`; zero secret-shape hits on the added diff lines; `STASIS.json` untouched (active=true).
