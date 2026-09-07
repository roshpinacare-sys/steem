// Example 4 — רשת תרגום אוטומטית (auto translation network)
// Ops: comment, comment_options, vote — תרגום כתגובה עם 70% beneficiaries למחבר המקורי ו-30% לאוצר.
import { db } from '@/lib/db'
import type { AppModule } from '../types'

const LANGS = ['אנגלית', 'ערבית', 'רוסית', 'צרפתית', 'אמהרית']

export const translateNetwork: AppModule = {
  id: 'translate-network',
  num: 4,
  name: 'רשת תרגום אוטומטית',
  category: 'A',
  description:
    'גשר תרגום-AI מאתר פוסטים שעוד לא תורגמו, מפרסם תרגום-סיכום כתגובה עם 70% beneficiaries למחבר המקורי ו-30% לאוצר, והמחבר מצביע לתרגום — חלוקת הכנסות הוגנת אוטומטית.',
  ops: ['comment', 'comment_options', 'vote'],
  agents: [{ name: 'ai.translator.bridge', role: 'גשר תרגום-AI', sp: 3000, balance: 150, sbd: 80 }],
  interval: 6,
  onTick: async (ctx) => {
    const done = ((ctx.state.done as string[]) ?? []).slice(-40) // cap 40 permlinks
    const recent = await db.simPost.findMany({ where: { parentAuthor: null }, orderBy: { createdAt: 'desc' }, take: 12 })
    const target = recent.find((p) => !done.includes(p.permlink) && p.author !== 'ai.translator.bridge')
    if (!target) return
    done.push(target.permlink)
    ctx.state.done = done

    const lang = ctx.pick(LANGS)
    const permlink = `translation-${ctx.tick}-${Math.floor(ctx.rng() * 100000)}`
    const res = await ctx.emit({
      op: 'comment',
      agent: 'ai.translator.bridge',
      data: {
        author: 'ai.translator.bridge',
        title: `[תרגום ${lang}] ${target.title.slice(0, 60)}`,
        body: `תרגום וסיכום ב${lang} של הפוסט המקורי מאת @${target.author}.\n\nהרעיון המרכזי: הפרוטוקול עצמו מאפשר לחלק הכנסות בין יוצרים בכל שפה בעזרת beneficiaries בלבד — בלי חוזה חכם ובלי מתווך.\n\nקוראים שמעדיפים ${lang} מוזמנים להגיב כאן.`,
        tags: ['translation', 'ai'],
        parentAuthor: target.author,
        parentPermlink: target.permlink,
        permlink,
      },
      note: `תרגום ${lang} לפוסט של @${target.author} (חלוקה 70/30)`,
    })
    if (!res.ok) return
    const opt = await ctx.emit({
      op: 'comment_options',
      agent: 'ai.translator.bridge',
      data: {
        author: 'ai.translator.bridge',
        permlink,
        beneficiaries: [
          { account: target.author, weight: 7000 },
          { account: 'treasury', weight: 3000 },
        ],
      },
      note: 'beneficiaries: 70% למחבר המקורי, 30% לאוצר',
    })
    if (opt.ok) {
      // the original author "signs" an upvote for their translated content
      await ctx.emit({
        op: 'vote',
        agent: target.author,
        data: { voter: target.author, author: 'ai.translator.bridge', permlink, weight: 5000 },
        note: `@${target.author} מצביע 50% לתרגום של הפוסט שלו`,
      })
    }
  },
}
