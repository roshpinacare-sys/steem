// ─────────────────────────────────────────────────────────────────────────────
// SAOS module registry — the 25 examples.
// Task 2-a adds remaining modules ONLY in the marked section below.
// ─────────────────────────────────────────────────────────────────────────────
import type { AppModule } from '../types'
import { writersCollective } from './writers-collective'
import { escrowMarket } from './escrow-market'
import { spsFarm } from './sps-farm'
import { tippingBot } from './tipping-bot'
// Task 2-a imports (modules registered below in the marked section):
import { interactiveCharacters } from './interactive-characters'
import { curationFund } from './curation-fund'
import { translateNetwork } from './translate-network'
import { rlVoter } from './rl-voter'
import { aiTreasury } from './ai-treasury'
import { predictionMarket } from './prediction-market'
import { chainBridge } from './bridge'
import { quadraticDao } from './quadratic-dao'
import { mutualAid } from './mutual-aid'
import { aiCommunity } from './ai-community'
import { tokenEngine } from './token-engine'
import { nftGallery } from './nft-gallery'
import { affiliateNet } from './affiliate-net'
import { knowledgeGraph } from './knowledge-graph'
import { dataOracle } from './oracle'
import { newsNetwork } from './news-network'
import { aiWitness } from './ai-witness'
import { marketMaker } from './market-maker'
import { licensingAgent } from './licensing-agent'
import { peerReview } from './peer-review'
import { personalAssistant } from './personal-assistant'
// wave-3 solo engines (user's own live services):
import { soloFactory } from './solo-factory'
import { soloOracle } from './solo-oracle'

export const ALL_MODULES: AppModule[] = [
  writersCollective, // 1
  escrowMarket, // 6
  spsFarm, // 10
  tippingBot, // 20
  // ── TASK_2A_ADD_MODULES_HERE (keep numeric order by `num`) ──
  interactiveCharacters, // 2
  curationFund, // 3
  translateNetwork, // 4
  rlVoter, // 5
  aiTreasury, // 7
  predictionMarket, // 8
  chainBridge, // 9
  quadraticDao, // 11
  mutualAid, // 12
  aiCommunity, // 13
  tokenEngine, // 14
  nftGallery, // 15
  affiliateNet, // 16
  knowledgeGraph, // 17
  dataOracle, // 18
  newsNetwork, // 19
  aiWitness, // 21
  marketMaker, // 22
  licensingAgent, // 23
  peerReview, // 24
  personalAssistant, // 25
  soloFactory, // 26 — S2 account factory
  soloOracle, // 27 — S5 pay-to-ask oracle
]

export const MODULES_BY_ID: Record<string, AppModule> = Object.fromEntries(
  ALL_MODULES.map((m) => [m.id, m])
)
