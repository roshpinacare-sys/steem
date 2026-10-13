---
name: webintel
description: "Web sensing with human-phrased probes and a junk guard — two-query rotations, sourced findings only, strict rate-phrase parsing (word-boundary steem+delegation context; month-April and circulating-supply percentages can never fabricate an APR). Use when measuring market rates (RC-rental APR) or sourcing intel for drafts. Triggers — intel, search, apr, rc rental, sources, junk guard"
triggers: intel, search, sources, apr, rc rental, market rates, web
laws: human-phrased-probes, junk-guard-drop, strict-rate-parse, sourced-or-null
verification: state/webintel.json + 8 poison vectors in selftest
when-not-to-use: never fabricates a rate from a substring match, never feeds unsourced findings to the router or the drafts
---
# Web intel

The sensor that once returned 1885-architect documents for an acronym-soup
query — killed. Two human-phrased probes + a junk guard brought the first
sourced delegation APR (~20%) to the router.
