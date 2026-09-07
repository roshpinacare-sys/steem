// Example 22 — market maker STEEM/SBD (internal market market maker)
// Ops: limit_order_create, limit_order_cancel, convert — ציטוט שני צדדים, ביטול פקודות ישנות וארביטרז.
import { db } from '@/lib/db'
import type { AppModule } from '../types'

export const marketMaker: AppModule = {
  id: 'market-maker',
  num: 22,
  name: 'market maker STEEM/SBD',
  category: 'F',
  description:
    'שולחן מסחר-AI מצטט שני צדדים סביב ה-feed (קנייה ב-0.97·P ומכירה ב-1.03·P), בוטל פקודות מיושנות מחוץ ל-spread, מאתר מילויים ומעריך רווח ספריד, וממיר STEEM ל-SBD כשמחיר מילוי סוטה יותר מ-5% מה-feed.',
  ops: ['limit_order_create', 'limit_order_cancel', 'convert'],
  agents: [{ name: 'ai.mm.desk', role: 'שולחן מסחר-AI', sp: 3000, balance: 2000, sbd: 2000 }],
  interval: 7,
  onTick: async (ctx) => {
    const st = await db.simState.findUnique({ where: { id: 1 } })
    const price = st?.feedPrice ?? 0.32

    // cancel one stale resting order (older than 14 ticks)
    const stale = await db.simOrder.findFirst({
      where: { owner: 'ai.mm.desk', status: 'open', tick: { lt: ctx.tick - 14 } },
      orderBy: { createdAt: 'asc' },
    })
    if (stale) {
      await ctx.emit({
        op: 'limit_order_cancel',
        agent: 'ai.mm.desk',
        data: { orderId: stale.id },
        note: 'ביטול פקודה מיושנת שנשארה מחוץ ל-spread',
      })
    }

    // quote both sides (kernel rejects silently when balances run low)
    const buyPx = Math.round(price * 0.97 * 1000) / 1000
    const sellPx = Math.round(price * 1.03 * 1000) / 1000
    await ctx.emit({
      op: 'limit_order_create',
      agent: 'ai.mm.desk',
      data: { side: 'buy', amount: 25, price: buyPx },
      note: `quote קנייה: 25 STEEM @ ${buyPx.toFixed(3)}`,
    })
    await ctx.emit({
      op: 'limit_order_create',
      agent: 'ai.mm.desk',
      data: { side: 'sell', amount: 25, price: sellPx },
      note: `quote מכירה: 25 STEEM @ ${sellPx.toFixed(3)}`,
    })

    // track fills → approximate spread earnings
    const filled = await db.simOrder.count({ where: { owner: 'ai.mm.desk', status: 'filled' } })
    const prevFilled = (ctx.state.filled as number) ?? 0
    if (filled > prevFilled) {
      ctx.state.spreadEarned = Math.round(((ctx.state.spreadEarned as number) ?? 0) + 25 * price * 0.06 * 100) / 100
    }
    ctx.state.filled = filled

    // arbitrage guard: last fill deviating >5% from the feed → convert
    const lastFill = await db.simOrder.findFirst({ where: { owner: 'ai.mm.desk', status: 'filled' }, orderBy: { createdAt: 'desc' } })
    if (lastFill && Math.abs(lastFill.price - price) / price > 0.05) {
      await ctx.emit({
        op: 'convert',
        agent: 'ai.mm.desk',
        data: { amount: 30 },
        note: `ארביטרז: מחיר מילוי ${lastFill.price.toFixed(3)} סוטה >5% מה-feed (${price.toFixed(3)})`,
      })
    }
    ctx.log(`MM: spread ${(price * 0.06).toFixed(3)} · רווח מצטבר מוערך ${ctx.state.spreadEarned ?? 0} SBD`)
  },
}
