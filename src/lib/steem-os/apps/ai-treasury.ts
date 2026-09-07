// Example 7 — אוצרה מנוהלת AI (AI-managed treasury)
// Ops: convert, limit_order_create, transfer_to_savings — הגנת ערך, פקודות שוק וחיסכון.
import { db } from '@/lib/db'
import type { AppModule } from '../types'

export const aiTreasury: AppModule = {
  id: 'ai-treasury',
  num: 7,
  name: 'אוצרה מנוהלת AI',
  category: 'B',
  description:
    'מנהל אוצרה-AI קורא את מחיר ה-feed ומחליט: מתחת ל-0.28 הוא ממיר STEEM ל-SBD באופן דפנסיבי, מעל 0.36 הוא מניח פקודת מכירה מעל השוק, ובין לבין מציב 10% מה-SBD בחיסכון — מדיניות מוניטרית אוטונומית.',
  ops: ['convert', 'limit_order_create', 'transfer_to_savings'],
  agents: [{ name: 'ai.treasury.manager', role: 'מנהל אוצרה-AI', sp: 4000, balance: 500, sbd: 800 }],
  interval: 8,
  onTick: async (ctx) => {
    const st = await db.simState.findUnique({ where: { id: 1 } })
    const price = st?.feedPrice ?? 0.32

    if (price < 0.28) {
      // defensive conversion while the feed is cheap
      const res = await ctx.emit({
        op: 'convert',
        agent: 'ai.treasury.manager',
        data: { amount: 40 },
        note: `המרה דפנסיבית: 40 STEEM→SBD כשה-feed זול (${price.toFixed(3)})`,
      })
      ctx.state.lastAction = res.ok ? `convert@${price.toFixed(3)}` : 'convert-נדחה'
    } else if (price > 0.36) {
      // sell above market into strength
      const target = Math.round(price * 1.03 * 1000) / 1000
      const res = await ctx.emit({
        op: 'limit_order_create',
        agent: 'ai.treasury.manager',
        data: { side: 'sell', amount: 30, price: target },
        note: `פקודת מכירה: 30 STEEM ב-${target.toFixed(3)} (3% מעל ה-feed)`,
      })
      ctx.state.lastAction = res.ok ? `sell@${target.toFixed(3)}` : 'sell-נדחה'
    } else {
      // park 10% of liquid SBD in savings occasionally
      const mgr = await ctx.agent('ai.treasury.manager')
      if (mgr && mgr.sbd > 50 && ctx.rng() < 0.5) {
        const amt = Math.round(mgr.sbd * 0.1 * 100) / 100
        const res = await ctx.emit({
          op: 'transfer_to_savings',
          agent: 'ai.treasury.manager',
          data: { amount: amt, asset: 'SBD' },
          note: `הפקדה לחיסכון: ${amt} SBD (10% מהיתרה הנזילה)`,
        })
        ctx.state.lastAction = res.ok ? `park:${amt}` : 'park-נדחה'
      } else {
        ctx.state.lastAction = 'hold'
        ctx.log(`אוצרה: החזקה — המחיר ${price.toFixed(3)} בתוך טווח היעד`)
      }
    }
  },
}
