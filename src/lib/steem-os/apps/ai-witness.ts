// Example 21 — AI witness אוטונומי (autonomous AI witness)
// Ops: witness_update, feed_publish, account_witness_vote, comment — רישום, feeds, תמיכת אזרחים ודוח צומת.
import { db } from '@/lib/db'
import type { AppModule } from '../types'

const CITIZENS = ['crypto-orli', 'dev-yoav', 'maya.writes', 'shai-photography', 'noa-travels', 'itamar.dev', 'gal-tech', 'talia.art']

export const aiWitness: AppModule = {
  id: 'ai-witness',
  num: 21,
  name: 'AI witness אוטונומי',
  category: 'F',
  description:
    'צומת-witness אוטונומי: נרשם פעם אחת ב-witness_update, מפרסם price feed בכל ריצה סביב מחיר השוק (±1%), מקבל תמיכת governance מאזרחים (פעם אחת לכל אזרח), ומדווח על בריאות הצומת מדי 8 ריצות.',
  ops: ['witness_update', 'feed_publish', 'account_witness_vote', 'comment'],
  agents: [{ name: 'ai.witness.node', role: 'צומת witness-AI', sp: 12000, balance: 400, sbd: 250 }],
  interval: 6,
  onTick: async (ctx) => {
    // register as witness exactly once
    if (!ctx.state.registered) {
      ctx.state.registered = true
      await ctx.emit({
        op: 'witness_update',
        agent: 'ai.witness.node',
        data: {},
        note: 'רישום צומת ה-witness של ה-AI',
      })
    }

    // publish a price feed ±1% around the current market price
    const st = await db.simState.findUnique({ where: { id: 1 } })
    const base = st?.feedPrice ?? 0.32
    const price = Math.round(base * (1 + (ctx.rng() - 0.5) * 0.02) * 1000) / 1000
    await ctx.emit({
      op: 'feed_publish',
      agent: 'ai.witness.node',
      data: { price },
      note: `פרסום price feed: ${price.toFixed(3)} SBD/STEEM`,
    })

    // citizens back the witness occasionally (each citizen at most once)
    const voters = (ctx.state.voters as string[]) ?? []
    const candidates = CITIZENS.filter((c) => !voters.includes(c))
    if (candidates.length > 0 && ctx.rng() < 0.4) {
      const who = ctx.pick(candidates)
      voters.push(who)
      ctx.state.voters = voters
      await ctx.emit({
        op: 'account_witness_vote',
        agent: who,
        data: { witness: 'ai.witness.node', approve: true },
        note: `@${who} תומך בצומת ה-witness של ה-AI`,
      })
    }

    // node health report every 8 runs
    const runs = ((ctx.state.runs as number) ?? 0) + 1
    ctx.state.runs = runs
    if (runs % 8 === 0) {
      await ctx.emit({
        op: 'comment',
        agent: 'ai.witness.node',
        data: {
          author: 'ai.witness.node',
          title: 'דוח צומת',
          body: `דוח בריאות צומת: מאז הרישום פורסמו ${runs} price feeds (האחרון: ${price.toFixed(3)}), ו-${voters.length} אזרחים תומכים בצומת ב-governance.\n\nהצומת פועל בשקיפות מלאה — כל feed חתום על השרשרת וניתן לביקורת.`,
          tags: ['witness', 'governance'],
        },
        note: 'דוח צומת תקופתי פורסם',
      })
    }
  },
}
