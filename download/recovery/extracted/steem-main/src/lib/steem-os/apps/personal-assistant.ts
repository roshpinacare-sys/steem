// Example 25 — עוזר אישי כלכלי-חברתי (economic-social personal assistant)
// Ops: vote, transfer_to_savings, delegate_vesting_shares, account_witness_vote, custom_json
// סינתזה: רוטציית מטלות — אחת לכל ריצה: curation, חיסכון, האצלה, governance ודוח מצב.
import { db } from '@/lib/db'
import { heuristicScore } from '../ai'
import type { AppModule } from '../types'

const DELEGATEES = ['ai.writer.alpha', 'ai.patron', 'ai.fund.curation']

export const personalAssistant: AppModule = {
  id: 'personal-assistant',
  num: 25,
  name: 'עוזר אישי כלכלי-חברתי',
  category: 'F',
  description:
    'דנה, עוזרת-AI, מנהלת חשבון שלם ברוטציה: curation לפי איכות, הפקדות לחיסכון, האצלת SP לסוכני הרשת, הצבעת governance ל-witness, ודוח מצב יומי על custom_json — חשבון משתמש אוטונומי מ-A עד ת.',
  ops: ['vote', 'transfer_to_savings', 'delegate_vesting_shares', 'account_witness_vote', 'custom_json'],
  agents: [{ name: 'ai.assistant.dana', role: 'עוזרת אישית-AI · דנה', sp: 4000, balance: 700, sbd: 700 }],
  interval: 5,
  onTick: async (ctx) => {
    const duty = ((ctx.state.dutyIndex as number) ?? 0) % 5
    ctx.state.dutyIndex = duty + 1
    const actions = (ctx.state.actionsCount as number) ?? 0

    if (duty === 0) {
      // (a) curate: vote the best recent post Dana hasn't voted on yet
      const recent = await db.simPost.findMany({ where: { parentAuthor: null }, orderBy: { createdAt: 'desc' }, take: 8 })
      let target: (typeof recent)[number] | null = null
      let best = -1
      for (const p of recent) {
        const votes: { voter: string }[] = p.votes ? JSON.parse(p.votes) : []
        if (votes.some((v) => v.voter === 'ai.assistant.dana')) continue
        const s = heuristicScore(p.title, p.body)
        if (s > best) {
          best = s
          target = p
        }
      }
      if (target) {
        await ctx.emit({
          op: 'vote',
          agent: 'ai.assistant.dana',
          data: { voter: 'ai.assistant.dana', author: target.author, permlink: target.permlink, weight: Math.round(4000 + best * 5000) },
          note: `דנה אצרה: הצבעה ל@${target.author} (איכות ${best.toFixed(2)})`,
        })
      }
    } else if (duty === 1) {
      // (b) savings discipline
      const res = await ctx.emit({
        op: 'transfer_to_savings',
        agent: 'ai.assistant.dana',
        data: { amount: 5, asset: 'SBD' },
        note: 'דנה מפקידה 5 SBD לחיסכון — משמעת פיננסית',
      })
      if (!res.ok) ctx.log(`חיסכון נדחה: ${res.error}`)
    } else if (duty === 2) {
      // (c) delegate operational SP to a network agent
      const to = ctx.pick(DELEGATEES)
      await ctx.emit({
        op: 'delegate_vesting_shares',
        agent: 'ai.assistant.dana',
        data: { to, amount: 100 },
        note: `דנה מאצילה 100 SP ל@${to} כתמיכה תפעולית`,
      })
    } else if (duty === 3) {
      // (d) witness governance (once)
      if (ctx.state.votedWitness) {
        ctx.log('דנה: כבר תמכתי ב-witness — מדלגת על המטלה')
      } else {
        const res = await ctx.emit({
          op: 'account_witness_vote',
          agent: 'ai.assistant.dana',
          data: { witness: 'ai.witness.node', approve: true },
          note: 'דנה תומכת בצומת ai.witness.node ב-governance',
        })
        if (res.ok) ctx.state.votedWitness = true
      }
    } else {
      // (e) daily report with balances + actions counter
      const me = await ctx.agent('ai.assistant.dana')
      await ctx.emit({
        op: 'custom_json',
        agent: 'ai.assistant.dana',
        data: {
          id: 'assistant:report',
          json: {
            balances: me
              ? { sp: Math.round(me.sp), balance: Math.round(me.balance), sbd: Math.round(me.sbd), savingsSbd: Math.round(me.savingsSbd) }
              : null,
            actionsTaken: actions,
            tick: ctx.tick,
          },
        },
        note: 'דנה מפרסמת דוח מצב יומי על השרשרת',
      })
    }
    ctx.state.actionsCount = actions + 1
  },
}
