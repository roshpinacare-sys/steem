import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { bootChain, runModule } from '@/lib/steem-os/engine'
import { MODULES_BY_ID } from '@/lib/steem-os/apps/registry'
import { ensureState } from '@/lib/steem-os/kernel'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    await bootChain()
    const body = (await req.json()) as {
      appId?: string
      enabled?: boolean
      action?: string
      payload?: Record<string, unknown>
    }
    const appId = body.appId
    const mod = appId ? MODULES_BY_ID[appId] : undefined
    if (!mod) return NextResponse.json({ error: 'unknown appId' }, { status: 404 })

    const inst = await db.appInstance.findUnique({ where: { id: appId } })

    // toggle enabled
    if (typeof body.enabled === 'boolean' && inst) {
      await db.appInstance.update({ where: { id: appId }, data: { enabled: body.enabled } })
      return NextResponse.json({ ok: true, enabled: body.enabled })
    }

    // manual action
    if (body.action) {
      if (!mod.onAction) return NextResponse.json({ error: 'module has no actions' }, { status: 400 })
      const st = await ensureState()
      await runModule(mod, st.tick, inst?.state ?? '{}', inst?.config ?? '{}', async (ctx) => {
        await mod.onAction!(ctx, body.action!, body.payload)
      })
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'nothing to do' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'apps failed' }, { status: 500 })
  }
}
