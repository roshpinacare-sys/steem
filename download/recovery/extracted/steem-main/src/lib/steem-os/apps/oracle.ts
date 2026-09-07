// Example 18 — אורקל נתונים עם מוניטין (data oracle with reputation)
// Ops: custom_json, comment — פרסום מחיר, ניבוי כיוון, מעקב דיוק ודוח מוניטין תקופתי.
import { db } from '@/lib/db'
import type { AppModule } from '../types'

export const dataOracle: AppModule = {
  id: 'oracle',
  num: 18,
  name: 'אורקל נתונים עם מוניטין',
  category: 'E',
  description:
    'אורקל-AI פורסם מחיר feed על custom_json בכל ריצה, מנבא את כיוון התנועה הבאה, וסופר פגיעות מול החטאות בהשוואה למחיר הקודם — ומדי 10 ריצות מפרסם דוח מוניטין עם דיוק מחושב on-chain.',
  ops: ['custom_json', 'comment'],
  agents: [{ name: 'ai.oracle.feed', role: 'אורקל נתונים-AI', sp: 2000, balance: 90, sbd: 60 }],
  interval: 6,
  onTick: async (ctx) => {
    const st = await db.simState.findUnique({ where: { id: 1 } })
    const price = st?.feedPrice ?? 0.32
    const prev = (ctx.state.prevPrice as number) ?? price
    const dir = price > prev ? 'up' : price < prev ? 'down' : 'flat'

    // score the previous prediction against the actual move
    const last = ctx.state.lastPrediction as string | undefined
    if (last) {
      if (last === dir) ctx.state.hits = ((ctx.state.hits as number) ?? 0) + 1
      else ctx.state.misses = ((ctx.state.misses as number) ?? 0) + 1
    }

    await ctx.emit({
      op: 'custom_json',
      agent: 'ai.oracle.feed',
      data: { id: 'oracle:price', json: { price, ts: Date.now(), source: 'sim-feed' } },
      note: `אורקל פרסם מחיר: ${price.toFixed(3)} (מקור sim-feed)`,
    })

    // momentum-informed guess for the next direction
    const predict = dir === 'down' ? 'up' : ctx.rng() < 0.5 ? 'up' : 'down'
    await ctx.emit({
      op: 'custom_json',
      agent: 'ai.oracle.feed',
      data: { id: 'oracle:predict', json: { dir: predict, confidence: Math.round((0.5 + ctx.rng() * 0.3) * 100) / 100 } },
      note: `אורקל מנבא: המחיר יעלה? ${predict === 'up' ? 'כן' : 'לא'}`,
    })
    ctx.state.lastPrediction = predict
    ctx.state.prevPrice = price

    // reputation report every 10 runs
    const runs = ((ctx.state.runs as number) ?? 0) + 1
    ctx.state.runs = runs
    if (runs % 10 === 0) {
      const hits = (ctx.state.hits as number) ?? 0
      const misses = (ctx.state.misses as number) ?? 0
      const rep = hits + misses > 0 ? Math.round((hits / (hits + misses)) * 100) : 0
      await ctx.emit({
        op: 'comment',
        agent: 'ai.oracle.feed',
        data: {
          author: 'ai.oracle.feed',
          title: 'דוח מוניטין האורקל',
          body: `דיוק הניבויים מאז האיפוס: ${rep}% (${hits} פגיעות מול ${misses} החטאות).\n\nמוניטין של אורקל נבנה מהיסטוריה בלתי ניתנת לעריכה — כל ניבוי וכל מחיר חתומים על custom_json וניתנים לביקורת ציבורית.`,
          tags: ['oracle', 'reputation'],
        },
        note: `דוח מוניטין: דיוק ${rep}%`,
      })
    }
  },
}
