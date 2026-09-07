// Solo Engine S5 — אורקל שאל-ושלם (Pay-to-Ask AI Oracle)
// Sim flow: a customer pays SBD with a memo question → oracle-core answers with
// a real LLM call (ai.ts) and posts the answer. Live twin: /api/solo/oracle
// reads REAL incoming transfers to @headcorner (read-only) and drafts answers.
import { llmText } from '../ai'
import type { AppModule } from '../types'

const SAMPLE_QUESTIONS = [
  'מה היתרון של delegate_vesting_shares על פני מכירת SP?',
  'איך מחשבים שווי הצבעה מלאה מול מאגר התגמולים?',
  'כמה RC צריך כדי להכריז חשבון חדש?',
  'מה ההבדל בין transfer_to_savings ל-transfer רגיל?',
  'איך עובד חלון ה-5 דקות בקורצין?',
]
const CITIZENS = ['crypto-orli', 'dev-yoav', 'maya.writes', 'noa-travels', 'gal-tech']

export const soloOracle: AppModule = {
  id: 'solo-oracle',
  num: 27,
  name: 'אורקל שאל-ושלם (S5)',
  category: 'E',
  description:
    'לקוח שולח SBD עם שאלה ב-memo → האורקל עונה ב-LLM אמיתי ומפרסם תשובה ציבורית. מנוע לידים לכל שירותי הסולו; התאום החי קורא העברות אמיתיות לחשבון (קריאה בלבד) ומטייטל תשובות.',
  ops: ['transfer', 'comment'],
  agents: [{ name: 'oracle-core', role: 'אורקל AI', sp: 300, balance: 100, sbd: 20 }],
  interval: 8,
  onTick: async (ctx) => {
    const questions = (ctx.state.questions as { id: string; from: string; q: string; answered?: boolean }[]) ?? []

    // ~40% of runs: a new paid question arrives
    if (ctx.rng() < 0.4) {
      const q = ctx.pick(SAMPLE_QUESTIONS)
      const from = ctx.pick(CITIZENS)
      questions.push({ id: `q-${Date.now()}-${Math.floor(ctx.rng() * 1000)}`, from, q })
      ctx.state.questions = questions.slice(-12)
      await ctx.emit({
        op: 'transfer',
        agent: from,
        data: { to: 'oracle-core', amount: 0.5, asset: 'SBD', memo: q },
        note: `שאלה בתשלום מ-@${from}: "${q.slice(0, 40)}..."`,
      })
    }

    // answer the first unanswered question with a real LLM call
    const pending = questions.find((x) => !x.answered)
    if (!pending) return
    const answer =
      (await llmText(
        "אתה מומחה Steem. ענה בעברית בקצרה (2-3 משפטים), מעשי ומדויק.",
        `שאלת הלקוח: ${pending.q}`
      )) ??
      `שאלה טובה. בקצרה: המנגנון מתועד ב-KEY_CAPABILITIES.md של הפלטפורמה — ${pending.q.includes('RC') ? 'הכרזת חשבונות נצרכת ממאגר RC הנגזר מה-SP שלך' : 'הכלי מאוזן על-ידי כלכלת המדף של הרשת'}.`
    await ctx.emit({
      op: 'comment',
      agent: 'oracle-core',
      data: { title: `תשובה: ${pending.q.slice(0, 50)}`, body: `שאלת @${pending.from}: ${pending.q}\n\n${answer}` },
      note: `האורקל ענה (LLM) ל-@${pending.from}`,
    })
    pending.answered = true
    ctx.state.questions = questions
  },
  actions: [
    { id: 'ask', label: 'שאלה נכנסת' },
    { id: 'answer', label: 'ענה עכשיו (LLM)' },
  ],
  onAction: async (ctx, action) => {
    if (action === 'ask') {
      const questions = (ctx.state.questions as { id: string; from: string; q: string }[]) ?? []
      const q = `שאלה ידנית #${questions.length + 1}: איך למטב את ה-SP שלי השבוע?`
      questions.push({ id: `q-${Date.now()}`, from: 'crypto-orli', q })
      ctx.state.questions = questions
      await ctx.emit({
        op: 'transfer',
        agent: 'crypto-orli',
        data: { to: 'oracle-core', amount: 0.5, asset: 'SBD', memo: q },
        note: `[כפתור] שאלה בתשלום נכנסה`,
      })
    } else if (action === 'answer') {
      const questions = (ctx.state.questions as { id: string; from: string; q: string; answered?: boolean }[]) ?? []
      const pending = questions.find((x) => !x.answered)
      if (!pending) {
        ctx.log('אין שאלות ממתינות')
        return
      }
      const answer = await llmText(
        "אתה מומחה Steem. ענה בעברית בקצרה (2-3 משפטים), מעשי ומדויק.",
        `שאלת הלקוח: ${pending.q}`
      )
      await ctx.emit({
        op: 'comment',
        agent: 'oracle-core',
        data: { title: `תשובה: ${pending.q.slice(0, 50)}`, body: answer ?? '(ללא תשובה)' },
        note: `[כפתור] האורקל ענה ל-@${pending.from}`,
      })
      pending.answered = true
      ctx.state.questions = questions
    }
  },
}
