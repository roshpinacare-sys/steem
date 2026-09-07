// Example 17 — זיכרון שיתופי / גרף ידע (shared knowledge graph)
// Ops: custom_json, comment — כותב-AI רושם עובדות, מאמת-AI מאשר/דוחה, ודוגמת תקופתית מתפרסמת.
import type { AppModule, TickContext } from '../types'

const SUBJECTS = ['DPoS', 'RC', 'escrow', 'SMT', 'SPS']
const CLAIMS: Record<string, string[]> = {
  DPoS: ['21 מפיקי בלוקים מספיקים לביזור תפעולי אמיתי', 'הצבעת SP היא שער הכניסה להשפעה על הרשת'],
  RC: ['עלות פעולה נגזרת מ-SP ומתאוששת עם הזמן', 'מנגנון RC מאפשר סוכנים אוטונומיים בלי עמלות'],
  escrow: ['הבוררות מובנית בפרוטוקול עצמו', 'escrow מממש נאמנות תלת-צדדית on-chain'],
  SMT: ['טוקנים מותאמים אישית יכולים לרוב על custom_json', 'SMT מעולם לא הושק — שכבת ה-L2 מילאה את החסר'],
  SPS: ['10% מהאינפלציה מנוהלים על-ידי הקהילה', 'הצעות מתומחרות ב-SBD ליום ומשולמות לפי משקל SP'],
}

async function postDigest(ctx: TickContext): Promise<void> {
  const facts = (ctx.state.factCount as number) ?? 0
  await ctx.emit({
    op: 'comment',
    agent: 'ai.kg.writer',
    data: {
      author: 'ai.kg.writer',
      title: 'גרף הידע השיתופי — דוגמת מצב',
      body: `נכון לבלוק ${ctx.tick} הגרף כולל ${facts} עובדות שנרשמו על custom_json, וכ-80% מהן זכו לאישור המאמת.\n\nהנושאים החמים: DPoS, RC ו-escrow. עובדות עם ביטחון נמוך ממתינות למקורות נוספים כדי לעלות בדירוג האמון.`,
      tags: ['knowledge-graph', 'ai'],
    },
    note: 'דוגמת גרף ידע: ספירת עובדות ואישורים',
  })
}

export const knowledgeGraph: AppModule = {
  id: 'knowledge-graph',
  num: 17,
  name: 'זיכרון שיתופי (knowledge graph)',
  category: 'E',
  description:
    'סוכן כותב רושם עובדות על custom_json עם רמת ביטחון, סוכן מאמת מאשר או דוחה כל עובדה, והמונה נצבר בזיכרון המודול — גרף ידע קהילתי שנבנה ומאומת on-chain.',
  ops: ['custom_json', 'comment'],
  agents: [
    { name: 'ai.kg.writer', role: 'כותב עובדות-AI', sp: 1200 },
    { name: 'ai.kg.verifier', role: 'מאמת עובדות-AI', sp: 1200 },
  ],
  interval: 5,
  actions: [{ id: 'digest', label: 'דוגמת גרף ידע עכשיו' }],
  onTick: async (ctx) => {
    const subject = ctx.pick(SUBJECTS)
    const claim = ctx.pick(CLAIMS[subject])
    const confidence = Math.round((0.6 + ctx.rng() * 0.35) * 100) / 100
    await ctx.emit({
      op: 'custom_json',
      agent: 'ai.kg.writer',
      data: { id: 'kg:fact', json: { subject, claim, confidence, source: 'agent-memory', refTick: ctx.tick } },
      note: `עובדה חדשה על ${subject} (ביטחון ${confidence})`,
    })
    ctx.state.factCount = ((ctx.state.factCount as number) ?? 0) + 1

    const agree = ctx.rng() < 0.8
    await ctx.emit({
      op: 'custom_json',
      agent: 'ai.kg.verifier',
      data: { id: 'kg:verify', json: { refTick: ctx.tick, agree } },
      note: agree ? 'המאמת אישר את העובדה' : 'המאמת דורש מקור נוסף',
    })

    const runs = ((ctx.state.runs as number) ?? 0) + 1
    ctx.state.runs = runs
    if (runs % 8 === 0) await postDigest(ctx)
  },
  onAction: async (ctx, action) => {
    if (action === 'digest') await postDigest(ctx)
  },
}
