# SOVEREIGN ENGINE — V2 Blueprint + V3 Sharper Round

> Owner-approved 2026-11-06 ("כן מאשר"). Sources: craft-anything (Study→Build→Check→Ready),
> Temporal (durable loops, judge pattern), blueprint docx 2026-11-06 (full Hebrew version).
> This file is the working engineering record. Numbers are MEASURED, not aspirational.

## V3 Sharper Round — measured 2026-11-06 00:00–00:10 UTC

### Insight 1: the army trade lane is mathematically dead, not sleeping

`armygrid.mjs` computes `askBudget = (liquidSTEEM − reserve) × askBudgetPct`.
Chain truth (condenser_api.get_accounts, 2026-11-06T00:00Z):

| account | liquid STEEM | SBD | verdict |
|---|---|---|---|
| headcorner | 65.490 | 0.106 | only funded account (dexflow: 152 open orders) |
| cashmachine/israelnews/woq/siq | 1.001 | 0.100 | dust |
| haran/lsa/macrame/tov/wic/wog | 0.100 | 0.197 | dust |
| hcsoldier4/hcsoldier5 | 1.000 | 0.934/0.688 | dust |

With reserve 0.5–1.0, `askBudget` is 0 for 12/13 accounts → `planLadder` returns
0 orders → verdict NO-PLAN **with probability 1**, every tick, every window.
The 4-minute trade window in every shift has been a no-op for the army by
construction. Fleet liquid total: 72.095 STEEM, of which 65.49 sits in one account.

**Consequence:** "the fleet feels asleep" is now a theorem, not a vibe. Two honest
fixes (owner decision):
- **A. Fund the army** — move liquid STEEM from treasury (headcorner) into the
  12 accounts so each clears `FUNDED_MIN_STEEM` (2.0). Tension: treasury is in a
  power-down (613.5 days to floor) and liquidity-stays-liquid applies to principal.
- **B. Concentrate** — stop burning windows on dust accounts; roster trades with
  headcorner's book only; KPI breadth pillar honestly reports 1/13.

### Insight 2: schema drift is a live failure mode (found by the new tests)

`custody-patrol.jsonl` is written by patrol with key `live` and by beat-loop with
key `liveAccounts`. The first KPI run scored custody 0/30 on a healthy fleet —
not because custody failed, but because two writers disagree on one field name.
Fixed in `ops/sovereign-kpi.mjs` (reads both). Law for V2 runtime: **one receipt,
one schema, one writer** — or a versioned envelope.

### Insight 3: the fleet now has a number

`ops/sovereign-kpi.mjs` + `ops/engine.test.mjs` (8/8 green) + CI gate
`.github/workflows/engine-ci.yml`:

```
score = 67.6  SOVEREIGN-PARTIAL
custody 30/30 · fundedCapital 9.97/25 · activity 11.6/20 · hygiene 6/15 · treasury 10/10
```

The two weakest pillars are exactly the two structural problems: unfunded capital
and audit flags (hcsoldier4/5 keys-in-census, hcsoldier6 no-custody). The score
is the daily KPI (blueprint P1) — it goes up when reality goes up.

## V2 target architecture (from blueprint, unchanged)

Study→Build→Check→Ready loop per tool · CLI+MCP dual exposure · check-engine
forcing iteration · MISSED-trigger replay · 244 scripts → ~30 modules with tests ·
LLM-judge for doctrine plans (Temporal broker/execution/judge pattern) ·
daily KPI 0-100 (now live, see above).

## Immediate next moves (sharpened order)

1. Owner picks A (fund) or B (concentrate) for the army lane. [DECISION]
2. hcsoldier6: rekey or retire — it blocks the custody pillar at 13/13. [DECISION]
3. Unify receipt schemas (versioned envelope), then MISSED-replay can trust them.
4. money page (giant.html) + console page upgrade on Pulse (pages-deploy green).
5. Doctrine-plan generator for powerup lane: today every shift honestly skips
   because no fresh plan exists — generate plans from a checked-in doctrine file.

## Laws honored (never violated by this work)

no-powerup without fresh doctrine · stop-self-wash · liquidity-stays-liquid ·
sovereignty-is-the-center · additive-only changes · chain is the only judge.
