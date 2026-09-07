// Example 2 — רשת דמויות אינטראקטיבית (interactive characters)
// Ops: comment, vote — דמויות-AI כותבות סאגה מתמשכת, קוראים מגיבים, ודמות שנייה עונה.
import { db } from '@/lib/db'
import type { AppModule } from '../types'

const CHARACTERS = ['ai.character.nova', 'ai.character.orion', 'ai.character.luna']
const READERS = ['crypto-orli', 'dev-yoav', 'maya.writes']
const PLOTS = [
  (c: string) => `פרק בסאגה: ${c} מגלה מנוע קונצנזוס עתיק שכותב בלוקים בעברית. הגילוי מטלטל את מאזן הכוחות בין ה-witnesses.\n\nהעלילה נמשכת מהפרק הקודם — והקהל מחליט מה יקרה בהמשך.`,
  (c: string) => `${c} יורד אל מעמקי ה-mempool בחיפוש העסקה האבודה. ככל שצולל יותר, ההבנה שלו על RC ועל כלכלת הרשת מתעמקת.\n\nכל תגובה של קורא משנה את פני הסיפור.`,
  (c: string) => `מפגש עם ה-witness המסתורי: ${c} מבין שה-price feed הוא לא רק מספר אלא הצהרת אמון.\n\nהפרק נכתב בזמן אמת על השרשרת — אין עריכות, יש רק קדימה.`,
]
const READER_LINES = [
  'וואו, זה הפרק הכי חזק עד עכשיו — מה יקרה עם ה-mempool בהמשך?',
  'קוראת מהקהל: אני מהמרת שהדמות תחזור עם הפתרון כבר בפרק הבא.',
  'העלילה מרגישה חיה כי היא נכתבת על השרשרת עצמה — ממשיכים!',
]

export const interactiveCharacters: AppModule = {
  id: 'interactive-characters',
  num: 2,
  name: 'רשת דמויות אינטראקטיבית',
  category: 'A',
  description:
    'שלוש דמויות-AI כותבות סיפור המשכי בפרקים עם מונה עלילה מתמשך, אזרחים מגיבים כ"קוראים" על פוסטים טריים, ודמות אחרת עונה לכל תגובה — נרטיב אינטראקטיבי שנכתב בשיתוף הקהל.',
  ops: ['comment', 'vote'],
  agents: [
    { name: 'ai.character.nova', role: 'דמות-AI · נובה', sp: 2200 },
    { name: 'ai.character.orion', role: 'דמות-AI · אוריון', sp: 2000 },
    { name: 'ai.character.luna', role: 'דמות-AI · לונה', sp: 1800 },
  ],
  interval: 5,
  onTick: async (ctx) => {
    const chapter = ((ctx.state.chapter as number) ?? 0) + 1
    const actor = ctx.pick(CHARACTERS)
    const res = await ctx.emit({
      op: 'comment',
      agent: actor,
      data: {
        author: actor,
        title: `הסאגה על השרשרת — פרק ${chapter}`,
        body: ctx.pick(PLOTS)(actor),
        tags: ['story', 'ai'],
      },
      note: `הדמות ${actor} פרסמה את פרק ${chapter} בסאגה המתמשכת`,
    })
    if (res.ok) ctx.state.chapter = chapter

    const recent = await db.simPost.findMany({ where: { parentAuthor: null }, orderBy: { createdAt: 'desc' }, take: 6 })
    if (recent.length === 0) return
    const target = ctx.pick(recent)
    const reader = ctx.pick(READERS)
    const rPermlink = `reader-note-${ctx.tick}-${Math.floor(ctx.rng() * 100000)}`
    const rc = await ctx.emit({
      op: 'comment',
      agent: reader,
      data: {
        author: reader,
        title: 'תגובת קורא',
        body: ctx.pick(READER_LINES),
        parentAuthor: target.author,
        parentPermlink: target.permlink,
        permlink: rPermlink,
      },
      note: `הקורא @${reader} מגיב לפוסט של @${target.author}`,
    })
    if (rc.ok) {
      const replier = ctx.pick(CHARACTERS.filter((c) => c !== actor))
      await ctx.emit({
        op: 'comment',
        agent: replier,
        data: {
          author: replier,
          title: 'תשובת הדמות',
          body: `${replier} עונה לקורא: התגובה שלך נכנסה לעלילה — בפרק הבא תרגיש את ההשפעה. זה הקסם של כתיבה על שרשרת בלתי ניתנת לעריכה.`,
          parentAuthor: reader,
          parentPermlink: rPermlink,
        },
        note: `דמות-AI ענתה לתגובת הקורא @${reader}`,
      })
    }
    await ctx.emit({
      op: 'vote',
      agent: actor,
      data: { voter: actor, author: target.author, permlink: target.permlink, weight: 3000 + Math.floor(ctx.rng() * 4000) },
      note: `הדמות ${actor} הצביעה לפוסט של @${target.author}`,
    })
  },
}
