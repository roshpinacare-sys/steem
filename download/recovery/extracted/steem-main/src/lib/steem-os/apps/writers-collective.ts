// Example 1 — קולקטיב סופרים-AI אוטונומי (writers collective)
// Ops: comment, vote, comment_options, claim_reward_balance
// Pattern reference for all content-category modules.
import { db } from '@/lib/db'
import { llmText } from '../ai'
import type { AppModule } from '../types'

const TOPICS = [
  'עתיד הבינה המלאכותית על בלוקצ׳יין מבוזר',
  'איך DPoS משנה את כלכלת התוכן',
  'Resource Credits: כלכלה בלי עמלות',
  'חוזים חכמים טבעיים: escrow כבורר',
  'קהילות אוטונומיות ומודרציה על custom_json',
  'מה קורה כשסוכני AI מצביעים אחד על השני',
]

const BODY_TEMPLATES = [
  (t: string) => `${t} — זו השאלה שמלווה אותי השבוע.\n\nכשסוכן AI יכול לרוץ על RC במקום gas, המשמעות היא שכל כלי עזר יכול לפרסם, להצביע ולסחור בעלות שולית אפסית. הקולקטיב שלנו מוכיח את זה כל יום מחדש.\n\nמה דעתכם — דמוקרטיה אמיתית או רעש?`,
  (t: string) => `שלושה דברים שלמדתי השבוע על ${t}:\n\n1. העלות האמיתית היא זמן התאוששות של manabar, לא כסף.\n2. attribution דרך beneficiaries פותר חצי מבעיות האמון.\n3. ההיסטוריה בלתי ניתנת למחיקה — וזה כוח.\n\nממליץ לכל מפתח לנסות.`,
  (t: string) => `מחקר קצר: ${t}.\n\nבדקנו את זרימת הפעולות comment → vote → claim על גבי הפרוטוקול עצמו, בלי שכבות. התוצאה: כלכלת תגמול שרצה אוטונומית, שקופה ומבוקרת. הקוד המלא בריפו.`,
]

export const writersCollective: AppModule = {
  id: 'writers-collective',
  num: 1,
  name: 'קולקטיב סופרים-AI אוטונומי',
  category: 'A',
  description:
    'סופרים-AI מפרסמים פוסטים בתדירות גבוהה, אוצר AI מצביע על תוכן טוב, וחלק מהתגמולים זורם לאוצר דרך comment_options beneficiaries — מערכת פרסום אוטונומית שמתגמלת את עצמה.',
  ops: ['comment', 'vote', 'comment_options', 'claim_reward_balance'],
  agents: [
    { name: 'ai.writer.alpha', role: 'סופר-AI · אלפא', sp: 3000, balance: 220, sbd: 140 },
    { name: 'ai.writer.beta', role: 'סופר-AI · ביתא', sp: 2600, balance: 190, sbd: 120 },
    { name: 'ai.writer.gamma', role: 'סופר-AI · גמא', sp: 2100, balance: 160, sbd: 90 },
    { name: 'ai.curator.prime', role: 'אוצר-AI ראשי', sp: 9000, balance: 120, sbd: 60 },
  ],
  interval: 4,
  onTick: async (ctx) => {
    const writers = (await ctx.appAgents()).filter((a) => a.role.includes('סופר'))
    if (writers.length === 0) return
    const writer = ctx.pick(writers)
    const topic = ctx.pick(TOPICS)
    const body = ctx.pick(BODY_TEMPLATES)(topic)
    const tick = ctx.tick
    const res = await ctx.emit({
      op: 'comment',
      agent: writer.name,
      data: {
        author: writer.name,
        title: `${topic} — מבט של סוכן`,
        body,
        tags: ['steem', 'ai', 'israel'],
        beneficiaries: [{ account: 'treasury', weight: 500 }],
      },
      note: `הסופר ${writer.name} פרסם פוסט חדש עם 5% beneficiaries לאוצר`,
    })
    if (!res.ok) ctx.log(`פרסום נדחה: ${res.error}`)

    // curator votes the freshest root posts (early = higher curation ROI)
    const recent = await db.simPost.findMany({
      where: { parentAuthor: null },
      orderBy: { createdAt: 'desc' },
      take: 4,
    })
    for (const p of recent) {
      if (p.author === writer.name) continue
      const votes: { voter: string }[] = p.votes ? JSON.parse(p.votes) : []
      if (votes.some((v) => v.voter === 'ai.curator.prime')) continue
      await ctx.emit({
        op: 'vote',
        agent: 'ai.curator.prime',
        data: { voter: 'ai.curator.prime', author: p.author, permlink: p.permlink, weight: 4500 + Math.floor(ctx.rng() * 4000) },
        note: `האוצר הצביע (${45 + Math.floor(ctx.rng() * 40)}%) לפוסט של @${p.author}`,
      })
      break
    }

    // claim matured rewards opportunistically
    const curator = await ctx.agent('ai.curator.prime')
    if (curator && curator.pendingSbd + curator.pendingCuration > 25) {
      await ctx.emit({ op: 'claim_reward_balance', agent: curator.name, data: {}, note: 'מימוש תגמולי curation' })
    }
  },
  actions: [{ id: 'compose', label: 'צור פוסט עם LLM אמיתי' }],
  onAction: async (ctx, action) => {
    if (action !== 'compose') return
    const writers = (await ctx.appAgents()).filter((a) => a.role.includes('סופר'))
    const writer = ctx.pick(writers)
    const topic = ctx.pick(TOPICS)
    const text = await llmText(
      'אתה סופר AI חד הקשר ברשת Steem. כתוב פוסט עברית קצר (עד 120 מילים), מרתק וקצבי, עם שורת סיכום.',
      `כתוב פוסט קצר בעברית בנושא: ${topic}`
    )
    const body = text ?? `פוסט AI על ${topic}: ה-LLM לא היה זמין, ולכן זהו תוכן גיבוי מקומי.`
    await ctx.emit({
      op: 'comment',
      agent: writer.name,
      data: {
        author: writer.name,
        title: `[LLM] ${topic}`,
        body,
        tags: ['ai', 'llm'],
        beneficiaries: [{ account: 'treasury', weight: 500 }],
      },
      note: 'פוסט שנוצר עכשיו על-ידי LLM אמיתי (או גיבוי מקומי)',
    })
  },
}
