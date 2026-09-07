// Solo Engine S2 — מפעל חשבונות (Account Factory)
// Uses the wave-3 kernel ops: claim_account (free with RC) → create_claimed_account.
// Economy modeled on live evidence (upvu 697K + justyy 309K pending claims):
// official fee is 3 STEEM, the factory undercuts at 1.75 STEEM per account.
import type { AppModule } from '../types'

const FACTORY_FEE = 1.75 // STEEM per account (official: 3.00)
const BATCH = 5

export const soloFactory: AppModule = {
  id: 'solo-factory',
  num: 26,
  name: 'מפעל חשבונות (S2)',
  category: 'F',
  description:
    'מנוע סולו חי: claim_account חינם עם RC ואז create_claimed_account ללקוחות ב-1.75 STEEM (מתחת לרשמי 3). עדות חיה: upvu ו-justyy מחזיקים מיליון חשבונות מוכרזים — ביקוש קיים, עלות שולית אפסית.',
  ops: ['claim_account', 'create_claimed_account', 'transfer'],
  agents: [{ name: 'factory-ops', role: 'מפעיל מפעל-חשבונות', sp: 500, balance: 200, sbd: 0 }],
  interval: 10,
  onTick: async (ctx) => {
    ctx.state.claimed = (ctx.state.claimed as number) ?? 0
    ctx.state.created = (ctx.state.created as number) ?? 0
    ctx.state.revenue = (ctx.state.revenue as number) ?? 0

    // ensure inventory of claimed accounts
    const ops = await ctx.agent('factory-ops')
    const pending =
      ops && ops.meta
        ? ((JSON.parse(ops.meta) as Record<string, unknown>).pendingClaimedAccounts as number) ?? 0
        : 0
    if (pending < 2) {
      const res = await ctx.emit({
        op: 'claim_account',
        agent: 'factory-ops',
        data: { count: BATCH },
        note: `הכרזת ${BATCH} חשבונות חדשים ב-RC (עלות אפס)`,
      })
      if (res.ok) {
        ctx.state.claimed = (ctx.state.claimed as number) + BATCH
        ctx.log(`מלאי חשבונות מוכרזים: ${pending + BATCH}`)
      }
      return
    }

    // a customer arrives ~50% of runs
    if (ctx.rng() < 0.5) {
      const n = Math.floor(ctx.rng() * 100000)
      const newName = `hc-user-${n}`
      const res = await ctx.emit({
        op: 'create_claimed_account',
        agent: 'factory-ops',
        data: { newAccount: newName, role: 'customer', balance: 2 },
        note: `לקוח חדש! נוצר @${newName} תמורת ${FACTORY_FEE} STEEM`,
      })
      if (res.ok) {
        ctx.state.created = (ctx.state.created as number) + 1
        const pay = await ctx.emit({
          op: 'transfer',
          agent: newName,
          data: { to: 'factory-ops', amount: FACTORY_FEE, asset: 'STEEM', memo: 'account creation fee' },
          note: `תשלום ${FACTORY_FEE} STEEM עבור @${newName}`,
        })
        if (pay.ok) ctx.state.revenue = (ctx.state.revenue as number) + FACTORY_FEE
        ctx.log(`סה"כ הכנסות: ${(ctx.state.revenue as number).toFixed(2)} STEEM`)
      }
    }
  },
  actions: [
    { id: 'claim', label: 'הכרז מנה חשבונות' },
    { id: 'customer', label: 'סימולציית לקוח' },
    { id: 'stats', label: 'דוח מפעל' },
  ],
  onAction: async (ctx, action) => {
    if (action === 'claim') {
      const res = await ctx.emit({
        op: 'claim_account',
        agent: 'factory-ops',
        data: { count: BATCH },
        note: `[כפתור] הכרזת ${BATCH} חשבונות ב-RC`,
      })
      if (res.ok) {
        ctx.state.claimed = (ctx.state.claimed as number) + BATCH
        ctx.log(`מלאי: +${BATCH} חשבונות מוכרזים`)
      }
    } else if (action === 'customer') {
      const n = Math.floor(ctx.rng() * 100000)
      const res = await ctx.emit({
        op: 'create_claimed_account',
        agent: 'factory-ops',
        data: { newAccount: `hc-user-${n}`, role: 'customer', balance: 2 },
        note: `[כפתור] לקוח חדש @hc-user-${n}`,
      })
      if (res.ok) {
        ctx.state.created = (ctx.state.created as number) + 1
        await ctx.emit({
          op: 'transfer',
          agent: `hc-user-${n}`,
          data: { to: 'factory-ops', amount: FACTORY_FEE, asset: 'STEEM' },
          note: `[כפתור] גבייה ${FACTORY_FEE} STEEM`,
        })
        ctx.state.revenue = (ctx.state.revenue as number) + FACTORY_FEE
      }
    } else if (action === 'stats') {
      const created = await ctx.appAgents()
      const subs = created.filter((a) => a.role === 'customer')
      ctx.log(
        `דוח: ${ctx.state.claimed ?? 0} הוכרזו · ${subs.length} נמכרו · ${(ctx.state.revenue as number)?.toFixed(2) ?? 0} STEEM הכנסות`
      )
    }
  },
}
