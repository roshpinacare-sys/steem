'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Fingerprint, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusBadge } from './StatusBadge'
import { cn } from '@/lib/utils'

/**
 * R287 · THE LIVE AUTHORITY WATCHDOG CARD. Polls /api/saos/authority-watchdog
 * (a thin reader over the engine's measured GPG-signature metrics + the
 * node-health circuit breaker) every 60s. Every non-G commit anywhere in the
 * fleet lineage is a named flag; the reader route echoes flags to dev.log on
 * each poll (the "unsigned line additions surface instantly" law). Node
 * health receipts (receipts/node-health.jsonl) feed the circuit breaker:
 * 3 consecutive failures or >2500ms quarantines an endpoint for 30 minutes.
 */

type RepoRow = { repo: string; coverage: string; method: string | null; scanned: number | null; signedPct: number | null; unsigned: number | null; invalid: number | null }
type Flag = { repo: string; hash: string; sig: string; author: string; subject: string }
type Ep = { chain: string; endpoint: string; ok: boolean; ms: number | null; verdict: string; reason: string | null }

type WatchdogState = {
  ok: boolean
  state: 'LIVE' | 'STALE'
  ageMin: number | null
  verdict: string | null
  coverage: { measured: number; total: number } | null
  repos: RepoRow[]
  flagged: Flag[]
  nodeHealth: { state: string; verdict: string; alive: number; quarantined: number; endpoints: Ep[] } | null
  law: string
}

const POLL_MS = 60_000

export function WatchdogCard() {
  const [data, setData] = useState<WatchdogState | null>(null)
  const [loading, setLoading] = useState(false)
  const [netErr, setNetErr] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/saos/authority-watchdog', { cache: 'no-store' })
      const j = (await r.json()) as WatchdogState
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

  const dirty = (data?.verdict ?? '').endsWith('-FLAGGED')
  const coverageOk = (data?.coverage?.measured ?? 0) > 0 && data?.coverage?.measured === data?.coverage?.total

  return (
    <Card className={cn('py-0 backdrop-blur-sm', dirty ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 to-slate-900/60')}>
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg border border-emerald-500/30 bg-emerald-500/10">
              <Fingerprint className="h-5 w-5 text-emerald-400" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-bold text-emerald-300">כלב-השמירה על-הרשויות <span dir="ltr" className="text-slate-500">(R287)</span></p>
              <p className="text-[11px] text-slate-500">חתימות-GPG של כל-הקומיטים בצי · אפס-הוספה-לא-חתומה-בשקט</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge tone={data?.state === 'LIVE' ? (dirty ? 'amber' : 'emerald') : data ? 'amber' : 'rose'} solid pulse={data?.state === 'LIVE'}>
              {data ? (data.state === 'LIVE' ? data.verdict ?? '—' : 'STALE') : 'מנותק'}
            </StatusBadge>
            <Button variant="outline" size="icon" onClick={load} disabled={loading} aria-label="רענון כלב-השמירה" className="h-11 w-11 border-slate-700 hover:bg-slate-800">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <StatusBadge tone={coverageOk ? 'emerald' : 'amber'} title="כיסוי נמדד, לא מונח — מאגר-לא-נגיש מדווח ככזה">
            כיסוי <span dir="ltr" className="tnum">{data?.coverage?.measured ?? 0}/{data?.coverage?.total ?? 7}</span> מאגרים
          </StatusBadge>
          <StatusBadge tone={dirty ? 'amber' : 'emerald'} solid>
            דגלים <span dir="ltr" className="tnum">{data?.flagged?.length ?? 0}</span>
          </StatusBadge>
          {data?.nodeHealth && (
            <StatusBadge tone={data.nodeHealth.quarantined > 0 ? 'amber' : 'emerald'} title="שובר-מעגל: 3 כשלים רצופים או >2500ms → הסגר 30 דק">
              צמתים <span dir="ltr" className="tnum">{data.nodeHealth.alive}</span> חיים · הסגר <span dir="ltr" className="tnum">{data.nodeHealth.quarantined}</span>
            </StatusBadge>
          )}
        </div>

        {/* fleet signature matrix */}
        <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
          {(data?.repos ?? []).map((r) => (
            <div key={r.repo} className="min-w-0 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2">
              <div className="flex items-center justify-between gap-1">
                <span className="truncate text-[11px] font-semibold text-slate-300" dir="ltr" title={r.repo}>{r.repo}</span>
                <StatusBadge tone={r.coverage !== 'MEASURED' ? 'slate' : (r.signedPct ?? 0) >= 80 ? 'emerald' : 'amber'} className="text-[10px]">
                  {r.coverage === 'MEASURED' ? `${r.signedPct ?? 0}%` : r.coverage.slice(0, 9)}
                </StatusBadge>
              </div>
              <p className="mt-0.5 text-[10px] text-slate-500" dir="ltr" >
                {r.coverage === 'MEASURED' ? `${r.scanned ?? 0} commits · ${r.unsigned ?? 0} unsigned` : r.method ?? 'measured-later'}
              </p>
            </div>
          ))}
          {!data && <p className="col-span-full text-xs text-slate-500">ממתין לסריקה-הראשונה של המנוע…</p>}
        </div>

        {/* flagged commits */}
        {!!data?.flagged?.length && (
          <div className="mt-3">
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold text-amber-300">
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> קומיטים-לא-חתומים (כל אחד מדווח בשמו — אין-סחיבה-שקטה)
            </p>
            <div className="max-h-44 divide-y divide-slate-800/70 overflow-y-auto rounded-lg border border-slate-800" role="list" aria-label="קומיטים מדוגלים">
              {data.flagged.map((f, i) => (
                <div key={`${f.repo}:${f.hash}:${i}`} className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 px-3 py-1.5 text-[11px]" role="listitem">
                  <span dir="ltr" className="tnum text-slate-400">{f.hash}</span>
                  <StatusBadge tone={f.sig === 'UNSIGNED' ? 'amber' : 'rose'} className="text-[9px]">{f.sig}</StatusBadge>
                  <span className="text-slate-500" dir="ltr">{f.repo}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-400" dir="auto" title={f.subject}>{f.subject}</span>
                  <span className="text-slate-600" dir="ltr">{f.author}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* node health */}
        {!!data?.nodeHealth?.endpoints?.length && (
          <div className="mt-3">
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold text-slate-300">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden /> בריאות-צמתים · קבלות דינמיות <span dir="ltr" className="font-normal text-slate-500">receipts/node-health.jsonl</span>
            </p>
            <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-800">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-slate-900/95 text-slate-500">
                  <tr>
                    <th className="px-3 py-1.5 text-start font-semibold">שרשרת</th>
                    <th className="px-3 py-1.5 text-start font-semibold">צומת</th>
                    <th className="px-3 py-1.5 text-end font-semibold">השהיה</th>
                    <th className="px-3 py-1.5 text-end font-semibold">ורדיקט</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {data.nodeHealth.endpoints.map((e, i) => (
                    <tr key={`${e.chain}:${e.endpoint}:${i}`} className="transition-colors hover:bg-slate-800/40">
                      <td className="px-3 py-1.5 text-slate-300">{e.chain}</td>
                      <td className="px-3 py-1.5 text-slate-400" dir="ltr">{e.endpoint.replace(/^https:\/\//, '')}</td>
                      <td className="px-3 py-1.5 text-end tnum" dir="ltr">{e.ok ? `${e.ms ?? '?'}ms` : 'FAIL'}</td>
                      <td className="px-3 py-1.5 text-end">
                        <StatusBadge tone={e.verdict === 'OPEN' ? (e.ok ? 'emerald' : 'amber') : 'rose'} className="text-[10px]">{e.verdict}</StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          {data?.law ?? 'אימות git-native מול מחזיק-המפתח-הציבורי של הצי; דגלי-חתימה זורמים ל-dev.log בכל דגימה.'}
          {netErr && <span className="text-rose-400"> · שגיאת-רשת, מציג נתון-אחרון</span>}
        </p>
      </CardContent>
    </Card>
  )
}
