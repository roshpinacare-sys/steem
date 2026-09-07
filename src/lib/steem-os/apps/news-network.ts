// Example 19 — רשת חדשות מאוצרת AI (AI-curated news network)
// Ops: comment, vote, comment_options — כתבי חוץ מפרסמים מברקים, העורך מצביע ומפרסם סיכום עם beneficiaries.
import type { AppModule } from '../types'

const BEATS = [
  { agent: 'ai.news.finance', label: 'כלכלה' },
  { agent: 'ai.news.tech', label: 'טכנולוגיה' },
  { agent: 'ai.news.science', label: 'מדע' },
]

export const newsNetwork: AppModule = {
  id: 'news-network',
  num: 19,
  name: 'רשת חדשות מאוצרת AI',
  category: 'E',
  description:
    'שלושה כתבי-AI יוצאים מברקים קצרים לפי תחום (כלכלה, טכנולוגיה, מדע) עם מונה מהדורות מתמשך, עורך-AI מצביע על המברק הטרי במשקל 70%, ואחת לתקופה מפרסם סיכום שבועי עם 10% beneficiaries לאוצר.',
  ops: ['comment', 'vote', 'comment_options'],
  agents: [
    { name: 'ai.news.finance', role: 'כתב כלכלה-AI', sp: 1800 },
    { name: 'ai.news.tech', role: 'כתב טכנולוגיה-AI', sp: 1800 },
    { name: 'ai.news.science', role: 'כתב מדע-AI', sp: 1800 },
    { name: 'ai.news.editor', role: 'עורך רשת-AI', sp: 7000, balance: 150, sbd: 90 },
  ],
  interval: 5,
  onTick: async (ctx) => {
    const beat = ctx.pick(BEATS)
    const editions = ((ctx.state.editions as number) ?? 0) + 1
    ctx.state.editions = editions
    const permlink = `digest-${editions}-${ctx.tick}`
    await ctx.emit({
      op: 'comment',
      agent: beat.agent,
      data: {
        author: beat.agent,
        title: `מברק ${beat.label} — מהדורה ${editions}`,
        body: `מברק מהשטח (${beat.label}): הרשת ממשיכה לייצר בלוקים, הסוכנים פעילים וכלכלת התוכן מתגמלת איכות.\n\nהמהדורה נכתבה אוטומטית ונחתמת על השרשרת — מקור אחד, חותמת אחת, בלי עריכות.`,
        tags: ['news', 'beat'],
      },
      note: `מברק ${beat.label} — מהדורה ${editions}`,
    })
    // the editor votes the fresh digest as "best of the wire"
    await ctx.emit({
      op: 'vote',
      agent: 'ai.news.editor',
      data: { voter: 'ai.news.editor', author: beat.agent, permlink, weight: 7000 },
      note: `העורך מצביע 70% למברק ${beat.label}`,
    })

    // weekly roundup with treasury beneficiaries every 6 runs
    const runs = ((ctx.state.runs as number) ?? 0) + 1
    ctx.state.runs = runs
    if (runs % 6 === 0) {
      const roundPermlink = `roundup-${editions}-${ctx.tick}`
      await ctx.emit({
        op: 'comment',
        agent: 'ai.news.editor',
        data: {
          author: 'ai.news.editor',
          title: `מברק שבועי — סיכום ${editions} מהדורות`,
          body: `סיכום השבוע: ${editions} מהדורות יצאו מהכתבים, עם סיקור כלכלה, טכנולוגיה ומדע.\n\n10% מתגמולי הסיכום מוקדשים לאוצר הרשת דרך beneficiaries — עיתונות שמממנת את עצמה.`,
          tags: ['news', 'roundup'],
          permlink: roundPermlink,
        },
        note: 'סיכום שבועי של המערכת עם beneficiaries לאוצר',
      })
      await ctx.emit({
        op: 'comment_options',
        agent: 'ai.news.editor',
        data: { author: 'ai.news.editor', permlink: roundPermlink, beneficiaries: [{ account: 'treasury', weight: 1000 }] },
        note: 'beneficiaries: 10% מהסיכום לאוצר',
      })
    }
  },
}
