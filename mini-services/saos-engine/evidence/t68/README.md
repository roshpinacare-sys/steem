# T-68 — THE DOMINION RUNG (measured facts, 2026-10-04)

## The pond (measured, market_history_api.get_trade_history 24h)
- **428 trades/day, 1,614.2 STEEM/day** (~$160/day at $0.10) — matches state/market.json exactly (two independent reads)
- Touch spread ~117bps · sizeP50 = 1 STEEM (retail dust flow) · sizeP90 = 9.7
- 20-level depth: 1.4M STEEM asks / 2.95M SBD bids (whale walls far from the touch)

## Probe dead-ends caught by measurement (zero guessing)
1. `condenser_api.get_trade_history` → "bad lexical cast" on both date forms (dead)
2. `market_history_api.get_trade_history` → works, but rows carry ONLY
   `date, current_pays, open_pays` — **owners are stripped** by the public plugin
   → player-ranking must ride OUR OWN `fill_order` virtual ops (counterparty visible there)
3. Hourly `get_market_history` candles returned zero-volume NAI objects — not the gate

## The honest math the operator must see
- Our share right now: 27 fills / 428 trades ≈ **6.3% fill-share**, ~6.5% volume-share
- **Capture ceiling = pond × spread × our share**: 1,614 × 117bps × 6.5% ≈ **1.23 STEEM/day ≈ $0.08/day**
- At 100% dominance the ceiling is ≈ $1.9/day — **the pond is the limit**
- The Steem internal market has **NO trade fees**: "taking other users' fees" does
  not exist here — the income IS the spread from others' market orders
- Wash-volume between our own accounts = zero profit + burned RC — the fleet's
  value is multi-PRICE presence (capture flow at many price points), never self-volume

## The volume-dominion paths (ranked by measured ceiling)
1. **Steem presence** (live): lawful two-sided quoting under guard/cost-floor/RC — bounded by the pond
2. **Hive internal market** (measured regime T-57: 13.2bps touch, bigger pond) — operator credential gates day-1
3. **More venues/networks** — operator-gated (keys/exchanges), sovereignty plans, operator executes

## The rung
- lib.mjs: `dominionShareLaw` · `presencePlanLaw` · `fleetVolumePlanLaw` (pure, vector-locked §68)
- dominion.mjs: the every-cycle instrument → state/dominion.json (zero extra chain calls)
- daily.mjs step `dominion` · /status `dominion` · cockpit `DominionCard`
