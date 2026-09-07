// Example 12 — קרן סיוע הדדי (mutual aid fund)
// Ops: delegate_vesting_shares, custom_json, transfer — אזרחים מאצילים, מגישים תביעות, והקרן סוקרת ומשלמת.
import { heuristicScore } from '../ai'
import type { AppModule } from '../types'

const CITIZENS = ['crypto-orli', 'dev-yoav', 'maya.writes', 'shai-photography', 'noa-travels', 'itamar.dev', 'gal-tech', 'talia.art']
const STORIES = [
  'נפלה לי המערכת במחשב העבודה, התיקון עולה 250 שקל ואין לי מענה זמני. אני כותב כאן כבר 3 חודשים ותורם לקהילה כל שבוע, ואשיב לקרן ברגע שאתאושש.',
  'משפחה בשלב קשה: השבוע נשארנו בלי תקציב למצרכים בסיסיים. כל סיוע יעזור ואזרחים אחרים יכולים לאמת שאני פעיל כאן זמן רב.',
  'סטודנטית למדעי המחשב. צריכה כרטיס אוטובוס חודשי כדי להגיע למבחנים — 8 מבחנים לפני הסמסטר.',
  'עזרה. בבקשה.',
  'עסק קטן נפגע מתקלת שרת ואיבד 2 שבועות הכנסות. הכסף ישמש לשחזור גיבויים ולהמשך הפעילות, וההחזר יתבצע כהלוואת גמגום.',
]

export const mutualAid: AppModule = {
  id: 'mutual-aid',
  num: 12,
  name: 'קרן סיוע הדדי',
  category: 'C',
  description:
    'אזרחים מאצילים SP כהון פתוח, מגישים תביעות סיוע על custom_json עם סיפור אישי, וקרן-AI סוקרת כל תביעה בהיוריסטיקת איכות ומעבירה מענק 5-10 SBD למי שעומד בקריטריון — ביטוח קהילתי אוטונומי.',
  ops: ['delegate_vesting_shares', 'custom_json', 'transfer'],
  agents: [{ name: 'ai.aid.fund', role: 'קרן סיוע-AI', sp: 1000, balance: 200, sbd: 100 }],
  interval: 7,
  onTick: async (ctx) => {
    // one-time: two citizens delegate seed capital (silent if they lack SP)
    if (!ctx.state.delegated) {
      ctx.state.delegated = true
      for (const who of ['gal-tech', 'talia.art']) {
        await ctx.emit({
          op: 'delegate_vesting_shares',
          agent: who,
          data: { to: 'ai.aid.fund', amount: 300 },
          note: `@${who} מאציל 300 SP לקרן הסיוע ההדדי`,
        })
      }
    }

    // a citizen files a claim with a personal story
    const claimant = ctx.pick(CITIZENS)
    const story = ctx.pick(STORIES)
    const claimId = `c-${ctx.tick}`
    await ctx.emit({
      op: 'custom_json',
      agent: claimant,
      data: { id: 'aid:claim', json: { claimId, who: claimant, story } },
      note: `@${claimant} הגיש בקשת סיוע (${claimId})`,
    })

    // the AI fund reviews the claim and pays when recommended + budget healthy
    const score = heuristicScore('בקשת סיוע', story)
    const recommend = score >= 0.35
    await ctx.emit({
      op: 'custom_json',
      agent: 'ai.aid.fund',
      data: { id: 'aid:review', json: { claimId, recommend, score: Math.round(score * 100) / 100 } },
      note: recommend ? `הקרן ממליצה לאשר את ${claimId} (ציון ${score.toFixed(2)})` : `הקרן דוחה את ${claimId} (ציון ${score.toFixed(2)})`,
    })
    if (recommend) {
      const fund = await ctx.agent('ai.aid.fund')
      if (fund && fund.sbd > 20) {
        const amount = Math.round((5 + ctx.rng() * 5) * 100) / 100
        await ctx.emit({
          op: 'transfer',
          agent: 'ai.aid.fund',
          data: { to: claimant, amount, asset: 'SBD', memo: `מענק סיוע הדדי על ${claimId} — הקרן איתך` },
          note: `מענק ${amount} SBD הועבר ל@${claimant}`,
        })
      }
    }
  },
}
