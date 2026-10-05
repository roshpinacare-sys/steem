/** T-21d · shared cockpit types (extracted from page.tsx so components can compose without cycles). */

export type Order = { orderid: number; side: string; base: string; quote: string; unit: number; created: string }

export type Status = {
  ok?: boolean
  asof?: string
  engine?: { up?: boolean; info?: { account?: string; keyless?: boolean } | null }
  grid?: { runCount?: number; simFills?: number; simFeesMu?: number; grids?: { id?: string; strategy?: string; active?: boolean }[] }
  observe?: {
    parity?: { parity?: number; source?: string; lowConfidence?: boolean; steemUsd?: number; sbdUsd?: number }
    feed?: number
    band?: { ok?: boolean; bps?: number; reason?: string }
    inventory?: { steem?: number; sbd?: number; spOwn?: number; rcPct?: number } | null
    ordersOk?: boolean
    orders?: unknown[]
    fills?: number
    lastFillAt?: string | null
    fuel?: { fuelUsdPerDay?: number | null; authorUsdPerDay?: number | null; curationOps?: number; authorOps?: number; windowNote?: string | null; windowSpanDays?: number; histLen?: number }
  } | null
  offer?: {
    verdict?: string; parityBps?: number | null; blocker?: string[] | null
    marks?: { paritySbdPerSteem?: number; source?: string; lowConfidence?: boolean; internalFeed?: number; dragK?: number; floor?: number; ceiling?: number }
    plan?: { asks?: unknown[]; bids?: unknown[]; flowAsks?: unknown[]; flowBids?: unknown[] }
    flow?: { bestAsk?: number; bestBid?: number; spacingBps?: number; levels?: number; askBudgetSteem?: number; bidBudgetSbd?: number; feedAnchor?: number | null; flowAsks?: number; flowBids?: number } | null
    book?: { bestAsk?: number | null; bestBid?: number | null; askDepthSteem?: number | null; bidDepthSbd?: number | null; at?: string } | null
    market?: {
      at?: string; windowHours?: number; class?: string; trades?: number; tradesPerDay?: number; volSteem?: number
      priceMin?: number | null; priceMax?: number | null; rangeBps?: number | null; sizeP50?: number | null; sizeP90?: number | null
      book?: { bestAsk?: number | null; bestBid?: number | null; spreadBps?: number | null; askDepthSteem?: number | null; bidDepthSbd?: number | null }
    } | null
    publishedAt?: string
  }
  live?: { orders?: Order[]; orderTotals?: { askedSteem?: number; bidSbd?: number }; balances?: { steem: string; sbd: string; vests: string } | null; chainReadOk?: boolean; rc?: { rcPct?: number } | null }
  profit?: {
    fills?: number; buys?: number; sells?: number
    realizedSbd?: number; positionSteem?: number; positionAvgCost?: number | null
    unbasedSteem?: number; unbasedSbd?: number; unrealizedAtParitySbd?: number | null
    parityRef?: number | null
  }
  rails?: {
    fuel?: number | null; author?: number | null; fuelWindowNote?: string | null; fuelHistory?: string
    deployedSteem?: number; bidSbd?: number; bookEmpty?: boolean; bookNote?: string | null
    convert?: { verdict?: string | null; reason?: string | null; amountSbd?: number; marketSbdUsd?: number | null; impliedSbdUsd?: number | null; marketSourceNote?: string | null; at?: string | null } | null
    autonomy?: { ok?: boolean; lastCycle?: string | null; steps?: Record<string, string> } | null
    note?: string
  }
  daily?: { ok?: boolean; health?: 'ok' | 'blocked' | 'fail'; failures?: { failedSteps?: string[]; blockedSteps?: string[] }; finishedAt?: string; rollup?: { realizedSbd?: number | null; deployedSteem?: number | null; measuredTotalUsdPerDay?: number | null; honesty?: string } }
  measuredPerDay?: number | null
  spoilage?: { daysBlocked?: number; votesForegone?: number; estSteemForegone?: number; class?: string; note?: string } | null
  hyper?: {
    running?: boolean | null; lastVerdict?: string | null; lastVerdictAt?: string | null; lastTickAt?: string | null
    ticks?: number | null; rcPct?: number | null; liveHyper?: number | null; label?: string | null; lastTxid?: string | null
    governor?: { pairs?: number; ops?: number; carry?: number; reason?: string; headroom?: number; burnPerDay?: number } | null
    economics?: { regenPerDay?: number; pairCost?: number; pairsPerDay?: number; opsPerDay?: number; reason?: string } | null
    ops?: {
      day?: string; opsToday?: number; opsDayCap?: number; lastTxid?: string | null
      chainTail?: { creates?: number; cancels?: number; total?: number } | null; chainTailAt?: string | null
    } | null
  } | null
  execution?: {
    credentialPresent?: boolean; fingerprint?: string | null; account?: string
    armed?: boolean; standingOrder?: boolean; operatorPaused?: boolean
    verdict?: string | null; reason?: string | null; guidance?: string | null
    proposedPubkeys?: Record<string, string> | null
    roles?: Record<string, { pubkey?: string; matched?: boolean }> | null
    caps?: Record<string, number> | null
    log?: { at?: string; tag?: string; account?: string; ok?: boolean; txid?: string | null; ops?: string[]; error?: string | null }[]
  } | null
  soldiers?: {
    deployed?: boolean; at?: string | null
    accounts?: { name?: string; fingerprint?: string }[]
    fundingTxid?: string | null; fundedEach?: { steem?: number; sbd?: number } | null
  } | null
  curator?: {
    verdict?: string | null; day?: string | null
    votesToday?: number; totalVotes?: number; vpEff?: number | null; maxPerDay?: number | null
    txid?: string | null; candidatesScanned?: number | null
    lastVotes?: { author?: string; permlink?: string; weight?: number; txid?: string | null }[]
    rejectedTop?: string[] | null
  } | null
  intel?: {
    at?: string | null
    decisions?: { kind?: string; decision?: string; reason?: string }[]
    book?: { bestAsk?: number | null; bestBid?: number | null; spreadBps?: number | null } | null
    spreadBpsRec?: number | null
  } | null
  learning?: {
    verdict?: string | null; at?: string | null; runsTotal?: number
    lessons?: { id?: string; severity?: string; lesson?: string; evidence?: string; action?: string; resolved?: boolean | null }[]
    tuningsApplied?: { key?: string; from?: number; to?: number; added?: string; because?: string }[]
    tunings?: Record<string, unknown> | null
    lessonsTotal?: Record<string, number> | null
    cycleMetrics?: { okRate?: number | null; window?: number; failReasons?: Record<string, number> | null; msP50?: number | null }
  } | null
  discovery?: {
    verdict?: string | null; at?: string | null
    opportunities?: { id?: string; kind?: string; potentialClass?: string; evidence?: string; potential?: string | number | null; gate?: string }[]
    topTags?: { tag?: string; payoutsSbd?: number }[]
    curationEst?: { dailyPoolSteem?: number; estimatedSteemPerDay?: number; note?: string } | null
  } | null
  fleet?: {
    at?: string; verdict?: string
    counts?: { total?: number; alive?: number; idle?: number; blocked?: number; dead?: number }
    agents?: { id: string; role: string; status: 'ALIVE' | 'IDLE' | 'BLOCKED' | 'DEAD'; ageMin?: number | null; blockedBy?: string | null; evidence: string; revival?: string }[]
    honesty?: string
    lostEraNote?: string
  } | null
  credential?: {
    present?: boolean; keyFile?: string; armedButNoCredential?: boolean
    missingSince?: string | null; alerts?: number
    agentsAffected?: string[]; revival?: string | null
    /* T-21 · identity-integrity transparency (doctrine account can never be
     * hijacked by a pasted credential — the proven-live failure class) */
    doctrineAccount?: string | null
    credentialAccount?: string | null
    foreignCredential?: boolean
    foreignSince?: string | null
  } | null
  events?: { type?: string; at?: string; [k: string]: unknown }[]
  /* T-21d · new optional engine sections — render only when present, never crash */
  roles?: {
    verdict?: string
    roster?: { id?: string; role?: string; lane?: string; capability?: string; status?: string; recruitedAt?: string; evidence?: string }[]
    ladderNote?: string
  } | null
  economics?: {
    asof?: string
    rails?: { id?: string; label?: string; measuredUsdPerDay?: number | null; estUsdPerDay?: number | null; confidence?: 'measured' | 'estimated' | 'blocked'; note?: string }[]
    totalMeasuredUsdPerDay?: number | null
    totalEstUsdPerDay?: number | null
    /* T-23 · passthrough fields (engine-computed) — X2Card wires x2; the others are mirrors of status.payouts */
    payoutClock?: { payoutDay?: string | null; msRemaining?: number | null; hoursRemaining?: number | null; daysRemaining?: number | null; phase?: string | null; law?: string | null } | null
    pendingRewards?: { steem?: number; sbd?: number; vests?: number; any?: boolean } | null
    x2?: {
      currentUsdPerDay?: number | null
      targetUsdPerDay?: number | null
      currentSp?: number | null
      factor?: number | null
      rows?: { mult?: number; sp?: number; usdPerDay?: number; reachesTarget?: boolean }[]
      law?: string | null
    } | null
  } | null
  /* T-22f · the standing teams (T-22) — engine-computed (one-body law), cockpit only renders.
   * Loose but honest: nullable exactly where the engine emits null. */
  webintel?: {
    verdict?: string | null
    fetchedAt?: string | null
    totalFindings?: number
    droppedJunk?: number
    failedScans?: number
    scans?: {
      id?: string
      note?: string
      count?: number
      dropped?: number
      findings?: {
        title?: string
        url?: string
        snippet?: string
        host?: string
        date?: string | null
        query?: string
        fetchedAt?: string | null
      }[]
    }[]
    history?: { fetchedAt?: string | null; totalFindings?: number; verdict?: string | null }[]
    law?: string | null
    ms?: number | null
  } | null
  content?: {
    verdict?: string | null
    draftedAt?: string | null
    draftsQueued?: number
    exposureBlocked?: number
    queue?: {
      id?: string
      title?: string
      body?: string
      tags?: string[]
      angle?: string
      seoNote?: string
      status?: string
      draftedAt?: string | null
      groundedOn?: string[]
    }[]
    law?: string | null
    bridgeError?: string | null
    ms?: number | null
  } | null
  rcTank?: {
    day?: string | null
    at?: string | null
    account?: string | null
    verdict?: string | null
    maxRc?: number | null
    rcPct?: number | null
    opsPerDayEquilibrium?: number | null
    prevDayMaxRc?: number | null
    growthPct?: number | null
    history?: { day?: string; maxRc?: number | null; opsPerDay?: number | null }[]
    scalingLaw?: string | null
  } | null
  /* T-23f · the payout clock + rewards scan (engine-computed, one-body law) — cockpit only renders.
   * Loose but honest: nullable exactly where the engine emits null. */
  payouts?: {
    day?: string | null
    at?: string | null
    account?: string | null
    verdict?: string | null
    pending?: { steem?: number; sbd?: number; vests?: number; any?: boolean } | null
    vp?: { pct?: number | null; hrsToFull?: number | null; regenPerSec?: number | null; vests?: number | null; basis?: string | null } | null
    payout?: { payoutDay?: string | null; msRemaining?: number | null; hoursRemaining?: number | null; daysRemaining?: number | null; phase?: string | null; law?: string | null } | null
    rollup?: {
      opsCount?: number | null
      claims?: number | null
      curationVests?: number | null
      authorSbd?: number | null
      authorSteem?: number | null
      authorVests?: number | null
      windowDays?: number | null
      oldestTs?: string | null
      newestTs?: string | null
      curationUsdPerDay?: number | null
      authorUsdPerDay?: number | null
      confidence?: 'measured' | 'estimated' | 'blocked' | string | null
      note?: string | null
    } | null
    scan?: {
      rewardOps?: number | null
      rewardApi?: string | null
      voteOps?: number | null
      votesScanned?: number | null
      firstVoteDay?: string | null
      unpaidTranches?: number | null
      unpaidCutoff?: string | null
      node?: string | null
    } | null
    history?: unknown[]
    law?: string | null
  } | null
  /* T-23f · the second-signer weave contract (engine-computed) — cockpit only renders. */
  weave?: {
    protocol?: string | null
    observedAt?: string | null
    account?: string | null
    day?: string | null
    ours?: { votesToday?: number | null; ordersLive?: number | null; fillsObserved?: number | null; journal?: string | null } | null
    theirs?: { votesToday?: number | null; lastVoteAt?: string | null; intervalMinEst?: number | null; ordersLive?: number | null; fillsObserved?: number | null; fingerprint?: string | null } | null
    arbitration?: {
      combined?: number | null
      sharedDayCap?: number | null
      capRemaining?: number | null
      capBasis?: string | null
      voteLanes?: { ours?: number | null; theirs?: number | null } | null
      orderLanes?: { ours?: number | null; theirs?: number | null } | null
      partitionLaw?: string | null
      collisionLaw?: string | null
      weightLaw?: string | null
    } | null
    handshake?: { status?: string | null; revision?: number | null; publishAt?: string | null; ourOffer?: string | null; request?: string | null } | null
    scan?: { rowsRead?: number | null; api?: string | null; node?: string | null } | null
    law?: string | null
  } | null
}

export type EngineResp = { ok?: boolean; health?: 'ok' | 'blocked' | 'fail'; failures?: { failedSteps?: string[]; blockedSteps?: string[] }; steps?: Record<string, { ok?: boolean; skipped?: boolean; verdict?: string; error?: string }>; rollup?: { measuredTotalUsdPerDay?: number | null; realizedSbd?: number | null }; finishedAt?: string; error?: string; engine?: string }

export type Sovereign = {
  ok?: boolean
  at?: string
  state?: {
    bootedAt?: string; pid?: number; paused?: boolean
    watchdog?: { checks?: number; downs?: number; heals?: number; healVerified?: number; healFailed?: number; engineUp?: boolean; lastSpawnAt?: string | null }
    cycles?: { autoRuns?: number; ok?: number; fail?: number; blocked?: number; lastAt?: string | null; lastOk?: boolean | null; lastHealth?: string | null; lastMs?: number | null; nextAt?: string | null }
    selftest?: { runs?: number; lastAt?: string | null; lastOk?: boolean | null; passed?: number | null; total?: number | null }
    cred?: { present?: boolean | null; firstDownAt?: string | null; lastDownAt?: string | null; alerts?: number; lastAlertAt?: string | null }
    custodian?: { checks?: number; downs?: number; heals?: number; healFailed?: number; lastCheckAt?: string | null; up?: boolean; lastUpAt?: string | null; lastSpawnAt?: string | null }
  }
  intervals?: { watchdogSec?: number; cycleSec?: number; selftestSec?: number }
  events?: { at?: string; kind?: string; [k: string]: unknown }[]
}
