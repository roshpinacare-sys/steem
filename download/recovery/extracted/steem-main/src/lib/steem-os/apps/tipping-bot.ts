// Example 20 — בוט טיפים אוטונומי עם פורטפוליו AI (autonomous tipping bot)
// Ops: vote, transfer
// Reference pattern for reading chain state and paying out with a budget.
import { db } from '@/lib/db'
import { heuristicScore } from '../ai'
import type { AppModule } from '../types'

export const tippingBot: AppModule = {
  id: 'tipping-bot',
  num: 20,
  name: 'בוט טיפים אוטונומי',
  category: 'E',
  description:
    'פטרון-AI קורא פוסטים חדשים, מדרג איכות, מטפים ב-SBD עם memo אישי ומצביע במשקל פרופורציונלי — בונה מוניטין on-chain של פטרון אוטומטי שמעודד יוצרים.',
  ops: ['vote', 'transfer'],
  agents: [{ name: 'ai.patron', role: 'פטרון-AI', sp: 6000, balance: 400, sbd: 500 }],
  interval: 5,
  onTick: async (ctx) => {
    const recent = await db.simPost.findMany({
      where: { parentAuthor: null, author: { not: 'ai.patron' } },
      orderBy: { createdAt: 'desc' },
      take: 6,
    })
    if (recent.length === 0) return
    const scored = recent
      .map((p) => ({ p, score: heuristicScore(p.title, p.body) }))
      .sort((a, b) => b.score - a.score)
    const target = scored[0]
    if (!target) return

    // vote proportional to quality
    const weight = Math.round(3000 + target.score * 6500)
    await ctx.emit({
      op: 'vote',
      agent: 'ai.patron',
      data: { voter: 'ai.patron', author: target.p.author, permlink: target.p.permlink, weight },
      note: `הפטרון הצביע ${Math.round(weight / 100)}% לפוסט של @${target.p.author} (ציון איכות ${target.score.toFixed(2)})`,
    })

    // tip with budget control
    const tips = (ctx.state.tips as number) ?? 0
    const spent = (ctx.state.spent as number) ?? 0
    if (spent < 300) {
      const amount = Math.round((1 + target.score * 3) * 100) / 100
      await ctx.emit({
        op: 'transfer',
        agent: 'ai.patron',
        data: {
          to: target.p.author,
          amount,
          asset: 'SBD',
          memo: `טיפ מהפטרון-AI על פוסט איכותי! ציון: ${(target.score * 100).toFixed(0)}/100`,
        },
        note: `טיפ של ${amount} SBD ל-@${target.p.author}`,
      })
      ctx.state.tips = tips + 1
      ctx.state.spent = spent + amount
    } else {
      ctx.state.spent = 0 // daily reset
    }
  },
}
