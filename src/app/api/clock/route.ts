import { NextRequest, NextResponse } from 'next/server'
import { bootChain, setSpeed, startEngine, stepOnce, stopEngine } from '@/lib/steem-os/engine'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    await bootChain()
    const body = (await req.json()) as { action?: string; speed?: number }
    switch (body.action) {
      case 'start':
        await startEngine()
        break
      case 'pause':
        stopEngine()
        break
      case 'step':
        await stepOnce()
        break
      case 'speed':
        setSpeed(body.speed ?? 1)
        break
      default:
        return NextResponse.json({ error: 'unknown action' }, { status: 400 })
    }
    const st = await (await import('@/lib/db')).db.simState.findUnique({ where: { id: 1 } })
    return NextResponse.json({ ok: true, clock: { running: st?.running ?? false, speed: st?.speed ?? 1, tick: st?.tick ?? 0 } })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'clock failed' }, { status: 500 })
  }
}
