# T-59 · NETWORK AUDIT & WIRING BRIEF — trace 1a1032bcd540d035

**Operator order (translated):** examine the whole git, connect the dots, find the technological
advantages and breakthroughs on the networks and our own network, name what limits us, advance all
agents together, and wire everything in the best proven way. This brief is the measured answer.

Method: THREE parallel read-only auditors (1-a git archaeology, 1-b live chain probes on the signing
nodes, 1-c own-network surface audit) → synthesis → FOUR parallel build agents (2-a…2-d) + core laws,
all wired the same day. Every number below is measured, not claimed.

---

## 1 · WHAT THE NETWORKS MEASURED (1-b, 2026-10-03)

| Surface | Measured fact | Implication |
|---|---|---|
| Audience | **1,164 followers / 288 following** (follow_api.get_follow_count) | distribution instrument never before measured |
| RC | **100.00% full** (rc_api.find_rc_accounts) | posting/voting bandwidth is free — use it |
| Delegation | **320.17 SP out in 10 rows** (9×30SP + 50SP); delegatees' output = self-vote dust, rep 0 | a dead lane — reclaim candidates (operator face) |
| Incoming | 244 SP received (lsa auto-vest power-down) | the hub-spoke power flow works |
| Promoted market | top slot **0.001 SBD** outranks 4.19e13 rshares posts — nearly empty | cheapest measured visibility on the chain |
| Self-vote | our saos-daily: **94.4% of rshares is our own vote**, pending 0.005 SBD | the curation competitor is ourselves |
| 3-layer price | last feed tick 0.063 / book 0.101 / **median feed 0.1041** SBD/STEEM | convert print path **loses ~3%** today → gate codified |
| Orders | 18 open orders, 6.1 STEEM asks above top-of-book, stale since 02:54 | daily peg cadence quotes stale within hours |
| Engagement | replies inbox **100% self**, zero third-party | visibility is the binding constraint, not content |
| Market | spread 0.09% top-of-book, whole venue ~$130–150/day | maker ceiling is cents regardless of skill (re-confirmed) |
| Governance | get_proposals / proposal_api UNAVAILABLE on both nodes | no proposal lane on this surface (honest gap) |

## 2 · WHAT OUR OWN NETWORK MEASURED (1-a + 1-c)

- **The two most valuable measured facts were produced every cycle and consumed by nobody:**
  the Hive regime (HBD:HIVE, 24h vol ≈ $4,015/day = 27× Steem's venue) had NO row in
  router/economics, and receipts.json measured the content loop while economics hardcoded
  `promo: null`.
- **The MCP door sold nothing and heard nothing:** zero demand telemetry (in-memory only), the
  market-data-feed SKU fulfillment text was still v1 (post-reply), 0 keys ever issued — the
  self-serve path (pay→key→`POST /mcp`) was invisible to every external agent.
- **The forge rail starved beside its own food:** forge-tasks.json empty since 05:21 while
  learning.json produced its 4th open lesson — the machine's self-engineering desk had no seeder.
- **discovery.json measured a live tag economy** (hive-129948 $6,906 payouts top) that never steered
  the content prompt.
- **Cockpit honesty gaps:** weave showed midnight counters as "today" (19h stale); learning
  trialEvents/trialsBlocked and receipts curatorSbd emitted by the engine but dropped by the proxy.

## 3 · WHAT LIMITS US (ranked, with evidence)

1. **CAPITAL** — neededFactor ≈ 11,700× (effective $0.085/day vs $1,000); whole-venue depth makes
   the maker ceiling cents. The scale lever is accumulation + the offer, not skill.
2. **One credential / one account / one chain** — Hive deploy, soldier revival, and org push are
   all operator-PAT-gated (T-15/T-19e/T-29 walls).
3. **7-day payout clock** — first income landed day ~19; forecast+calibration instruments exist
   precisely to see through it (TONIGHT 00:04 UTC the first settlement judges the machine).
4. **Visibility, not content** — 1,164 followers but 100% self-engagement; the promoted slot is the
   measured cheap lever (0.001 SBD), the door is the measured expensive one (external SBD).
5. **Cadence walls** — daily peg re-quotes stale within hours; one-post-per-cycle throttles reach.

## 4 · THE BREAKTHROUGH PAIRINGS — WIRED THIS RUNG (T-59)

| # | Breakthrough | Joined assets | Status |
|---|---|---|---|
| 1 | **Hive enters the denominator** | hive.json × router.venueRow × aggregateRails | DONE — `hive-grid` row, class `blocked-no-credential`, zero-income honest; spacing doctrine unified (flowSpacingLaw now serves both chains; 29.9→30bps at the measured regime) |
| 2 | **The door goes to market** | feed.mjs × catalog v2 × promo footer | DONE — 6th tool `hive.regime`, persisted door telemetry (survives restart, ≤8KB), self-serve fulfillment text, door line in every daily post |
| 3 | **The machine feeds itself** | learning.lessons × forge seeder | DONE — `forgeSeedTaskFromLesson` seeded `seed-signing-cred-blocked` LIVE in the first cycle after hot-reload; discovery tagBoard now steers content/digest prompts (top ≤5, lawful number mirrors) |
| 4 | **The median-feed gate** | internalFeed median × planConvert | DONE — two axes, one verdict: parity 0.101 ≤ median 0.1041 → `median-feed-gate` blocks a ~3% loss the edge-bps law alone could never see |
| 5 | **The reclaim instrument** | chain delegations × rep floor × promoted rows | DONE — plan-only, operator-gated: dead lane measured per-delegatee (rep raw floor 1e9, honest SP via the chain ratio), promoted slot plan for our latest permlink |
| 6 | **Cockpit honesty** | status proxy × WeaveCard × OfferCard × ReclaimCard | DONE — weave age + "נתוני-חצות" badge, door telemetry line, learning/receipts passthrough fixed, reclaim card live |

Deferred honestly (measured, not built): fills per-fill ledger card (needs a cockpit data path —
`/live` exists, consumerless), workloads control UI, skills-registry runtime merge, orders
re-quote cadence law (peg re-quote drift trigger — next rung candidate), Hive day-1 kit
(fundsLedger/makerGuard/preflight pre-wiring — fires when an operator credential lands).

## 5 · THE NUMBERS

- selftest **1,031 → 1,185** (+154: 36 t59a + 44 t59b + 36 t59c + 38 §65 core)
- lint clean · engine hot-reload clean · live cycle picked up forge seed + hive row same-cycle
- The denominator did not move (measured $0.0239/day unchanged — the rung wires truths, it does
  not manufacture income), but the machine now SEES its second venue, HEARS its door, FEEDS its
  forge, GATES its convert rail on the chain's own oracle, and PLANS the reclaim of 320 SP.

*Judge = the chain, not the code writer. Tonight's settlement (payout day 2026-10-04 ~00:04 UTC)
lands into a truer machine.*
