---
name: curate
description: "Capped curation voting on Steem — the machine votes on content with a doctrine cap (20/day, floored against stale operator config), a VP floor, and chain-truth telemetry. Use when the machine must distribute daily curation votes or audit its own voting cap. Triggers — curation, voting, votes, curator, vp"
triggers: curation, voting, votes, curator, vp floor
laws: doctrine-cap-floor, vp-floor, chain-truth-only, semi-class-signing
verification: state/curator.json + selftest vectors + live chain votes
when-not-to-use: never buys votes, never votes outside the doctrine cap, never promises curation returns
---
# Curation (T-5 rail)

Votes on Steem content within the doctrine cap. The cap can never sit below
doctrine (lib.doctrineCapFloor). Every vote is chain-recorded; the payouts
instrument turns curation from estimated to measured at payout time.
