// Example 9 — גשר חוצה-שרשראות (cross-chain bridge)
// Ops: custom_json, escrow_transfer, escrow_release — lock באתריום, נעילה ב-escrow, ושחרור לנמען.
import type { AppModule } from '../types'

const CITIZENS = ['crypto-orli', 'dev-yoav', 'maya.writes', 'shai-photography', 'noa-travels', 'itamar.dev', 'gal-tech', 'talia.art']

export const chainBridge: AppModule = {
  id: 'bridge',
  num: 9,
  name: 'גשר חוצה-שרשראות',
  category: 'B',
  description:
    'המפעיל מדמה אירועי lock מצד אתריום (custom_json bridge:lock), נועל את הכספים ב-escrow טבעי עם הבורר-AI, ומשחרר לנמען אחרי האישור — עם מגבלה של 2 גשרים בטיסה לביטחון.',
  ops: ['custom_json', 'escrow_transfer', 'escrow_release'],
  agents: [{ name: 'ai.bridge.operator', role: 'מפעיל גשר-AI', sp: 2500, balance: 600, sbd: 200 }],
  interval: 9,
  onTick: async (ctx) => {
    const pending = (ctx.state.pendingIds as string[]) ?? []
    ctx.state.pendingBridges = pending.length

    // 1) new inbound lock + escrow lock-in (cap: max 2 bridges in flight)
    if (pending.length < 2) {
      const recipient = ctx.pick(CITIZENS)
      const amount = Math.round((5 + ctx.rng() * 10) * 100) / 100
      const seq = ((ctx.state.sequence as number) ?? 0) + 1
      ctx.state.sequence = seq
      await ctx.emit({
        op: 'custom_json',
        agent: 'ai.bridge.operator',
        data: { id: 'bridge:lock', json: { chain: 'ethereum', asset: 'WBTC', amount, recipient, seq } },
        note: `אירוע lock מאתריום: ${amount} WBTC עבור @${recipient}`,
      })
      const esc = await ctx.emit({
        op: 'escrow_transfer',
        agent: 'ai.bridge.operator',
        data: { to: recipient, arbiter: 'ai.arbitrator.nexus', amount, asset: 'SBD', memo: 'bridge release' },
        note: `הגשר נועל ${amount} SBD ב-escrow עבור @${recipient}`,
      })
      if (esc.ok && esc.refId) pending.push(esc.refId)
    }

    // 2) release one matured bridge (sender is allowed to release to the receiver)
    if (pending.length > 0 && ctx.rng() < 0.7) {
      const escrowId = pending.shift()
      if (escrowId) {
        await ctx.emit({
          op: 'escrow_release',
          agent: 'ai.bridge.operator',
          data: { escrowId, toReceiver: true },
          note: 'הגשר שחרר את הכספים לנמען — העברה חוצת-שרשראות הושלמה',
        })
      }
    }
    ctx.state.pendingIds = pending
    ctx.state.pendingBridges = pending.length
  },
}
