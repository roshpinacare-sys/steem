import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { bootChain } from '@/lib/steem-os/engine'
import { ALL_MODULES } from '@/lib/steem-os/apps/registry'
import { CATEGORY_META } from '@/lib/steem-os/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await bootChain()
    const st = await db.simState.findUnique({ where: { id: 1 } })
    const agents = await db.agent.findMany({ orderBy: { sp: 'desc' } })
    const instances = await db.appInstance.findMany()
    const posts = await db.simPost.count()
    const opsLast100 = await db.opLog.count({ where: { seq: { gt: Math.max(0, (st?.totalOps ?? 0) - 100) } } })

    const treasury = agents.find((a) => a.name === 'treasury')

    const apps = ALL_MODULES.map((m) => {
      const inst = instances.find((i) => i.id === m.id)
      return {
        id: m.id,
        num: m.num,
        name: m.name,
        category: m.category,
        description: m.description,
        ops: m.ops,
        interval: inst?.interval ?? m.interval,
        enabled: inst?.enabled ?? false,
        runs: inst?.runs ?? 0,
        opsEmitted: inst?.opsEmitted ?? 0,
        lastNote: inst?.lastNote ?? null,
        lastTickAt: inst?.lastTickAt ?? null,
        actions: m.actions ?? [],
        agents: m.agents.map((a) => a.name),
      }
    })

    return NextResponse.json({
      clock: { running: st?.running ?? false, speed: st?.speed ?? 1, tick: st?.tick ?? 0 },
      meta: {
        feedPrice: st?.feedPrice ?? 0.32,
        rewardPool: Math.round((st?.rewardPool ?? 0) * 100) / 100,
        spsPool: Math.round((st?.spsPool ?? 0) * 100) / 100,
        totalOps: st?.totalOps ?? 0,
      },
      kpis: {
        agents: agents.length,
        apps: apps.length,
        appsEnabled: apps.filter((a) => a.enabled).length,
        posts,
        opsTotal: st?.totalOps ?? 0,
        opsLast100,
      },
      categories: CATEGORY_META,
      agents: agents.map((a) => ({
        name: a.name,
        role: a.role,
        appId: a.appId,
        sp: Math.round(a.sp),
        rc: Math.round(a.rc),
        rcCap: Math.round(a.rcCap),
        balance: Math.round(a.balance * 100) / 100,
        sbd: Math.round(a.sbd * 100) / 100,
        savings: Math.round(a.savings * 100) / 100,
        savingsSbd: Math.round(a.savingsSbd * 100) / 100,
        pendingSbd: Math.round(a.pendingSbd * 100) / 100,
        pendingCuration: Math.round(a.pendingCuration * 100) / 100,
        witness: a.witness,
      })),
      apps,
      treasury: {
        steem: Math.round((treasury?.balance ?? 0) * 100) / 100,
        sbd: Math.round((treasury?.sbd ?? 0) * 100) / 100,
        sp: Math.round((treasury?.sp ?? 0) * 100) / 100,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'state failed' }, { status: 500 })
  }
}
