# T-70 · THE THIRD-WATER & SELF-INQUIRY RUNG — המים-השלישיים והשאילות-הריבוניות

**Mandate answered (trace 1a104c334acdc759):** "be the biggest, most profitable
market-maker/grid players on the networks we operate, with agents and soldiers,
volume even if profit is small, take other users' fees, and let the sovereignty
develop itself — learn from the big companies' money paths AND their failures,
raise many queries so they give you a path and capabilities."

**Doctrine: measured-first, zero guessing.** Three probes (v1→v3) wrote the
facts BEFORE any law was written — and the probes falsified themselves twice,
which is exactly how this house builds.

## 1 · THE MEASURED FACTS (2026-10-04, probes v1..v3)

| pond | fills/24h | vol SWAP.HIVE/24h | BOOK touch | absolute ceiling | full-24h basis |
|---|---|---|---|---|---|
| SWAP.LTC | 335 | 11,996 ($672) | 942bps | **$63.28/day** | true |
| DEC | 386 | 11,100 ($622) | 496.6bps | **$30.87/day** | false (partial named) |
| SWAP.BTC | 56 | 2,157 ($121) | 953.6bps | $11.52/day | true |
| BEE | 202 | 1,909 ($107) | 86.8bps | $0.93/day | true |
| SWAP.HBD | 67 | 994 ($56) | 380.8bps | $2.12/day | false (partial named) |

- **Σ max across ALL measured waters: $3.61 → $110.86/day (~31×)** — live in
  the dominion rank (`state/dominion.json → ranked`), cockpit-verified.
- **The `market.metrics` table is a STALE SNAPSHOT — proven lying twice:**
  volume claimed 29,396 vs tradesHistory-measured 2,153 SWAP.HIVE (13.6×);
  spread claimed 7.3bps vs book-measured 521.9-953.6bps (~70×). **NO LAW READS
  METRICS FOR TRUTH**: pond = tradesHistory (buyer+seller+type live), touch =
  buyBook/sellBook.
- **tradesHistory carries buyer+seller owners + `type`** (buy×37/sell×18
  measured histogram on SWAP.BTC) → the leaderboard is CHAIN-TRUTH here too:
  konvik-ltc 40.6%, konvik-btc 79.0%, konvik-hbd 83.7% of maker-side volume.
- **NO fee surface exists** (fee-named keys in top-20 metrics: NONE measured)
  → the T-68 law holds across all three waters: **the income IS the spread
  from other users' market orders.**

## 2 · THE PROBES' OWN LESSONS (each became law-shaped code)

1. v1 read `m.token` while the field is `symbol` — the probe must read the
   MEASURED shape, never the assumed one.
2. v1 computed `ceilUsd` in the same object literal that created `spreadBps`
   → the old row's `undefined` poisoned every ceiling to null. **The law
   computes in steps.**
3. v3 computed full-basis from the oldest FILTERED row — always false by
   construction. **The law (`enginePondLaw`) computes oldest from the RAW
   rows before the cutoff filter.**
4. v3 credited BOTH buyer and seller with full value (top shares >100%) —
   the law ranks MAKERS only: `type` is the aggressor, the resting side gets
   the credit; missing-type rows count toward the pond, never the leaderboard.

## 3 · THE LAWS (lib.mjs §70, vector-locked — selftest 1523→1572)

- **enginePondLaw(rows, {nowMs, ourAccount})** — per-symbol pond from
  tradesHistory: fills24h, volHive24h, full24hBasis + honest partial label,
  sizeP50, leaders (makers), leaderCount, top1VolShare, ours (buyer OR seller).
- **engineTouchSpreadLaw(buyRows, sellRows)** — the BOOK touch, never metrics:
  TOUCH-MEASURED / EMPTY-BOOK / CROSSED-BOOK / SPREAD-INSANE-STALE (sane band
  ≤20,000bps — the ALPHA 129,997bps junk fenced), best-5 depth each side.
- **volumePlanLaw({...})** — the reachable fills/day on the DEPLOYED pond:
  expected = pond × our measured fill-share (model named in the law), the
  pond's OWN count is the absolute ceiling; gates judged in enforcement order:
  PAUSE-FLOW → RC>97% → ops>80% → HEADROOM. Live: GUARD-PAUSE-SELL-ONLY,
  expected 31/day, ceiling 423/day.
- **inquiryLaw(facts)** — the sovereignty asking its own questions from
  measured facts, deterministic, statuses MEASURED / OPEN-OPERATOR / NEXT-RUNG,
  cap 12. Live 8 inquiries.

## 4 · THE EXECUTOR + THE LIVE-CAUGHT KILL

`enginepond.mjs` — allowlist-leashed (`https://api.hive-engine.com` only),
30-min leash riding prev (T-69 pattern), fail-open per pair, atomic write.
**The first live cycle caught a real bug the vectors could not see: a
duplicate `runEnginePond` declaration silently shadowed the probe and
recursed → journaled as a failedStep, killed same-hour (renamed
`runEnginePondCycle`).** Laws are vector-locked; executors are caught by the
cycle — the doctrine worked as designed.

## 5 · THE SELF-INQUIRY (the operator's "raise many queries" — live answers)

| # | question | status | answer (measured) |
|---|---|---|---|
| 1 | The third water measured — $63.28/day ceiling and we are ABSENT — what blocks? | **OPEN-OPERATOR** | H-E-enabled Hive credential + SWAP.HIVE float (irreversible gate, operator's hand) — then the same maker laws descend (cost-floor T-64, watchdog T-60, PAUSE-FLOW) |
| 2 | Can we take other users' fees? | MEASURED | No fee surface on Steem internal nor H-E (top-20 metrics: zero fee keys) — the income IS the spread from others' flow (T-68) |
| 3 | Volume via trading between our own accounts? | MEASURED | Zero profit (spread paid to ourselves) + burned RC — refused by law; fleet value = multi-PRICE presence catching OTHERS' flow |
| 4 | Ask ladder starved (SBD 0.987) — why doesn't the ask target fill? | NEXT-RUNG | The lawful ladder only sells what exists; the unlock is the SBD→STEEM conversion rail guarding the cost floor (T-64), never selling below basis |
| 5 | PAUSE-FLOW — when does buying return? | MEASURED | When the PnL window returns to the profit threshold; meanwhile asks keep selling inventory above basis |
| 6 | Ops pool nearly empty (0.08% used) — is cadence starving presence? | MEASURED | No — the cadence is set by drift laws (T-61 TTL + eps-2bps), not the budget |
| 7 | Fleet bricked — how do we restore multi-price presence? | **OPEN-OPERATOR** | T-19e: soldier keys were lost in the reset; uploading them is the irreversible gate |
| 8 | RC at 95.9% — how many more orders? | MEASURED | Live updates continue until 97%; the remaining ops quota rides tickBudgetSplit |

## 6 · THE DOCTRINE CHARTER — the industry's money paths and failures → our laws

The operator asked: learn from the big companies' successful money paths and
from where they fell — and do not fall there. Measured mapping:

| industry lesson (the giants' path/fall) | SAOS law that encodes it | status |
|---|---|---|
| Market makers live on SPREAD × FLOW, never on volume vanity (Virtu's "one losing day" discipline) | pondCeilingLaw: ceiling = pond × spread × share; T-68: no-fee internal markets | **live** |
| Wash trading buys nothing and burns everything | T-68 fleetVolumePlanLaw: self-volume = zero profit + burned RC | **live** |
| Never let inventory cost leak into the quote (Alameda's silent bleed class) | T-64 costFloorLaw: no ask below basis×(1+edge); PAUSE-FLOW on measured loss | **live** |
| Dead quotes are dead capital (drift) | T-60 driftReclaimLaw + gridWatchdog; T-61 TTL law | **live** |
| One-body instrumentation: measure the venue before arming it | T-54/T-68/T-69/T-70 sensors-before-laws, this rung included | **live** |
| Diversify venues — no single pond dictates (the multi-market makers' width) | §T-69 multiPondRankLaw + §T-70 third water | **live** |
| Stale snapshots kill (the metrics table lied 13.6×/70×) | engineTouchSpreadLaw: book-touch only; metrics never trusted | **live (new)** |
| The UNMEASURED is not the UNTRUE — a partial window is named, never vanity-filled | full24hBasis honesty in hivePondLaw/enginePondLaw | **live** |
| Resting-side attribution requires the chain's own owner fields | Hive/H-E trades carry owners; Steem strips them → ranking rides our own fill_order (T-68 law-lock) | **live** |
| Kill-switches must have TEETH (the guard that only logs is a lie) | T-64 guard-gate: PAUSE zeroes flow bids at the live layer | **live** |
| Diversification of SETTLEMENT risk (never one node, one key, one venue) | signer node rotation, credential gating, engine token | **live** |
| The giants' real moat: they ASK the next question before the market does | inquiryLaw — the standing self-inquiry instrument | **live (new)** |

**Where the giants fell, the laws already stand. Where they rose, the
instruments now measure. The remaining gates are the operator's irreversible
ones — by the constitution, not by our choice.**

## 7 · THE UNLOCK LADDER (what converts measured ceilings into income)

1. **H-E credential + SWAP.HIVE float** (operator) → arms the widest ponds
   (SWAP.LTC $63/day ceiling) under the same maker laws.
2. **Hive internal-market credential** (operator) → arms HBD:HIVE ($1.44/day
   at today's touch; the T-54 byte-proven signer is ready).
3. **Soldier keys** (operator, T-19e) → 12×6=72 multi-price presence.
4. **Machine's own next rung (NEXT-RUNG):** refill the ask side via the
   conversion rail above the cost floor — the volume plan's ask starvation.

## 8 · EVIDENCE FILES

- `probe.mjs` (v1 — discovery + the metrics trap), `probe2.mjs` (v2 — symbol
  fix, depth read, volume cross-check), `probe3.mjs` (v3 — per-pair pond
  truth from tradesHistory), `t70-desktop.png`, `t70-mobile-375.png`,
  `t70-dominion-card.png` (browser-verified: strips render live data,
  overflowX 0 both widths, console clean).
- Engine live state: `state/enginepond.json` (5 pairs TOUCH-MEASURED),
  `state/dominion.json` (enginePonds + volumePlan + inquiries, Σ max
  $110.86/day), cycle health ok, selftest 1572/1572.
