// Example 13 — קהילה במודרציה AI (AI-moderated community)
// Ops: custom_json, vote, comment — mute/pin על custom_json, הצבעות עידוד, ודוח מודרציה שבועי.
import { db } from '@/lib/db'
import { heuristicScore } from '../ai'
import type { AppModule } from '../types'

export const aiCommunity: AppModule = {
  id: 'ai-community',
  num: 13,
  name: 'קהילה במודרציה AI',
  category: 'D',
  description:
    'מודרטורית-AI סורקת פוסטים: ספאמרים (טקסט קצר) מושתקים ב-custom_json ונזכרים ברשימת ההשתקה, פוסטים איכותיים מוצמדים ומקבלים הצבעת עידוד, וכל תקופה מתפרסם דוח מודרציה שקוף לקהילה.',
  ops: ['custom_json', 'vote', 'comment'],
  agents: [{ name: 'ai.community.mod', role: 'מודרטורית קהילה-AI', sp: 3500, balance: 120, sbd: 70 }],
  interval: 5,
  onTick: async (ctx) => {
    const muted = (ctx.state.muted as string[]) ?? []
    const recent = await db.simPost.findMany({ where: { parentAuthor: null }, orderBy: { createdAt: 'desc' }, take: 8 })
    const post = recent.length > 0 ? ctx.pick(recent) : null
    if (post && post.author !== 'ai.community.mod') {
      if (muted.includes(post.author)) {
        await ctx.emit({
          op: 'custom_json',
          agent: 'ai.community.mod',
          data: { id: 'community:op', json: { op: 'mute', author: post.author } },
          note: `@${post.author} — הושתק ספאמר מוכר`,
        })
      } else if (ctx.rng() < 0.2 && post.body.length < 60) {
        // spam detection: tiny body → mute (cap the muted list at 10)
        if (muted.length >= 10) muted.shift()
        muted.push(post.author)
        ctx.state.muted = muted
        await ctx.emit({
          op: 'custom_json',
          agent: 'ai.community.mod',
          data: { id: 'community:op', json: { op: 'mute', author: post.author, reason: 'spam' } },
          note: `זוהה ספאמר: @${post.author} הושתק`,
        })
      } else if (heuristicScore(post.title, post.body) >= 0.5) {
        // good post → pin + encouragement vote
        await ctx.emit({
          op: 'custom_json',
          agent: 'ai.community.mod',
          data: { id: 'community:op', json: { op: 'pin', author: post.author, permlink: post.permlink } },
          note: `פוסט איכותי של @${post.author} הוצמד לקהילה`,
        })
        await ctx.emit({
          op: 'vote',
          agent: 'ai.community.mod',
          data: { voter: 'ai.community.mod', author: post.author, permlink: post.permlink, weight: 6000 },
          note: `הצבעת עידוד 60% ל@${post.author}`,
        })
        ctx.state.pins = ((ctx.state.pins as number) ?? 0) + 1
      }
    }

    // weekly digest with stats every 6 runs
    const runs = ((ctx.state.runs as number) ?? 0) + 1
    ctx.state.runs = runs
    if (runs % 6 === 0) {
      const pins = (ctx.state.pins as number) ?? 0
      await ctx.emit({
        op: 'comment',
        agent: 'ai.community.mod',
        data: {
          author: 'ai.community.mod',
          title: 'דוח מודרציה שבועי',
          body: `דוח שקוף לקהילה: ${muted.length} חשבונות מושתקים (${muted.slice(0, 4).join(', ') || 'אין'}), ${pins} פוסטים הוצמדו, ${runs} סבבי סריקה.\n\nהמדיניות פשוטה: ספאמרים מושתקים, איכות מתוגמלת — והכל רשום on-chain לביקורת.`,
          tags: ['moderation', 'community'],
        },
        note: 'דוח מודרציה שבועי פורסם לקהילה',
      })
    }
  },
}
