import { NextResponse } from 'next/server'
import { resetAll } from '@/lib/steem-os/seed'
import { stopEngine } from '@/lib/steem-os/engine'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    stopEngine()
    await resetAll()
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'reset failed' }, { status: 500 })
  }
}
