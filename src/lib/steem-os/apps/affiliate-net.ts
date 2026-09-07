// Example 16 — רשת שותפים עם ייחוס AI (affiliate network with AI attribution)
// Ops: custom_json, transfer — קליקים, המרות, עמלות, וזיהוי הונאות.
import type { AppModule } from '../types'

const CITIZENS = ['crypto-orli', 'dev-yoav', 'maya.writes', 'shai-photography', 'noa-travels', 'itamar.dev', 'gal-tech', 'talia.art']
const CAMPAIGNS = ['קורס בלוקצ׳יין', 'ארנק קר למתחילים', 'בוט מסחר אוטומטי', 'ספר אלקטרוני על DPoS']

export const affiliateNet: AppModule = {
  id: 'affiliate-net',
  num: 16,
  name: 'רשת שותפים עם ייחוס AI',
  category: 'D',
  description:
    'אזרחים "לוחצים" על קמפיינים (custom_json affiliate:click), חלק מהקליקים מומרים בהסתברות קבועה, הרשת משלמת עמלה 1-3 SBD, ובקר הונאות-AI חוסם אזרחים שממירים יותר מדי בזמן קצר.',
  ops: ['custom_json', 'transfer'],
  agents: [{ name: 'ai.affiliate.net', role: 'רשת שותפים-AI', sp: 1500, balance: 100, sbd: 300 }],
  interval: 5,
  onTick: async (ctx) => {
    const who = ctx.pick(CITIZENS)
    const campaign = ctx.pick(CAMPAIGNS)
    await ctx.emit({
      op: 'custom_json',
      agent: who,
      data: { id: 'affiliate:click', json: { ref: who, campaign } },
      note: `@${who} לחץ על קמפיין "${campaign}"`,
    })

    // conversion probability 25%
    if (ctx.rng() < 0.25) {
      const conversions = (ctx.state.conversions as Record<string, number>) ?? {}
      if ((conversions[who] ?? 0) >= 3) {
        // fraud check: too many recent conversions from the same citizen
        await ctx.emit({
          op: 'custom_json',
          agent: 'ai.affiliate.net',
          data: { id: 'affiliate:fraud', json: { ref: who, campaign, reason: 'conversions over limit' } },
          note: `דגל הונאה: @${who} חרג ממכסת ההמרות`,
        })
        ctx.log(`בקר ההונאות חסם עמלה ל@${who} — חשד לקליקים מזויפים`)
      } else {
        const commission = Math.round((1 + ctx.rng() * 2) * 100) / 100
        await ctx.emit({
          op: 'custom_json',
          agent: who,
          data: { id: 'affiliate:convert', json: { ref: who, campaign, commission } },
          note: `המרה מאומתת: @${who} בקמפיין "${campaign}"`,
        })
        await ctx.emit({
          op: 'transfer',
          agent: 'ai.affiliate.net',
          data: { to: who, amount: commission, asset: 'SBD', memo: `עמלת שותפים על "${campaign}"` },
          note: `עמלה של ${commission} SBD שולמה ל@${who}`,
        })
        conversions[who] = (conversions[who] ?? 0) + 1
        ctx.state.conversions = conversions
      }
    }
  },
}
