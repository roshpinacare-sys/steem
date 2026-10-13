'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Coins, RefreshCw } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatusBadge } from './StatusBadge'
import { cn } from '@/lib/utils'

/**
 * R287 · THE HIGH-DENSITY CONTENT COMPILER RAIL (the operator's view of the
 * staging buffer). Polls /api/saos/revenue (a thin reader over the engine's
 * own compiled state) every 60s. Shows: the BROADCAST-READY buffer with each
 * package's content-address, byte density, scrub count and L-26 cadence
 * slot; the compile verdict; the T-15 custody gate. This rail NEVER
 * broadcasts — the staging buffer is the deliverable, broadcasting stays
 * owned by the custody-gated social rails (one-body law).
 */

type Pkg = {
  id: string | null
  title: string | null
  chain: string | null
  state: string | null
  bytes: number | null
  words: number | null
  scrubbed: number | null
  frozen: boolean
  eligibleAt: string | null
}

type RevenueState = {
  ok: boolean
  state: 'LIVE' | 'STALE'
  ageMin: number | null
  verdict: string | null
  custodyGate: string | null
  headCid: string | null
  stats: { staged: number; rejected: number; dupDropped: number; scrubHits: number; bufferMax: number } | null
  packages: Pkg[]
  law: string
}

const POLL_MS = 60_000

export function RevenueRailCard() {
  const [data, setData] = useState<RevenueState | null>(null)
  const [loading, setLoading] = useState(false)
  const [netErr, setNetErr] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/saos/revenue', { cache: 'no-store' })
      const j = (await r.json()) as RevenueState
      if (j?.ok) {
        setData(j)
        setNetErr(false)
      }
    } catch {
      setNetErr(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    timer.current = setInterval(load, POLL_MS)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [load])

  const frozen = (data?.custodyGate ?? '').startsWith('FROZEN')
  const ready = data?.stats?.staged ?? 0

  return (
    <Card className={cn('py-0 backdrop-blur-sm', frozen ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 to-slate-900/60')}>
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg border border-emerald-500/30 bg-emerald-500/10">
              <Coins className="h-5 w-5 text-emerald-400" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-bold text-emerald-300">מהדר-התוכן · מאגר-BROADCAST-READY <span dir="ltr" className="text-slate-500">(R287)</span></p>
              <p className="text-[11px] text-slate-500">קומפילציה-ילידה → ניקוי → סכימה-קפדנית → כתובת-תוכן → חוק-קצב L-26</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge tone={data?.state === 'LIVE' ? 'emerald' : data ? 'amber' : 'rose'} solid pulse={data?.state === 'LIVE'}>
              {data ? (data.state === 'LIVE' ? `${data.verdict ?? 'COMPILED'}` : 'STALE') : 'מנותק'}
            </StatusBadge>
            <Button variant="outline" size="icon" onClick={load} disabled={loading} aria-label="רענון מאגר-התוכן" className="h-11 w-11 border-slate-700 hover:bg-slate-800">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <StatusBadge tone={ready > 0 ? 'emerald' : 'slate'} solid>
            <span dir="ltr">{ready}/{data?.stats?.bufferMax ?? 24} READY</span>
          </StatusBadge>
          <StatusBadge tone={frozen ? 'amber' : 'emerald'} title="שער-הקוסטודיה T-15: RED מקפיא את המאגר">
            {data?.custodyGate ?? 'שער-לא-ידוע'}
          </StatusBadge>
          <StatusBadge tone="slate">זבל-נגרס <span dir="ltr" className="tnum">{data?.stats?.dupDropped ?? 0}</span></StatusBadge>
          <StatusBadge tone="slate">דחויות <span dir="ltr" className="tnum">{data?.stats?.rejected ?? 0}</span></StatusBadge>
          <StatusBadge tone="slate">ניקויים <span dir="ltr" className="tnum">{data?.stats?.scrubHits ?? 0}</span></StatusBadge>
        </div>

        {frozen && (
          <p className="mt-2 rounded-lg border border-amber-900/60 bg-amber-950/30 p-2 text-[11px] leading-relaxed text-amber-300/90">
            שער-הקוסטודיה (T-15) אדום — המאגר קפוא: חבילות-מוכנות נשמרות אך השידור מושהה עד שהמנוע יוכיח בריאות-מלאה מחדש.
          </p>
        )}

        {!!data?.packages?.length && (
          <div className="mt-3 max-h-72 space-y-1.5 overflow-y-auto pe-1" role="list" aria-label="חבילות-תוכן מוכנות-שידור">
            {data.packages.map((p, i) => (
              <div key={`${p.id ?? i}`} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2" role="listitem">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-xs font-semibold text-slate-200" dir="auto">{p.title ?? '—'}</p>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {p.frozen && <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-300">קפוא</Badge>}
                    <StatusBadge tone={p.state === 'BROADCAST-READY' ? 'emerald' : 'rose'} className="text-[10px]">
                      {p.state === 'BROADCAST-READY' ? 'READY' : 'REJECTED'}
                    </StatusBadge>
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-slate-500">
                  <span dir="ltr" className="tnum">{p.id?.slice(0, 22) ?? '—'}</span>
                  <span dir="ltr" className="tnum">{p.bytes ?? 0}B · {p.words ?? 0} words</span>
                  <span>{p.chain ?? 'steem'}</span>
                  <span dir="ltr">L-26 slot {p.eligibleAt?.slice(11, 19) ?? '—'}Z</span>
                  {!!p.scrubbed && <span className="text-amber-400/80">scrubbed {p.scrubbed}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          {data?.law ?? 'המסילה לא משדרת לעולם — מסילות-השידור המוגבלות-קוסטודיה נשארות השדרן היחיד (חוק-גוף-אחד).'}
          {data?.headCid && <> · ראש-השרשרת <span dir="ltr" className="tnum text-slate-400">{data.headCid.slice(0, 26)}</span></>}
          {netErr && <span className="text-rose-400"> · שגיאת-רשת, מציג נתון-אחרון</span>}
        </p>
      </CardContent>
    </Card>
  )
}
