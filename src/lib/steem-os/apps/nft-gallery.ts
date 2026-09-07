// Example 15 — גלריית NFT מנוהלת AI (AI-curated NFT gallery)
// Ops: custom_json, escrow_transfer, escrow_release — מנטות מפוסטים, מדף מחירים, ומכירות דרך escrow טבעי.
import { db } from '@/lib/db'
import type { AppModule } from '../types'

type HistEntry = { event: string; owner: string; tick: number }

export const nftGallery: AppModule = {
  id: 'nft-gallery',
  num: 15,
  name: 'גלריית NFT מנוהלת AI',
  category: 'D',
  description:
    'אוצרת-AI הופכת פוסטים טריים ל-NFT בגלריית steem-ai-gallery (מנטה על custom_json + אינדקס NftItem), מעלה פריטים למדף 10-30 SBD, ומוכרת דרך escrow טבעי עם בורר — עדכון בעלות והיסטוריה on-chain.',
  ops: ['custom_json', 'escrow_transfer', 'escrow_release'],
  agents: [{ name: 'ai.gallery.curator', role: 'אוצרת גלריה-AI', sp: 3000, balance: 300, sbd: 150 }],
  interval: 6,
  onTick: async (ctx) => {
    // 1) mint an NFT from a recent post (50%)
    if (ctx.rng() < 0.5) {
      const recent = await db.simPost.findMany({ where: { parentAuthor: null }, orderBy: { createdAt: 'desc' }, take: 5 })
      const post = recent.length > 0 ? ctx.pick(recent) : null
      if (post) {
        const tokenId = `ai-${((ctx.state.minted as number) ?? 0) + 1}`
        await db.nftItem.create({
          data: {
            appId: 'nft-gallery',
            collection: 'steem-ai-gallery',
            tokenId,
            owner: post.author,
            title: post.title.slice(0, 120),
            meta: JSON.stringify({ permlink: post.permlink, author: post.author }),
            history: JSON.stringify([{ event: 'mint', owner: post.author, tick: ctx.tick }]),
          },
        })
        await ctx.emit({
          op: 'custom_json',
          agent: 'ai.gallery.curator',
          data: { id: 'nft:mint', json: { collection: 'steem-ai-gallery', tokenId, creator: post.author, permlink: post.permlink } },
          note: `מנטת NFT ${tokenId} מהפוסט של @${post.author}`,
        })
        ctx.state.minted = ((ctx.state.minted as number) ?? 0) + 1
      }
    }

    // 2) list one item for sale (40%)
    if (ctx.rng() < 0.4) {
      const item = await db.nftItem.findFirst({ where: { appId: 'nft-gallery', forSale: false }, orderBy: { createdAt: 'desc' } })
      if (item) {
        const price = Math.round(10 + ctx.rng() * 20)
        await db.nftItem.update({ where: { id: item.id }, data: { forSale: true, price } })
        await ctx.emit({
          op: 'custom_json',
          agent: 'ai.gallery.curator',
          data: { id: 'nft:list', json: { tokenId: item.tokenId, price } },
          note: `${item.tokenId} עלה למדף ב-${price} SBD`,
        })
      }
    }

    // 3) buy a listed item via native escrow, then auto-release (60%)
    if (ctx.rng() < 0.6) {
      const item = await db.nftItem.findFirst({ where: { appId: 'nft-gallery', forSale: true }, orderBy: { createdAt: 'desc' } })
      const buyer = await ctx.agent('ai.gallery.curator')
      if (item?.price && buyer && buyer.sbd >= item.price) {
        const esc = await ctx.emit({
          op: 'escrow_transfer',
          agent: buyer.name,
          data: { to: item.owner, arbiter: 'ai.arbitrator.nexus', amount: item.price, asset: 'SBD', memo: `רכישת NFT ${item.tokenId}` },
          note: `הקונה נעל ${item.price} SBD ב-escrow עבור ${item.tokenId}`,
        })
        if (esc.ok && esc.refId) {
          await ctx.emit({
            op: 'escrow_release',
            agent: buyer.name,
            data: { escrowId: esc.refId, toReceiver: true },
            note: 'שחרור אוטומטי — ה-NFT עובר לקונה',
          })
          const hist: HistEntry[] = item.history ? JSON.parse(item.history) : []
          hist.push({ event: 'sale', owner: buyer.name, tick: ctx.tick })
          await db.nftItem.update({
            where: { id: item.id },
            data: { owner: buyer.name, forSale: false, price: null, history: JSON.stringify(hist) },
          })
          await ctx.emit({
            op: 'custom_json',
            agent: buyer.name,
            data: { id: 'nft:sale', json: { tokenId: item.tokenId, from: item.owner, to: buyer.name, price: item.price } },
            note: `נמכר: ${item.tokenId} → @${buyer.name}`,
          })
        }
      }
    }
  },
}
