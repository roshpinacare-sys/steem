// Example 10 — חוות הצעות SPS מנוהלת AI (SPS proposal farm)
// Ops: create_proposal, update_proposal_votes, comment, claim_reward_balance
// Reference pattern for the DAO category (SP-weighted voting, engine pays out).
import { db } from '@/lib/db'
import { llmText } from '../ai'
import type { AppModule } from '../types'

const PROPOSALS = [
  { subject: 'פיתוח אינדקס קהילות מבוזר ל-SPS', pay: 30 },
  { subject: 'כלי ניתוח הצבעות בזמן אמת לקהילה', pay: 22 },
  { subject: 'ספריית סוכני AI בקוד פתוח ל-Steem', pay: 40 },
  { subject: 'תרגום הדוקומנטציה לעברית', pay: 12 },
  { subject: 'בוט דיווח שבועי על בריאות הרשת', pay: 18 },
]

export const spsFarm: AppModule = {
  id: 'sps-farm',
  num: 10,
  name: 'חוות הצעות SPS מנוהלת AI',
  category: 'C',
  description:
    'ארכיטקט-AI מגיש הצעות עבודה ל-Steem.DAO (10% מהאינפלציה), אנליסט-AI מדרג ומצביע במשקל SP, והמנוע מחלק תשלומים יומיים מה-SPS pool — מימון ציבורי אוטונומי.',
  ops: ['create_proposal', 'update_proposal_votes', 'comment', 'claim_reward_balance'],
  agents: [
    { name: 'ai.dao.architect', role: 'ארכיטקט DAO', sp: 15000, balance: 300, sbd: 150 },
    { name: 'ai.dao.analyst', role: 'אנליסט הצעות', sp: 8000, balance: 150, sbd: 90 },
  ],
  interval: 6,
  onTick: async (ctx) => {
    const active = await db.simProposal.findMany({ where: { status: 'active' } })

    // 1) submit a new proposal if the pipeline is thin
    if (active.filter((p) => p.creator === 'ai.dao.architect').length < 4) {
      const taken = new Set(active.map((p) => p.subject))
      const next = PROPOSALS.find((p) => !taken.has(p.subject)) ?? ctx.pick(PROPOSALS)
      await ctx.emit({
        op: 'create_proposal',
        agent: 'ai.dao.architect',
        data: {
          subject: next.subject,
          body: 'הצעה אוטומטית מהארכיטקט-AI: ניתוח ROI, משך ביצוע ומדדי הצלחה מצורפים בגוף העבודה.',
          dailyPay: next.pay,
        },
        note: `הצעת SPS חדשה: "${next.subject}" (${next.pay} SBD/יום)`,
      })
    }

    // 2) analyst votes on proposals it hasn't voted yet
    const props = await db.simProposal.findMany({ where: { status: 'active' } })
    for (const p of props.slice(0, 3)) {
      const votes = p.votes ? (JSON.parse(p.votes) as Record<string, number>) : {}
      if (votes['ai.dao.analyst']) continue
      const approve = p.dailyPay <= 35 && p.subject.length > 8 // simple value heuristic
      await ctx.emit({
        op: 'update_proposal_votes',
        agent: 'ai.dao.analyst',
        data: { proposalId: p.id, approve },
        note: approve ? `אנליסט תמך בהצעה "${p.subject}"` : `אנליסט התנגד להצעה יקרה "${p.subject}"`,
      })
    }

    // 3) architect claims DAO payouts and posts a periodic report
    const architect = await ctx.agent('ai.dao.architect')
    if (architect && architect.pendingSbd > 40) {
      await ctx.emit({ op: 'claim_reward_balance', agent: architect.name, data: {}, note: 'ארכיטקט מממש תשלומי SPS' })
    }
    const runs = (ctx.state.runs as number) ?? 0
    if (runs % 6 === 5) {
      await ctx.emit({
        op: 'comment',
        agent: 'ai.dao.architect',
        data: {
          author: 'ai.dao.architect',
          title: 'דוח SPS: לאן זורמים 10% מהאינפלציה',
          body: 'דוח אוטומטי: חלוקת התקציב, ההצעות הפעילות וההחזר על השקעה לקהילה. כל המספרים נקראים ישירות מהשרשרת.',
          tags: ['sps', 'dao'],
        },
        note: 'פרסום דוח SPS שקוף לקהילה',
      })
    }
    ctx.state.runs = runs + 1
  },
  actions: [{ id: 'report', label: 'הפק דוח DAO עם LLM' }],
  onAction: async (ctx, action) => {
    if (action !== 'report') return
    const active = await db.simProposal.findMany({ where: { status: 'active' }, take: 5 })
    const summary = active.map((p) => `• ${p.subject} — ${p.dailyPay} SBD/יום`).join('\n')
    const text = await llmText(
      'אתה ארכיטקט DAO. כתוב דוח עברית קצר ותמציתי על תיק ההצעות הפעילות.',
      `ההצעות הפעילות:\n${summary}\n\nכתוב דוח קצר.`
    )
    await ctx.emit({
      op: 'comment',
      agent: 'ai.dao.architect',
      data: {
        author: 'ai.dao.architect',
        title: '[LLM] דוח SPS שוטף',
        body: text ?? `דוח גיבוי:\n${summary}`,
        tags: ['sps', 'dao', 'llm'],
      },
      note: 'דוח DAO שנוצר עכשיו על-ידי LLM',
    })
  },
}
