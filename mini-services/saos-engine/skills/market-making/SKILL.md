---
name: market-making
description: "Two-tranche SBD/STEEM market-making on the internal market — value tranche holds the VF1 floor law, flow tranche quotes with measured fill-share; auto-pauses flow on measured loss (PAUSE-FLOW) and classifies losses (trend-adverse vs spread-negative). Use when quoting the peg ladder or auditing P&L. Triggers — maker, market-making, ladder, peg quotes, fill share, pnl"
triggers: maker, market making, ladder, peg, fills, pnl, quoting
laws: pause-flow-on-measured-loss, vf1-value-floor, parity-band-refuse, fifo-post-mortem
verification: state/observe.json pnl + state/economics.json makerPostMortem + 15 fifoPairSummary vectors
when-not-to-use: never re-quotes while the trend-adverse guard holds without NEW measured evidence, never promises spread capture
---
# Market-making (peg ladder)

Five asks + five bids around measured parity, clamped to liquid balances.
The maker's own guard paused it on measured loss — the post-mortem named the
class (trend-adverse) before anyone was allowed to touch spacing again.
