# Vibe-Trading (HKUDS) — W27 Assessment (owner trace 1a15c67385c253b5)

Owner order: "תראה אם זה יכול לעזור לנו ביכולות ביצוע ועוד ומה שצריך בצע ודחוף".

## What it is (measured, shallow-clone 2026-10-21)
Python 3.11+/FastAPI agent framework (~155MB repo, MIT): LLM trading-research
agent — strategy discovery harness, "Shadow Account" (extract strategies from
expert accounts → conditional entry rules), strict backtest-validation gates
(recognized-config warnings, NaN hygiene, annualization reuse), MCP server +
CLI + React UI. Data rails: tushare (A-shares/ETF/indices/HK) — **no STEEM,
no SBD, no order-book market-making organ**.

## Honest verdict for OUR stack
1. **No runtime adoption today** (three measured reasons):
   - domain mismatch: equity daily-bars research vs our chain-native STEEM/SBD
     limit-order book (the "DEX" lives ON the Steem chain, inside our engine);
   - dependency risk: heavy Python/FastAPI tree inside a reaper-hostile sandbox
     (boot-managed organs law) — a 155MB research runtime is not an organ;
   - our execution capabilities the owner asked about are ALREADY chain-native:
     hyper-grid (maker presence), dexflow (self-cross volume trips), tiered
     fleet book (W27), capital router, custody custody-custody rails.
2. **What we ADOPT (patterns, proven in their repo):**
   - **Strategy-validation gates before live money**: a strategy/param change
     must pass strict offline validation before it touches the book. Our
     equivalent (already law): selftest vectors + operator order records +
     chain-judged receipts. FUTURE LANE: backtest our grid params
     (setpoint/spacing/levels) against recorded internal-market parity/fill
     history before every setpoint ladder move.
   - **Shadow Account discipline**: learn rules from a measured account's
     fills — our fill ledger already feeds pnlFromFills; the adoption is
     "entry-condition extraction" for our fuel-ladder timing.
   - **MCP pattern**: when the FF lane opens, an MCP-style read-only bridge
     for the cockpit is the clean shape (the engine already serves /status).

## Where the clone lives
/home/z/vibe-trading (sandbox-local, OUTSIDE every git-visible tree; nothing
imported into any repo). If a wipe takes it, the assessment above is the
keeper; re-clone is one command.

## Next concrete step (recorded, not executed)
`scripts/backtest-grid-params.mjs` CI lane: replay measure.mjs parity history
+ fill ledger over the last N days, grid-search setpoint×spacing×levels within
doctrine caps, output ranked table → operator picks → one operator order per
ladder move (the same T2 reversibility law).
