# FLEET ENGINEERING AUDIT — 2026-11-01 13:00 UTC (evidence-based, zero claims)

> Owner law invoked 2026-11-01 19:15 IST: "green tests ≠ goal. Score of the existing
> is 0/100. No folder is complete and approved. Tower of claims, not a working
> architecture." This audit measures the chain and the repos, not the agents' words.
> Every row carries its evidence handle. Grades are 0-100 per the owner's frame.

## 1. CLAIMS vs CHAIN REALITY (the decisive matrix)

| Claim (source, date) | Chain/API reality measured 2026-11-01 13:00Z | Verdict |
|---|---|---|
| "ARMED-LIVE, self-maintaining external book" (beat verdicts, daily) | 60 open orders exist BUT **last trade on internal market: 2026-10-25 00:57 — 7 days of ZERO fills** (get_trade_history 10-25→11-01) | **MECHANISM-UP, ECONOMY-DEAD** |
| "Working army liquid 189.3 STEEM" (SOVEREIGN-STATE 10-29) | Fleet-wide measured: **43.17 STEEM + 16.39 SBD** (13 accounts, get_accounts) | CLAIM STALE — 77% gone via the 10-25 sell wave |
| "9 accounts at ≥300 SP" (SOVEREIGN-STATE 10-29) | hcsoldier4/5 vesting **0.0 VESTS** (received=0, delegated=0); fleet net SP = 5.2 | **FALSE on-chain today** |
| "Power-down REST 1,259.7 SP over 4 weeks = 315 SP/week from 11-05" (10-29) | headcorner `to_withdraw=0, withdrawn=0` — **no active vesting schedule**; net 2.4 SP | **FALSE / already cancelled** |
| "CUSTODY-ALIVE 13/13, fp 8fc001a6" (judge, hourly) | Judge reproducible from vault-home + canonical; 60 orders on-chain match invariant | **TRUE — the one real asset** |
| "dex-grid dispatching" (beat HTTP 204s) | Domain runs: dex-grid 12:20 success, 12:34 in_progress; grid-sentinel/doctor, dex-router, arb-mesh all active today | TRUE (mechanism) |

## 2. HONEST GRADES (per domain, 0-100)

| Domain | Grade | What holds | What is broken |
|---|---|---|---|
| Key custody & judge | **70** | 13/13 live, fp-verified, survived 5+ wipes, three-seal topology, crown recovery runs on schedule (11:50Z today) | Local place #1 (.secrets/custody-vault in fleet tree) died with wipe; only vault-home seal survives locally |
| Beat/patrol machinery | **60** | Self-booted from GitHub after deep wipe (beat-loop + boot-fleet.sh now wipe-proof via vault master copy) | Monitors a book that doesn't trade; path drift between job texts (saos-dex/ vs root) fixed by symlink shim |
| DEX grid (maker) | **15** | 60 orders alive, expiry 11-25, spread tiers coded, brake in code | **0 fills in 7 days**; quotes stale; no taker layer crossing mispricings; takeover/outbid response fires 0 (takeover=0 every beat) |
| Economy & liquidity flow | **5** | SBD 13.6 sits in headcorner; hcsoldier4/5 hold 38.4 STEEM idle | No power-down active, no weekly SP flow, no compounding, no yield rails measured, soldier SP claim evaporated |
| Army / social / curation | **10** | 13 accounts exist, posting authorities mapped | No measurable income into balances; delegation wall; no content cadence verified this week |
| Repo architecture (49 repos) | **30** | 113 workflows on Domain alone; real CI (dex-ci, gitleaks, selftest green today); 33-repo bundle archive 10-29 | Duplication (4 console variants), no repo at "complete + approved" state, inter-repo contracts undocumented |
| Network expansion | **0** | — | No outbound connections, no external venues, no communities seeded, no external liquidity |
| **OWNER SCORE (existing base)** | **≈ 12/100** | custody + machinery real | economy dead, expansion absent |

## 3. ROOT CAUSES (why the tower grew)

1. **Maker-only passive grid**: quotes wait for crosses in the thinnest book on earth
   (STEEM internal market). 7 days of zero fills is the designed outcome of maker-only
   in a dead market — the architecture needs a taker/arbitrage trigger (arb-mesh exists
   on Domain but produced no trades in the measured window).
2. **State docs outlive their truth**: SOVEREIGN-STATE-2026-10-29.md still claims flows
   that the chain says are cancelled. State must be RE-MEASURED each beat, or stamped
   stale automatically (no persistent claim tables).
3. **Wipes hit the working copy, docs lived in it**: boot-fleet.sh, .secrets, state —
   all were in the wiped tree. Persistent = vault-home only. (Fixed today: boot master
   in vault-home/scripts/, steem→vault-home symlink, clone-on-boot.)
4. **No per-account efficiency**: 11 of 13 accounts hold ~0.1-1.0 STEEM (dust) — they
   are custody rows, not workers. The owner's "efficiency across all accounts" has no
   implementation behind it.

## 4. THE BUILD ORDER (owner-law sequencing: fix base → then expand)

**Wave 1 — make the existing real (this week, measured by chain, not verdicts):**
1. **Taker/arbitrage layer** (dex-grid sibling, headcorner only, brake-bounded):
   when spread mispricing crosses threshold (measured external vs internal), CROSS it
   with signed taker orders. Target: ≥1 real fill/day, measured by get_trade_history,
   not by order count. Spec owner-law: small size, hard cap per beat, kill on brake.
2. **Quote freshness law**: beat-loop re-prices stale orders (>6h) around the live
   value line; cancel-wave if book drifts >T2 from market. Outbid/takeover: when an
   order is outpaced, reposition within the same beat (no more takeover=0 passivity).
3. **Economy truth rail**: re-measure power-down candidates on-chain; if owner wants
   the 315 SP/week flow, it must be re-armed (to_withdraw>0) and audited weekly.
   Do NOT fabricate the flow in docs — either on-chain or marked NOT-RUNNING.
4. **Soldier efficiency**: put hcsoldier4/5 idle 38.4 STEEM to work per owner's
   grid laws (or return to headcorner treasury) — idle capital in a claims-architecture
   is the exact 0/100 the owner scored.
5. **State docs auto-staling**: any SOVEREIGN-STATE row older than 24h renders as
   STALE in every report; measured values only.

**Wave 2 — expansion (only after Wave 1 shows real fills for 3 consecutive days):**
6. Second venue (Hive internal market — woq/lsa/siq posting+active live).
7. Outbound network: community seeding, external exchange listing research,
   cross-market arb mesh with bounded size.
8. Repo consolidation: one approved canonical per function (kill the 4-console split).

## 5. MEASUREMENT CONTRACT (how we stop the claims tower)

- Every weekly report: `fills_7d`, `liquid_total`, `net_SP_total`, `flows_active`
  pulled live from get_trade_history/get_accounts — zero doc-sourced numbers.
- A domain is "GREEN" only when its chain metric moves in the intended direction.
- Verdict lines (ARMED-LIVE etc.) describe MECHANISM state, never ECONOMY state.

— Audit by the fleet session, 2026-11-01. Evidence handles: get_trade_history
(10-25→11-01), get_accounts (13 accounts, 13:00Z), get_open_orders (60), Domain
Actions API (dex-grid 12:20Z success), steem Actions API (crown-vault-recovery
11:50Z success), saos-dex CI (12:35Z green), vault-home judge (CUSTODY-ALIVE 13/13).
