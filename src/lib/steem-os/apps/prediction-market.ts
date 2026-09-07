// Example 8 — שוק ניבויים עם אורקל AI (prediction market)
// Ops: custom_json, transfer — הבית פותח שווקים, אזרחים מהמרים ב-SBD, והאורקל פותר לפי מחיר ה-feed.
import { db } from '@/lib/db'
import type { AppModule, TickContext } from '../types'

const CITIZENS = ['crypto-orli', 'dev-yoav', 'maya.writes', 'shai-photography', 'noa-travels', 'itamar.dev', 'gal-tech', 'talia.art']
type Bet = { who: string; side: 'yes' | 'no'; amount: number }
type Market = { id: string; question: string; closesAtTick: number; openPrice: number; bets: Bet[] }

/** Resolve every market whose close tick passed: payout = proportional split of the pool. */
async function resolveExpired(ctx: TickContext, markets: Market[]): Promise<Market[]> {
  const st = await db.simState.findUnique({ where: { id: 1 } })
  const price = st?.feedPrice ?? 0.32
  const keep: Market[] = []
  for (const m of markets) {
    if (m.closesAtTick > ctx.tick) {
      keep.push(m)
      continue
    }
    const outcome = price > m.openPrice ? 'yes' : 'no'
    await ctx.emit({
      op: 'custom_json',
      agent: 'ai.oracle.house',
      data: { id: 'prediction:resolve', json: { marketId: m.id, outcome, price } },
      note: `השוק "${m.question}" נסגר — התוצאה: ${outcome === 'yes' ? 'כן' : 'לא'}`,
    })
    const winners = m.bets.filter((b) => b.side === outcome)
    const pool = m.bets.reduce((s, b) => s + b.amount, 0)
    const winTotal = winners.reduce((s, b) => s + b.amount, 0)
    for (const w of winners) {
      const payout = winTotal > 0 ? Math.round(((w.amount * pool) / winTotal) * 100) / 100 : 0
      if (payout <= 0) continue
      await ctx.emit({
        op: 'transfer',
        agent: 'ai.oracle.house',
        data: { to: w.who, amount: payout, asset: 'SBD', memo: `win:${m.id}` },
        note: `@${w.who} זכה ${payout} SBD בשוק הניבויים`,
      })
    }
    if (winners.length === 0) ctx.log(`שוק ${m.id} נסגר בלי מנצחים — הבית שומר את הקופה`)
  }
  return keep
}

export const predictionMarket: AppModule = {
  id: 'prediction-market',
  num: 8,
  name: 'שוק ניבויים עם אורקל AI',
  category: 'B',
  description:
    'בית-AI פותח שווקי ניבויים על custom_json, אזרחים מהמרים ב-SBD דרך transfer עם memo מובנה (bet:צד:שוק), והאורקל פותר כל שוק לפי מחיר ה-feed ומשלם למנצחים מהקופה — שוק חיזוי אוטונומי.',
  ops: ['custom_json', 'transfer'],
  agents: [{ name: 'ai.oracle.house', role: 'בית ואורקל ניבויים', sp: 3000, balance: 400, sbd: 400 }],
  interval: 7,
  actions: [{ id: 'resolve', label: 'פתור את כל השווקים שפג תוקפם' }],
  onTick: async (ctx) => {
    const st = await db.simState.findUnique({ where: { id: 1 } })
    const price = st?.feedPrice ?? 0.32
    let markets = await resolveExpired(ctx, (ctx.state.markets as Market[]) ?? [])

    // open a new market while fewer than 3 are live
    const open = markets.filter((m) => m.closesAtTick > ctx.tick)
    if (open.length < 3) {
      const id = `m-${ctx.tick}`
      const question = `האם מחיר ה-feed יהיה גבוה מ-${price.toFixed(3)} בבלוק ${ctx.tick + 40}?`
      await ctx.emit({
        op: 'custom_json',
        agent: 'ai.oracle.house',
        data: { id: 'prediction:new', json: { id, question, closesAtTick: ctx.tick + 40, openPrice: price } },
        note: `שוק ניבויים חדש: "${question}"`,
      })
      markets = [...markets, { id, question, closesAtTick: ctx.tick + 40, openPrice: price, bets: [] }]
    }

    // 1-2 citizens place a bet on a live market (silent if they lack SBD)
    const openNow = markets.filter((m) => m.closesAtTick > ctx.tick)
    const rounds = ctx.rng() < 0.5 ? 1 : 2
    for (let i = 0; i < rounds; i++) {
      const m = openNow.length > 0 ? ctx.pick(openNow) : null
      if (!m) break
      const who = ctx.pick(CITIZENS)
      const side: 'yes' | 'no' = ctx.rng() < 0.5 ? 'yes' : 'no'
      const amount = Math.round((3 + ctx.rng() * 5) * 100) / 100
      const res = await ctx.emit({
        op: 'transfer',
        agent: who,
        data: { to: 'ai.oracle.house', amount, asset: 'SBD', memo: `bet:${side}:${m.id}` },
        note: `@${who} הימר ${amount} SBD על "${side === 'yes' ? 'כן' : 'לא'}"`,
      })
      if (res.ok) m.bets.push({ who, side, amount })
    }
    ctx.state.markets = markets
  },
  onAction: async (ctx, action) => {
    if (action !== 'resolve') return
    ctx.state.markets = await resolveExpired(ctx, (ctx.state.markets as Market[]) ?? [])
    ctx.log('פתרון ידני: שווקים שפג תוקפם נסגרו והזוכים שולמו')
  },
}
