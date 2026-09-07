// Example 6 — שוק P2P עם escrow טבעי ובורר AI (escrow marketplace)
// Ops: custom_json, escrow_transfer, escrow_approve, escrow_dispute, escrow_release
// Reference pattern for the native-contract category (state machines over protocol ops).
import { db } from '@/lib/db'
import { llmText } from '../ai'
import type { AppModule } from '../types'

const ITEMS = ['כרטיס מסחרי דיגיטלי', 'סט נפט נדיר', 'ייעוץ טכני של שעה', 'רישוי תמונה', 'קורס קידוד מוקלט']
 
type EscrowMeta = Record<string, any>

export const escrowMarket: AppModule = {
  id: 'escrow-market',
  num: 6,
  name: 'שוק P2P עם בורר AI',
  category: 'B',
  description:
    'סוחר מפרסם מוצרים כ-custom_json, קונה נועל כסף ב-escrow_transfer עם בורר-AI, והבורר מאשר, פותר סכסוכים ומשחרר — escrow טבעי בפרוטוקול, בלי חוזה חכם.',
  ops: ['custom_json', 'escrow_transfer', 'escrow_approve', 'escrow_dispute', 'escrow_release'],
  agents: [
    { name: 'ai.arbitrator.nexus', role: 'בורר-AI', sp: 5000, balance: 500, sbd: 300 },
    { name: 'merchant.iron', role: 'סוחר', sp: 1500, balance: 300, sbd: 80 },
    { name: 'buyer.hank', role: 'קונה', sp: 900, balance: 350, sbd: 200 },
  ],
  interval: 5,
  onTick: async (ctx) => {
    const escrows = await db.simEscrow.findMany({
      where: { appId: 'escrow-market' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })

    // 1) new listing from time to time
    const listings = (ctx.state.listings as number) ?? 0
    if (ctx.rng() < 0.4) {
      const item = ctx.pick(ITEMS)
      const price = 5 + Math.floor(ctx.rng() * 20)
      await ctx.emit({
        op: 'custom_json',
        agent: 'merchant.iron',
        data: { id: 'market:listing', json: { item, price, seller: 'merchant.iron', listingId: listings + 1 } },
        note: `מודעה חדשה: ${item} ב-${price} SBD`,
      })
      ctx.state.listings = listings + 1
    }

    // 2) buyer opens an escrow for a listing occasionally
    if (ctx.rng() < 0.45) {
      const price = 5 + Math.floor(ctx.rng() * 20)
      await ctx.emit({
        op: 'escrow_transfer',
        agent: 'buyer.hank',
        data: { to: 'merchant.iron', arbiter: 'ai.arbitrator.nexus', amount: price, asset: 'SBD', memo: `רכישה #${listings}` },
        note: `הקונה נעל ${price} SBD ב-escrow`,
      })
    }

    // 3) arbitrator advances the state machine
    for (const esc of escrows) {
      let meta: EscrowMeta = {}
      try {
        meta = esc.meta ? JSON.parse(esc.meta) : {}
      } catch {
        meta = {}
      }
      if (esc.status === 'held') {
        await ctx.emit({
          op: 'escrow_approve',
          agent: 'ai.arbitrator.nexus',
          data: { escrowId: esc.id },
          note: 'הבורר אישר את עסקת ה-escrow',
        })
      } else if (esc.status === 'approved') {
        if (ctx.rng() < 0.22) {
          await ctx.emit({
            op: 'escrow_dispute',
            agent: 'buyer.hank',
            data: { escrowId: esc.id },
            note: 'הקונה פתח סכסוך — המוצר לא הגיע כמתואר',
          })
        } else {
          await ctx.emit({
            op: 'escrow_release',
            agent: 'ai.arbitrator.nexus',
            data: { escrowId: esc.id, toReceiver: true },
            note: 'הבורר שחרר את הכסף למוכר — עסקה תקינה',
          })
        }
      } else if (esc.status === 'disputed') {
        const decision = ctx.rng() < 0.7 ? 'release' : 'refund'
        await ctx.emit({
          op: 'escrow_release',
          agent: 'ai.arbitrator.nexus',
          data: { escrowId: esc.id, toReceiver: decision === 'release' },
          note: decision === 'release' ? 'בורר-AI: ההחלטה לטובת המוכר' : 'בורר-AI: החזר לקונה',
        })
      }
      void meta
    }
  },
  actions: [{ id: 'arbitrate', label: 'בקש פסיקה מ-LLM על סכסוך פתוח' }],
  onAction: async (ctx, action) => {
    if (action !== 'arbitrate') return
    const disputed = await db.simEscrow.findFirst({ where: { appId: 'escrow-market', status: 'disputed' } })
    if (!disputed) {
      ctx.log('אין סכסוכים פתוחים לפסיקה')
      return
    }
    const verdict = await llmText(
      'אתה בורר AI בשוק escrow. קבל החלטה קצרה ומנומקת בעברית: לטובת המוכר או הקונה.',
      `תיאור העסקה: ${disputed.memo ?? 'רכישה כללית'}, סכום ${disputed.amount} ${disputed.asset}. הקונה טוען שהמוצר לא כמתואר.`
    )
    const release = verdict ? !verdict.includes('קונה') : ctx.rng() < 0.6
    await ctx.emit({
      op: 'escrow_release',
      agent: 'ai.arbitrator.nexus',
      data: { escrowId: disputed.id, toReceiver: release },
      note: `פסיקת LLM: ${release ? 'לטובת המוכר' : 'לטובת הקונה'} — ${verdict?.slice(0, 90) ?? 'ברירת מחדל'}`,
    })
  },
}
