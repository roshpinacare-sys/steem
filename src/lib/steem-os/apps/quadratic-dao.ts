// Example 11 — DAO הצבעה ריבועית היברידית (quadratic voting DAO)
// Ops: custom_json, create_proposal, update_proposal_votes — העדפות אזרחים, טאלי ריבועי, והצעת מנצח ל-SPS.
import type { AppModule } from '../types'

const CITIZENS = ['crypto-orli', 'dev-yoav', 'maya.writes', 'shai-photography', 'noa-travels', 'itamar.dev', 'gal-tech', 'talia.art']
const CHOICES = [
  { pref: 'A', subject: 'מימון כלי ניתוח on-chain לקהילה' },
  { pref: 'B', subject: 'מימון מרתון כתיבה קהילתי' },
  { pref: 'C', subject: 'מימון אינדקס סוכני AI פתוח' },
]

export const quadraticDao: AppModule = {
  id: 'quadratic-dao',
  num: 11,
  name: 'DAO הצבעה ריבועית היברידית',
  category: 'C',
  description:
    'אזרחים מביעים העדפה (A/B/C) ב-custom_json, וכל תקופה נערך טאלי ריבועי (עלות = מספר בחירות²): המנצח הופך להצעת SPS בת 15 SBD ליום ואזרח תומך בה בהצבעה — היברידית של שכבה-1 ושכבה-2.',
  ops: ['custom_json', 'create_proposal', 'update_proposal_votes'],
  agents: [{ name: 'ai.dao.quadratic', role: 'מנהל DAO ריבועי', sp: 2000, balance: 90, sbd: 50 }],
  interval: 6,
  onTick: async (ctx) => {
    // a citizen expresses a preference (citizens have RC — they sign the json)
    const who = ctx.pick(CITIZENS)
    const choice = ctx.pick(CHOICES)
    await ctx.emit({
      op: 'custom_json',
      agent: who,
      data: { id: 'qdao:pref', json: { pref: choice.pref, voter: who } },
      note: `@${who} מביע העדפה ${choice.pref} ב-DAO הריבועי`,
    })
    const counts = (ctx.state.prefCount as Record<string, number>) ?? {}
    counts[choice.pref] = (counts[choice.pref] ?? 0) + 1
    ctx.state.prefCount = counts

    // every 5th run: quadratic tally → winner proposal on SPS
    const runs = ((ctx.state.runs as number) ?? 0) + 1
    ctx.state.runs = runs
    if (runs % 5 === 0) {
      let winner = CHOICES[0]
      let bestCost = -1
      for (const c of CHOICES) {
        const cost = Math.pow(counts[c.pref] ?? 0, 2)
        if (cost > bestCost) {
          bestCost = cost
          winner = c
        }
      }
      await ctx.emit({
        op: 'custom_json',
        agent: 'ai.dao.quadratic',
        data: { id: 'qdao:result', json: { winner: winner.pref, tally: counts, cost: bestCost } },
        note: `טאלי ריבועי הסתיים: המנצח ${winner.pref} (עלות ${bestCost})`,
      })
      const prop = await ctx.emit({
        op: 'create_proposal',
        agent: 'ai.dao.quadratic',
        data: {
          subject: winner.subject,
          body: `הצעה שנבחרה בהצבעה ריבועית קהילתית (העדפה ${winner.pref}) בבלוק ${ctx.tick}. כל הטאלי מצורף on-chain.`,
          dailyPay: 15,
        },
        note: `הצעת SPS מהמנצח הריבועי: "${winner.subject}"`,
      })
      if (prop.ok && prop.refId) {
        await ctx.emit({
          op: 'update_proposal_votes',
          agent: who,
          data: { proposalId: prop.refId, approve: true },
          note: `@${who} תומך בהצעה שניצחה בהצבעה הריבועית`,
        })
      }
      ctx.state.prefCount = {} // reset the voting cycle
    }
  },
}
