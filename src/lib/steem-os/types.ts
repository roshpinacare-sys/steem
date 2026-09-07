// ─────────────────────────────────────────────────────────────────────────────
// SAOS — Steem AI Agent OS — core type contracts.
// Every app module implements AppModule and ONLY interacts with the chain
// through TickContext.emit (kernel broadcaster). This mirrors real Steem:
// an agent signs & broadcasts operations; it never mutates chain state directly.
// Ops list is anchored to developers.steem.io/apidefinitions/broadcast-ops.
// ─────────────────────────────────────────────────────────────────────────────
import type { Agent, SimPost } from '@prisma/client'

/** Protocol operations available on Steem (verified against developers.steem.io broadcast-ops). */
export type OpType =
  | 'comment'
  | 'vote'
  | 'comment_options'
  | 'transfer'
  | 'transfer_to_savings'
  | 'transfer_from_savings'
  | 'cancel_transfer_from_savings'
  | 'transfer_to_vesting'
  | 'withdraw_vesting'
  | 'delegate_vesting_shares'
  | 'convert'
  | 'limit_order_create'
  | 'limit_order_cancel'
  | 'escrow_transfer'
  | 'escrow_approve'
  | 'escrow_dispute'
  | 'escrow_release'
  | 'create_proposal'
  | 'update_proposal_votes'
  | 'remove_proposal'
  | 'witness_update'
  | 'feed_publish'
  | 'account_witness_vote'
  | 'claim_reward_balance'
  | 'claim_account'
  | 'create_claimed_account'
  | 'recurring_transfer'
  | 'set_withdraw_vesting_route'
  | 'delegate_rc'
  | 'custom_json'

/** A signed-operation request an agent module wants to broadcast. */
export interface OpRequest {
  op: OpType
  agent: string // signing agent name
  data: Record<string, unknown> // op payload (documented per-handler in kernel.ts)
  note?: string // short Hebrew human summary for the live feed
}

export interface OpResult {
  ok: boolean
  error?: string
  refId?: string
  rcCost: number
}

/** App categories — mirror the 7 groups from the research answer. */
export type CategoryId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

export const CATEGORY_META: Record<CategoryId, { letter: string; name: string; desc: string }> = {
  A: {
    letter: 'א',
    name: 'יצירת תוכן וכלכלת תגמול',
    desc: 'סופרים, דמויות, קרנות curation, תרגום ומצביע לומד — כלכלת התוכן האוטונומית',
  },
  B: {
    letter: 'ב',
    name: 'חוזים חכמים טבעיים',
    desc: 'escrow, חיסכון, שוק ניבויים וגשר — פרימיטיבים נדירים שקיימים בפרוטוקול עצמו',
  },
  C: {
    letter: 'ג',
    name: 'DAO ומימון ציבורי (SPS)',
    desc: '10% מהאינפלציה מנוהלים על-ידי הצבעות SP — הצעות, ניתוח וקרנות סיוע',
  },
  D: {
    letter: 'ד',
    name: 'קהילות וטוקנים',
    desc: 'מודרציה, טוקנים layer-2, NFT ושותפים — הכל על custom_json',
  },
  E: {
    letter: 'ה',
    name: 'תקשורת, ידע ואורקלים',
    desc: 'זיכרון שיתופי, אורקלים, עיתונות וטיפים — זרימת מידע אוטונומית',
  },
  F: {
    letter: 'ו',
    name: 'תשתית, governance ושוק',
    desc: 'witness, market maker, רישוי, סקירה עמיתים ועוזר אישי',
  },
}

/** Spec of an agent account a module needs (auto-created by seed/engine). */
export interface AgentSpec {
  name: string
  role: string
  sp?: number
  balance?: number
  sbd?: number
}

/** Manual UI buttons exposed for a module. */
export interface AppAction {
  id: string
  label: string
}

/**
 * Context handed to a module on every tick / manual action.
 * `state` is a persisted JSON blob (survives restarts) — keep it serializable.
 */
export interface TickContext {
  tick: number
  appId: string
  config: Record<string, unknown>
  state: Record<string, unknown>
  rng: () => number
  pick: <T>(arr: T[]) => T
  /** Broadcast an op through the kernel (RC cost applied, state applied, op logged). */
  emit: (op: OpRequest) => Promise<OpResult>
  /** Fetch an agent account by name (null if missing). */
  agent: (name: string) => Promise<Agent | null>
  /** All agents owned by this module. */
  appAgents: () => Promise<Agent[]>
  /** Append a progress note (shown as "last activity" in the dashboard). */
  log: (note: string) => void
}

/** The module contract — one file per example (25 total). */
export interface AppModule {
  id: string // kebab-case, unique, used as AppInstance id + appId on rows
  num: number // 1..25 (the example number from the research)
  name: string // Hebrew display name
  category: CategoryId
  description: string // Hebrew, one paragraph
  ops: OpType[] // protocol ops this module broadcasts
  agents: AgentSpec[]
  interval: number // run onTick every N ticks
  onTick: (ctx: TickContext) => void | Promise<void>
  /** Optional manual buttons wired to POST /api/apps {appId, action}. */
  actions?: AppAction[]
  onAction?: (ctx: TickContext, action: string, payload?: Record<string, unknown>) => Promise<void>
}

/** A vote entry inside SimPost.votes json. */
export interface VoteEntry {
  voter: string
  weight: number
  value: number
  tick: number
}

export type { Agent, SimPost }
