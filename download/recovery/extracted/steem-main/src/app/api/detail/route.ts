import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { bootChain } from '@/lib/steem-os/engine'
import { MODULES_BY_ID } from '@/lib/steem-os/apps/registry'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    await bootChain()
    const url = new URL(req.url)
    const appId = url.searchParams.get('appId')
    if (!appId) return NextResponse.json({ error: 'appId required' }, { status: 400 })
    const mod = MODULES_BY_ID[appId]
    if (!mod) return NextResponse.json({ error: 'unknown appId' }, { status: 404 })

    const [posts, escrows, proposals, orders, customs, tokens, nfts] = await Promise.all([
      db.simPost.findMany({ where: { appId }, orderBy: { createdAt: 'desc' }, take: 12 }),
      db.simEscrow.findMany({ where: { appId }, orderBy: { createdAt: 'desc' }, take: 12 }),
      db.simProposal.findMany({ where: { appId }, orderBy: { createdAt: 'desc' }, take: 12 }),
      db.simOrder.findMany({ where: { appId }, orderBy: { createdAt: 'desc' }, take: 12 }),
      db.simCustom.findMany({ where: { appId }, orderBy: { createdAt: 'desc' }, take: 12 }),
      db.tokenBalance.findMany({ where: { appId }, orderBy: { amount: 'desc' }, take: 12 }),
      db.nftItem.findMany({ where: { appId }, orderBy: { createdAt: 'desc' }, take: 12 }),
    ])

    return NextResponse.json({
      app: { id: mod.id, num: mod.num, name: mod.name, description: mod.description, ops: mod.ops },
      posts: posts.map((p) => ({
        author: p.author,
        permlink: p.permlink,
        title: p.title,
        body: p.body.slice(0, 220),
        isComment: !!p.parentAuthor,
        pending: Math.round(p.pending * 100) / 100,
        votes: p.votes ? JSON.parse(p.votes).length : 0,
      })),
      escrows: escrows.map((e) => ({
        id: e.id.slice(-6),
        from: e.from,
        to: e.to,
        arbiter: e.arbiter,
        amount: e.amount,
        asset: e.asset,
        status: e.status,
        memo: e.memo,
      })),
      proposals: proposals.map((p) => ({
        subject: p.subject,
        creator: p.creator,
        dailyPay: p.dailyPay,
        paid: Math.round(p.paid * 100) / 100,
        status: p.status,
        votes: p.votes ? Object.keys(JSON.parse(p.votes)).length : 0,
      })),
      orders: orders.map((o) => ({ owner: o.owner, side: o.side, amount: o.amount, price: o.price, status: o.status })),
      customs: customs.map((c) => ({ agent: c.agent, jsonId: c.jsonId, payload: c.payload.slice(0, 180), tick: c.tick })),
      tokens: tokens.map((t) => ({ token: t.token, account: t.account, amount: Math.round(t.amount * 100) / 100 })),
      nfts: nfts.map((n) => ({ tokenId: n.tokenId, owner: n.owner, title: n.title, forSale: n.forSale, price: n.price })),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'detail failed' }, { status: 500 })
  }
}
