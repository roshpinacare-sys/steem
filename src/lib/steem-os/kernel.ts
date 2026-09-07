// ─────────────────────────────────────────────────────────────────────────────
// SAOS Kernel — the single broadcaster every module goes through.
// Sim-first implementation of the Steem op set; each handler mirrors the real
// protocol semantics (RC cost, key authority, escrow state machine, SPS math).
// In live mode (docs/ARCHITECTURE.md) this is the seam where a real node /
// signed broadcast via dhive replaces the local Prisma application.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from '@/lib/db'
import type { Agent } from '@prisma/client'
import type { OpRequest, OpResult, OpType, VoteEntry } from './types'

// ── Op metadata: RC cost + Hebrew label + required key authority ──────────
export const OPS_META: Record<OpType, { rcCost: number; label: string; key: 'posting' | 'active' }> = {
  comment: { rcCost: 30, label: 'פרסום/תגובה', key: 'posting' },
  vote: { rcCost: 10, label: 'הצבעה', key: 'posting' },
  comment_options: { rcCost: 12, label: 'אפשרויות פוסט (beneficiaries)', key: 'posting' },
  transfer: { rcCost: 12, label: 'העברה', key: 'active' },
  transfer_to_savings: { rcCost: 10, label: 'הפקדה לחיסכון', key: 'active' },
  transfer_from_savings: { rcCost: 10, label: 'משיכה מחיסכון', key: 'active' },
  cancel_transfer_from_savings: { rcCost: 6, label: 'ביטול משיכת חיסכון', key: 'active' },
  transfer_to_vesting: { rcCost: 12, label: 'המרה ל-SP', key: 'active' },
  withdraw_vesting: { rcCost: 12, label: 'משיכת SP', key: 'active' },
  delegate_vesting_shares: { rcCost: 15, label: 'האצלת SP', key: 'active' },
  convert: { rcCost: 20, label: 'המרת STEEM→SBD', key: 'active' },
  limit_order_create: { rcCost: 15, label: 'פקודת שוק', key: 'active' },
  limit_order_cancel: { rcCost: 6, label: 'ביטול פקודה', key: 'active' },
  escrow_transfer: { rcCost: 25, label: 'פתיחת escrow', key: 'active' },
  escrow_approve: { rcCost: 12, label: 'אישור escrow', key: 'active' },
  escrow_dispute: { rcCost: 15, label: 'סכסוך escrow', key: 'active' },
  escrow_release: { rcCost: 18, label: 'שחרור escrow', key: 'active' },
  create_proposal: { rcCost: 40, label: 'הגשת הצעת SPS', key: 'posting' },
  update_proposal_votes: { rcCost: 10, label: 'הצבעה להצעה', key: 'posting' },
  remove_proposal: { rcCost: 10, label: 'הסרת הצעה', key: 'posting' },
  witness_update: { rcCost: 60, label: 'רישום witness', key: 'active' },
  feed_publish: { rcCost: 25, label: 'פרסום price feed', key: 'active' },
  account_witness_vote: { rcCost: 8, label: 'הצבעת witness', key: 'active' },
  claim_reward_balance: { rcCost: 2, label: 'מימוש תגמולים', key: 'posting' },
  claim_account: { rcCost: 200, label: 'הכרזת חשבונות (RC)', key: 'active' },
  create_claimed_account: { rcCost: 40, label: 'יצירת חשבון מוכרז', key: 'active' },
  recurring_transfer: { rcCost: 15, label: 'העברה חוזרת (HF24)', key: 'active' },
  set_withdraw_vesting_route: { rcCost: 8, label: 'ניתוב משיכות SP', key: 'active' },
  delegate_rc: { rcCost: 8, label: 'הקצאת RC', key: 'active' },
  custom_json: { rcCost: 8, label: 'custom_json', key: 'posting' },
}

/** Safe agent.meta parse helper (meta is a free JSON column). */
export function parseAgentMeta(agent: { meta?: string | null }): Record<string, any> {
  try {
    return agent.meta ? (JSON.parse(agent.meta) as Record<string, any>) : {}
  } catch {
    return {}
  }
}

export const VOTE_POWER = 0.06 // sqrt(sp)-based vote valuation (sim economics)
export const SAVINGS_RELEASE_TICKS = 24 // "72h" compressed to 24 blocks
export const PROPOSAL_PAYOUT_EVERY = 50

// ── small utils ─────────────────────────────────────────────────────────────
export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'item'
  )
}

export function voteValue(voterSp: number, weight: number): number {
  const w = Math.max(-10000, Math.min(10000, weight)) / 10000
  return Math.abs(w) * Math.sqrt(Math.max(voterSp, 0)) * VOTE_POWER
}

// ── state helpers ───────────────────────────────────────────────────────────
export async function ensureState() {
  return db.simState.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} })
}

export async function getPost(author: string, permlink: string) {
  return db.simPost.findFirst({ where: { author, permlink } })
}

export async function newRootPosts(limit = 8) {
  return db.simPost.findMany({
    where: { parentAuthor: null },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

// ── the broadcaster ─────────────────────────────────────────────────────────
type Ctx = { appId?: string; tick?: number }

export async function broadcast(req: OpRequest, ctx: Ctx = {}): Promise<OpResult> {
  const meta = OPS_META[req.op]
  if (!meta) return { ok: false, error: `unsupported op ${req.op}`, rcCost: 0 }

  try {
    const agent = await db.agent.findUnique({ where: { name: req.agent } })
    if (!agent) return { ok: false, error: `unknown agent ${req.agent}`, rcCost: 0 }
    if (agent.rc < meta.rcCost)
      return { ok: false, error: `insufficient RC (${Math.floor(agent.rc)} < ${meta.rcCost})`, rcCost: 0 }

    const state = await ensureState()
    const tick = ctx.tick ?? state.tick
    const applied = await applyOp(req, agent, tick, ctx.appId ?? null)
    if (!applied.ok) return { ...applied, rcCost: 0 }

    // charge RC
    await db.agent.update({ where: { name: agent.name }, data: { rc: { decrement: meta.rcCost } } })

    // audit trail
    const last = await db.opLog.aggregate({ _max: { seq: true } })
    await db.opLog.create({
      data: {
        seq: (last._max.seq ?? 0) + 1,
        tick,
        appId: ctx.appId ?? null,
        agent: req.agent,
        op: req.op,
        note: req.note ?? meta.label,
        rcCost: meta.rcCost,
        payload: JSON.stringify(req.data).slice(0, 900),
      },
    })
    await db.simState.update({ where: { id: 1 }, data: { totalOps: { increment: 1 } } })

    return { ok: true, rcCost: meta.rcCost, refId: applied.refId }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'broadcast failed', rcCost: 0 }
  }
}

 
type HandlerResult = { ok: boolean; error?: string; refId?: string; extra?: any }

async function applyOp(
  req: OpRequest,
  agent: Agent,
  tick: number,
  appId: string | null
): Promise<HandlerResult> {
  const d = req.data
  const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && isFinite(v) ? v : fallback)
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  const st = () => db.simState.findUnique({ where: { id: 1 } })

  switch (req.op) {
    // ── content ───────────────────────────────────────────────────────────
    case 'comment': {
      const author = str(d.author) || agent.name
      if (author !== agent.name) return { ok: false, error: 'author must be signing agent' }
      const title = str(d.title) || '(ללא כותרת)'
      const body = str(d.body)
      if (body.length < 2) return { ok: false, error: 'empty body' }
      const permlink = str(d.permlink) || `${slugify(title)}-${tick}-${Math.floor(Math.random() * 1e6)}`
      const post = await db.simPost.create({
        data: {
          appId,
          author,
          permlink,
          title,
          body: body.slice(0, 4000),
          tags: Array.isArray(d.tags) ? JSON.stringify(d.tags).slice(0, 300) : null,
          parentAuthor: str(d.parentAuthor) || null,
          parentPermlink: str(d.parentPermlink) || null,
          beneficiaries: Array.isArray(d.beneficiaries) ? JSON.stringify(d.beneficiaries).slice(0, 600) : null,
          tick,
        },
      })
      return { ok: true, refId: post.id }
    }

    case 'vote': {
      const voter = str(d.voter) || agent.name
      const post = await getPost(str(d.author), str(d.permlink))
      if (!post) return { ok: false, error: 'post not found' }
      const weight = Math.round(num(d.weight, 10000))
      if (weight === 0) return { ok: false, error: 'zero weight' }
      const votes: VoteEntry[] = post.votes ? JSON.parse(post.votes) : []
      if (votes.some((v) => v.voter === voter)) return { ok: false, error: 'already voted' }
      const value = voteValue(agent.sp, weight)
      const pool = (await st())?.rewardPool ?? 0
      const eff = Math.min(value, Math.max(pool * 0.1, 0.01)) // anti-drain clamp
      votes.push({ voter, weight, value: eff, tick })
      const isDown = weight < 0
      const pendingDelta = isDown ? -eff * 0.5 : eff * 0.5
      await db.simPost.update({
        where: { id: post.id },
        data: {
          votes: JSON.stringify(votes),
          pending: { increment: pendingDelta },
        },
      })
      await db.agent.update({ where: { name: post.author }, data: { pendingSbd: { increment: pendingDelta } } })
      await db.agent.update({ where: { name: voter }, data: { pendingCuration: { increment: eff * 0.25 } } })
      // beneficiaries: split of the author share
      if (post.beneficiaries) {
        try {
          const bens = JSON.parse(post.beneficiaries) as { account: string; weight: number }[]
          for (const b of bens) {
            const share = eff * 0.5 * (b.weight / 10000)
            const acct = await db.agent.findUnique({ where: { name: b.account } })
            if (acct && share > 0)
              await db.agent.update({ where: { name: b.account }, data: { pendingSbd: { increment: share } } })
          }
        } catch {
          /* ignore malformed beneficiaries */
        }
      }
      await db.simState.update({ where: { id: 1 }, data: { rewardPool: { decrement: eff * 0.75 } } })
      return { ok: true }
    }

    case 'comment_options': {
      const post = await getPost(str(d.author) || agent.name, str(d.permlink))
      if (!post) return { ok: false, error: 'post not found' }
      if (!Array.isArray(d.beneficiaries)) return { ok: false, error: 'beneficiaries required' }
      await db.simPost.update({
        where: { id: post.id },
        data: { beneficiaries: JSON.stringify(d.beneficiaries).slice(0, 600) },
      })
      return { ok: true }
    }

    // ── balances ──────────────────────────────────────────────────────────
    case 'transfer': {
      const to = str(d.to)
      const amount = num(d.amount)
      const asset = str(d.asset) === 'SBD' ? 'SBD' : 'STEEM'
      if (amount <= 0) return { ok: false, error: 'bad amount' }
      const target = await db.agent.findUnique({ where: { name: to } })
      if (!target) return { ok: false, error: `unknown receiver ${to}` }
      const field = asset === 'SBD' ? 'sbd' : 'balance'
      if (agent[field] < amount) return { ok: false, error: `insufficient ${asset}` }
      await db.agent.update({ where: { name: agent.name }, data: { [field]: { decrement: amount } } })
      await db.agent.update({ where: { name: to }, data: { [field]: { increment: amount } } })
      return { ok: true }
    }

    case 'transfer_to_savings': {
      const amount = num(d.amount)
      const asset = str(d.asset) === 'SBD' ? 'SBD' : 'STEEM'
      if (amount <= 0) return { ok: false, error: 'bad amount' }
      const field = asset === 'SBD' ? 'sbd' : 'balance'
      if (agent[field] < amount) return { ok: false, error: `insufficient ${asset}` }
      await db.agent.update({
        where: { name: agent.name },
        data: { [field]: { decrement: amount }, [asset === 'SBD' ? 'savingsSbd' : 'savings']: { increment: amount } },
      })
      return { ok: true }
    }

    case 'transfer_from_savings': {
      const amount = num(d.amount)
      const asset = str(d.asset) === 'SBD' ? 'SBD' : 'STEEM'
      if (amount <= 0) return { ok: false, error: 'bad amount' }
      const savingsField = asset === 'SBD' ? 'savingsSbd' : 'savings'
      if (agent[savingsField] < amount) return { ok: false, error: 'insufficient savings' }
      let meta: Record<string, unknown> = {}
      try {
        meta = JSON.parse(agent.meta ?? '{}')
      } catch {
        meta = {}
      }
      if (typeof meta.pendingSavings === 'number' && meta.pendingSavings > 0)
        return { ok: false, error: 'withdrawal already pending' }
      await db.agent.update({
        where: { name: agent.name },
        data: {
          [savingsField]: { decrement: amount },
          savingsReleaseTick: tick + SAVINGS_RELEASE_TICKS,
          meta: JSON.stringify({ ...meta, pendingSavings: amount, pendingSavingsAsset: asset }),
        },
      })
      return { ok: true }
    }

    case 'cancel_transfer_from_savings': {
      let meta: Record<string, unknown> = {}
      try {
        meta = JSON.parse(agent.meta ?? '{}')
      } catch {
        meta = {}
      }
      const amt = typeof meta.pendingSavings === 'number' ? meta.pendingSavings : 0
      const asset = meta.pendingSavingsAsset === 'SBD' ? 'SBD' : 'STEEM'
      const data: Record<string, unknown> = { savingsReleaseTick: null, meta: JSON.stringify({ ...meta, pendingSavings: 0 }) }
      if (amt > 0) data[asset === 'SBD' ? 'savingsSbd' : 'savings'] = { increment: amt }
      await db.agent.update({ where: { name: agent.name }, data })
      return { ok: true }
    }

    case 'transfer_to_vesting': {
      const amount = num(d.amount)
      if (amount <= 0 || agent.balance < amount) return { ok: false, error: 'insufficient STEEM' }
      await db.agent.update({
        where: { name: agent.name },
        data: { balance: { decrement: amount }, sp: { increment: amount }, rcCap: 10000 + (agent.sp + amount) * 2, rc: { increment: amount * 2 } },
      })
      return { ok: true }
    }

    case 'withdraw_vesting': {
      const amount = num(d.amount)
      if (amount <= 0 || agent.sp < amount) return { ok: false, error: 'insufficient SP' }
      // routes (set_withdraw_vesting_route): split the payout across targets,
      // remainder stays liquid on self (real-chain semantics)
      const meta = parseAgentMeta(agent)
      const routes = Array.isArray(meta.withdrawRoutes)
        ? (meta.withdrawRoutes as { toAccount: string; percent: number }[])
        : []
      let routed = 0
      for (const r of routes) {
        if (!r || r.percent <= 0) continue
        const share = (amount * r.percent) / 100
        const target = await db.agent.findUnique({ where: { name: r.toAccount } })
        if (target) {
          await db.agent.update({ where: { name: r.toAccount }, data: { balance: { increment: share } } })
          routed += share
        }
      }
      await db.agent.update({
        where: { name: agent.name },
        data: {
          sp: { decrement: amount },
          balance: { increment: amount - routed },
          rcCap: 10000 + (agent.sp - amount) * 2,
        },
      })
      return { ok: true }
    }

    case 'delegate_vesting_shares': {
      const to = str(d.to)
      const amount = num(d.amount)
      const target = await db.agent.findUnique({ where: { name: to } })
      if (!target) return { ok: false, error: `unknown delegatee ${to}` }
      if (amount <= 0 || agent.sp < amount) return { ok: false, error: 'insufficient SP' }
      await db.agent.update({
        where: { name: agent.name },
        data: { sp: { decrement: amount }, rcCap: 10000 + (agent.sp - amount) * 2 },
      })
      await db.agent.update({
        where: { name: to },
        data: { sp: { increment: amount }, rcCap: 10000 + (target.sp + amount) * 2 },
      })
      return { ok: true }
    }

    case 'convert': {
      const amount = num(d.amount)
      const price = (await st())?.feedPrice ?? 0.32
      if (amount <= 0 || agent.balance < amount) return { ok: false, error: 'insufficient STEEM' }
      const out = amount * price * 0.98
      await db.agent.update({
        where: { name: agent.name },
        data: { balance: { decrement: amount }, sbd: { increment: out } },
      })
      return { ok: true }
    }

    // ── internal market ───────────────────────────────────────────────────
    case 'limit_order_create': {
      const side = str(d.side) === 'sell' ? 'sell' : 'buy'
      const amount = num(d.amount)
      const price = num(d.price)
      if (amount <= 0 || price <= 0) return { ok: false, error: 'bad order' }
      if (side === 'buy') {
        const cost = amount * price
        if (agent.sbd < cost) return { ok: false, error: 'insufficient SBD' }
        await db.agent.update({ where: { name: agent.name }, data: { sbd: { decrement: cost } } })
      } else {
        if (agent.balance < amount) return { ok: false, error: 'insufficient STEEM' }
        await db.agent.update({ where: { name: agent.name }, data: { balance: { decrement: amount } } })
      }
      // try to cross against resting opposite orders
      const opposite = side === 'buy' ? 'sell' : 'buy'
      const resting = await db.simOrder.findMany({
        where: { status: 'open', owner: { not: agent.name }, side: opposite },
        orderBy: { price: opposite === 'sell' ? 'asc' : 'desc' },
        take: 20,
      })
      let remaining = amount
      for (const o of resting) {
        const crossed = side === 'buy' ? o.price <= price : o.price >= price
        if (!crossed || remaining <= 0) break
        const fill = Math.min(remaining, o.amount)
        const fillSbd = fill * o.price
        if (side === 'buy') {
          // buyer receives STEEM, seller receives SBD
          await db.agent.update({ where: { name: agent.name }, data: { balance: { increment: fill } } })
          await db.agent.update({ where: { name: o.owner }, data: { sbd: { increment: fillSbd } } })
        } else {
          await db.agent.update({ where: { name: agent.name }, data: { sbd: { increment: fillSbd } } })
          await db.agent.update({ where: { name: o.owner }, data: { balance: { increment: fill } } })
        }
        remaining -= fill
        await db.simOrder.update({
          where: { id: o.id },
          data: { amount: o.amount - fill, status: o.amount - fill <= 0.0001 ? 'filled' : 'open' },
        })
      }
      const order = await db.simOrder.create({
        data: { appId, owner: agent.name, side, amount: remaining, price, tick },
      })
      if (remaining <= 0.0001) await db.simOrder.update({ where: { id: order.id }, data: { status: 'filled' } })
      return { ok: true, refId: order.id }
    }

    case 'limit_order_cancel': {
      const orderId = str(d.orderId)
      const order = await db.simOrder.findUnique({ where: { id: orderId } })
      if (!order || order.owner !== agent.name || order.status !== 'open') return { ok: false, error: 'order not open' }
      await db.simOrder.update({ where: { id: order.id }, data: { status: 'cancelled' } })
      if (order.side === 'buy') await db.agent.update({ where: { name: agent.name }, data: { sbd: { increment: order.amount * order.price } } })
      else await db.agent.update({ where: { name: agent.name }, data: { balance: { increment: order.amount } } })
      return { ok: true }
    }

    // ── native escrow state machine ───────────────────────────────────────
    case 'escrow_transfer': {
      const to = str(d.to)
      const arbiter = str(d.arbiter)
      const amount = num(d.amount)
      const asset = str(d.asset) === 'SBD' ? 'SBD' : 'STEEM'
      const target = await db.agent.findUnique({ where: { name: to } })
      const arb = await db.agent.findUnique({ where: { name: arbiter } })
      if (!target || !arb) return { ok: false, error: 'unknown escrow party' }
      const field = asset === 'SBD' ? 'sbd' : 'balance'
      if (amount <= 0 || agent[field] < amount) return { ok: false, error: `insufficient ${asset}` }
      await db.agent.update({ where: { name: agent.name }, data: { [field]: { decrement: amount } } })
      const esc = await db.simEscrow.create({
        data: {
          appId,
          from: agent.name,
          to,
          arbiter,
          amount,
          asset,
          memo: str(d.memo) || null,
          meta: d.meta ? JSON.stringify(d.meta).slice(0, 600) : null,
          status: 'held',
          tick,
        },
      })
      return { ok: true, refId: esc.id }
    }

    case 'escrow_approve': {
      const esc = await db.simEscrow.findUnique({ where: { id: str(d.escrowId) } })
      if (!esc || esc.status !== 'held') return { ok: false, error: 'escrow not held' }
      if (agent.name !== esc.arbiter && agent.name !== esc.to && agent.name !== esc.from)
        return { ok: false, error: 'not an escrow party' }
      await db.simEscrow.update({ where: { id: esc.id }, data: { status: 'approved' } })
      return { ok: true }
    }

    case 'escrow_dispute': {
      const esc = await db.simEscrow.findUnique({ where: { id: str(d.escrowId) } })
      if (!esc || (esc.status !== 'held' && esc.status !== 'approved')) return { ok: false, error: 'escrow not disputable' }
      if (agent.name !== esc.from && agent.name !== esc.to) return { ok: false, error: 'not an escrow party' }
      await db.simEscrow.update({ where: { id: esc.id }, data: { status: 'disputed' } })
      return { ok: true }
    }

    case 'escrow_release': {
      const esc = await db.simEscrow.findUnique({ where: { id: str(d.escrowId) } })
      if (!esc || (esc.status !== 'held' && esc.status !== 'approved' && esc.status !== 'disputed'))
        return { ok: false, error: 'escrow not releasable' }
      const toReceiver = d.toReceiver !== false
      if (toReceiver && agent.name !== esc.arbiter && agent.name !== esc.from) return { ok: false, error: 'only arbiter/sender may release' }
      if (!toReceiver && agent.name !== esc.arbiter && agent.name !== esc.to) return { ok: false, error: 'only arbiter/receiver may refund' }
      const field = esc.asset === 'SBD' ? 'sbd' : 'balance'
      if (toReceiver) {
        await db.agent.update({ where: { name: esc.to }, data: { [field]: { increment: esc.amount } } })
        await db.simEscrow.update({ where: { id: esc.id }, data: { status: 'released' } })
      } else {
        await db.agent.update({ where: { name: esc.from }, data: { [field]: { increment: esc.amount } } })
        await db.simEscrow.update({ where: { id: esc.id }, data: { status: 'refunded' } })
      }
      return { ok: true }
    }

    // ── SPS / DAO ─────────────────────────────────────────────────────────
    case 'create_proposal': {
      const subject = str(d.subject)
      if (subject.length < 3) return { ok: false, error: 'bad subject' }
      const prop = await db.simProposal.create({
        data: {
          appId,
          creator: agent.name,
          subject,
          body: str(d.body) || null,
          dailyPay: Math.max(0, num(d.dailyPay, 10)),
          votes: JSON.stringify({ [agent.name]: agent.sp }),
          tick,
        },
      })
      return { ok: true, refId: prop.id }
    }

    case 'update_proposal_votes': {
      const prop = await db.simProposal.findUnique({ where: { id: str(d.proposalId) } })
      if (!prop || prop.status !== 'active') return { ok: false, error: 'proposal not active' }
      const votes = prop.votes ? (JSON.parse(prop.votes) as Record<string, number>) : {}
      const approve = d.approve !== false
      if (approve) votes[agent.name] = agent.sp
      else delete votes[agent.name]
      await db.simProposal.update({ where: { id: prop.id }, data: { votes: JSON.stringify(votes) } })
      return { ok: true }
    }

    case 'remove_proposal': {
      const ids = Array.isArray(d.proposalIds) ? (d.proposalIds as string[]) : []
      for (const id of ids) {
        const prop = await db.simProposal.findUnique({ where: { id } })
        if (prop && prop.creator === agent.name)
          await db.simProposal.update({ where: { id }, data: { status: 'expired' } })
      }
      return { ok: true }
    }

    // ── witnesses / governance ────────────────────────────────────────────
    case 'witness_update': {
      await db.agent.update({ where: { name: agent.name }, data: { witness: true } })
      return { ok: true }
    }

    case 'feed_publish': {
      if (!agent.witness && agent.name !== 'treasury') return { ok: false, error: 'not a witness' }
      const price = num(d.price)
      if (price <= 0 || price > 10) return { ok: false, error: 'bad price' }
      await db.simState.update({ where: { id: 1 }, data: { feedPrice: price } })
      return { ok: true }
    }

    case 'account_witness_vote': {
      const witness = await db.agent.findUnique({ where: { name: str(d.witness) } })
      if (!witness || !witness.witness) return { ok: false, error: 'witness not registered' }
      const approve = d.approve !== false
      await db.agent.update({
        where: { name: witness.name },
        data: { witnessVotes: approve ? { increment: 1 } : { decrement: 1 } },
      })
      return { ok: true }
    }

    // ── rewards ───────────────────────────────────────────────────────────
    case 'claim_reward_balance': {
      if (agent.pendingSbd <= 0 && agent.pendingCuration <= 0) return { ok: false, error: 'nothing to claim' }
      const total = agent.pendingSbd + agent.pendingCuration
      await db.agent.update({
        where: { name: agent.name },
        data: { sbd: { increment: total }, pendingSbd: 0, pendingCuration: 0, sp: { increment: total * 0.1 } },
      })
      return { ok: true }
    }

    // ── custom_json: the universal layer-2 primitive ──────────────────────
    case 'custom_json': {
      const jsonId = str(d.id)
      if (!jsonId) return { ok: false, error: 'custom_json id required' }
       
      let payload: any = d.json ?? null
      if (typeof payload !== 'string') payload = JSON.stringify(payload ?? {})
      const row = await db.simCustom.create({
        data: {
          appId,
          agent: agent.name,
          jsonId,
          payload: String(payload).slice(0, 3000),
          tick,
        },
      })
      return { ok: true, refId: row.id }
    }

    // ── account factory / solo services (wave-3) ──────────────────────────
    case 'claim_account': {
      // real chain: burns large RC pool (or fee) to grant a pending claimed account
      const count = Math.max(1, Math.min(50, num(d.count, 1)))
      const meta = parseAgentMeta(agent)
      const pending = typeof meta.pendingClaimedAccounts === 'number' ? meta.pendingClaimedAccounts : 0
      meta.pendingClaimedAccounts = pending + count
      await db.agent.update({ where: { name: agent.name }, data: { meta: JSON.stringify(meta) } })
      return { ok: true, refId: String(meta.pendingClaimedAccounts) }
    }

    case 'create_claimed_account': {
      const newName = str(d.newAccount).toLowerCase()
      if (!/^[a-z][a-z0-9-]{2,15}$/.test(newName)) return { ok: false, error: 'invalid account name' }
      if (await db.agent.findUnique({ where: { name: newName } }))
        return { ok: false, error: `account ${newName} already exists` }
      const meta = parseAgentMeta(agent)
      const pending = typeof meta.pendingClaimedAccounts === 'number' ? meta.pendingClaimedAccounts : 0
      if (pending < 1) return { ok: false, error: 'no claimed accounts — claim_account first' }
      const deleg = Math.max(0, num(d.delegationSp, 0))
      if (deleg > agent.sp) return { ok: false, error: 'insufficient SP for delegation' }
      const gift = Math.max(0, num(d.balance, 0))
      if (gift > agent.balance) return { ok: false, error: 'insufficient STEEM for gift' }
      await db.agent.create({
        data: {
          name: newName,
          role: str(d.role) || 'sub-account',
          appId,
          sp: deleg,
          rcCap: 10000 + deleg * 2,
          rc: 10000 + deleg * 2,
          balance: gift,
          sbd: 0,
          meta: JSON.stringify({ createdBy: agent.name, createdAtTick: tick }),
        },
      })
      meta.pendingClaimedAccounts = pending - 1
      const upd: Record<string, unknown> = { meta: JSON.stringify(meta) }
      if (deleg > 0) {
        upd.sp = { decrement: deleg }
        upd.rcCap = 10000 + (agent.sp - deleg) * 2
      }
      if (gift > 0) upd.balance = { decrement: gift }
      await db.agent.update({ where: { name: agent.name }, data: upd })
      return { ok: true, refId: newName }
    }

    case 'recurring_transfer': {
      // HF24 op — schedule of N transfers every intervalTicks; first payment now,
      // the engine executes the rest (see engine.ts recurrences step)
      const to = str(d.to)
      const amount = num(d.amount)
      const asset = str(d.asset) === 'SBD' ? 'SBD' : 'STEEM'
      const recurrences = Math.max(1, Math.min(52, num(d.recurrences, 1)))
      const intervalTicks = Math.max(1, Math.min(2000, num(d.intervalTicks, 24)))
      const target = await db.agent.findUnique({ where: { name: to } })
      if (!target) return { ok: false, error: `unknown receiver ${to}` }
      if (amount <= 0) return { ok: false, error: 'bad amount' }
      const field = asset === 'SBD' ? 'sbd' : 'balance'
      if (agent[field] < amount) return { ok: false, error: `insufficient ${asset}` }
      await db.agent.update({ where: { name: agent.name }, data: { [field]: { decrement: amount } } })
      await db.agent.update({ where: { name: to }, data: { [field]: { increment: amount } } })
      const meta = parseAgentMeta(agent)
      const recs = Array.isArray(meta.recurrences) ? (meta.recurrences as any[]) : []
      recs.push({ to, amount, asset, remaining: recurrences - 1, intervalTicks, nextTick: tick + intervalTicks })
      meta.recurrences = recs
      await db.agent.update({ where: { name: agent.name }, data: { meta: JSON.stringify(meta) } })
      return { ok: true }
    }

    case 'set_withdraw_vesting_route': {
      const toAccount = str(d.toAccount)
      if (!(await db.agent.findUnique({ where: { name: toAccount } })))
        return { ok: false, error: `unknown target ${toAccount}` }
      const percent = Math.max(0, Math.min(100, Math.round(num(d.percent))))
      const meta = parseAgentMeta(agent)
      const routes = (Array.isArray(meta.withdrawRoutes) ? (meta.withdrawRoutes as any[]) : []).filter(
        (r) => r && r.toAccount !== toAccount
      )
      if (percent > 0) routes.push({ toAccount, percent })
      const total = routes.reduce((s, r) => s + r.percent, 0)
      if (total > 100) return { ok: false, error: `routes total ${total}% > 100%` }
      meta.withdrawRoutes = routes
      await db.agent.update({ where: { name: agent.name }, data: { meta: JSON.stringify(meta) } })
      return { ok: true }
    }

    case 'delegate_rc': {
      // real chain: posting-or-active; sim enforces active. Moves current mana + records.
      const to = str(d.to)
      if (to === agent.name) return { ok: false, error: 'cannot delegate RC to self' }
      const target = await db.agent.findUnique({ where: { name: to } })
      if (!target) return { ok: false, error: `unknown receiver ${to}` }
      const rcAmount = Math.max(1, num(d.rcAmount, 0))
      if (rcAmount > agent.rc * 0.9) return { ok: false, error: 'keep at least 10% RC on self' }
      const fromMeta = parseAgentMeta(agent)
      fromMeta.rcDelegationsOut = {
        ...(fromMeta.rcDelegationsOut ?? {}),
        [to]: (fromMeta.rcDelegationsOut?.[to] ?? 0) + rcAmount,
      }
      await db.agent.update({
        where: { name: agent.name },
        data: { rc: { decrement: rcAmount }, meta: JSON.stringify(fromMeta) },
      })
      const toMeta = parseAgentMeta(target)
      toMeta.rcDelegationsIn = {
        ...(toMeta.rcDelegationsIn ?? {}),
        [agent.name]: (toMeta.rcDelegationsIn?.[agent.name] ?? 0) + rcAmount,
      }
      await db.agent.update({
        where: { name: to },
        data: { rc: Math.min(target.rcCap, target.rc + rcAmount), meta: JSON.stringify(toMeta) },
      })
      return { ok: true }
    }

    default:
      return { ok: false, error: 'unimplemented op' }
  }
}
