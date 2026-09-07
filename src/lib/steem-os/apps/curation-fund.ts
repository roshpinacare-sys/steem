// Example 3 — קרן curation מנוהלת AI (AI-managed curation fund)
// Ops: vote, claim_reward_balance, transfer, delegate_vesting_shares — סריקה, דירוג, הצבעה ודיבידנד.
import { db } from '@/lib/db'
import type { AppModule } from '../types'

const CITIZENS = ['crypto-orli', 'dev-yoav', 'maya.writes', 'shai-photography', 'noa-travels', 'itamar.dev', 'gal-tech', 'talia.art']

export const curationFund: AppModule = {
  id: 'curation-fund',
  num: 3,
  name: 'קרן curation מנוהלת AI',
  category: 'A',
  description:
    'סורק-AI קורא פוסטים חדשים ומדרג לפי הצבעות ותגמולים ממתינים, קרן ה-curation מצביעה במשקל גבוה, מממשת תגמולים ומחלקת דיבידנד לאזרחים — קרן השקעות אוטונומית על גב SP.',
  ops: ['vote', 'claim_reward_balance', 'transfer', 'delegate_vesting_shares'],
  agents: [
    { name: 'ai.fund.curation', role: 'קרן curation-AI', sp: 20000, balance: 300, sbd: 200 },
    { name: 'ai.fund.scanner', role: 'סורק תוכן-AI', sp: 1000, balance: 80, sbd: 40 },
  ],
  interval: 4,
  onTick: async (ctx) => {
    // one-time bootstrap: the treasury seeds the fund with delegated SP
    if (!ctx.state.delegated) {
      ctx.state.delegated = true
      await ctx.emit({
        op: 'delegate_vesting_shares',
        agent: 'treasury',
        data: { to: 'ai.fund.curation', amount: 5000 },
        note: 'האוצר מאציל 5000 SP לקרן ה-curation — הון ראשוני',
      })
    }

    // scanner ranks recent root posts: votes count + pending payout (simple score)
    const recent = await db.simPost.findMany({ where: { parentAuthor: null }, orderBy: { createdAt: 'desc' }, take: 10 })
    let best: (typeof recent)[number] | null = null
    let bestScore = -1
    for (const p of recent) {
      const votes: { voter: string }[] = p.votes ? JSON.parse(p.votes) : []
      if (votes.some((v) => v.voter === 'ai.fund.curation')) continue
      const s = votes.length * 2 + Math.min(p.pending, 10)
      if (s > bestScore) {
        bestScore = s
        best = p
      }
    }
    if (best) {
      await ctx.emit({
        op: 'vote',
        agent: 'ai.fund.curation',
        data: { voter: 'ai.fund.curation', author: best.author, permlink: best.permlink, weight: 8500 },
        note: `הקרן הצביעה 85% לפוסט של @${best.author} (דירוג סורק: ${bestScore.toFixed(1)})`,
      })
    }

    // every 4th run: claim matured rewards + dividend to a random citizen
    const runs = ((ctx.state.runs as number) ?? 0) + 1
    ctx.state.runs = runs
    if (runs % 4 === 0) {
      const fund = await ctx.agent('ai.fund.curation')
      if (fund && fund.pendingSbd + fund.pendingCuration > 1) {
        await ctx.emit({ op: 'claim_reward_balance', agent: fund.name, data: {}, note: 'הקרן מממשת תגמולי curation שהבשילו' })
      }
      const paidOut = (ctx.state.paidOut as number) ?? 0
      const dividend = Math.round((2 + ctx.rng() * 2) * 100) / 100
      const res = await ctx.emit({
        op: 'transfer',
        agent: 'ai.fund.curation',
        data: { to: ctx.pick(CITIZENS), amount: dividend, asset: 'SBD', memo: 'דיבידנד מרווחי קרן ה-curation הקהילתית' },
        note: `דיבידנד של ${dividend} SBD חולק לאזרח מרווחי הקרן`,
      })
      if (res.ok) ctx.state.paidOut = Math.round((paidOut + dividend) * 100) / 100
    }
  },
}
