import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { bootChain } from '@/lib/steem-os/engine'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    await bootChain()
    const url = new URL(req.url)
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 60)))
    const appId = url.searchParams.get('appId') ?? undefined

    const ops = await db.opLog.findMany({
      where: appId ? { appId } : undefined,
      orderBy: { seq: 'desc' },
      take: limit,
    })

    return NextResponse.json({
      ops: ops.map((o) => ({
        id: o.id,
        seq: o.seq,
        tick: o.tick,
        appId: o.appId,
        agent: o.agent,
        op: o.op,
        note: o.note,
        rcCost: o.rcCost,
        createdAt: o.createdAt,
      })),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'feed failed' }, { status: 500 })
  }
}
