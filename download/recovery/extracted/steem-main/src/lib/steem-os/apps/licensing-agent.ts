// Example 23 — סוכן רישוי תוכן (content licensing agent)
// Ops: custom_json, comment, comment_options — בקשות ומענקי רישוי, ותמלוג אוטומטי דרך beneficiaries.
import { db } from '@/lib/db'
import type { AppModule } from '../types'

const CITIZENS = ['crypto-orli', 'dev-yoav', 'maya.writes', 'shai-photography', 'noa-travels', 'itamar.dev', 'gal-tech', 'talia.art']

export const licensingAgent: AppModule = {
  id: 'licensing-agent',
  num: 23,
  name: 'סוכן רישוי תוכן',
  category: 'F',
  description:
    'סוכן רישוי מאתר תוכן טרי, מתעד בקשת שימוש חוזר ומענק רישוי 10-20% על custom_json, ומפרסם פוסט "רישיון תוכן חדש" שמזקיק את המחבר המקורי כ-beneficiary — תמלוגים מובנים בפרוטוקול עצמו.',
  ops: ['custom_json', 'comment', 'comment_options'],
  agents: [{ name: 'ai.license.agent', role: 'סוכן רישוי-AI', sp: 1500, balance: 100, sbd: 60 }],
  interval: 6,
  onTick: async (ctx) => {
    const recent = await db.simPost.findMany({ where: { parentAuthor: null }, orderBy: { createdAt: 'desc' }, take: 8 })
    const candidates = recent.filter((p) => p.author !== 'ai.license.agent')
    if (candidates.length < 2) return
    const original = candidates[0]
    const others = candidates.filter((p) => p.author !== original.author)
    const reuser = others.length > 0 ? ctx.pick(others).author : ctx.pick(CITIZENS)
    const percent = Math.round(10 + ctx.rng() * 10)

    await ctx.emit({
      op: 'custom_json',
      agent: 'ai.license.agent',
      data: { id: 'license:request', json: { original: original.permlink, originalAuthor: original.author, reuser } },
      note: `בקשת רישוי: @${reuser} מבקש להשתמש בתוכן של @${original.author}`,
    })
    await ctx.emit({
      op: 'custom_json',
      agent: 'ai.license.agent',
      data: { id: 'license:grant', json: { originalAuthor: original.author, reuser, percent, terms: 'ייחוס מלא + תמלוג דרך beneficiaries' } },
      note: `מענק רישוי ${percent}% מ@${original.author} ל@${reuser}`,
    })

    // publish the license post crediting the original author as beneficiary
    const permlink = `license-${ctx.tick}-${Math.floor(ctx.rng() * 10000)}`
    const res = await ctx.emit({
      op: 'comment',
      agent: 'ai.license.agent',
      data: {
        author: 'ai.license.agent',
        title: 'רישיון תוכן חדש',
        body: `אושר רישוי שימוש חוזר (${percent}%) לתוכן המקורי של @${original.author} עבור @${reuser}.\n\nהתמלוג ממומש בפרוטוקול עצמו: המחבר המקורי רשום כ-beneficiary של הפוסט הזה — הכסף זורם אוטומטית בכל הצבעה, בלי חוזה חכם.`,
        tags: ['licensing', 'ai'],
        permlink,
      },
      note: 'פוסט רישוי חדש עם המחבר המקורי כ-beneficiary',
    })
    if (res.ok) {
      await ctx.emit({
        op: 'comment_options',
        agent: 'ai.license.agent',
        data: { author: 'ai.license.agent', permlink, beneficiaries: [{ account: original.author, weight: 1500 }] },
        note: 'beneficiaries: 15% תמלוג למחבר המקורי',
      })
    }
  },
}
