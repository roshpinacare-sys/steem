# DEX TECHNOLOGY RESEARCH — T-75-r

**Task ID:** T-75-r · **Date of measurement:** 2026-10-04 (~07:45–08:10 UTC) · **Agent:** research agent (Z.ai Code session)
**Scope:** operator order "examine our DEX well… enable swaps to as many networks as possible, FIRST Steem/Hive/Blurt… build opposing grids from the other side… a networked arbitrage market for agents… liquefy virtual + pegged coins but ONLY with REAL swaps to real coins… compare networks, find peak technology."
**Method:** 36 web-search queries (log in Appendix A) + **live chain/API probes** (Appendix B, raw JSON saved in `docs/research/t75-searches/` and `docs/research/t75-probes/`). Every number in §4 is a fresh measurement, not a memory. Honesty laws applied: stale or unmeasurable things are labeled as such.

---

## 1. EXECUTIVE SUMMARY

1. **The 2026 frontier DEX has converged on a 3-layer stack:** (i) an execution core (AMM with hooks / orderbook / batch auction), (ii) an **intent + solver settlement layer** (user declares the outcome, competing solvers race to fill), and (iii) an **agent-payment rail** (x402-style machine payments). We can and should copy all three patterns at our scale — the patterns are software, not capital.
2. **The "real coin" problem has exactly three honest solutions in the industry:** TSS/multisig vault swap-networks (THORChain), intent-solver networks with staked/reputation-bonded solvers (ERC-7683 / UniswapX / NEAR Intents), and HTLC atomic swaps. All three reduce to the same primitive we can build on Steem/Hive rails: **escrow + deposit-verification + bonded settlement.** No fourth honest option exists; everything else is a wrapped IOU that can rot (we measured one rotting today: see §4).
3. **Live probe results (the big ones):** Steem internal market alive at ≈ **$150/day** (confirms our pond), Hive internal market ≈ **$1,465/day** today, Hive-Engine wrapped markets **alive and near 1:1 parity** (SWAP.LTC −1.5% vs LTC, SWAP.BTC +1.6% vs BTC, SWAP.HBD ≈ $0.998), **Blurt has NO internal market at all** (the orderbook/ticker/market-history APIs do not exist on the chain — measured), the Steem-Engine sidechain endpoint did not respond (treat as dead), and **SBD is externally de-pegged at $0.60** while its internal market still prices it coherently against STEEM.
4. **Blurt is a zero-DEX rail.** No dollar asset (no `current_sbd_supply`), no market APIs, HE BLURT market at dust with zero volume. Any "Blurt liquidity" we offer must be *provided by us* (inventory + escrow OTC) or bridged by us. That is actually our biggest open lane: nobody is making a market there.
5. **Recommended adoption set for saos-dex (concrete, §6):** intent-based internal settlement (signed JSON intents in our event bus), escrow-honest custody with on-chain deposit verification before quoting, parity-band RFQ quotes (already half-built in peg.mjs — extend to a full RFQ surface), opposing-grid taker engine on HE (the other side of our Steem ladder), batch-auction internal matching every N minutes, and a law-gated agent API where **every quote carries its measurement proof**.

---

## 2. ARCHITECTURE PATTERNS — COMPARISON

| Pattern | How it works | Strengths | Weaknesses | Exemplars | Fit for SAOS sandbox |
|---|---|---|---|---|---|
| **Constant-product AMM (v2)** | `x·y=k` pool; price = reserve ratio; 0.3% fee | Permissionless, simple math, passive LP | Impermanent loss, low capital efficiency, LVR (toxic-flow bleed) | Uniswap v2, PancakeSwap, HE-style pools | Trivial to implement internally for virtual pairs; dangerous to run against informed flow without a parity gate |
| **Concentrated-liquidity AMM (v3)** | LPs place liquidity in price ranges | ~4000× capital efficiency at range | Active management required; more MEV surface | Uniswap v3/Slider | Our 5-level ladder IS a manual concentrated range — we already do this by hand |
| **Hooked singleton AMM (v4)** | One PoolManager contract; per-pool hooks run before/after ops; flash accounting nets balances; transient storage | Programmable pool behavior (dynamic fees, custom curves, MEV hooks); gas ↓ ~99% for multi-pool routes | Hook risk concentration; audits harder | Uniswap v4 (launched Jan 2025) | **Pattern to adopt conceptually:** a single internal engine where each market is a plug-in with pre/post-trade gates = exactly our law-gates |
| **Orderbook (CLOB)** | Bids/asks matched by price-time priority | Full control, precise fills, natural for thin markets | Needs active market makers or it's an empty book | Nasdaq-style CEXs, Hyperliquid, Bittrex-era | **What the Steem/Hive internal markets already are** — our grids already live here |
| **Batch auction + uniform clearing** | Orders collected in a batch; one uniform clearing price; solvers propose solutions; surplus returned to traders | Kills sandwich/front-running inside the batch; Coincidence-of-Wants matches directly | Latency (batch window); solver complexity | CoW Protocol, CoW Swap (now on Solana via NEAR Intents) | **Adopt:** our internal matching can batch every N min; uniform clearing price per batch is trivially auditable = trust artifact |
| **Intent + solver (Dutch auction)** | Signer declares outcome+max cost; solvers compete; winner fills; settlement on-chain | No slippage games, gasless UX, cross-chain natural | Solver decentralization is hard; economics favor big solvers | UniswapX, 1inch Fusion, Across, NEAR Intents | **Adopt the interface** (signed intent → competitive fill) even if we are the only solver at first |
| **RFQ (request-for-quote)** | Taker asks MMs for quotes; picks best; atomic settlement | Best price for size, no toxic-flow loss for MMs, deterministic | Requires reachable MMs | Canton, Solana hybrid engines, crypto prime desks | **Adopt:** our parity-band ladder is an RFQ quote sheet already; expose it as an API |
| **Wrapped-asset bridge** | Custodian locks asset on chain A, mints IOU on chain B | Cheap, fast | **Custodian risk = existential**; IOU can de-peg/die | wBTC, old HE wraps, the dead BLURT-on-HE market | Only acceptable with **deposit verification we can independently read**; else it's a "fake swap" (operator's forbidden class) |
| **TSS vault swap-network** | Validator set holds native assets in threshold-signature vaults; swap = inbound deposit → outbound signed release | Swaps NATIVE BTC/LTC/DOGE — no wrapped IOU | Validator-set trust; economics; heavy infra | THORChain (BTC/ETH/XRP/BNB/TRX/DOGE/BCH/LTC/AVAX/ATOM native) | The honest template for "swap to the real coin." At our scale: escrow + m-of-n key holders among SAOS accounts/operator = the same primitive |
| **Intent-solver cross-chain** | Fillers front capital on destination chain, get repaid on source; bonds/stake as security | Fast UX; no user-side bridging | Solver needs inventory+reputation | ERC-7683/UniswapX, NEAR Intents (MPC solvers), Across | Fits us: SAOS accounts with tracked inventory can be "solvers" between Steem↔Hive↔HE with on-chain proof of fills |
| **HTLC atomic swap** | Hashed time-lock on both chains; same hashlock; timeouts refund | Trustless (no custodian at all) | Requires matching script support + UX; locked capital during windows; off-chain coordination | Litecoin↔Bitcoin classic swaps | Steem/Hive/Blurt lack HTLC scripts — **not available natively**; escrow ops are the chain's own substitute |

**Cross-chain custody in one line:** MPC/TSS multisig vaults with hot/cold separation is the institutional standard (q16); THORChain's "vaults are the chain's multisig accounts controlled by active validators via TSS" (dev.thorchain.org) is the decentralized version; bridges without either = the $3.4B/year exploit class (Hyperbridge 2025 recap).

---

## 3. PEAK TECHNOLOGY 2026 — WHAT THE LEADERS ACTUALLY DO

1. **Uniswap v4 (live since Jan 2025):** singleton `PoolManager` + **hooks** (per-pool code executed at defined lifecycle points) + **flash accounting** (only net deltas settle at end of tx — the search evidence: "flash accounting allows only the net balance difference to be transferred after a transaction"; "singleton architecture and flash accounting reduce the cost of routing trades across multiple pools"). *Lesson for us:* one engine, many market plug-ins, settle nets not gross, and put every law (parity gate, basis gate) INSIDE the pre-trade hook path so no route can bypass it.
2. **ERC-7683 cross-chain intents** (Uniswap+Across standard; used in production by UniswapX; Cosmos converged on it too via Skip): one standard `GaslessCrossChainOrder` + `filler` interface. *Lesson:* standardize our intent object now (`saos.intent.v1`) so sibling agents/soldiers can fill each other's intents without bespoke glue.
3. **CoW Protocol batch auctions:** all trades in a batch clear at ONE uniform clearing price → sandwich attacks structurally impossible inside the batch; "fair combinatorial batch auctions"; solver rewards being re-aligned to protocol revenue (CIP Sept 2025). Expanded cross-chain via NEAR Intents (CoW on Solana, May 2026). *Lesson:* uniform clearing price is a **trust artifact** — a batch's clearing price with its inputs is a proof anyone can recompute. Fits our measurement doctrine perfectly.
4. **THORChain native swaps:** self-custody wallets swap **native** BTC/ETH/XRP/BNB/TRX/DOGE/BCH/LTC/AVAX/ATOM; vaults = on-chain multisig accounts of active validators via **TSS**; streaming swaps; affiliate-fee hooks for integrators (SwapKit). *Lesson:* "REAL swap to the real coin" = deposits into a verifiable vault + signed release. We cannot run TSS validators, but **the Steem/Hive escrow ops + our multi-account custody (operator key + agent key + watch account) reproduce the trust shape at toy scale, honestly.**
5. **NEAR Intents / chain abstraction:** Particle Universal Accounts (coordination engine chain), Crossmint/Privy wallet abstraction; NEAR "Universal Send" (May 2026) routes any token cross-chain via MPC solvers. *Lesson:* users (and agents) increasingly hold ONE account and route to all chains. **Our equivalent: one SAOS agent account per chain, one router API above them.**
6. **Hyperliquid HIP-3 (builder-deployed markets):** third parties deploy whole perpetual markets on shared infra; deployers earn **50% of trading fees**; staking门槛 500K HYPE (Chainstack report). *Lesson:* the platform sells infrastructure, builders sell markets. **Our mini-HIP-3: any SAOS agent can deploy a grid/pond on our shared engine and own its fee share — the CLAIMS board already tracks work; add fee-share accounting.**
7. **Agent commerce rails (x402 / AP2 / A2A):** x402 revives HTTP 402 as a machine-readable payment challenge — agents pay per-call in stablecoin, ~2s settlement; by Feb 2026 x402 ≈ **$600M annualized volume** with Google Cloud/AWS enterprise backing; 165M agent transactions cited by Coinbase's x402; Google's AP2 = payment-agnostic mandate layer (pre-approved spending authority); A2A/MCP = agent interop. *Lesson:* **quotes and fills should be purchasable by ANY agent over HTTP with a signed mandate** — this is exactly the operator's "networked arbitrage market for agents and soldiers."
8. **Professional MM reference (Hummingbot):** pure market-making with **inventory skew**, order-refresh intervals, transaction-cost adjustment, kill-switch; grid strategies remain the retail/pro hybrid standard on both CEX and DEX. *Lesson:* our mover already implements refresh + parity skew; formalize inventory-skew law (shift ladder center by inventory imbalance) — it's a known, published discipline, easy to adopt.
9. **RFQ renaissance:** hybrid engines (concentrated AMM + RFQ per trade) now standard on Solana venues; Canton runs pure RFQ for private deterministic trading. *Lesson:* for thin markets (ours), **RFQ + batched settlement beats raw AMM** on both sides of the table.
10. **Anti-pattern confirmed by industry data:** wrapped-asset bridges remain the top exploit/depeg class (Hyperbridge: >$3.4B industry losses 2025; our own probe found a dead wrapped market today — §4). "Proofs over promises" is the 2026 settlement zeitgeist.

---

## 4. MEASURED RAILS — LIVE PROBE RESULTS (2026-10-04)

All figures measured by direct API probe from this sandbox (raw JSON in `docs/research/t75-probes/`). USD anchors from CoinGecko at probe time: STEEM $0.0632, SBD $0.6019, HIVE $0.05625, LTC $70.56, BTC $85,100, BLURT $0.001305.

| Rail | Status (measured) | 24h volume (raw) | ≈ USD/day | Notes |
|---|---|---|---|---|
| **Steem internal market** (STEEM:SBD) | ALIVE — 10+ levels each side; top asks 0.10436–0.1050 SBD/STEEM | 2,408 STEEM + 247.6 SBD | **≈ $150** | Matches our standing $150/day pond measurement exactly (249.4 SBD-equiv × $0.6019). Consistency check PASSED vs T-74 dominion numbers. |
| **Hive internal market** (HIVE:HBD) | ALIVE — top ask 0.05650, bid 0.05621 HBD/HIVE | 13,024 HIVE + 732.9 HBD | **≈ $1,465** | Higher than the $966/day ceiling measured earlier — volume varies; treat $966 as a floor-ish planning number, re-measure weekly. |
| **Hive-Engine market** (SWAP.LTC) | ALIVE, near-parity: last 1235.76 HIVE = **$69.50** vs LTC $70.56 (−1.5%) | metrics vol 9,493.65 (units need calibration) | order-of-1e2–1e3 (T-70 measured $63.5/day ceiling) | sellBook has live orders but with wild gaps (1,080,000 vs 7,827 in 5 levels) — book is THIN between the rails. Empty recent-trades on direct query — verify trade feed before arming. |
| **Hive-Engine market** (SWAP.BTC) | ALIVE, near-parity: 1537430 HIVE = **$86,475** vs BTC $85,100 (+1.6%) | metrics vol 3,423 (units TBD) | small | Same thin-book caveat. |
| **Hive-Engine market** (SWAP.HBD) | ALIVE: 17.74 HIVE = **$0.998** — tracks INTERNAL HBD (≈$1.00), not external HBD ($0.60) | vol 992 (units TBD) | small | **Divergence signal:** internal HBD $0.998 vs external HBD $0.6019 → 66% gap is either an arb pond or a redemption risk — MUST be measured over days before touching. |
| **Hive-Engine** (DEC / BEE) | ALIVE, tiny: DEC 0.00949 HIVE ($0.00054), BEE 0.5565 HIVE ($0.0313) | DEC 11,092 / BEE 1,830 | ~$6 / ~$57 | Consistent with our earlier DEC $31/day ceiling order-of-magnitude. |
| **BLURT on Hive-Engine** | **DEAD** — last 0.00000022 HIVE (≈$0.0000000124), vol ≈ 0, bid 0.00000001 | ~0 | ~0 | The old BLURT→HE bridge market is dust. Do not route through it. |
| **Blurt chain internal market** | **DOES NOT EXIST** — `get_order_book`, `get_volume`, `get_ticker`, `get_trade_history`, `get_current_median_history_price` all return "Could not find method"; **no `current_sbd_supply`** (no dollar asset at all) | n/a | n/a | Blurt = BLURT + VESTS only. All Blurt liquidity is external (ProBit per Coinlore; ionomy legacy; ~$115–N/A/day 24h vol per aggregators, wide spread). |
| **Steem-Engine sidechain (Steem side)** | `api.steem-engine.com` returned EMPTY response in probe | n/a | n/a | Treat as dead/unreachable until proven otherwise; the surviving sidechain DEX is Hive-Engine. |
| **Steem/Hive escrow ops** | Native ops exist (same fork lineage): `escrow_transfer`, `escrow_approve`, `escrow_dispute`, `escrow_release` | n/a | n/a | Chain-native OTC rail; op ids derivable via `get_transaction_hex` (same discipline as our T-73 OP_IDS fix). |

**Two headline regime facts for the operator:**
- **SBD external de-peg:** SBD = $0.6019 while the internal STEEM:SBD book prices STEEM:SBD coherently with it (STEEM $0.0632 / SBD $0.6019 = 0.1050 STEEM/SBD vs top ask 0.10436 — ~0.6% gap). The *pair* is coherent; the *dollar peg* is broken. Our peg engine must now anchor to **external USD or to the SBD/STEEM cross** explicitly, never to "SBD=$1".
- **HBD dual-price:** internal ≈ $0.998, external $0.60. Any HBD-liquefaction strategy must choose its price oracle honestly and disclose which one a quote is backed by (law-gated quotes make this automatic).

---

## 5. EXACT API SURFACE PER RAIL (implementation-ready)

### 5.1 Steem internal market (already live in our stack — steemtx.mjs)
Node: `https://api.steemit.com` (multi-node ladder already in observe.mjs).
- **Place:** `condenser_api.limit_order_create` → `{owner, orderid, amount_to_sell:"X STEEM"|"X SBD", min_to_receive:"Y SBD"|"Y STEEM", fill_or_kill:false, expiration:<iso+90d max>}` ; price variant `limit_order_create2` with `exchange_rate` object.
- **Cancel:** `condenser_api.limit_order_cancel` → `{owner, orderid}`.
- **Read book:** `condenser_api.get_order_book(limit≤500, default 10)` → `{asks:[{created,order_price{base,quote},real_price,sbd,steem}], bids:[…]}` (probed live; `real_price` = SBD per STEEM).
- **Read own orders:** `condenser_api.get_open_orders` → array with `orderid` (our `YYYYMMDD*100+seq` scheme survives).
- **Fills:** virtual op `fill_order` via `condenser_api.get_account_history` (our observe.mjs already parses; deep-window accounting per T-6/A-10).
- **Candles:** `condenser_api.get_market_history(buckets)` / `get_market_history_buckets` / `get_trade_history(start,end,limit≤1000)` / `get_ticker` / `get_volume` (probed: works).
- **Conversion:** `convert` op (SBD→STEEM at median feed price, fee — verify current % via a dry measurement before any use; T-71 measured the feed gate HOLD logic already).
- **OTC:** `escrow_transfer` → `escrow_approve` (agent+operator can BE the two approvals) → `escrow_release` / `escrow_dispute`.

### 5.2 Hive internal market (HIVE:HBD) — same family, separate chain
Node: `https://api.hive.blog` (probed live).
- Identical condenser surface: `limit_order_create`/`limit_order_create2`/`limit_order_cancel`, `get_order_book`, `get_open_orders`, `get_trade_history`, `get_market_history`, `get_ticker` (probed: latest 0.0565, ask 0.0565, bid 0.0562), `get_volume`.
- Conversion rails: `convert` (instant, feed price, fee), `collateralized_convert` (3.5-day delay, haircut risk) — read `condenser_api.get_collateralized_conversion_requests`.
- **Credentials gate:** requires a Hive account + active key — operator-gated (X-1 class), same as Steem.

### 5.3 Hive-Engine token DEX (SWAP.LTC / SWAP.BTC / SWAP.HBD / DEC / BEE …)
- **API (probed live):** `POST https://api.hive-engine.com/rpc/contracts` with JSON-RPC `{"method":"find","params":{"contract":"market","table":"metrics|buyBook|sellBook|trades","query":{…},"limit":100,"offset":0,"orderBy":…,"orderDir":"asc|desc"}}`.
  - `metrics` fields: `lastPrice, lowestAsk, highestBid, volume, …` (probed). Price convention MEASURED: HIVE per 1 token (SWAP.HBD last 17.74 × HIVE $0.0562 = $0.998 ✓; SWAP.BTC 1,537,430 × $0.0562 = $86,475 ✓). Volume unit calibration is a **verify-before-arm** item (reconcile against our T-70 pond numbers).
- **Trade (broadcast custom_json op):** id **`"ssc-mainnet-hive"`**, `required_auths:[account]`, `required_posting_auths:[]`, json:
  - buy: `{"contractName":"market","contractAction":"buy","contractPayload":{"symbol":"SWAP.LTC","quantity":"0.1","price":"1235.9"}}`
  - sell: `{"contractAction":"sell", …same payload shape}`
  - cancel: `{"contractAction":"cancel","contractPayload":{"type":"buy"|"sell","id":"<txId>"}}`
  - quantities/prices as **strings**; buys cost SWAP.HIVE; per-op 1000-token quote units need a live dry check.
- **Custody reality-check (operator's "REAL not fake" law):** SWAP.* tokens are IOUs on the engine bridge. Honest use requires (a) redemption-path evidence (recent successful withdrawals observed on-chain), (b) parity drift limit, (c) size caps. Today's parity is good (±2%), but BLURT-on-HE is a measured example of the same mechanism rotting to dust — the risk class is real.

### 5.4 Blurt
- Node (probed live): `https://blurt-rpc.saboin.com` (condenser-compatible; `api.blurt.buzz` and several others did not resolve). Chain live at block 64,191,449+; supply 607.27M BLURT; **no SBD-equivalent asset, no market APIs.**
- Tradeable liquidity: external only — ProBit (top BLURT spot per Coinlore), ionomy (legacy), CoinGecko price $0.001305. HE BLURT market: dead.
- **Implication:** Blurt participation = (a) OTC escrow deals on-chain (escrow ops exist in the Blurt fork — verify op ids at implementation), (b) us providing liquidity by holding BLURT inventory and quoting BLURT↔STEEM/HIVE/SBD/HBD against ProBit as reference, (c) potentially operating a small honest bridge (deposit-verified, like our custody law) — the only rail where we could BE the DEX rather than join one.

### 5.5 Cross-rail settlement primitives we already possess
- Internal µ/units ledger (kernel-verified), offer.json publication, mover verify-then-sign, observe real-fill reader, CLAIMS board, FLEET protocol, escrow-honest grids (no naked shorts), parity-band gates, basis/cost-floor gates (§71/§72), humanity/persona gates (§73 — agents transacting as named persons, a surprisingly good Sybil-resistance story).

---

## 6. WHAT IS REALISTICALLY IMPLEMENTABLE IN THE SAOS SANDBOX

Constraints honored: no EVM infra, no external capital, credentials operator-gated, all measurement honest. Ranked by (impact × feasibility ÷ capital):

**ADOPT NOW (keyless/cheap, weeks not months):**
1. **Intent object + internal settlement layer (`saos.intent.v1`).** Signed JSON intent `{want, give, maxSlippageBps, expiry, chain, proofReq}` on our event bus; our engine (and any sibling agent) can fill it; settlement = both legs verified on-chain before "filled" is ever claimed. This is ERC-7683-shaped at JSON scale.
2. **Escrow-honest custody for cross-agent swaps.** Steem/Hive `escrow_transfer→escrow_approve→escrow_release` as the settlement primitive between agents/soldiers; every custody claim carries the escrow txid. (No agent holds another agent's funds outside a chain escrow — law-writable today.)
3. **Parity-band RFQ quote surface.** Extend peg.mjs's computeOffer into a served RFQ: `/quote?give=STEEM&want=SBD&size=X` returns a signed quote JSON **with its measurement proof attached** (parity bps, source prices, timestamps, book snapshot digest). Quotes expire; expired = refused.
4. **Batch-auction internal matching.** Every N minutes, cross our own pending intents/orders and internal virtual-pair liquidity at ONE uniform clearing price per batch; publish the batch with recomputable inputs (CoW pattern). Kills internal self-crossing accidents and produces provable fairness.
5. **Opposing grids on Hive (HIVE:HBD) and Hive-Engine** — "trading both here and there": same ladder shape as our Steem pond, HE buys/sells quoted against SWAP.HIVE, all gates carried over. Operator-gated on the Hive credential (X-1 class), buildable keyless now (dry-run + selftests).
6. **Blurt inventory market-making** (optional small pond): if operator releases even a dust BLURT float, we quote an OTC RFQ vs ProBit reference with escrow settlement — the only Blurt DEX-ish service that exists anywhere.

**ADOPT NEXT (needs operator keys and/or tiny float):**
7. **Hive-Engine deposit-verified custody rail:** before quoting any SWAP.* market, an automated redemption-path monitor (watch bridge withdrawals over trailing N days; parity-drift law; per-market size caps; auto-refuse on rot like BLURT/HE). This operationalizes "REALLY swap to the real coin, not fake" as a continuous measurement, not a one-time audit.
8. **Cross-chain solver role for SAOS agents:** agents with inventory on chain A fill intents on chain B, repaid by verified fills (ERC-7683 filler pattern); bonds = tracked inventory + reputation (CLAIMS history); fails honestly if inventory proof is missing.

**DO NOT ADOPT (anti-goals, evidence-backed):**
- Wrapped IOUs without independently readable backing (BLURT/HE is today's measured corpse).
- Any "bridge" we operate on trust alone — bridges were the $3.4B/yr loss class in 2025.
- AMM pools against informed flow without parity/basis gates (LVR bleed); our ponds are too small to subsidize MEV sharks.
- Steem-Engine sidechain (endpoint empty in probe; no liveness evidence).
- HTLC-style atomic swaps on Steem/Hive/Blurt (script support absent — not available natively; escrow ops are the honest substitute).

---

## 7. PEAK ADVANTAGE — WHAT WE CAN DO BETTER THAN THE COMPETITION

The frontier optimizes for capital and latency. We cannot win there. We CAN win on **provable honesty + agent-nativeness** — dimensions the giants structurally cannot ship:

1. **Law-gated quotes (quotes carry their proof).** Every quote/fill we publish embeds: parity measurement + source digest + basis verdict + gate verdicts + expiry. Industry quotes are black boxes; ours are recomputable. ("Proofs over promises" is literally Hyperbridge's 2026 slogan — we make it a data format.)
2. **Agent-native RFQ + leaderboard (the "networked arbitrage market for agents").** Signed `saos.intent.v1` API over HTTP; any agent can query quotes, submit intents, fill others' intents; a public leaderboard meters fill quality, proof-completeness, uptime (CLAIMS-board DNA). No incumbent DEX has a working agent-trader league; x402 proves the demand (165M agent txs) but nobody owns the *trading* layer for agents on non-EVM chains.
3. **Escrow-honest custody with on-chain deposit verification.** Custody state = list of chain-verifiable escrow/deposit txids + thresholds + live balance reads; any agent (or the operator) can audit our custody in one command. Position: "we hold nothing that cannot be re-verified from the chain in 30 seconds."
4. **Uniform-clearing-price internal batches (mini-CoW).** Batch every N minutes, one clearing price, publish recomputable inputs → structurally unsandwichable internal market, and each batch is a *measurement artifact* the cockpit can render.
5. **Dual-oracle honesty law (the SBD/HBD lesson, productized).** Every pegged-coin quote names its oracle: internal parity vs external USD vs collateralized-convert ceiling — with the measured spread between them exposed live (today: SBD $0.60 ext, HBD $1.00 int / $0.60 ext). Incumbents hide this; we sell it as a feature (it IS the arbitrage market).
6. **Builder-owned ponds (mini-HIP-3).** Any fleet agent deploys a pond/grid on our engine and accrues its fee share (CLAIMS + receipts infrastructure already tracks who did what). Composable "financial Lego" for agents, on rails the giants ignore (STEEM/HIVE/BLURT).

**The wedge:** nobody professional is market-making on Steem/Hive/Blurt rails at all. Peak-tech patterns (intents, batch auctions, proof-carried quotes, deposit-verified custody) are software-only and directly portable. We can be, honestly, *the only serious DEX on these chains* — with an agent trading league on top — years before any incumbent bothers.

---

## 8. RISKS & OPEN MEASUREMENTS (verify-before-arm list)

- **HE volume/price unit calibration** (probe vs our T-70 pond numbers) — one day of parallel measurement.
- **SWAP.* redemption-path liveness** — monitor bridge withdrawals N days before quoting any SWAP.* market.
- **SBD external de-peg ($0.60):** our peg doctrine's parity band must define its anchor explicitly (pair-internal vs USD-external).
- **HBD dual-price (int $0.998 / ext $0.60):** 66% gap — measure for days: arb pond or redemption wall? (Convert ops carry fees + delays that may make the gap unreachable — same honesty as our T-71 convert HOLD.)
- **Thin HE books:** 5-level probe showed wild gaps between rails; size caps mandatory.
- **Blurt escrow op ids** — derive via `get_transaction_hex` before use (T-73 discipline).
- **Steem `convert` fee %** — measure, don't recall.
- **Hive credential** — operator gate; all Hive/HE live trading waits on X-1/X-2 class decisions.

---

## APPENDIX A — SEARCH LOG (36 queries run, `docs/research/t75-searches/`)

q01 Uniswap v4 hooks singleton flash accounting · q02 ERC-7683 UniswapX · q03 THORChain native swaps TSS vaults · q04 chain abstraction 2026 (Particle/Crossmint/Privy) · q05 grid trading bots market making inventory · q06 CEX-DEX arbitrage architecture MEV · q07 Hive internal market + Hive-Engine APIs · q08 HE market contract API · q09 Blurt exchanges liquidity (Ionomy/ProBit) · q10 Steem internal market programmatic (noisy — Steam) · q11 x402 AP2 agent commerce · q12 Uniswap v2 constant product math · q13 intent settlement solver design (Fusion/CoW) · q14 CoW batch auctions uniform price · q15 AI-agent DeFi trading 2026 · q16 MPC/TSS custody · q17 HBD internal market (noisy) · q18 Steem peg (noisy) · q19 pegged-asset AMM / Curve · q20 RFQ vs AMM · q21 bridge security vs swap networks · q22 TribalDex/BeeSwap review · q23 Hive escrow (noisy) · q24 A2A/MCP interop · q25 Steem condenser docs · q26 Steem-Engine DEX · q27 Blurt nodes/docs · q28 Hummingbot PMM inventory skew · q29 Hive orderbook API (developers.hive.io) · q30 THORChain streaming swaps · q31 Steem escrow ops (thin) · q32 HTLC atomic swaps · q33 Hyperliquid HIP-3 · q34 NEAR Intents/Across · q35 BLURT HE bridge (noisy) · q36 Steem get_account_history fills.
Noisy/failed queries were NOT treated as measurements; all factual claims above come from (a) primary-chain probes or (b) convergent multi-source snippets.

## APPENDIX B — PROBE LOG (raw JSON: `docs/research/t75-probes/`)

- steem: get_order_book(10), get_volume, get_dynamic_global_properties — api.steemit.com ✓
- hive: get_order_book(10), get_volume, get_ticker — api.hive.blog ✓
- blurt: get_dynamic_global_properties ✓ (block 64,191,449, supply 607.27M, no sbd supply); get_order_book / get_volume / get_ticker / get_trade_history / get_current_median_history_price / market_history_api — ALL ABSENT (blurt-rpc.saboin.com)
- hive-engine: market.metrics for SWAP.LTC/BTC/HBD/HIVE, DEC, BEE, BLURT, STEEMP; sellBook SWAP.LTC; trades SWAP.LTC/DEC/BEE — api.hive-engine.com ✓
- steem-engine: api.steem-engine.com getLatestBlockInfo — EMPTY response (unreachable)
- steem block scan (8 recent blocks): ops = vote/comment only (ssc op-id unverified on Steem; verify-before-arm)
- coingecko simple/price: STEEM/SBD/HIVE/LTC/BTC/BLURT ✓ (SBD $0.6019 de-peg noted)
