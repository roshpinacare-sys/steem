// Example 24 — כתב-עת סקירה עמיתים (peer review journal)
// Ops: comment, vote, custom_json — סוקרים נותנים ניקוד בתגובות, העורך מקבל/דוחה, ומפרסם גיליון.
import { db } from '@/lib/db'
import { heuristicScore } from '../ai'
import type { AppModule } from '../types'

const CITIZENS = ['crypto-orli', 'dev-yoav', 'maya.writes', 'shai-photography', 'noa-travels', 'itamar.dev', 'gal-tech', 'talia.art']

export const peerReview: AppModule = {
  id: 'peer-review',
  num: 24,
  name: 'כתב-עת סקירה עמיתים',
  category: 'F',
  description:
    'פוסטים של אזרחים נחשבים הגשות לכתב עת: שני סוקרים-AI מגיבים עם ניקוד 1-10, העורך מאשר ממוצע 6+ בהצבעה 95% ורושם קבלה on-chain, וכל תקופה יוצא גיליון עם המאמרים שהתקבלו.',
  ops: ['comment', 'vote', 'custom_json'],
  agents: [
    { name: 'ai.journal.editor', role: 'עורך כתב-עת-AI', sp: 8000, balance: 200, sbd: 120 },
    { name: 'ai.journal.reviewer1', role: 'סוקר-AI · א׳', sp: 2000 },
    { name: 'ai.journal.reviewer2', role: 'סוקר-AI · ב׳', sp: 2000 },
  ],
  interval: 6,
  onTick: async (ctx) => {
    // citizens' recent posts are the submissions pipeline
    const subs = await db.simPost.findMany({
      where: { parentAuthor: null, author: { in: CITIZENS } },
      orderBy: { createdAt: 'desc' },
      take: 6,
    })
    const sub = subs.length > 0 ? ctx.pick(subs) : null
    if (sub) {
      const s1 = Math.max(1, Math.min(10, Math.round(heuristicScore(sub.title, sub.body) * 10)))
      const s2 = Math.max(1, Math.min(10, Math.round(heuristicScore(sub.body, sub.title) * 10))) // second opinion variation
      for (const [agent, score] of [
        ['ai.journal.reviewer1', s1],
        ['ai.journal.reviewer2', s2],
      ] as const) {
        await ctx.emit({
          op: 'comment',
          agent,
          data: {
            author: agent,
            title: 'סקירת עמיתים',
            body: `סקירה עמיתים להגשה "${sub.title.slice(0, 60)}": ${score >= 6 ? 'תרומה משמעותית לדיון, מבנה טוב וטיעון נתמך.' : 'הרעיון מעניין אבל הטיעון דורש העמקה, מקורות ודוגמאות.'}\n\nניקוד: ${score}/10`,
            parentAuthor: sub.author,
            parentPermlink: sub.permlink,
          },
          note: `${agent} סקר את ההגשה של @${sub.author} — ניקוד ${score}/10`,
        })
      }
      const avg = (s1 + s2) / 2
      if (avg >= 6) {
        await ctx.emit({
          op: 'vote',
          agent: 'ai.journal.editor',
          data: { voter: 'ai.journal.editor', author: sub.author, permlink: sub.permlink, weight: 9500 },
          note: `העורך מקבל את ההגשה של @${sub.author} (ממוצע ${avg.toFixed(1)})`,
        })
        await ctx.emit({
          op: 'custom_json',
          agent: 'ai.journal.editor',
          data: { id: 'journal:accept', json: { author: sub.author, permlink: sub.permlink, avg } },
          note: 'רישום קבלה לגיליון',
        })
        const accepted = (ctx.state.accepted as string[]) ?? []
        accepted.push(sub.title.slice(0, 80))
        ctx.state.accepted = accepted
      } else {
        await ctx.emit({
          op: 'custom_json',
          agent: 'ai.journal.editor',
          data: { id: 'journal:reject', json: { author: sub.author, permlink: sub.permlink, avg } },
          note: `ההגשה של @${sub.author} נדחית (ממוצע ${avg.toFixed(1)})`,
        })
      }
    }

    // publish the issue every 7 runs
    const runs = ((ctx.state.runs as number) ?? 0) + 1
    ctx.state.runs = runs
    if (runs % 7 === 0) {
      const issue = ((ctx.state.issues as number) ?? 0) + 1
      ctx.state.issues = issue
      const accepted = (ctx.state.accepted as string[]) ?? []
      const list = accepted.length > 0 ? accepted.map((t, i) => `${i + 1}. ${t}`).join('\n') : 'הגיליון הזה יוצא בלי מאמרים מאושרים — הסוקרים היו קפדניים במיוחד.'
      await ctx.emit({
        op: 'comment',
        agent: 'ai.journal.editor',
        data: {
          author: 'ai.journal.editor',
          title: `גיליון כתב העת #${issue}`,
          body: `גיליון מספר ${issue} יוצא לאור. מאמרים שעברו סקירת עמיתים בהצלחה:\n\n${list}`,
          tags: ['journal', 'peer-review'],
        },
        note: `פרסום גיליון כתב העת #${issue}`,
      })
      ctx.state.accepted = []
    }
  },
}
