// Example 14 — טוקן layer-2 AIQ (token engine)
// Ops: custom_json — הנפקות ואיירדרופים; אינדקס היתרות L2 מתוחזק על-ידי המודול (off-chain by design).
import { db } from '@/lib/db'
import { heuristicScore } from '../ai'
import type { AppModule } from '../types'

const CITIZENS = ['crypto-orli', 'dev-yoav', 'maya.writes', 'shai-photography', 'noa-travels', 'itamar.dev', 'gal-tech', 'talia.art']

export const tokenEngine: AppModule = {
  id: 'token-engine',
  num: 14,
  name: 'טוקן layer-2 (AIQ)',
  category: 'D',
  description:
    'מנפיק-AI מדרג פוסטים ומנפיק טוקני AIQ על custom_json (ssc-aiq), מתחזק אינדקס יתרות L2 משלו (TokenBalance — אינדקס off-chain by design שהמודול מחזיק), ומחלק איירדרופים תקופתיים לאזרחים.',
  ops: ['custom_json'],
  agents: [{ name: 'ai.token.issuer', role: 'מנפיק טוקן-AI', sp: 2000, balance: 100, sbd: 60 }],
  interval: 4,
  onTick: async (ctx) => {
    // score a recent post and issue AIQ to its author
    const recent = await db.simPost.findMany({ where: { parentAuthor: null }, orderBy: { createdAt: 'desc' }, take: 6 })
    const post = recent.length > 0 ? ctx.pick(recent) : null
    if (post) {
      const amount = Math.max(1, Math.round(heuristicScore(post.title, post.body) * 50))
      await ctx.emit({
        op: 'custom_json',
        agent: 'ai.token.issuer',
        data: { id: 'ssc-aiq', json: { action: 'issue', to: post.author, amount, ref: post.permlink } },
        note: `הנפקת ${amount} AIQ ל@${post.author} על תוכן איכותי`,
      })
      // L2 balance index (documented design: layer-2 indexing is off-chain, module-owned)
      await db.tokenBalance.upsert({
        where: { token_account: { token: 'AIQ', account: post.author } },
        update: { amount: { increment: amount } },
        create: { token: 'AIQ', account: post.author, amount, appId: 'token-engine' },
      })
      ctx.state.issued = ((ctx.state.issued as number) ?? 0) + amount
    }

    // every 5th run: airdrop 5 AIQ to 3 random citizens
    const runs = ((ctx.state.runs as number) ?? 0) + 1
    ctx.state.runs = runs
    if (runs % 5 === 0) {
      const lucky = [...CITIZENS].sort(() => ctx.rng() - 0.5).slice(0, 3)
      for (const who of lucky) {
        await ctx.emit({
          op: 'custom_json',
          agent: 'ai.token.issuer',
          data: { id: 'ssc-aiq', json: { action: 'airdrop', to: who, amount: 5 } },
          note: `איירדרופ 5 AIQ ל@${who}`,
        })
        await db.tokenBalance.upsert({
          where: { token_account: { token: 'AIQ', account: who } },
          update: { amount: { increment: 5 } },
          create: { token: 'AIQ', account: who, amount: 5, appId: 'token-engine' },
        })
      }
      ctx.log('איירדרופ תקופתי: 5 AIQ ל-3 אזרחים')
    }
  },
}
