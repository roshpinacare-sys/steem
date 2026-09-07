// Example 5 — מצביע לומד (RL voter)
// Ops: vote — משקל הצבעה נגזר מציון אמון פר-מחבר, והציון מתעדכן מהיוריסטיקה אחרי כל הצבעה.
import { db } from '@/lib/db'
import { heuristicScore } from '../ai'
import type { AppModule } from '../types'

export const rlVoter: AppModule = {
  id: 'rl-voter',
  num: 5,
  name: 'מצביע לומד (RL)',
  category: 'A',
  description:
    'סוכן מצביע שלומד מהניסיון: לכל מחבר ציון אמון בזיכרון המודול (ברירת מחדל 0.5), משקל ההצבעה נגזר מהציון, ואחרי כל הצבעה הציון מתעדכן לפי היוריסטיקת איכות — למידת חיזוקים פשוטה על כלכלת ההצבעה.',
  ops: ['vote'],
  agents: [{ name: 'ai.voter.rl', role: 'מצביע לומד-AI', sp: 5000, balance: 100, sbd: 60 }],
  interval: 4,
  onTick: async (ctx) => {
    const authors = (ctx.state.authors as Record<string, number>) ?? {}
    const recent = await db.simPost.findMany({ where: { parentAuthor: null }, orderBy: { createdAt: 'desc' }, take: 10 })
    for (const p of recent) {
      const votes: { voter: string }[] = p.votes ? JSON.parse(p.votes) : []
      if (votes.some((v) => v.voter === 'ai.voter.rl')) continue
      const score = Math.min(1, Math.max(0, authors[p.author] ?? 0.5))
      const weight = Math.min(9500, Math.max(500, Math.round(score * 10000)))
      const res = await ctx.emit({
        op: 'vote',
        agent: 'ai.voter.rl',
        data: { voter: 'ai.voter.rl', author: p.author, permlink: p.permlink, weight },
        note: `המצביע הלומד הצביע ${Math.round(weight / 100)}% ל@${p.author} (ציון אמון ${score.toFixed(2)})`,
      })
      if (res.ok) {
        // RL-ish update: nudge the author score toward the heuristic quality
        const heur = heuristicScore(p.title, p.body)
        authors[p.author] = Math.min(1, Math.max(0, score + (heur - 0.5) * 0.1))
        ctx.state.authors = authors
        ctx.state.votes = ((ctx.state.votes as number) ?? 0) + 1
      }
      break // one vote per run
    }
  },
}
